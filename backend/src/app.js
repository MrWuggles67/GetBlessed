import express from 'express';
import multer from 'multer';
import { HttpError } from './errors.js';
import { authRouter } from './routes/auth.js';
import { billsRouter } from './routes/bills.js';
import { blessingsRouter, stripeWebhookRouter } from './routes/blessings.js';
import { subscriptionsRouter } from './routes/subscriptions.js';

export function createApp({ pool, config, storage, payments = null, appleVerifier = null, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy ?? 1);
  app.use('/api', stripeWebhookRouter({ pool, payments }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  });

  app.use('/api/auth', authRouter({ pool, config }));
  app.use('/api/bills', billsRouter({ pool, config, storage, payments }));
  app.use('/api', subscriptionsRouter({ pool, config, appleVerifier, logger }));
  app.use('/api', blessingsRouter({ pool, config }));

  app.use((_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'Not found' } }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: { code: 'invalid_upload', message: err.message } });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
    }
    logger.error(err);
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
  });

  return app;
}
