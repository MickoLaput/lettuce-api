// src/routes/notifications.js
const router = require('express').Router();
const pool   = require('../db');
const jwt    = require('jsonwebtoken');

function verifyToken(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok:false, error: 'no_token' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    if (!p?.id) return res.status(401).json({ ok:false, error:'bad_token_payload' });
    req.user = { id: p.id, role: p.role || 'user' };
    next();
  } catch (e) {
    return res.status(401).json({ ok:false, error: e.name || 'unauthorized' });
  }
}

/* GET /api/notifications?limit=30&offset=0 */
router.get('/', verifyToken, async (req, res) => {
  try {
    const limit  = Math.min(Number(req.query.limit || 30), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const uid = req.user.id;

    const [rows] = await pool.query(
      `SELECT n.*, 
              CONCAT(u.firstname,' ',u.lastname) AS actor_name
         FROM notifications n
         LEFT JOIN users u ON u.id = n.actor_id
        WHERE n.recipient_id = ?
        ORDER BY n.created_at DESC
        LIMIT ? OFFSET ?`,
      [uid, limit, offset]
    );

    const [[cnt]] = await pool.query(
      `SELECT COUNT(*) AS n FROM notifications WHERE recipient_id=?`,
      [uid]
    );

    res.json({ ok:true, items: rows, total: cnt.n });
  } catch (e) {
    console.error('notifications.list error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* GET /api/notifications/unread-count */
router.get('/unread-count', verifyToken, async (req, res) => {
  try {
    const uid = req.user.id;
    const [[r]] = await pool.query(
      `SELECT COUNT(*) AS c FROM notifications WHERE recipient_id=? AND indicator='unread'`,
      [uid]
    );
    res.json({ ok:true, count: r.c || 0 });
  } catch (e) {
    console.error('notifications.unread-count error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* PUT /api/notifications/:id/read */
router.put('/:id/read', verifyToken, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_id' });

    const [r] = await pool.query(
      `UPDATE notifications SET indicator='read' 
        WHERE id=? AND recipient_id=?`,
      [id, req.user.id]
    );
    res.json({ ok:true, updated: r.affectedRows });
  } catch (e) {
    console.error('notifications.mark-read error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

module.exports = router;
