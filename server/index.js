const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');

const app = express();
app.use(express.json());

// CORS: allow your app; during dev you can use '*'
const allowed = (process.env.CORS_ORIGIN || '*')
  .split(',')
  .map(s => s.trim());
app.use(cors({ origin: allowed }));

// MySQL pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
  waitForConnections: true,
  connectionLimit: 10,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined
  // If your provider requires a CA cert, use:
  // ssl: process.env.DB_CA ? { ca: process.env.DB_CA } : undefined
});

// Health
app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, lastname, middlename, firstname, birthdate, country, city, role } = req.body;
    if (!email || !password || !firstname || !lastname || !birthdate || !country || !city) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const password_hash = await bcrypt.hash(password, 10);
    const username = email.split('@')[0];

    const [r] = await pool.query(
      `INSERT INTO users (username,email,password_hash,lastname,middlename,firstname,birth_date,Country,City,role)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [username, email, password_hash, lastname, middlename || '', firstname, birthdate, country, city, role || 'user']
    );

    res.json({ userId: r.insertId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query(`SELECT * FROM users WHERE email=? LIMIT 1`, [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const u = rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: u.id, role: u.role },
      process.env.JWT_SECRET || 'dev',
      { expiresIn: '7d' }
    );
    res.json({ token, user: { id: u.id, firstname: u.firstname, lastname: u.lastname, role: u.role } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('API listening on', PORT));
