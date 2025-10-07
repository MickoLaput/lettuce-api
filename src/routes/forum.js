// src/routes/forum.js
const router = require('express').Router();
const pool   = require('../db');
const jwt    = require('jsonwebtoken');

function requireAdmin(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ ok:false, error: 'no_token' });
  try {
    const p = jwt.verify(token, process.env.JWT_SECRET || 'dev');
    if (!p || !p.id) return res.status(401).json({ ok:false, error:'bad_token_payload' });
    if ((p.role || '').toLowerCase() !== 'admin') {
      return res.status(403).json({ ok:false, error:'forbidden' });
    }
    req.user = { id: p.id, role: p.role };
    next();
  } catch (e) {
    return res.status(401).json({ ok:false, error: e.name || 'unauthorized' });
  }
}

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
   LIST POSTS (with indicator + sort)
   GET /api/forum/posts?q=...&sort=latest|popular|yours|open|closed&limit=20&offset=0
   Only returns posts where indicator IN ('open','closed')
   =========================================================== */
router.get('/posts', async (req, res) => {
  try {
    const q      = (req.query.q || '').trim();
    let   sort   = (req.query.sort || 'latest').toLowerCase();
    const limit  = Math.min(Number(req.query.limit || 20), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    // backwards-compat alias
    if (sort === 'new') sort = 'latest';

    // validate sort
    const allowed = new Set(['latest','popular','yours','open','closed']);
    if (!allowed.has(sort)) {
      return res.status(400).json({ ok:false, error:'invalid_sort' });
    }

    const where = [];
    const params = [];

    // base visibility: only open/closed (never ban)
    if (sort === 'open') {
      where.push(`p.indicator = 'open'`);
    } else if (sort === 'closed') {
      where.push(`p.indicator = 'closed'`);
    } else if (sort === 'yours') {
      const uid = tryUserId(req);
      if (!uid) return res.status(401).json({ ok:false, error:'login_required' });
      where.push(`p.user_id = ?`);
      params.push(uid);
      where.push(`p.indicator IN ('open','closed')`);
    } else {
      // latest / popular
      where.push(`p.indicator IN ('open','closed')`);
    }

    // full‑text filter
    if (q) {
      where.push(`(p.title LIKE ? OR p.content LIKE ?)`);
      params.push(`%${q}%`, `%${q}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const orderSql = (sort === 'popular')
      ? 'ORDER BY score DESC, p.created_at DESC, p.id DESC'
      : 'ORDER BY p.created_at DESC, p.id DESC';

    const sql = `
      SELECT
        p.id, p.user_id, p.title, p.content, p.image_url, p.created_at, p.indicator,
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
      image_url: r.image_url || null,
      indicator: r.indicator || 'open'
    }));

    // count (apply same where but ignore GROUP BY/ORDER)
    // count DISTINCT to mirror GROUP BY p.id
    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS n
       FROM (
         SELECT p.id
         FROM forum_posts p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN votes v ON v.entity_type='post' AND v.entity_id=p.id
         LEFT JOIN forum_comments c ON c.post_id = p.id
         ${whereSql}
         GROUP BY p.id
       ) t`,
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
   indicator defaults to 'open' via DB; you may pass indicator if needed.
   =========================================================== */
router.post('/posts', verifyToken, async (req, res) => {
  try {
    const { title, content, image_url, indicator } = req.body || {};
    if (!title || !content) {
      return res.status(400).json({ ok:false, error: 'title_and_content_required' });
    }

    // only allow 'open' or 'closed' on create, otherwise fallback to DB default
    const allowed = new Set(['open','closed']);
    const ind = allowed.has((indicator || '').toLowerCase()) ? indicator.toLowerCase() : null;

    let sql, args;
    if (ind) {
      sql  = 'INSERT INTO forum_posts (user_id, title, content, image_url, indicator) VALUES (?,?,?,?,?)';
      args = [req.user.id, title, content, image_url || null, ind];
    } else {
      sql  = 'INSERT INTO forum_posts (user_id, title, content, image_url) VALUES (?,?,?,?)';
      args = [req.user.id, title, content, image_url || null];
    }

    const [r] = await pool.query(sql, args);
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (e) {
    console.error('CREATE POST ERROR:', e);
    res.status(500).json({ ok:false, error: 'server_error' });
  }
});

/* ===========================================================
   POST DETAIL (with score + my_vote)
   =========================================================== */
router.get('/posts/:id', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) return res.status(400).json({ ok:false, error:'bad_id' });

    const uid = tryUserId(req);

    const [rows] = await pool.query(`
      SELECT
        p.id, p.user_id, p.title, p.content, p.image_url, p.created_at, p.indicator,
        CONCAT(u.firstname,' ',u.lastname) AS author,
        IFNULL(SUM(CASE WHEN v.vote=1 THEN 1 WHEN v.vote=-1 THEN -1 ELSE 0 END),0) AS score,
        (
          SELECT vote FROM votes
          WHERE user_id=? AND entity_type='post' AND entity_id=p.id LIMIT 1
        ) AS my_vote
      FROM forum_posts p
      JOIN users u ON u.id=p.user_id
      LEFT JOIN votes v ON v.entity_type='post' AND v.entity_id=p.id
      WHERE p.id=? AND p.indicator IN ('open','closed')
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

/* ===========================================================
   BAN POST (admin only)
   PUT /api/forum/posts/:id/ban     { reason }
   =========================================================== */
router.put('/posts/:id/ban', requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const reason = (req.body && req.body.reason ? String(req.body.reason) : '').trim();
    if (!id || !reason) return res.status(400).json({ ok:false, error:'reason_required' });

    // find the post + owner
    const [rows] = await pool.query('SELECT id, user_id, indicator FROM forum_posts WHERE id=? LIMIT 1', [id]);
    if (!rows.length) return res.status(404).json({ ok:false, error:'not_found' });

    // update indicator
    await pool.query('UPDATE forum_posts SET indicator="ban" WHERE id=?', [id]);

    // write a notification to the post owner
    const ownerId = rows[0].user_id;
    const title = 'Your post was banned';
    const message = `An admin banned your post (ID ${id}). Reason: ${reason}`;
    const meta = JSON.stringify({ postId: id, reason, previousIndicator: rows[0].indicator });

    await pool.query(
      `INSERT INTO notifications (type, actor_id, recipient_id, post_id, title, message, meta)
       VALUES (?,?,?,?,?,?,?)`,
      ['post_banned', req.user.id, ownerId, id, title, message, meta]
    );

    res.json({ ok:true });
  } catch (e) {
    console.error('BAN POST ERROR:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

module.exports = router;
