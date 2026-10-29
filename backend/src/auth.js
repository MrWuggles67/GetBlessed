const jwt = require('jsonwebtoken');
const config = require('./config');
const pool = require('./db');

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const sign = (user) => jwt.sign({ id: user.id, role: user.role }, config.jwtSecret, { expiresIn: '7d' });

// Verifies the token and reloads the user so suspensions/role changes apply immediately.
const authenticate = wrap(async (req, res, next) => {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return res.status(401).json({ error: 'Authentication required' });
  let payload;
  try {
    payload = jwt.verify(header.slice(7), config.jwtSecret);
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  const [rows] = await pool.query('SELECT id, email, name, role, status FROM users WHERE id = ?', [payload.id]);
  if (!rows.length) return res.status(401).json({ error: 'Account not found' });
  if (rows[0].status !== 'active') return res.status(403).json({ error: 'Account suspended' });
  req.user = rows[0];
  next();
});

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Forbidden for your role' });

module.exports = { wrap, sign, authenticate, requireRole };
