// routes/users.js
const router = require('express').Router();
const pool = require('../db'); // your db.js
const jwt = require('jsonwebtoken');

// Simple JWT verify (adjust secret/env)
function verifyToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({error: 'no_token'});
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id };
    next();
  } catch (e) {
    return res.status(401).json({error: 'bad_token'});
  }
}

router.get('/me', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, name, email, DATE_FORMAT(dob, '%Y-%m-%d') as dob, country, state, city
       FROM users WHERE id = ? LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({error: 'not_found'});
    res.json({ user: rows[0] });
  } catch (e) {
    console.error('GET /api/me error', e);
    res.status(500).json({error: 'server_error'});
  }
});

router.put('/me', verifyToken, async (req, res) => {
  const { name, email, password, dob, country, state, city } = req.body || {};

  // parse "dd/MM/yyyy" → "yyyy-MM-dd"
  function toSqlDate(s) {
    if (!s) return null;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    if (!m) return s; // maybe already yyyy-MM-dd
    return `${m[3]}-${m[2]}-${m[1]}`;
  }

  try {
    // Build dynamic set clause
    const fields = [];
    const vals = [];

    if (name != null) { fields.push('name=?'); vals.push(name); }
    if (email != null) { fields.push('email=?'); vals.push(email); }
    if (dob != null)   { fields.push('dob=?'); vals.push(toSqlDate(dob)); }
    if (country != null){ fields.push('country=?'); vals.push(country); }
    if (state != null) { fields.push('state=?'); vals.push(state); }
    if (city != null)  { fields.push('city=?'); vals.push(city); }
    if (password) {     // only if provided
      // hash if you support hashing; else store as-is (not recommended)
      // const hash = await bcrypt.hash(password, 10);
      fields.push('password=?'); vals.push(password);
    }

    if (!fields.length) return res.json({ ok: true });

    vals.push(req.user.id);
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    await pool.query(sql, vals);

    res.json({ ok: true });
  } catch (e) {
    console.error('PUT /api/me error', e);
    res.status(500).json({error: 'server_error'});
  }
});

module.exports = router;
