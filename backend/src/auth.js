import jwt from 'jsonwebtoken';
import { forbidden, unauthorized } from './errors.js';

export const ROLES = Object.freeze({ BILLABLE: 'billable', BLESSINGS: 'blessings' });

export function signToken(user, config) {
  return jwt.sign({ role: user.role }, config.jwtSecret, {
    subject: user.public_id,
    expiresIn: config.jwtTtl,
    algorithm: 'HS256',
  });
}

/** Verifies the bearer token and loads the (active) member onto req.user. */
export function authenticate({ pool, config }) {
  return async (req, _res, next) => {
    try {
      const header = req.get('authorization') ?? '';
      const [scheme, token] = header.split(' ');
      if (scheme !== 'Bearer' || !token) throw unauthorized();

      let payload;
      try {
        payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      } catch {
        throw unauthorized('Invalid or expired token');
      }

      const [rows] = await pool.execute(
        "SELECT id, public_id, email, display_name, role, created_at FROM users WHERE public_id = ? AND status = 'active'",
        [payload.sub],
      );
      if (rows.length === 0) throw unauthorized('Account not found or inactive');
      req.user = rows[0];
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!roles.includes(req.user?.role)) return next(forbidden(`This action requires a ${roles.join(' or ')} account`));
    next();
  };
}
