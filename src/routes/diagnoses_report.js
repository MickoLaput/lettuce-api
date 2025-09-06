// src/routes/diagnoses_report.js
const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

/* ---------- auth helper ---------- */
function verifyToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok:false, error: 'no_token' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    req.user = { id: p.id || p.uid, role: p.role };
    if (!req.user.id) return res.status(401).json({ ok:false, error: 'bad_token_payload' });
    next();
  } catch (e) {
    return res.status(401).json({ ok:false, error: e.name });
  }
}

/* Helper: turn DB path into a browser URL served by /uploads */
function toPublicUrl(image_path) {
  if (!image_path) return null;
  if (/^https?:\/\//i.test(image_path)) return image_path;         // already absolute
  const clean = String(image_path).replace(/^\/+/, '');             // remove leading slashes
  return `/uploads/${clean}`;                                       // static served by server.js
}

/* ---------- LIST user diagnoses ----------
   GET /api/diagnoses?limit=50&offset=0
*/
router.get('/', verifyToken, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit || 50), 200);
    const offset = Math.max(parseInt(req.query.offset || 0), 0);

    const [rows] = await pool.query(
      `SELECT id, user_id, image_path, label, confidence, treatment, created_at
         FROM diagnoses
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    const items = rows.map(r => ({
      id: r.id,
      user_id: r.user_id,
      image_path: r.image_path,
      image_url: toPublicUrl(r.image_path),
      label: r.label,
      confidence: Number(r.confidence),
      treatment: r.treatment,
      created_at: r.created_at,
    }));

    res.json({ ok: true, items, total: items.length });
  } catch (e) {
    console.error('DIAGNOSES REPORT LIST ERROR:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* ---------- GET one diagnosis ----------
   GET /api/diagnoses/:id
*/
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [rows] = await pool.query(
      `SELECT id, user_id, image_path, label, confidence, treatment, created_at
         FROM diagnoses
        WHERE id=? AND user_id=?`,
      [id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ ok:false, error:'not_found' });

    const d = rows[0];
    const diagnosis = {
      id: d.id,
      user_id: d.user_id,
      image_path: d.image_path,
      image_url: toPublicUrl(d.image_path),
      label: d.label,
      confidence: Number(d.confidence),
      treatment: d.treatment,
      created_at: d.created_at,
    };

    res.json({ ok:true, diagnosis });
  } catch (e) {
    console.error('DIAGNOSES REPORT GET ERROR:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

module.exports = router;
