import express, { Router } from 'express';
import { ROLES, authenticate, requireRole } from '../auth.js';
import { withTransaction } from '../db.js';
import { HttpError, badRequest } from '../errors.js';
import { serializeBlessing } from '../serializers.js';

export function blessingsRouter({ pool, config }) {
  const router = Router();

  // A Blessings member's blessing history (newest first).
  router.get('/blessings/mine', authenticate({ pool, config }), requireRole(ROLES.BLESSINGS), async (req, res) => {
    const [rows] = await pool.execute(
      `SELECT bl.*, b.public_id AS bill_public_id, b.title AS bill_title
       FROM blessings bl JOIN bills b ON b.id = bl.bill_id
       WHERE bl.blesser_user_id = ? ORDER BY bl.id DESC LIMIT 100`,
      [req.user.id],
    );
    res.json({ blessings: rows.map(serializeBlessing) });
  });

  return router;
}

/**
 * Stripe webhook. Needs the raw request body to check Stripe's signature, so
 * it is mounted before the JSON body parser.
 */
export function stripeWebhookRouter({ pool, payments }) {
  const router = Router();
  router.post('/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
    if (!payments) throw new HttpError(503, 'not_configured', 'Payments are not configured on this server');
    let event;
    try {
      event = payments.parseWebhook(req.body, req.get('stripe-signature'));
    } catch {
      throw badRequest('Invalid webhook signature');
    }

    const intent = event.data?.object;
    if (event.type === 'payment_intent.succeeded') {
      await markSucceeded(pool, intent.id);
    } else if (event.type === 'payment_intent.payment_failed' || event.type === 'payment_intent.canceled') {
      const status = event.type === 'payment_intent.canceled' ? 'canceled' : 'failed';
      await pool.execute("UPDATE blessings SET status = ? WHERE payment_intent_id = ? AND status = 'pending'", [status, intent.id]);
    }
    res.json({ received: true });
  });
  return router;
}

// Idempotent: Stripe may deliver the same event more than once.
async function markSucceeded(pool, paymentIntentId) {
  await withTransaction(pool, async (conn) => {
    const [rows] = await conn.execute('SELECT id, bill_id, amount, status FROM blessings WHERE payment_intent_id = ? FOR UPDATE', [
      paymentIntentId,
    ]);
    const blessing = rows[0];
    if (!blessing || blessing.status === 'succeeded') return;

    await conn.execute("UPDATE blessings SET status = 'succeeded' WHERE id = ?", [blessing.id]);
    // MySQL applies SET assignments left to right, so the status check sees the new amount.
    await conn.execute(
      `UPDATE bills SET amount_blessed = amount_blessed + ?,
         status = IF(status = 'open' AND amount_blessed >= total, 'blessed', status)
       WHERE id = ?`,
      [blessing.amount, blessing.bill_id],
    );
  });
}
