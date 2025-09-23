// src/routes/faq.js
const router = require('express').Router();
const pool = require('../db');

// GET /api/faq/top?limit=4
router.get('/faq/top', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || 4), 20);
    const [rows] = await pool.query(
      `SELECT id, question, answer, created_at
         FROM faq
        ORDER BY created_at DESC
        LIMIT ?`, [limit]
    );
    res.json({ ok: true, items: rows });
  } catch (e) {
    console.error('FAQ TOP error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

// GET /api/faq?limit=...&offset=...&q=...
router.get('/faq', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit || 20), 200);
    const offset = Math.max(parseInt(req.query.offset || 0), 0);
    const q      = req.query.q ? `%${req.query.q}%` : null;

    let sql  = `SELECT id, question, answer, created_at
                  FROM faq`;
    let args = [];
    if (q) { sql += ` WHERE question LIKE ? OR answer LIKE ?`; args.push(q, q); }
    sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
    args.push(limit, offset);

    const [rows] = await pool.query(sql, args);
    res.json({ ok: true, items: rows });
  } catch (e) {
    console.error('FAQ LIST error:', e);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
});

module.exports = router;
