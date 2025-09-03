// src/routes/forum.js
const router = require('express').Router();
const pool   = require('../db');
const jwt    = require('jsonwebtoken');

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

/* ---------- optional helper: read user id without forcing auth ---------- */
function tryUserId(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return 0;
  try {
    const p = jwt.verify(h.slice(7), process.env.JWT_SECRET || 'dev');
    return p.id || p.uid || 0;
  } catch { return 0; }
}

/* ===========================================================
   LIST POSTS
   GET /api/forum/posts?q=banana&sort=popular&limit=20&offset=0
   =========================================================== */
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

/* ===========================================================
   CREATE POST
   POST /api/forum/posts   (Authorization: Bearer <jwt>)
   =========================================================== */
router.post('/posts', verifyToken, async (req, res) => {
  try {
    const { title, content, image_url } = req.body || {};
    if (!title || !content) {
      return res.status(400).json({ ok:false, error: 'title_and_content_required' });
    }

    const [r] = await pool.query(
      'INSERT INTO forum_posts (user_id, title, content, image_url) VALUES (?,?,?,?)',
      [req.user.id, title, content, image_url || null]
    );

    res.status(201).json({ ok: true, id: r.insertId });
  } catch (e) {
    console.error('CREATE POST ERROR:', e);
    res.status(500).json({ ok:false, error: 'server_error' });
  }
});

/* ===========================================================
   POST DETAIL (with score + my_vote)
   GET /api/forum/posts/:id
   =========================================================== */
router.get('/posts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_id' });

    const uid = tryUserId(req);

    const [rows] = await pool.query(`
      SELECT
        p.id, p.user_id, p.title, p.content, p.image_url, p.created_at,
        CONCAT(u.firstname,' ',u.lastname) AS author,
        IFNULL(SUM(CASE WHEN v.vote=1 THEN 1 WHEN v.vote=-1 THEN -1 ELSE 0 END),0) AS score,
        (
          SELECT vote FROM votes
          WHERE user_id=? AND entity_type='post' AND entity_id=p.id LIMIT 1
        ) AS my_vote
      FROM forum_posts p
      JOIN users u ON u.id=p.user_id
      LEFT JOIN votes v ON v.entity_type='post' AND v.entity_id=p.id
      WHERE p.id=?
      GROUP BY p.id
    `, [uid, id]);

    if (!rows.length) return res.status(404).json({ ok:false, error:'not_found' });
    res.json({ ok:true, post: rows[0] });
  } catch (e) {
    console.error('POST DETAIL ERROR:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* ===========================================================
   LIST COMMENTS (flat; include my_vote). Supports parent_id for replies.
   GET /api/forum/posts/:id/comments?parent_id=<nullable>&limit=50&offset=0
   =========================================================== */
router.get('/posts/:id/comments', async (req, res) => {
  try {
    const postId   = Number(req.params.id || 0);
    const parentId = req.query.parent_id ? Number(req.query.parent_id) : null;
    const limit    = Math.min(Number(req.query.limit || 50), 100);
    const offset   = Math.max(Number(req.query.offset || 0), 0);
    const uid      = tryUserId(req);

    const [rows] = await pool.query(`
      SELECT
        c.id, c.post_id, c.user_id, c.parent_id, c.content, c.created_at,
        CONCAT(u.firstname,' ',u.lastname) AS author,
        IFNULL(SUM(CASE WHEN v.vote=1 THEN 1 WHEN v.vote=-1 THEN -1 ELSE 0 END),0) AS score,
        (
          SELECT vote FROM votes
          WHERE user_id=? AND entity_type='comment' AND entity_id=c.id LIMIT 1
        ) AS my_vote
      FROM forum_comments c
      JOIN users u ON u.id=c.user_id
      LEFT JOIN votes v ON v.entity_type='comment' AND v.entity_id=c.id
      WHERE c.post_id=? AND (? IS NULL OR c.parent_id <=> ?)
      GROUP BY c.id
      ORDER BY c.created_at ASC
      LIMIT ? OFFSET ?
    `, [uid || 0, postId, parentId, parentId, limit, offset]);

    res.json({ ok:true, items: rows });
  } catch (e) {
    console.error('LIST COMMENTS ERROR:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* ===========================================================
   CREATE COMMENT (supports replies via parent_id)
   POST /api/forum/posts/:id/comments    { content, parent_id? }
   =========================================================== */
router.post('/posts/:id/comments', verifyToken, async (req, res) => {
  try {
    const postId = Number(req.params.id || 0);
    const { content, parent_id } = req.body || {};
    if (!postId || !content) return res.status(400).json({ ok:false, error:'content_required' });

    if (parent_id) {
      const [chk] = await pool.query(
        `SELECT id FROM forum_comments WHERE id=? AND post_id=? LIMIT 1`,
        [parent_id, postId]
      );
      if (!chk.length) return res.status(400).json({ ok:false, error:'bad_parent' });
    }

    const [r] = await pool.query(
      `INSERT INTO forum_comments (post_id, user_id, parent_id, content) VALUES (?,?,?,?)`,
      [postId, req.user.id, parent_id || null, content]
    );
    res.status(201).json({ ok:true, id: r.insertId });
  } catch (e) {
    console.error('CREATE COMMENT ERROR:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* ===========================================================
   VOTE ENDPOINTS (toggle/clear)
   POST /api/forum/posts/:id/vote     { vote: -1|0|1 }
   POST /api/forum/comments/:id/vote  { vote: -1|0|1 }
   =========================================================== */
router.post('/posts/:id/vote', verifyToken, (req, res) => voteEntity('post', req, res));
router.post('/comments/:id/vote', verifyToken, (req, res) => voteEntity('comment', req, res));

async function voteEntity(entityType, req, res) {
  try {
    const entityId = Number(req.params.id || 0);
    const val = Number((req.body || {}).vote);
    if (![1, -1, 0].includes(val)) return res.status(400).json({ ok:false, error:'bad_vote' });

    const uid = req.user.id;

    const [ex] = await pool.query(
      `SELECT id, vote FROM votes WHERE user_id=? AND entity_type=? AND entity_id=? LIMIT 1`,
      [uid, entityType, entityId]
    );

    // clear if same vote or vote=0
    if (!val || (ex.length && ex[0].vote === val)) {
      await pool.query(
        `DELETE FROM votes WHERE user_id=? AND entity_type=? AND entity_id=?`,
        [uid, entityType, entityId]
      );
      return res.json({ ok:true, cleared:true });
    }

    if (ex.length) {
      await pool.query(`UPDATE votes SET vote=? WHERE id=?`, [val, ex[0].id]);
    } else {
      await pool.query(
        `INSERT INTO votes (user_id, entity_type, entity_id, vote) VALUES (?,?,?,?)`,
        [uid, entityType, entityId, val]
      );
    }
    res.json({ ok:true });
  } catch (e) {
    console.error('VOTE ERROR:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
}

module.exports = router;
