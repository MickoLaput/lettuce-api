// src/server.js
require('dotenv').config();
console.log('[BOOT] JWT_SECRET present:', !!process.env.JWT_SECRET, 'len:', (process.env.JWT_SECRET||'').length);

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const compression = require('compression');

const app = express();

// ----- Uploads dir (works locally & on Render) -----
const isProd = process.env.NODE_ENV === 'production';
const UPLOAD_DIR =
  process.env.UPLOAD_DIR ||
  (isProd ? '/tmp/uploads' : path.join(__dirname, 'uploads'));

// ensure the folder exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// make it visible to route files that read from env at require-time
process.env.UPLOAD_DIR = UPLOAD_DIR;

// ----- Core middleware -----
app.use(cors());
app.use(express.json());
app.use(compression()); 

// health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const pool = require('./db');
app.get('/api/db-ping', async (_req, res) => {
  const t0 = Date.now();
  try {
    await pool.query({ sql: 'SELECT 1', timeout: 5000 });
    res.json({ ok: true, ms: Date.now() - t0 });
  } catch (e) {
    res.status(500).json({ ok: false, ms: Date.now() - t0, err: e.code || String(e) });
  }
});

// serve uploaded files
app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    // (optional) long cache for immutable files
    setHeaders: (res) => res.set('Cache-Control', 'public, max-age=31536000, immutable'),
  })
);

// ----- Routes -----
const authRoutes = require('./routes/auth');
const forumRoutes = require('./routes/forum');
const usersRoutes = require('./routes/users');
const treatmentsRoutes = require('./routes/treatments');
const diagnosesRoutes = require('./routes/diagnoses'); // should use UPLOAD_DIR (env) internally
const uploadRoutes = require('./routes/upload');
const diagnosesReportRoutes = require('./routes/diagnoses_report');
const eventsRoutes = require('./routes/events');
const faqRoutes = require('./routes/faq');
const adminRoutes = require('./routes/admin');

app.use('/api/auth', authRoutes);
app.use('/api/forum', forumRoutes);
app.use('/api', usersRoutes);
app.use('/api', treatmentsRoutes);
app.use('/api', diagnosesRoutes);
app.use('/api', uploadRoutes);
app.use('/api/diagnoses', diagnosesReportRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/feedback', require('./routes/feedback'));
app.use('/api', faqRoutes);
app.use('/api/admin', adminRoutes);

// ----- Server -----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`API listening on ${PORT}`);
  console.log(`Serving uploads from: ${UPLOAD_DIR}`);
});
