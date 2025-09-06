// src/routes/diagnoses.js
const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok:false, error:'no_token' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    req.user = { id: p.id || p.uid };
    if (!req.user.id) return res.status(401).json({ ok:false, error:'bad_token_payload' });
    next();
  } catch(e) {
    return res.status(401).json({ ok:false, error:e.name });
  }
}

// GET /api/diagnoses?limit=100&offset=0
router.get('/', verifyToken, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit || 50), 200);
    const offset = Math.max(parseInt(req.query.offset || 0), 0);

    const [rows] = await pool.query(`
      SELECT id, image_path, label, confidence, treatment, created_at
      FROM diagnoses
      WHERE user_id=?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?`, [req.user.id, limit, offset]);

    // Optionally include absolute URL
    const items = rows.map(r => ({
      ...r,
      image_url: (r.image_path || '').startsWith('http')
         ? r.image_path
         : `/uploads/${(r.image_path||'').replace(/^\/+/, '')}`
    }));

    res.json({ ok:true, items, total: items.length });
  } catch (e) {
    console.error('DIAGNOSES LIST ERR', e);
    res.status(500).json({ ok:false, error: 'server_error' });
  }
});

// GET /api/diagnoses/:id
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT id, image_path, label, confidence, treatment, created_at
      FROM diagnoses WHERE id=? AND user_id=?`, [req.params.id, req.user.id]);

    if (!rows.length) return res.status(404).json({ ok:false, error:'not_found' });

    const d = rows[0];
    d.image_url = (d.image_path || '').startsWith('http')
        ? d.image_path
        : `/uploads/${(d.image_path||'').replace(/^\/+/, '')}`;

    res.json({ ok:true, diagnosis: d });
  } catch (e) {
    console.error('DIAGNOSES GET ERR', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

module.exports = router;
