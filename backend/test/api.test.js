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

// Stand-ins for Apple's and Stripe's services: "signed" payloads are plain JSON.
const fakeAppleVerifier = {
  async verifyTransaction(jws) {
    return JSON.parse(jws);
  },
  async verifyNotification(payload) {
    return JSON.parse(payload);
  },
};
const paymentIntents = [];
const fakePayments = {
  publishableKey: 'pk_test_123',
  async createPaymentIntent(args) {
    paymentIntents.push(args);
    return { id: `pi_${paymentIntents.length}`, clientSecret: `pi_${paymentIntents.length}_secret` };
  },
  parseWebhook(rawBody, signature) {
    if (signature !== 'valid') throw new Error('bad signature');
    return JSON.parse(rawBody.toString('utf8'));
  },
};

const appleTransaction = (overrides) =>
  JSON.stringify({
    productId: 'com.getblessed.app.blessings.yearly',
    originalTransactionId: '1000000001',
    transactionId: '1000000001',
    expiresDate: Date.now() + 365 * 24 * 3600 * 1000,
    environment: 'Sandbox',
    ...overrides,
  });

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
    app = createApp({
      pool,
      config,
      storage: createDiskStorage(uploadDir),
      payments: fakePayments,
      appleVerifier: fakeAppleVerifier,
      logger: { error() {}, warn() {} },
    });
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
  let appAccountToken;

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
    assert.match(res.body.user.appAccountToken, /^[0-9a-f-]{36}$/);
    assert.equal(res.body.user.subscription, null);
    blessingsToken = res.body.token;
    appAccountToken = res.body.user.appAccountToken;
  });

  test('pricing lists the three Blessings plans and the tip service fee', async () => {
    const res = await request(app).get('/api/pricing').expect(200);
    assert.deepEqual(res.body.plans.map((p) => [p.name, p.price]), [
      ['Monthly', '9.99'],
      ['1-Year', '69.99'],
      ['2-Year', '104.99'],
    ]);
    assert.deepEqual(res.body.tipServiceFee, { fee: '1.99', per: '800.00' });
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

  test('blessings members need a plan before they can see bills', async () => {
    const res = await request(app).get('/api/bills/feed').set('Authorization', `Bearer ${blessingsToken}`).expect(402);
    assert.equal(res.body.error.code, 'subscription_required');
    await request(app).get(`/api/bills/${billId}`).set('Authorization', `Bearer ${blessingsToken}`).expect(402);
  });

  test('a purchase made for another account is rejected', async () => {
    await request(app)
      .post('/api/subscriptions/apple')
      .set('Authorization', `Bearer ${blessingsToken}`)
      .send({ signedTransaction: appleTransaction({ appAccountToken: '00000000-0000-0000-0000-000000000000' }) })
      .expect(403);
  });

  test('a verified App Store purchase activates the plan', async () => {
    const res = await request(app)
      .post('/api/subscriptions/apple')
      .set('Authorization', `Bearer ${blessingsToken}`)
      .send({ signedTransaction: appleTransaction({ appAccountToken: appAccountToken.toUpperCase() }) })
      .expect(200);
    assert.equal(res.body.subscription.plan, 'yearly');
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${blessingsToken}`).expect(200);
    assert.equal(me.body.user.subscription.plan, 'yearly');
  });

  test('the 2-Year plan is a one-time purchase that lasts 2 years', async () => {
    const other = await request(app)
      .post('/api/auth/signup/blessings')
      .send({ email: 'twoyear@example.com', password: 'password123', displayName: 'Two', annualIncome: '1' })
      .expect(201);
    const purchased = Date.UTC(2026, 0, 15);
    const signedTransaction = JSON.stringify({
      productId: 'com.getblessed.app.blessings.twoyear',
      originalTransactionId: '2000000001',
      transactionId: '2000000001',
      purchaseDate: purchased,
      appAccountToken: other.body.user.appAccountToken,
    });
    const res = await request(app)
      .post('/api/subscriptions/apple')
      .set('Authorization', `Bearer ${other.body.token}`)
      .send({ signedTransaction })
      .expect(200);
    assert.equal(res.body.subscription.plan, 'two_year');
    assert.equal(new Date(res.body.subscription.expiresAt).toISOString(), '2028-01-15T00:00:00.000Z');
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

  test('blessing a bill charges $1.99 tip service fee for every started $800', async () => {
    const bless = (id, amount) =>
      request(app).post(`/api/bills/${id}/blessings`).set('Authorization', `Bearer ${blessingsToken}`).send({ amount });

    const big = await request(app)
      .post('/api/bills')
      .set('Authorization', `Bearer ${billableToken}`)
      .attach('image', JPEG, 'bill.jpg')
      .field('bill', JSON.stringify({ title: 'Rent', items: [], total: '2000.00' }))
      .expect(201);
    const rentId = big.body.bill.id;

    const cases = [
      ['50.00', '1.99', '51.99'],
      ['800.00', '1.99', '801.99'],
      ['800.01', '3.98', '803.99'],
      ['1600.00', '3.98', '1603.98'],
      ['1600.01', '5.97', '1605.98'],
    ];
    for (const [amount, fee, charge] of cases) {
      const res = await bless(rentId, amount).expect(201);
      assert.equal(res.body.blessing.tipServiceFee, fee, `fee for ${amount}`);
      assert.equal(res.body.blessing.chargeTotal, charge);
      assert.equal(res.body.blessing.status, 'pending');
      assert.equal(res.body.payment.publishableKey, 'pk_test_123');
      assert.equal(paymentIntents.at(-1).amountCents, Math.round(Number(charge) * 100));
    }

    await bless(rentId, '2000.01').expect(400);
    await bless(rentId, '0').expect(400);
    await request(app)
      .post(`/api/bills/${rentId}/blessings`)
      .set('Authorization', `Bearer ${billableToken}`)
      .send({ amount: '10.00' })
      .expect(403);
  });

  test('a successful payment marks the blessing and fully blessed bill', async () => {
    const res = await request(app)
      .post(`/api/bills/${billId}/blessings`)
      .set('Authorization', `Bearer ${blessingsToken}`)
      .send({ amount: '9.86' })
      .expect(201);
    const intentId = `pi_${paymentIntents.length}`;
    const event = JSON.stringify({ type: 'payment_intent.succeeded', data: { object: { id: intentId } } });
    const webhook = (signature) =>
      request(app).post('/api/stripe/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signature).send(event);

    await webhook('forged').expect(400);
    await webhook('valid').expect(200);
    await webhook('valid').expect(200); // duplicate delivery must not double count

    const bill = await request(app).get(`/api/bills/${billId}`).set('Authorization', `Bearer ${billableToken}`).expect(200);
    assert.equal(bill.body.bill.amountBlessed, '9.86');
    assert.equal(bill.body.bill.amountRemaining, '0.00');
    assert.equal(bill.body.bill.status, 'blessed');

    const history = await request(app).get('/api/blessings/mine').set('Authorization', `Bearer ${blessingsToken}`).expect(200);
    const blessing = history.body.blessings.find((b) => b.id === res.body.blessing.id);
    assert.equal(blessing.status, 'succeeded');
    assert.equal(blessing.tipServiceFee, '1.99');

    await request(app)
      .post(`/api/bills/${billId}/blessings`)
      .set('Authorization', `Bearer ${blessingsToken}`)
      .send({ amount: '1.00' })
      .expect(409);
  });

  test('App Store notifications update the plan, and expired plans lose access', async () => {
    const notification = JSON.stringify({
      notificationType: 'EXPIRED',
      transaction: JSON.parse(appleTransaction({ appAccountToken, expiresDate: Date.now() + 1000 * 3600 * 24 * 400 })),
    });
    await request(app).post('/api/apple/notifications').send({ signedPayload: notification }).expect(200);
    // An older (out-of-order) expiry must not shorten the plan...
    const stale = JSON.stringify({ transaction: JSON.parse(appleTransaction({ appAccountToken, expiresDate: Date.now() - 1000 })) });
    await request(app).post('/api/apple/notifications').send({ signedPayload: stale }).expect(200);
    await request(app).get('/api/bills/feed').set('Authorization', `Bearer ${blessingsToken}`).expect(200);
    // ...but a refund revokes it.
    const refund = JSON.stringify({ transaction: JSON.parse(appleTransaction({ appAccountToken, revocationDate: Date.now() })) });
    await request(app).post('/api/apple/notifications').send({ signedPayload: refund }).expect(200);
    await request(app).get('/api/bills/feed').set('Authorization', `Bearer ${blessingsToken}`).expect(402);
  });

  test('requests without a token are rejected', async () => {
    await request(app).get('/api/bills/feed').expect(401);
    await request(app).get('/api/auth/me').set('Authorization', 'Bearer nope').expect(401);
  });
});
