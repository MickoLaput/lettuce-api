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
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    req.user = { id: p.id || p.uid };
    if (!req.user.id) return res.status(401).json({ error: 'bad_token_payload' });
    next();
  } catch (e) {
    return res.status(401).json({ error: 'unauthorized' });
  }
}

// Use the SAME dir that server.js exposes at /uploads
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg');
    cb(null, `diag_${Date.now()}_${Math.round(Math.random()*1e6)}${ext}`);
  }
});
const upload = multer({ storage });

router.post('/diagnoses', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { label, confidence } = req.body || {};

    // basic validation
    if (!label || typeof confidence === 'undefined' || !req.file) {
      return res.status(400).json({ ok: false, error: 'missing_fields' });
    }

    // ALWAYS get the latest protocol from `treatments`
    let treatment = '';
    const [rows] = await pool.query(
      'SELECT protocol FROM treatments WHERE disease = ? LIMIT 1',
      [label]
    );
    if (rows.length) {
      treatment = rows[0].protocol || '';
    }

    const rel = `/uploads/${req.file.filename}`;
    const [r] = await pool.query(
      `INSERT INTO diagnoses (user_id, image_path, label, confidence, treatment)
       VALUES (?,?,?,?,?)`,
      [req.user.id, rel, label, Number(confidence), treatment]
    );

    // include treatment in response just in case the app wants it
    res.json({
      ok: true,
      id: r.insertId,
      image_path: rel,
      treatment
    });
  } catch (e) {
    console.error('POST /api/diagnoses', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});


router.get('/diagnoses', verifyToken, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, user_id, image_path, label, confidence, treatment, created_at FROM diagnoses WHERE user_id=? ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({ ok: true, items: rows, total: rows.length });
});

module.exports = router;
