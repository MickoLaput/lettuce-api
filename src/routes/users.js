// routes/users.js
const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ---- auth helper ----
function verifyToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    req.user = { id: p.id || p.uid, role: p.role };
    if (!req.user.id) return res.status(401).json({ error: 'bad_token_payload' });
    next();
  } catch {
    return res.status(401).json({ error: 'bad_token' });
  }
}

// small util for dd/MM/yyyy -> yyyy-MM-dd (or pass-through)
function toSqlDate(s) {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s;
}

// split "Full Name" to first/middle/last
function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return { first: null, middle: null, last: null };
  if (parts.length === 1) return { first: parts[0], middle: '', last: '' };
  if (parts.length === 2) return { first: parts[0], middle: '', last: parts[1] };
  const first = parts.shift();
  const last  = parts.pop();
  const middle = parts.join(' ');
  return { first, middle, last };
}

// ---- GET /api/me ----
router.get('/me', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id,
              username,
              email,
              firstname,
              middlename,
              lastname,
              CONCAT_WS(' ', firstname, middlename, lastname) AS name,
              DATE_FORMAT(birth_date, '%Y-%m-%d') AS dob,
              Country AS country,
              City   AS state,
              City    AS city
       FROM users
       WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json({ user: rows[0] });
  } catch (e) {
    console.error('GET /api/me error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// ---- PUT /api/me ----
router.put('/me', verifyToken, async (req, res) => {
  const b = req.body || {};

  // Prefer explicit parts; otherwise split name
  let first  = b.firstname ?? null;
  let middle = b.middlename ?? null;
  let last   = b.lastname ?? null;
  if (b.name && first == null && middle == null && last == null) {
    const s = splitName(b.name);
    first = s.first; middle = s.middle; last = s.last;
  }

  try {
    const sets = [];
    const vals = [];

    if (b.email != null)   { sets.push('email=?');       vals.push(b.email); }
    if (first != null)     { sets.push('firstname=?');   vals.push(first); }
    if (middle != null)    { sets.push('middlename=?');  vals.push(middle); }
    if (last != null)      { sets.push('lastname=?');    vals.push(last); }
    if (b.dob != null)     { sets.push('birth_date=?');  vals.push(toSqlDate(b.dob)); }
    if (b.country != null) { sets.push('Country=?');     vals.push(b.country); }
    if (b.state != null)   { sets.push('City=?');       vals.push(b.state); }
    if (b.city != null)    { sets.push('City=?');        vals.push(b.city); }

    if (b.password) {
      const hash = await bcrypt.hash(b.password, 10);
      sets.push('password_hash=?'); vals.push(hash);
    }

    if (!sets.length) return res.json({ ok: true });

    vals.push(req.user.id);
    const sql = `UPDATE users SET ${sets.join(', ')} WHERE id = ?`;
    await pool.query(sql, vals);

    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/me error', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
