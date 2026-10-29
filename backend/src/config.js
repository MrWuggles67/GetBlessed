const secret = process.env.JWT_SECRET;
if (!secret && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production');
}
module.exports = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: secret || 'dev-only-secret',
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'getblessed',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'getblessed',
    connectionLimit: Number(process.env.DB_POOL_SIZE) || 50,
    decimalNumbers: true,
  },
};
