import { createAppleVerifier } from './apple.js';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db.js';
import { createStripePayments } from './payments.js';
import { createDiskStorage } from './storage.js';

const config = loadConfig();
const pool = createPool(config.db);
const app = createApp({
  pool,
  config,
  storage: createDiskStorage(config.uploadDir),
  payments: createStripePayments(config.stripe),
  appleVerifier: await createAppleVerifier(config.apple),
});

const server = app.listen(config.port, () => {
  console.log(`GetBlessed API listening on :${config.port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
