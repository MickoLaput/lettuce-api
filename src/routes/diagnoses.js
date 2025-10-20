// src/routes/diagnoses.js
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const pool = require('../db');

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
    return res.status(401).json({ ok:false, error: e.name || 'unauthorized' });
  }
}

// Always save in the same folder that server.js serves at /uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR ||
  (process.env.NODE_ENV === 'production'
     ? '/tmp/uploads'
     : path.join(__dirname, '..', 'uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg') || '.jpg';
    const name = `diag_${Date.now()}_${Math.round(Math.random()*1e6)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage });

/** Build a browser URL path served by server.js */
function toPublicUrl(filename) {
  const clean = String(filename).replace(/^\/+/, '');
  // We expose /uploads statically in server.js, so the URL path is /uploads/<file>
  return `/uploads/${clean}`;
}

/* ---------- CREATE diagnosis ---------- */
router.post('/diagnoses', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { label, confidence } = req.body || {};
    if (!label || typeof confidence === 'undefined' || !req.file) {
      return res.status(400).json({ ok:false, error: 'missing_fields' });
    }

    let treatment = req.body.treatment || '';
    if (!treatment) {
      const [rows] = await pool.query('SELECT protocol FROM treatments WHERE disease=? LIMIT 1', [label]);
      if (rows.length) treatment = rows[0].protocol;
    }

    const filename = req.file.filename;                // stored under UPLOAD_DIR
    const image_path = filename;                       // DB stores filename only (cleaner)
    const image_url  = toPublicUrl(filename);          // what client loads

    const [r] = await pool.query(
      `INSERT INTO diagnoses (user_id, image_path, label, confidence, treatment)
       VALUES (?,?,?,?,?)`,
      [req.user.id, image_path, label, Number(confidence), treatment || '']
    );

    res.json({ ok:true, id: r.insertId, image_path, image_url });
  } catch (e) {
    console.error('POST /api/diagnoses error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* ---------- LIST user diagnoses ---------- */
router.get('/diagnoses', verifyToken, async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit || 50), 200);
    const offset = Math.max(parseInt(req.query.offset || 0), 0);

    const [rows] = await pool.query(
      `SELECT id, user_id, image_path, label, confidence, treatment, created_at
         FROM diagnoses
        WHERE user_id=?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
      [req.user.id, limit, offset]
    );

    const items = rows.map(r => ({
      id: r.id,
      user_id: r.user_id,
      image_path: r.image_path,           // e.g., "diag_...jpg"
      image_url: toPublicUrl(r.image_path),
      label: r.label,
      confidence: Number(r.confidence),
      treatment: r.treatment,
      created_at: r.created_at
    }));

    res.json({ ok:true, items, total: items.length });
  } catch (e) {
    console.error('GET /api/diagnoses error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

module.exports = router;
