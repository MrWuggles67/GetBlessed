import bcrypt from 'bcryptjs';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ROLES, authenticate, signToken } from '../auth.js';
import { withTransaction } from '../db.js';
import { conflict, unauthorized } from '../errors.js';
import { centsToString } from '../money.js';
import { serializeUser } from '../serializers.js';
import { ulid } from '../ulid.js';
import { validateBillableSignup, validateBlessingsSignup, validateLogin } from '../validation.js';

// Used so that login for an unknown email costs the same as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

export function authRouter({ pool, config }) {
  const router = Router();
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: config.authRateLimit ?? 50, standardHeaders: 'draft-7', legacyHeaders: false });

  async function createMember(role, input) {
    const passwordHash = await bcrypt.hash(input.password, config.bcryptRounds);
    const publicId = ulid();
    try {
      return await withTransaction(pool, async (conn) => {
        const [result] = await conn.execute(
          'INSERT INTO users (public_id, email, password_hash, display_name, role) VALUES (?, ?, ?, ?, ?)',
          [publicId, input.email, passwordHash, input.displayName, role],
        );
        let profile;
        if (role === ROLES.BLESSINGS) {
          profile = { annual_income: centsToString(input.annualIncomeCents) };
          await conn.execute('INSERT INTO blessing_profiles (user_id, annual_income) VALUES (?, ?)', [
            result.insertId,
            profile.annual_income,
          ]);
        }
        const [rows] = await conn.execute(
          'SELECT id, public_id, email, display_name, role, created_at FROM users WHERE id = ?',
          [result.insertId],
        );
        return { user: rows[0], profile };
      });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw conflict('An account with that email already exists');
      throw err;
    }
  }

  // The role is decided by WHICH sign-up page is used, never by the request body.
  router.post('/signup/billable', limiter, async (req, res) => {
    const { user } = await createMember(ROLES.BILLABLE, validateBillableSignup(req.body));
    res.status(201).json({ token: signToken(user, config), user: serializeUser(user) });
  });

  router.post('/signup/blessings', limiter, async (req, res) => {
    const { user, profile } = await createMember(ROLES.BLESSINGS, validateBlessingsSignup(req.body));
    res.status(201).json({ token: signToken(user, config), user: serializeUser(user, profile) });
  });

  router.post('/login', limiter, async (req, res) => {
    const { email, password } = validateLogin(req.body);
    const [rows] = await pool.execute(
      "SELECT id, public_id, email, password_hash, display_name, role, created_at FROM users WHERE email = ? AND status = 'active'",
      [email],
    );
    const user = rows[0];
    const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) throw unauthorized('Incorrect email or password');

    await pool.execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [user.id]);
    const profile = await loadProfile(pool, user);
    res.json({ token: signToken(user, config), user: serializeUser(user, profile) });
  });

  router.get('/me', authenticate({ pool, config }), async (req, res) => {
    res.json({ user: serializeUser(req.user, await loadProfile(pool, req.user)) });
  });

  return router;
}

async function loadProfile(pool, user) {
  if (user.role !== ROLES.BLESSINGS) return undefined;
  const [rows] = await pool.execute('SELECT annual_income FROM blessing_profiles WHERE user_id = ?', [user.id]);
  return rows[0];
}
