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
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

    const [rows] = await pool.query('SELECT * FROM users WHERE email=?', [email]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET || 'dev',
      { expiresIn: process.env.JWT_TTL || '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        firstname: user.firstname,
        middlename: user.middlename,
        lastname: user.lastname,
        role: user.role
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
