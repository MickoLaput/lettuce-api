// src/routes/treatments.js
const router = require('express').Router();
const pool = require('../db');

router.get('/treatments', async (req, res) => {
  try {
    const key = (req.query.disease || '').trim().toLowerCase();
    if (!key) return res.status(400).json({ error: 'missing_disease' });

    const [rows] = await pool.query(
      'SELECT disease, protocol FROM treatments WHERE disease = ? LIMIT 1',
      [key]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('GET /api/treatments error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

// add this to also accept /api/treatments/:disease
router.get('/treatments/:disease', async (req, res) => {
  try {
    const key = (req.params.disease || '').trim().toLowerCase();
    const [rows] = await pool.query(
      'SELECT protocol FROM treatments WHERE disease = ? LIMIT 1', [key]
    );
    if (!rows.length) return res.status(404).json({ error: 'not_found' });
    res.json({ protocol: rows[0].protocol });
  } catch (e) {
    console.error('GET /api/treatments/:disease error:', e);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
