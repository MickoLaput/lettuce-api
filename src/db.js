// db.js
const mysql = require('mysql2/promise');
const fs = require('fs');

const useSSL = /^(1|true|yes)$/i.test(process.env.DB_SSL || '');

const config = {
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,   // read from env
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE || 10),
  queueLimit: 0,
  multipleStatements: false,           // safer
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 8000),
  supportBigNumbers: true,
  charset: 'utf8mb4'
};

// Optional TLS (for providers that require it)
// If you have a CA file, set DB_SSL_CA_PATH to its path in the container.
if (useSSL) {
  const caPath = process.env.DB_SSL_CA_PATH;
  config.ssl = caPath && fs.existsSync(caPath)
    ? { ca: fs.readFileSync(caPath, 'utf8'), minVersion: 'TLSv1.2' }
    : { minVersion: 'TLSv1.2', rejectUnauthorized: false };
}

const pool = mysql.createPool(config);

// One-time connectivity check on boot with helpful logs
(async () => {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    console.log(`[DB] Connected to ${config.host}:${config.port} / ${config.database} (ssl=${useSSL})`);
    conn.release();
  } catch (e) {
    console.error('[DB] Initial connection failed:', {
      code: e.code,
      errno: e.errno,
      address: e.address,
      port: e.port,
      message: e.message
    });
  }
})();

module.exports = pool;
