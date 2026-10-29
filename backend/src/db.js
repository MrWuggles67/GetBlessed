const mysql = require('mysql2/promise');
const config = require('./config');

module.exports = mysql.createPool({ ...config.db, waitForConnections: true, queueLimit: 0 });
