const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: +(process.env.DB_PORT || 3306),
  waitForConnections: true,
  connectionLimit: 5,
  // Set DB_SSL=true in Render if your host requires TLS
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : undefined
});

module.exports = pool;
