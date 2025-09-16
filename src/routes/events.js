const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

function verifyToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok:false, error:'no_token' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    req.user = { id: p.id || p.uid, role: p.role };
    if (!req.user.id) return res.status(401).json({ ok:false, error:'bad_token_payload' });
    next();
  } catch (e) {
    return res.status(401).json({ ok:false, error:e.name });
  }
}

// GET /api/events?month=2025-09   (returns all events for the month)
router.get('/', verifyToken, async (req, res) => {
  try {
    const month = (req.query.month || '').trim(); // yyyy-MM
    if (!/^\d{4}-\d{2}$/.test(month)) return res.status(400).json({ ok:false, error:'bad_month' });

    const start = month + '-01';
    const [rows] = await pool.query(
      `SELECT id,user_id,title,event_date,event_time,created_at
         FROM events
        WHERE user_id = ? AND event_date >= ? AND event_date < DATE_ADD(?, INTERVAL 1 MONTH)
        ORDER BY event_date ASC, event_time ASC`,
      [req.user.id, start, start]
    );

    res.json({ ok:true, items: rows });
  } catch (e) {
    console.error('EVENTS LIST ERROR', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

// POST /api/events  { title, event_date:"yyyy-MM-dd", event_time:"HH:mm" }
router.post('/', verifyToken, async (req, res) => {
  try {
    const { title, event_date, event_time } = req.body || {};
    if (!title || !event_date || !/^\d{4}-\d{2}-\d{2}$/.test(event_date))
      return res.status(400).json({ ok:false, error:'bad_input' });

    // event_time optional → default '08:00'
    const time = (/^\d{2}:\d{2}$/.test(event_time) ? event_time : '08:00') + ':00';

    const [r] = await pool.query(
      `INSERT INTO events (user_id, title, event_date, event_time) VALUES (?,?,?,?)`,
      [req.user.id, title, event_date, time]
    );
    const [rows] = await pool.query(
      `SELECT id,user_id,title,event_date,event_time,created_at FROM events WHERE id=?`,
      [r.insertId]
    );
    res.json({ ok:true, event: rows[0] });
  } catch (e) {
    console.error('EVENTS CREATE ERROR', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

module.exports = router;
