import { Router } from 'express';
import { ROLES, authenticate, requireRole } from '../auth.js';
import { HttpError, badRequest, forbidden } from '../errors.js';
import { centsToString } from '../money.js';
import { PLANS, TIP_SERVICE_FEE } from '../pricing.js';
import { activeSubscription, recordAppleTransaction, serializeSubscription } from '../subscriptions.js';

const notConfigured = () => new HttpError(503, 'not_configured', 'App Store purchases are not configured on this server');

export function subscriptionsRouter({ pool, config, appleVerifier, logger }) {
  const router = Router();

  // Public: what Blessings membership and blessing cost.
  router.get('/pricing', (_req, res) => {
    res.json({
      plans: Object.entries(PLANS).map(([plan, p]) => ({
        plan, productId: p.productId, name: p.name, period: p.period, autoRenews: p.autoRenews, price: centsToString(p.priceCents),
      })),
      tipServiceFee: { fee: centsToString(TIP_SERVICE_FEE.feeCents), per: centsToString(TIP_SERVICE_FEE.perCents) },
    });
  });

  // The app sends each StoreKit 2 transaction (purchase, renewal, restore) here.
  router.post('/subscriptions/apple', authenticate({ pool, config }), requireRole(ROLES.BLESSINGS), async (req, res) => {
    if (!appleVerifier) throw notConfigured();
    if (typeof req.body?.signedTransaction !== 'string') {
      throw badRequest('signedTransaction is required', { field: 'signedTransaction' });
    }
    let transaction;
    try {
      transaction = await appleVerifier.verifyTransaction(req.body.signedTransaction);
    } catch {
      throw badRequest('The App Store transaction could not be verified', { field: 'signedTransaction' });
    }

    const [profiles] = await pool.execute('SELECT app_account_token FROM blessing_profiles WHERE user_id = ?', [req.user.id]);
    if (transaction.appAccountToken?.toLowerCase() !== profiles[0]?.app_account_token) {
      throw forbidden('This purchase was made for a different account');
    }
    await recordAppleTransaction(pool, transaction, req.user.id);
    res.json({ subscription: serializeSubscription(await activeSubscription(pool, req.user.id)) });
  });

  // App Store Server Notifications V2: renewals, expirations, refunds.
  // Configure this URL in App Store Connect.
  router.post('/apple/notifications', async (req, res) => {
    if (!appleVerifier) throw notConfigured();
    let notification;
    try {
      notification = await appleVerifier.verifyNotification(req.body?.signedPayload);
    } catch {
      throw badRequest('Invalid notification');
    }
    const transaction = notification.transaction;
    if (transaction?.appAccountToken) {
      const [rows] = await pool.execute('SELECT user_id FROM blessing_profiles WHERE app_account_token = ?', [
        transaction.appAccountToken.toLowerCase(),
      ]);
      if (rows[0]) {
        await recordAppleTransaction(pool, transaction, rows[0].user_id);
      } else {
        logger.warn?.(`App Store notification for unknown account token (${notification.notificationType})`);
      }
    }
    res.json({ ok: true });
  });

  return router;
}
