// Integration tests against a real MySQL (or MariaDB) server.
// Configure with TEST_DB_HOST / TEST_DB_PORT / TEST_DB_USER / TEST_DB_PASSWORD;
// the suite is skipped when no server is reachable.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import mysql from 'mysql2/promise';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPool } from '../src/db.js';
import { createDiskStorage } from '../src/storage.js';

const DB_NAME = 'getblessed_test';
const dbConfig = {
  host: process.env.TEST_DB_HOST ?? '127.0.0.1',
  port: Number(process.env.TEST_DB_PORT ?? 3306),
  user: process.env.TEST_DB_USER ?? 'root',
  password: process.env.TEST_DB_PASSWORD ?? '',
};

// Smallest valid JPEG header bytes are enough for the magic-byte check.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);

async function setupDatabase() {
  let conn;
  try {
    conn = await mysql.createConnection({ ...dbConfig, multipleStatements: true });
  } catch {
    return false;
  }
  const [[{ version }]] = await conn.query('SELECT VERSION() AS version');
  let sql = (await readFile(new URL('../../database/schema.sql', import.meta.url), 'utf8')).replaceAll('getblessed', DB_NAME);
  if (/mariadb/i.test(version)) sql = sql.replaceAll('utf8mb4_0900_ai_ci', 'utf8mb4_unicode_ci');
  await conn.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
  await conn.query(sql);
  await conn.end();
  return true;
}

const available = await setupDatabase();

describe('GetBlessed API', { skip: !available && 'no MySQL server reachable' }, () => {
  let pool;
  let app;
  let uploadDir;

  before(async () => {
    uploadDir = await mkdtemp(path.join(tmpdir(), 'getblessed-'));
    pool = createPool({ ...dbConfig, database: DB_NAME, connectionLimit: 5 });
    const config = { jwtSecret: 'test-secret', jwtTtl: '1h', bcryptRounds: 4, maxUploadBytes: 1024 * 1024, authRateLimit: 1000 };
    app = createApp({ pool, config, storage: createDiskStorage(uploadDir), logger: { error() {} } });
  });

  after(async () => {
    await pool?.end();
    if (uploadDir) await rm(uploadDir, { recursive: true, force: true });
  });

  const billable = { email: 'billy@example.com', password: 'password123', displayName: 'Billy' };
  const blessings = { email: 'grace@example.com', password: 'password123', displayName: 'Grace', annualIncome: '250000' };
  let billableToken;
  let blessingsToken;
  let billId;

  test('billable sign-up assigns the billable role automatically', async () => {
    const res = await request(app).post('/api/auth/signup/billable').send({ ...billable, role: 'blessings' }).expect(201);
    assert.equal(res.body.user.role, 'billable');
    assert.equal(res.body.user.annualIncome, undefined);
    billableToken = res.body.token;
  });

  test('blessings sign-up stores yearly income and assigns the blessings role', async () => {
    const res = await request(app).post('/api/auth/signup/blessings').send(blessings).expect(201);
    assert.equal(res.body.user.role, 'blessings');
    assert.equal(res.body.user.annualIncome, '250000.00');
    blessingsToken = res.body.token;
  });

  test('blessings sign-up without income is rejected', async () => {
    const res = await request(app)
      .post('/api/auth/signup/blessings')
      .send({ email: 'x@example.com', password: 'password123', displayName: 'X' })
      .expect(400);
    assert.equal(res.body.error.details.field, 'annualIncome');
  });

  test('duplicate email is rejected', async () => {
    await request(app).post('/api/auth/signup/billable').send(billable).expect(409);
  });

  test('login returns a token', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'GRACE@example.com', password: 'password123' }).expect(200);
    assert.equal(res.body.user.role, 'blessings');
    await request(app).post('/api/auth/login').send({ email: 'grace@example.com', password: 'wrong-pass' }).expect(401);
  });

  test('billable member uploads a bill photo with its items and total', async () => {
    const bill = {
      title: 'Grocery run',
      merchant: 'Corner Market',
      items: [
        { name: 'Milk', quantity: 2, unitPrice: '3.49', lineTotal: '6.98' },
        { name: 'Bread', unitPrice: '2.50' },
      ],
      tax: '0.38',
      total: '9.86',
      ocrRawText: 'CORNER MARKET\n2 x MILK 6.98\nBREAD 2.50\nTAX 0.38\nTOTAL 9.86',
    };
    const res = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${billableToken}`)
      .attach('image', JPEG, { filename: 'bill.jpg', contentType: 'image/jpeg' })
      .field('bill', JSON.stringify(bill))
      .expect(201);
    assert.equal(res.body.bill.itemCount, 2);
    assert.equal(res.body.bill.subtotal, '9.48');
    assert.equal(res.body.bill.total, '9.86');
    assert.deepEqual(res.body.bill.items.map((i) => [i.name, i.quantity, i.unitPrice, i.lineTotal]), [
      ['Milk', 2, '3.49', '6.98'],
      ['Bread', 1, '2.50', '2.50'],
    ]);
    billId = res.body.bill.id;
  });

  test('blessings members cannot upload bills', async () => {
    await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${blessingsToken}`)
      .attach('image', JPEG, 'bill.jpg')
      .field('bill', JSON.stringify({ title: 'x', items: [], total: '1.00' }))
      .expect(403);
  });

  test('non-image uploads are rejected', async () => {
    await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${billableToken}`)
      .attach('image', Buffer.from('definitely not an image'), { filename: 'x.jpg', contentType: 'image/jpeg' })
      .field('bill', JSON.stringify({ title: 'x', items: [], total: '1.00' }))
      .expect(400);
  });

  test('blessings members see all billable postings, paginated', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/bills')
        .set('Authorization', `Bearer ${billableToken}`)
        .attach('image', JPEG, 'bill.jpg')
        .field('bill', JSON.stringify({ title: `Bill ${i}`, items: [], total: '10.00' }))
        .expect(201);
    }
    const first = await request(app).get('/api/bills/feed?limit=3').set('Authorization', `Bearer ${blessingsToken}`).expect(200);
    assert.equal(first.body.bills.length, 3);
    assert.equal(first.body.bills[0].title, 'Bill 2');
    assert.equal(first.body.bills[0].postedBy.displayName, 'Billy');
    assert.ok(first.body.nextCursor);
    const second = await request(app)
      .get(`/api/bills/feed?limit=3&cursor=${first.body.nextCursor}`)
      .set('Authorization', `Bearer ${blessingsToken}`)
      .expect(200);
    assert.deepEqual(second.body.bills.map((b) => b.id), [billId]);
    assert.equal(second.body.nextCursor, null);
  });

  test('billable members cannot see the blessings feed', async () => {
    await request(app).get('/api/bills/feed').set('Authorization', `Bearer ${billableToken}`).expect(403);
  });

  test('bill details and image are visible to blessings members and the owner only', async () => {
    const detail = await request(app).get(`/api/bills/${billId}`).set('Authorization', `Bearer ${blessingsToken}`).expect(200);
    assert.equal(detail.body.bill.items.length, 2);
    const image = await request(app).get(`/api/bills/${billId}/image`).set('Authorization', `Bearer ${billableToken}`).expect(200);
    assert.equal(image.headers['content-type'], 'image/jpeg');

    const other = await request(app)
      .post('/api/auth/signup/billable')
      .send({ email: 'other@example.com', password: 'password123', displayName: 'Other' })
      .expect(201);
    await request(app).get(`/api/bills/${billId}`).set('Authorization', `Bearer ${other.body.token}`).expect(403);
    const mine = await request(app).get('/api/bills/mine').set('Authorization', `Bearer ${other.body.token}`).expect(200);
    assert.equal(mine.body.bills.length, 0);
  });

  test('requests without a token are rejected', async () => {
    await request(app).get('/api/bills/feed').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer nope').expect(401);
  });
});
