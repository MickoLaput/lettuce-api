// src/routes/forum.js
const router = require('express').Router();
const pool = require('../db');
const jwt = require('jsonwebtoken');

/* ---------- auth helper (same style as users.js) ---------- */
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
    console.warn('[JWT VERIFY FAILED]', e.name, e.message);
    return res.status(401).json({ ok:false, error: e.name });
  }
}

/* ---------- LIST POSTS ---------- */
// GET /api/forum/posts?q=banana&sort=popular&limit=20&offset=0
router.get('/posts', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const sort = (req.query.sort || 'new').toLowerCase();
    const limit  = Math.min(Number(req.query.limit || 20), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const where = [];
    const params = [];
    if (q) {
      where.push('(p.title LIKE ? OR p.content LIKE ?)');
      params.push(`%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderSql = sort === 'popular'
      ? 'ORDER BY score DESC, p.created_at DESC'
      : 'ORDER BY p.created_at DESC';

    const sql = `
      SELECT
        p.id, p.title, p.content, p.image_url, p.created_at,
        CONCAT(u.firstname, ' ', u.lastname) AS author,
        IFNULL(SUM(CASE WHEN v.vote=1 THEN 1 WHEN v.vote=-1 THEN -1 ELSE 0 END),0) AS score,
        COUNT(DISTINCT c.id) AS comments
      FROM forum_posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN votes v ON v.entity_type='post' AND v.entity_id=p.id
      LEFT JOIN forum_comments c ON c.post_id = p.id
      ${whereSql}
      GROUP BY p.id
      ${orderSql}
      LIMIT ? OFFSET ?`;

    const [rows] = await pool.query(sql, [...params, limit, offset]);
    const items = rows.map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      created_at: r.created_at,
      author: r.author || 'User',
      comments: r.comments || 0,
      score: r.score || 0,
      image_url: r.image_url || null
    }));

    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS n FROM forum_posts p ${whereSql}`,
      params
    );

    res.json({ ok: true, items, total: cnt[0].n });
  } catch (e) {
    console.error('LIST POSTS ERROR:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

/* ---------- CREATE POST ---------- */
// POST /api/forum/posts   (Authorization: Bearer <jwt>)
router.post('/posts', verifyToken, async (req, res) => {
  try {
    const { title, content, image_url } = req.body || {};
    if (!title || !content) {
      return res.status(400).json({ ok:false, error: 'title_and_content_required' });
    }

    // forum_posts doesn’t have image_url column, ignore for now.
    const [r] = await pool.query(
      'INSERT INTO forum_posts (user_id, title, content, image_url) VALUES (?,?,?,?)',
      [req.user.id, title, content, image_url||null]
    );

    res.status(201).json({ ok: true, id: r.insertId });
  } catch (e) {
    console.error('CREATE POST ERROR:', e);
    res.status(500).json({ ok:false, error: 'server_error' });
  }
});

module.exports = router;
