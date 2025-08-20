const router = require('express').Router();
const pool = require('../db');

// GET /api/forum/posts?q=banana&sort=popular&limit=20&offset=0
router.get('/posts', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const sort = (req.query.sort || 'new').toLowerCase();
    const limit = Number(req.query.limit || 20);
    const offset = Number(req.query.offset || 0);

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
        p.id, p.title, p.content, p.created_at,
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

    const rows = await pool.query(sql, [...params, limit, offset]);
    const items = rows[0].map(r => ({
      id: r.id,
      title: r.title,
      content: r.content,
      created_at: r.created_at,
      author: r.author || 'User',
      comments: r.comments || 0,
      score: r.score || 0,
      image_url: null
    }));

    // (optional) total count
    const cntSql = `
      SELECT COUNT(*) AS n
      FROM forum_posts p
      ${whereSql}`;
    const cnt = await pool.query(cntSql, params);

    res.json({ ok: true, items, total: cnt[0][0].n });
  } catch (e) {
    console.error('LIST POSTS ERROR:', e);
    res.status(500).json({ ok: false, error: 'Server error' });
  }
});

module.exports = router;
