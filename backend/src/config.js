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
