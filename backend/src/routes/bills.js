import { Router } from 'express';
import multer from 'multer';
import { ROLES, authenticate, requireRole } from '../auth.js';
import { withTransaction } from '../db.js';
import { badRequest, forbidden, notFound } from '../errors.js';
import { centsToString, milliToString } from '../money.js';
import { serializeBill } from '../serializers.js';
import { IMAGE_TYPES } from '../storage.js';
import { ULID_PATTERN, ulid } from '../ulid.js';
import { validateBill } from '../validation.js';

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;
const FEED_STATUSES = new Set(['open', 'blessed', 'closed']);

const BILL_COLUMNS = `b.id, b.public_id, b.user_id, b.title, b.merchant, b.description, b.image_key,
  b.item_count, b.subtotal, b.tax, b.total, b.currency, b.status, b.created_at,
  u.public_id AS poster_public_id, u.display_name AS poster_display_name`;

export function billsRouter({ pool, config, storage }) {
  const router = Router();
  router.use(authenticate({ pool, config }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 5, fieldSize: 256 * 1024 },
  });

  // Billable members upload a photo of their bill together with the items the
  // app recognised (and the member reviewed) from that photo.
  router.post('/', requireRole(ROLES.BILLABLE), upload.single('image'), async (req, res) => {
    if (!req.file) throw badRequest('image is required (multipart field "image")', { field: 'image' });
    const extension = detectImageType(req.file.buffer);
    if (!extension) throw badRequest('image must be a JPEG, PNG or HEIC photo', { field: 'image' });

    let payload;
    try {
      payload = JSON.parse(req.body.bill ?? '');
    } catch {
      throw badRequest('bill must be a JSON string (multipart field "bill")', { field: 'bill' });
    }
    const bill = validateBill(payload);

    const publicId = ulid();
    const imageKey = `bills/${publicId.slice(0, 2)}/${publicId}.${extension}`;
    await storage.put(imageKey, req.file.buffer);

    try {
      await withTransaction(pool, async (conn) => {
        const [result] = await conn.execute(
          `INSERT INTO bills (public_id, user_id, title, merchant, description, image_key, item_count,
             subtotal, tax, total, ocr_raw_text)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            publicId, req.user.id, bill.title, bill.merchant, bill.description, imageKey, bill.items.length,
            centsToString(bill.subtotalCents), centsToString(bill.taxCents), centsToString(bill.totalCents),
            bill.ocrRawText,
          ],
        );
        if (bill.items.length > 0) {
          await conn.query('INSERT INTO bill_items (bill_id, line_no, name, quantity, unit_price, line_total) VALUES ?', [
            bill.items.map((item) => [
              result.insertId, item.lineNo, item.name, milliToString(item.quantityMilli),
              centsToString(item.unitPriceCents), centsToString(item.lineTotalCents),
            ]),
          ]);
        }
      });
    } catch (err) {
      await storage.remove(imageKey);
      throw err;
    }

    const row = await findBill(pool, publicId);
    res.status(201).json({ bill: serializeBill(row, await findItems(pool, row.id)) });
  });

  // A Billable member's own bills.
  router.get('/mine', requireRole(ROLES.BILLABLE), async (req, res) => {
    const { limit, beforeId } = pageParams(req.query);
    const params = [req.user.id];
    let where = 'b.user_id = ?';
    if (beforeId) {
      where += ' AND b.id < ?';
      params.push(beforeId);
    }
    res.json(await page(pool, where, params, limit));
  });

  // Blessings members can see any and all Billable postings.
  router.get('/feed', requireRole(ROLES.BLESSINGS), async (req, res) => {
    const { limit, beforeId } = pageParams(req.query);
    const params = [];
    let where;
    if (req.query.status !== undefined) {
      if (!FEED_STATUSES.has(req.query.status)) throw badRequest('status must be open, blessed or closed', { field: 'status' });
      where = 'b.status = ?';
      params.push(req.query.status);
    } else {
      where = "b.status <> 'removed'";
    }
    if (beforeId) {
      where += ' AND b.id < ?';
      params.push(beforeId);
    }
    res.json(await page(pool, where, params, limit));
  });

  router.get('/:id', async (req, res) => {
    const row = await findVisibleBill(pool, req.params.id, req.user);
    res.json({ bill: serializeBill(row, await findItems(pool, row.id)) });
  });

  router.get('/:id/image', async (req, res) => {
    const row = await findVisibleBill(pool, req.params.id, req.user);
    const extension = row.image_key.split('.').pop();
    const contentType = Object.keys(IMAGE_TYPES).find((type) => IMAGE_TYPES[type] === extension);
    res.set('Cache-Control', 'private, max-age=86400');
    res.type(contentType ?? 'application/octet-stream').send(await storage.get(row.image_key));
  });

  return router;
}

function pageParams(query) {
  let limit = PAGE_SIZE_DEFAULT;
  if (query.limit !== undefined) {
    limit = Number.parseInt(query.limit, 10);
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_SIZE_MAX) {
      throw badRequest(`limit must be between 1 and ${PAGE_SIZE_MAX}`, { field: 'limit' });
    }
  }
  let beforeId = null;
  if (query.cursor) {
    beforeId = Number.parseInt(Buffer.from(String(query.cursor), 'base64url').toString('utf8'), 10);
    if (!Number.isSafeInteger(beforeId) || beforeId < 1) throw badRequest('cursor is invalid', { field: 'cursor' });
  }
  return { limit, beforeId };
}

// Keyset pagination on the primary key: constant cost no matter how deep the
// member scrolls, which matters once the bills table holds millions of rows.
async function page(pool, where, params, limit) {
  const [rows] = await pool.execute(
    `SELECT ${BILL_COLUMNS} FROM bills b JOIN users u ON u.id = b.user_id
     WHERE ${where} ORDER BY b.id DESC LIMIT ${limit + 1}`,
    params,
  );
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  return {
    bills: pageRows.map((row) => serializeBill(row)),
    nextCursor: hasMore ? Buffer.from(String(last.id)).toString('base64url') : null,
  };
}

async function findBill(pool, publicId) {
  const [rows] = await pool.execute(
    `SELECT ${BILL_COLUMNS} FROM bills b JOIN users u ON u.id = b.user_id WHERE b.public_id = ?`,
    [publicId],
  );
  return rows[0];
}

async function findVisibleBill(pool, publicId, user) {
  if (!ULID_PATTERN.test(publicId)) throw notFound('Bill not found');
  const row = await findBill(pool, publicId);
  if (!row || row.status === 'removed') throw notFound('Bill not found');
  const isOwner = row.user_id === user.id;
  if (!isOwner && user.role !== ROLES.BLESSINGS) throw forbidden();
  return row;
}

async function findItems(pool, billId) {
  const [rows] = await pool.execute(
    'SELECT line_no, name, quantity, unit_price, line_total FROM bill_items WHERE bill_id = ? ORDER BY line_no',
    [billId],
  );
  return rows;
}

/** Identifies the image type from its magic bytes rather than trusting the client's MIME type. */
function detectImageType(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buffer.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'heim', 'heis'].includes(brand)) return 'heic';
    if (['mif1', 'msf1'].includes(brand)) return 'heif';
  }
  return null;
}
