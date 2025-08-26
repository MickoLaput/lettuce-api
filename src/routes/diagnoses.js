// src/routes/diagnoses.js
const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const pool = require('../db');

// ---- auth (same shape as users.js) ----
function verifyToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'no_token' });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.id };
    next();
  } catch (e) {
    return res.status(401).json({ error: 'bad_token' });
  }
}

// ---- storage for uploaded images ----
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'uploads');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg');
    const name = `diag_${Date.now()}_${Math.round(Math.random()*1e6)}${ext}`;
    cb(null, name);
  }
});
const upload = multer({ storage });

// POST /api/diagnoses  (multipart/form-data)
// fields: label, confidence, [treatment?]; file: image
router.post('/diagnoses', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { label, confidence } = req.body || {};
    if (!label || !confidence || !req.file) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    // if client didn’t send treatment, fetch from DB
    let treatment = req.body.treatment || '';
    if (!treatment) {
      const [rows] = await pool.query('SELECT protocol FROM treatments WHERE disease=?', [label]);
      if (rows.length) treatment = rows[0].protocol;
    }

    const relPath = `/uploads/${req.file.filename}`;
    const [r] = await pool.query(
      'INSERT INTO diagnoses (user_id, image_path, label, confidence, treatment) VALUES (?,?,?,?,?)',
      [req.user.id, relPath, label, parseFloat(confidence), treatment || '']
    );

    res.json({ ok: true, id: r.insertId, image_path: relPath });
  } catch (e) {
    console.error('POST /api/diagnoses', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// GET /api/diagnoses  (list for current user)
router.get('/diagnoses', verifyToken, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM diagnoses WHERE user_id=? ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({ items: rows });
});

module.exports = router;
