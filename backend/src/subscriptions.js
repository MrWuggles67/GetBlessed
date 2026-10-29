import { ROLES } from './auth.js';
import { HttpError, conflict, forbidden } from './errors.js';
import { PLANS, planForProductId } from './pricing.js';

export const subscriptionRequired = () =>
  new HttpError(402, 'subscription_required', 'Choose a Blessings plan to see and bless bills');

/** The member's current subscription, or undefined when they have none active. */
export async function activeSubscription(db, userId) {
  const [rows] = await db.execute(
    `SELECT plan, expires_at FROM subscriptions
     WHERE user_id = ? AND status = 'active' AND expires_at > ?
     ORDER BY expires_at DESC LIMIT 1`,
    [userId, new Date()],
  );
  return rows[0];
}

/** Express middleware: Blessings members need an active plan. */
export function requireSubscription({ pool }) {
  return async (req, _res, next) => {
    try {
      if (req.user.role !== ROLES.BLESSINGS) throw forbidden('This action requires a blessings account');
      if (!(await activeSubscription(pool, req.user.id))) throw subscriptionRequired();
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Records a verified App Store transaction (a purchase or a renewal).
 * `userId` is the member it belongs to, found via the transaction's appAccountToken.
 */
export async function recordAppleTransaction(db, transaction, userId) {
  const plan = planForProductId(transaction.productId);
  if (!plan) throw new HttpError(400, 'unknown_product', `Unknown product ${transaction.productId}`);
  const expiresMs = PLANS[plan].autoRenews ? transaction.expiresDate : addMonths(transaction.purchaseDate, PLANS[plan].months);
  if (!transaction.originalTransactionId || !expiresMs) {
    throw new HttpError(400, 'invalid_transaction', 'Transaction is missing subscription dates');
  }

  const [existing] = await db.execute('SELECT user_id, expires_at FROM subscriptions WHERE original_transaction_id = ?', [
    transaction.originalTransactionId,
  ]);
  if (existing[0] && existing[0].user_id !== userId) {
    throw conflict('This App Store subscription belongs to another account');
  }

  const status = transaction.revocationDate ? 'revoked' : 'active';
  const expiresAt = new Date(expiresMs);
  // Notifications can arrive out of order: never move the expiry backwards
  // unless Apple revoked the subscription (refund).
  if (existing[0] && status === 'active' && existing[0].expires_at > expiresAt) return;

  await db.execute(
    `INSERT INTO subscriptions (user_id, plan, status, original_transaction_id, latest_transaction_id, expires_at, environment)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE plan = VALUES(plan), status = VALUES(status),
       latest_transaction_id = VALUES(latest_transaction_id), expires_at = VALUES(expires_at)`,
    [userId, plan, status, transaction.originalTransactionId, transaction.transactionId ?? transaction.originalTransactionId,
      expiresAt, transaction.environment ?? 'Production'],
  );
}

export function serializeSubscription(row) {
  if (!row) return null;
  return { plan: row.plan, expiresAt: row.expires_at, active: true };
}

function addMonths(ms, months) {
  if (!ms) return null;
  const date = new Date(ms);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.getTime();
}
