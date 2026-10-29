// Applies schema.sql and seeds the admin account from ADMIN_EMAIL / ADMIN_PASSWORD.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');
const config = require('./config');

(async () => {
  const conn = await mysql.createConnection({ ...config.db, multipleStatements: true });
  await conn.query(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8'));
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await conn.query(
      "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, 'Administrator', 'admin') " +
        'ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = \'admin\'',
      [ADMIN_EMAIL.toLowerCase(), hash]
    );
    console.log('Admin account ready:', ADMIN_EMAIL);
  }
  await conn.end();
  console.log('Migration complete');
})().catch((e) => { console.error(e); process.exit(1); });
