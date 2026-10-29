// Applies database/schema.sql to the configured MySQL server.
import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';

const { db } = loadConfig();
const schemaPath = process.argv[2] ?? new URL('../../database/schema.sql', import.meta.url).pathname;
const sql = await readFile(schemaPath, 'utf8');

const conn = await mysql.createConnection({ host: db.host, port: db.port, user: db.user, password: db.password, multipleStatements: true });
await conn.query(sql);
await conn.end();
console.log(`Applied ${schemaPath}`);
