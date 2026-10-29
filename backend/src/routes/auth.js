const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { wrap, sign, authenticate } = require('../auth');
const { getSettings, isTrue } = require('../settings');

const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function signup(role) {
  return wrap(async (req, res) => {
    const settings = await getSettings();
    if (!isTrue(settings.signups_enabled)) return res.status(403).json({ error: 'Sign ups are currently closed' });
    const email = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || '').trim().slice(0, 120);
    const password = String(req.body.password || '');
    if (!EMAIL_RE.test(email) || email.length > 255) return res.status(400).json({ error: 'Valid email required' });
    if (!name) return res.status(400).json({ error: 'Name required' });
    if (password.length < 8 || password.length > 72) return res.status(400).json({ error: 'Password must be 8-72 characters' });
    let income = null;
    if (role === 'blessings') {
      income = Number(req.body.annualIncome);
      if (!Number.isFinite(income) || income < 0 || income > 1e10) {
        return res.status(400).json({ error: 'Yearly income is required' });
      }
      if (income < Number(settings.min_blessing_income || 0)) {
        return res.status(400).json({ error: 'Income below the minimum for Blessings accounts' });
      }
    }
    const hash = await bcrypt.hash(password, 12);
    try {
      const [r] = await pool.query(
        'INSERT INTO users (email, password_hash, name, role, annual_income) VALUES (?, ?, ?, ?, ?)',
        [email, hash, name, role, income]
      );
      const user = { id: r.insertId, email, name, role };
      res.status(201).json({ token: sign(user), user });
    } catch (e) {
      if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already registered' });
      throw e;
    }
  });
}

router.post('/signup/billable', signup('billable'));
router.post('/signup/blessings', signup('blessings'));

router.post('/login', wrap(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) {
    return res.status(401).json({ error: 'Incorrect email or password' });
  }
  if (u.status !== 'active') return res.status(403).json({ error: 'Account suspended' });
  const user = { id: u.id, email: u.email, name: u.name, role: u.role };
  res.json({ token: sign(user), user });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

module.exports = router;
