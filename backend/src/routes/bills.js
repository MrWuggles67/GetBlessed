const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db');
const { wrap, authenticate, requireRole } = require('../auth');
const { normalizeItems, round2 } = require('../billing');
const { getSettings, isTrue } = require('../settings');

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads');
const TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + TYPES[file.mimetype]),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(TYPES[file.mimetype] ? null : new Error('Only JPEG, PNG or WebP images allowed'), !!TYPES[file.mimetype]),
});

const router = express.Router();
router.use(authenticate);

const withUrl = (b) => ({ ...b, imageUrl: '/uploads/' + b.image_path });

// Billable users upload a bill: image + items (detected on-device) as JSON.
router.post('/', requireRole('billable'), upload.single('image'), wrap(async (req, res) => {
  const settings = await getSettings();
  if (!isTrue(settings.uploads_enabled)) return res.status(403).json({ error: 'Uploads are currently disabled' });
  if (!req.file) return res.status(400).json({ error: 'Bill image required' });
  let parsed;
  try {
    parsed = normalizeItems(JSON.parse(req.body.items || '[]'));
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (parsed.total > Number(settings.max_bill_total)) return res.status(400).json({ error: 'Bill total exceeds the allowed maximum' });
  const status = isTrue(settings.require_bill_approval) ? 'pending' : 'approved';
  const merchant = String(req.body.merchant || '').trim().slice(0, 160) || null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.query(
      'INSERT INTO bills (user_id, merchant, image_path, total, status) VALUES (?, ?, ?, ?, ?)',
      [req.user.id, merchant, req.file.filename, parsed.total, status]
    );
    await conn.query('INSERT INTO bill_items (bill_id, name, quantity, price) VALUES ?', [
      parsed.items.map((i) => [r.insertId, i.name, i.quantity, i.price]),
    ]);
    await conn.commit();
    res.status(201).json({ id: r.insertId, total: parsed.total, status });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

// Billable: own bills. Blessings: every bill (admin approval hides only rejected/pending ones).
router.get('/', requireRole('billable', 'blessings'), wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const own = req.user.role === 'billable';
  const [rows] = await pool.query(
    `SELECT b.id, b.merchant, b.image_path, b.total, b.status, b.created_at, u.name AS owner_name,
            COALESCE((SELECT SUM(amount) FROM blessings WHERE bill_id = b.id), 0) AS blessed_amount
       FROM bills b JOIN users u ON u.id = b.user_id
      WHERE ${own ? 'b.user_id = ?' : "b.status IN ('approved','blessed') AND ? IS NOT NULL"}
      ORDER BY b.created_at DESC LIMIT ? OFFSET ?`,
    [req.user.id, limit, offset]
  );
  res.json({ bills: rows.map(withUrl) });
}));

router.get('/:id', requireRole('billable', 'blessings'), wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT b.*, u.name AS owner_name FROM bills b JOIN users u ON u.id = b.user_id WHERE b.id = ?`, [req.params.id]);
  const bill = rows[0];
  const visible = bill && (req.user.role === 'blessings' ? ['approved', 'blessed'].includes(bill.status) : bill.user_id === req.user.id);
  if (!visible) return res.status(404).json({ error: 'Bill not found' });
  const [items] = await pool.query('SELECT name, quantity, price FROM bill_items WHERE bill_id = ? ORDER BY id', [bill.id]);
  const [[{ blessed }]] = await pool.query('SELECT COALESCE(SUM(amount),0) AS blessed FROM blessings WHERE bill_id = ?', [bill.id]);
  res.json({ ...withUrl(bill), items, blessed_amount: blessed });
}));

router.post('/:id/bless', requireRole('blessings'), wrap(async (req, res) => {
  const amount = round2(Number(req.body.amount));
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Valid amount required' });
  const message = String(req.body.message || '').trim().slice(0, 500) || null;
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT id, total, status FROM bills WHERE id = ? FOR UPDATE', [req.params.id]);
    const bill = rows[0];
    if (!bill || !['approved', 'blessed'].includes(bill.status)) {
      await conn.rollback();
      return res.status(404).json({ error: 'Bill not found' });
    }
    const [[{ blessed }]] = await conn.query('SELECT COALESCE(SUM(amount),0) AS blessed FROM blessings WHERE bill_id = ?', [bill.id]);
    const remaining = round2(bill.total - blessed);
    if (amount > remaining) {
      await conn.rollback();
      return res.status(400).json({ error: `Only ${remaining.toFixed(2)} remains on this bill` });
    }
    await conn.query('INSERT INTO blessings (bill_id, blesser_id, amount, message) VALUES (?, ?, ?, ?)', [bill.id, req.user.id, amount, message]);
    if (amount === remaining) await conn.query("UPDATE bills SET status = 'blessed' WHERE id = ?", [bill.id]);
    await conn.commit();
    res.status(201).json({ remaining: round2(remaining - amount) });
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}));

module.exports = router;
