// src/routes/feedback.js
const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

router.post('/', async (req, res) => {
  let userId = null;
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (token) {
    try { const p = jwt.verify(token, process.env.JWT_SECRET || 'dev'); userId = p.id || null; } catch (_) {}
  }
  const rating = (req.body.rating || '').toLowerCase();
  if (!['bad','good','excellent'].includes(rating)) return res.status(400).json({ ok:false });
  await pool.query('INSERT INTO feedback (user_id, rating) VALUES (?,?)', [userId, rating]);
  res.json({ ok:true });
});

module.exports = router;
