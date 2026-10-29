import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';

/**
 * Verifies StoreKit 2 signed transactions and App Store Server Notifications
 * (V2) against Apple's root certificates. Returns null when not configured.
 *
 * APPLE_ROOT_CERTS_DIR must contain Apple's root certificates (.cer), from
 * https://www.apple.com/certificateauthority/ (AppleRootCA-G3.cer, AppleRootCA-G2.cer).
 */
export async function createAppleVerifier(config, { production = process.env.NODE_ENV === 'production' } = {}) {
  const environment = Environment[config.environment] ?? Environment.PRODUCTION;
  // Purchases made in Xcode with a .storekit file aren't signed by Apple, so the
  // library skips signature checks for them. Never allow that in production.
  const unsigned = environment === Environment.XCODE || environment === Environment.LOCAL_TESTING;
  if (unsigned && production) throw new Error(`APPLE_ENVIRONMENT=${config.environment} is not allowed in production`);
  if (!config.bundleId || (!unsigned && !config.rootCertsDir)) return null;

  let certs = [];
  if (config.rootCertsDir) {
    const files = (await readdir(config.rootCertsDir)).filter((file) => file.endsWith('.cer'));
    certs = await Promise.all(files.map((file) => readFile(path.join(config.rootCertsDir, file))));
  }
  if (environment === Environment.PRODUCTION && !config.appAppleId) {
    throw new Error('APPLE_APP_ID is required to verify production App Store purchases');
  }
  const verifier = new SignedDataVerifier(certs, true, environment, config.bundleId, config.appAppleId);
  return {
    verifyTransaction: (signedTransaction) => verifier.verifyAndDecodeTransaction(signedTransaction),
    async verifyNotification(signedPayload) {
      const notification = await verifier.verifyAndDecodeNotification(signedPayload);
      const signedTransaction = notification.data?.signedTransactionInfo;
      return {
        notificationType: notification.notificationType,
        transaction: signedTransaction ? await verifier.verifyAndDecodeTransaction(signedTransaction) : null,
      };
    },
  };
}
