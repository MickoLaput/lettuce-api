// routes/users.js
const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Accept both {id} and old {uid}
function verifyToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    req.user = { id: p.id || p.uid, role: p.role };
    if (!req.user.id) return res.status(401).json({ error: 'bad_token_payload' });
    next();
  } catch (e) {
    return res.status(401).json({ error: 'bad_token' });
  }
}

// GET /api/me
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
              Country  AS country,
              City     AS city
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

// PUT /api/me
router.put('/me', verifyToken, async (req, res) => {
  const { email, password, dob, country, city, firstname, middlename, lastname } = req.body || {};

  const toSqlDate = (s) => {
    if (!s) return null;
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : s; // accepts yyyy-MM-dd as-is
  };

  try {
    const sets = [];
    const vals = [];

    if (email != null)      { sets.push('email=?');      vals.push(email); }
    if (firstname != null)  { sets.push('firstname=?');  vals.push(firstname); }
    if (middlename != null) { sets.push('middlename=?'); vals.push(middlename); }
    if (lastname != null)   { sets.push('lastname=?');   vals.push(lastname); }
    if (dob != null)        { sets.push('birth_date=?'); vals.push(toSqlDate(dob)); }
    if (country != null)    { sets.push('Country=?');    vals.push(country); }
    if (city != null)       { sets.push('City=?');       vals.push(city); }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
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
