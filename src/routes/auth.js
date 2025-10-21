// src/routes/auth.js
const router = require('express').Router();
const pool = require('../db');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// +++ ADD: mailer helper
const { sendOtpEmail } = require('../utils/mailer');

// +++ ADD: simple 6-digit OTP generator
function genOtp() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const b = req.body || {};
    console.log('REGISTER payload:', b);

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
    console.error('REGISTER ERROR:', e);
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
      { sql: 'SELECT * FROM users WHERE email=?', timeout: 15000 },
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

/* +++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
   NEW: OTP FLOW
   -------------------------------------------------------------
   POST /api/auth/forgot-password  { email }
   → If user exists: create OTP (hashed), store with 10-min expiry, email it.
   → Always return 200 to avoid email enumeration.
+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++ */
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ ok: false, error: 'Email is required' });

    const [u] = await pool.query('SELECT id, email FROM users WHERE email=? LIMIT 1', [email]);
    if (!u.length) {
      // Hide existence (always OK)
      return res.json({ ok: true, message: 'If this email exists, an OTP has been sent.' });
    }

    const userId = u[0].id;
    const otp = genOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // keep one active token per user
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id=?', [userId]);

    await pool.query(
      'INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
      [userId, otpHash, expiresAt]
    );

    await sendOtpEmail(email, otp);

    return res.json({ ok: true, message: 'If this email exists, an OTP has been sent.' });
  } catch (e) {
    console.error('forgot-password error:', e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

/* -------------------------------------------------------------
   POST /api/auth/reset-password  { email, otp, newPassword }
   → Verifies most recent unexpired token; compares OTP; updates password.
   → Invalidates tokens after success.
-------------------------------------------------------------- */
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body || {};
    if (!email || !otp || !newPassword) {
      return res.status(400).json({ ok: false, error: 'Email, OTP and newPassword are required' });
    }
    if (String(newPassword).length < 8) {
      return res.status(400).json({ ok: false, error: 'Password must be at least 8 characters' });
    }

    const [users] = await pool.query('SELECT id FROM users WHERE email=? LIMIT 1', [email]);
    if (!users.length) {
      return res.status(400).json({ ok: false, error: 'Invalid email or OTP' });
    }
    const userId = users[0].id;

    const [tokens] = await pool.query(
      `SELECT id, token, expires_at
         FROM password_reset_tokens
        WHERE user_id=?
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId]
    );

    if (!tokens.length) {
      return res.status(400).json({ ok: false, error: 'Invalid or expired OTP' });
    }

    const t = tokens[0];
    if (new Date(t.expires_at).getTime() < Date.now()) {
      await pool.query('DELETE FROM password_reset_tokens WHERE id=?', [t.id]);
      return res.status(400).json({ ok: false, error: 'OTP expired. Please request a new one.' });
    }

    const match = await bcrypt.compare(String(otp), t.token);
    if (!match) {
      return res.status(400).json({ ok: false, error: 'Invalid email or OTP' });
    }

    const newHash = await bcrypt.hash(String(newPassword), 10);
    await pool.query('UPDATE users SET password_hash=? WHERE id=?', [newHash, userId]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id=?', [userId]);

    return res.json({ ok: true, message: 'Password reset successful' });
  } catch (e) {
    console.error('reset-password error:', e);
    return res.status(500).json({ ok: false, error: 'Server error' });
  }
});

module.exports = router;
