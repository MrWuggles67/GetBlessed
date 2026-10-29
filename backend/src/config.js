const env = process.env;

function required(name, fallback) {
  const value = env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable ${name}`);
  }
  return value;
}

export function loadConfig() {
  const isProd = env.NODE_ENV === 'production';
  return {
    port: Number(env.PORT ?? 3000),
    jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-only-secret-change-me'),
    jwtTtl: env.JWT_TTL ?? '30d',
    bcryptRounds: Number(env.BCRYPT_ROUNDS ?? 11),
    uploadDir: env.UPLOAD_DIR ?? new URL('../uploads/', import.meta.url).pathname,
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
    apple: {
      bundleId: env.APPLE_BUNDLE_ID ?? 'com.getblessed.app',
      appAppleId: env.APPLE_APP_ID ? Number(env.APPLE_APP_ID) : undefined,
      environment: env.APPLE_ENVIRONMENT ?? 'PRODUCTION', // PRODUCTION | SANDBOX | XCODE
      rootCertsDir: env.APPLE_ROOT_CERTS_DIR,
    },
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY,
      publishableKey: env.STRIPE_PUBLISHABLE_KEY,
      webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    },
    db: {
      host: env.DB_HOST ?? '127.0.0.1',
      port: Number(env.DB_PORT ?? 3306),
      user: env.DB_USER ?? 'getblessed',
      password: env.DB_PASSWORD ?? '',
      database: env.DB_NAME ?? 'getblessed',
      connectionLimit: Number(env.DB_POOL_SIZE ?? 20),
    },
  };
}
