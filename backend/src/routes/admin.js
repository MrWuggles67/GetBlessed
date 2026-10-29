const express = require('express');
const bcrypt = require('bcryptjs');
const fs = require('fs/promises');
const path = require('path');
const pool = require('../db');
const { wrap, authenticate, requireRole } = require('../auth');
const { getSettings } = require('../settings');

const router = express.Router();
router.use(authenticate, requireRole('admin'));

const ROLES = ['billable', 'blessings', 'admin'];
const BILL_STATUSES = ['pending', 'approved', 'rejected', 'blessed'];
const SETTING_KEYS = ['signups_enabled', 'uploads_enabled', 'require_bill_approval', 'max_bill_total', 'min_blessing_income', 'site_name'];
const paging = (q) => ({ limit: Math.min(Number(q.limit) || 25, 100), offset: Math.max(Number(q.offset) || 0, 0) });

router.get('/stats', wrap(async (req, res) => {
  const [[u]] = await pool.query(
    `SELECT COUNT(*) AS users, SUM(role='billable') AS billable, SUM(role='blessings') AS blessings,
            SUM(status='suspended') AS suspended, SUM(created_at > NOW() - INTERVAL 7 DAY) AS new_week FROM users`);
  const [[b]] = await pool.query(
    `SELECT COUNT(*) AS bills, COALESCE(SUM(total),0) AS total_value, SUM(status='pending') AS pending FROM bills`);
  const [[s]] = await pool.query('SELECT COUNT(*) AS blessings, COALESCE(SUM(amount),0) AS blessed_total FROM blessings');
  res.json({ users: u, bills: b, blessings: s });
}));

router.get('/users', wrap(async (req, res) => {
  const { limit, offset } = paging(req.query);
  const where = []; const args = [];
  if (ROLES.includes(req.query.role)) { where.push('role = ?'); args.push(req.query.role); }
  if (req.query.q) { where.push('(email LIKE ? OR name LIKE ?)'); const q = `%${String(req.query.q).replace(/[\\%_]/g, '\\$&')}%`; args.push(q, q); }
  const clause = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await pool.query(
    `SELECT id, email, name, role, annual_income, status, created_at FROM users ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users ${clause}`, args);
  res.json({ users: rows, total });
}));

router.post('/users', wrap(async (req, res) => {
  const { email, name, password, role } = req.body;
  if (!email || !name || !ROLES.includes(role) || String(password || '').length < 8) return res.status(400).json({ error: 'email, name, role and a password of 8+ characters required' });
  const income = role === 'blessings' ? Number(req.body.annualIncome) || 0 : null;
  try {
    const [r] = await pool.query('INSERT INTO users (email, password_hash, name, role, annual_income) VALUES (?, ?, ?, ?, ?)',
      [String(email).toLowerCase(), await bcrypt.hash(String(password), 12), name, role, income]);
    res.status(201).json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already registered' });
    throw e;
  }
}));

router.patch('/users/:id', wrap(async (req, res) => {
  const sets = []; const args = [];
  if (req.body.role !== undefined) { if (!ROLES.includes(req.body.role)) return res.status(400).json({ error: 'Invalid role' }); sets.push('role = ?'); args.push(req.body.role); }
  if (req.body.status !== undefined) { if (!['active', 'suspended'].includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' }); sets.push('status = ?'); args.push(req.body.status); }
  if (req.body.password) { if (String(req.body.password).length < 8) return res.status(400).json({ error: 'Password too short' }); sets.push('password_hash = ?'); args.push(await bcrypt.hash(String(req.body.password), 12)); }
  if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
  if (Number(req.params.id) === req.user.id && (req.body.role || req.body.status)) return res.status(400).json({ error: 'You cannot change your own role or status' });
  await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...args, req.params.id]);
  res.json({ ok: true });
}));

router.delete('/users/:id', wrap(async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  await pool.query('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

router.get('/bills', wrap(async (req, res) => {
  const { limit, offset } = paging(req.query);
  const status = BILL_STATUSES.includes(req.query.status) ? req.query.status : null;
  const [rows] = await pool.query(
    `SELECT b.id, b.merchant, b.total, b.status, b.admin_note, b.image_path, b.created_at, u.email AS owner_email
       FROM bills b JOIN users u ON u.id = b.user_id ${status ? 'WHERE b.status = ?' : ''}
       ORDER BY b.id DESC LIMIT ? OFFSET ?`, status ? [status, limit, offset] : [limit, offset]);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM bills ${status ? 'WHERE status = ?' : ''}`, status ? [status] : []);
  res.json({ bills: rows.map((b) => ({ ...b, imageUrl: '/uploads/' + b.image_path })), total });
}));

router.get('/bills/:id', wrap(async (req, res) => {
  const [items] = await pool.query('SELECT name, quantity, price FROM bill_items WHERE bill_id = ? ORDER BY id', [req.params.id]);
  const [blessings] = await pool.query(
    'SELECT k.amount, k.message, k.created_at, u.email FROM blessings k JOIN users u ON u.id = k.blesser_id WHERE k.bill_id = ?', [req.params.id]);
  res.json({ items, blessings });
}));

router.patch('/bills/:id', wrap(async (req, res) => {
  if (!BILL_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  await pool.query('UPDATE bills SET status = ?, admin_note = ? WHERE id = ?',
    [req.body.status, String(req.body.note || '').slice(0, 500) || null, req.params.id]);
  res.json({ ok: true });
}));

router.delete('/bills/:id', wrap(async (req, res) => {
  const [rows] = await pool.query('SELECT image_path FROM bills WHERE id = ?', [req.params.id]);
  await pool.query('DELETE FROM bills WHERE id = ?', [req.params.id]);
  if (rows[0]) await fs.unlink(path.join(__dirname, '..', '..', 'uploads', path.basename(rows[0].image_path))).catch(() => {});
  res.json({ ok: true });
}));

router.get('/blessings', wrap(async (req, res) => {
  const { limit, offset } = paging(req.query);
  const [rows] = await pool.query(
    `SELECT k.id, k.bill_id, k.amount, k.message, k.created_at, u.email AS blesser_email
       FROM blessings k JOIN users u ON u.id = k.blesser_id ORDER BY k.id DESC LIMIT ? OFFSET ?`, [limit, offset]);
  res.json({ blessings: rows });
}));

router.get('/settings', wrap(async (req, res) => res.json(await getSettings())));

router.put('/settings', wrap(async (req, res) => {
  for (const k of Object.keys(req.body)) {
    if (!SETTING_KEYS.includes(k)) return res.status(400).json({ error: 'Unknown setting: ' + k });
    await pool.query('INSERT INTO settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)', [k, String(req.body[k]).slice(0, 255)]);
  }
  res.json(await getSettings());
}));

module.exports = router;
