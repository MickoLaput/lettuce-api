// src/routes/upload.js
const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const jwt = require('jsonwebtoken');

/* ---- auth helper (same as users/forum) ---- */
function verifyToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: 'no_token' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    req.user = { id: p.id || p.uid, role: p.role };
    if (!req.user.id) return res.status(401).json({ ok: false, error: 'bad_token_payload' });
    next();
  } catch {
    console.warn('[JWT VERIFY FAILED]', e.name, e.message); // <— shows 'TokenExpiredError' or 'JsonWebTokenError: invalid signature'
    return res.status(401).json({ ok:false, error: e.name });
  }
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');

/* ---- multer config ---- */
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `post_${Date.now()}${ext || '.jpg'}`);
  },
});

const fileFilter = (_req, file, cb) => {
  // allow only images
  if ((file.mimetype || '').startsWith('image/')) cb(null, true);
  else cb(new Error('only_images_allowed'));
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

/* build absolute base correctly behind proxies (Render/CF) */
function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  return process.env.PUBLIC_BASE || `${proto}://${host}`;
}

/* ---- POST /api/upload ---- */
router.post('/upload', verifyToken, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'no_file' });
  const url = `${getBaseUrl(req)}/uploads/${req.file.filename}`;
  return res.json({ ok: true, url });
});

/* (optional) handle multer errors nicely */
router.use((err, _req, res, _next) => {
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.message === 'only_images_allowed')) {
    return res.status(400).json({ ok: false, error: err.message });
  }
  return res.status(500).json({ ok: false, error: 'upload_failed' });
});

module.exports = router;
