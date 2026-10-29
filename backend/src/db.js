import mysql from 'mysql2/promise';

export function createPool(dbConfig) {
  return mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    queueLimit: 0,
    // DECIMAL columns come back as strings so money never passes through floats.
    decimalNumbers: false,
    timezone: 'Z',
    dateStrings: false,
  });
}

/** Runs `fn(conn)` inside a transaction, committing on success. */
export async function withTransaction(pool, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}
