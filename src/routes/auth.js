const router = require('express').Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const b = req.body || {};
    console.log('REGISTER payload:', b); // <— see what Android sends

    const required = ['email','password','username','firstname','lastname','birthdate','country','city'];
    if (required.some(k => !b[k])) {
      return res.status(400).json({ ok: false, error: 'Missing fields' });
    }

    const [dup] = await pool.query(
      'SELECT id FROM users WHERE email=? OR username=?',
      [b.email, b.username]
    );
    if (dup.length) return res.status(409).json({ ok: false, error: 'Email or username already used' });

    const hash = await bcrypt.hash(b.password, 10);
    const [r] = await pool.query(
      `INSERT INTO users (username,email,password_hash,lastname,middlename,firstname,birth_date,Country,City,role)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [b.username, b.email, hash, b.lastname, b.middlename || null, b.firstname,
       b.birthdate, b.country, b.city, b.role || 'user']
    );

    res.status(201).json({ ok: true, userId: r.insertId });
  } catch (e) {
    console.error('REGISTER ERROR:', e);  // <— see it in Render logs
    // Return a useful message while debugging
    res.status(500).json({ ok: false, error: e.sqlMessage || e.message || String(e) });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const t0 = Date.now();
  console.log('[LOGIN] start', new Date().toISOString());
  try {
    const { email, password } = (req.body || {});
    if (!email || !password) {
      console.log('[LOGIN] 400 missing', Date.now() - t0, 'ms');
      return res.status(400).json({ error: 'Missing credentials' });
    }

    console.log('[LOGIN] query user…');
    const [rows] = await pool.query(
      { sql: 'SELECT * FROM users WHERE email=?', timeout: 15000 },  // <= 15s cap
      [email]
    );
    console.log('[LOGIN] query done', Date.now() - t0, 'ms; rows=', rows.length);

    if (!rows.length) {
      console.log('[LOGIN] 401 invalid (no user)', Date.now() - t0, 'ms');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log('[LOGIN] bcrypt compare…');
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    console.log('[LOGIN] bcrypt done', Date.now() - t0, 'ms');

    if (!ok) {
      console.log('[LOGIN] 401 invalid (bad pw)', Date.now() - t0, 'ms');
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: rows[0].id, role: rows[0].role },
      process.env.JWT_SECRET || 'dev',
      { expiresIn: process.env.JWT_TTL || '7d' }
    );

    console.log('[LOGIN] 200 OK', Date.now() - t0, 'ms');
    return res.json({
      token,
      user: {
        id: rows[0].id, email: rows[0].email, username: rows[0].username,
        firstname: rows[0].firstname, middlename: rows[0].middlename,
        lastname: rows[0].lastname, role: rows[0].role
      }
    });
  } catch (e) {
    console.error('[LOGIN] 500', Date.now() - t0, 'ms', e);
    return res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
