// src/routes/admin.js
const router = require('express').Router();
const pool   = require('../db');
const jwt    = require('jsonwebtoken');

/* auth: require JWT and admin role */
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

/* GET /api/admin/stats/users-by-month?year=YYYY
   Returns { ok, year, months: [12 ints] } */
router.get('/stats/users-by-month', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year || now.getFullYear());

    // Ensure users table has created_at. If not, see migration below.
    const [rows] = await pool.query(
      `SELECT MONTH(created_at) AS m, COUNT(*) AS n
       FROM users
       WHERE YEAR(created_at)=?
       GROUP BY MONTH(created_at)`,
      [year]
    );

    const months = Array(12).fill(0);
    rows.forEach(r => {
      const idx = Math.min(Math.max((r.m || 1) - 1, 0), 11);
      months[idx] = Number(r.n) || 0;
    });

    res.json({ ok:true, year, months });
  } catch (e) {
    console.error('users-by-month error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* GET /api/admin/stats/posts-summary
   Returns { ok, total, open, closed, ban } */
router.get('/stats/posts-summary', requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT indicator, COUNT(*) AS n
       FROM forum_posts
       GROUP BY indicator`
    );
    const out = { total:0, open:0, closed:0, ban:0 };
    rows.forEach(r => {
      const key = (r.indicator || 'open').toLowerCase();
      if (out[key] == null) return;
      out[key] = Number(r.n) || 0;
      out.total += Number(r.n) || 0;
    });
    res.json({ ok:true, ...out });
  } catch (e) {
    console.error('posts-summary error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

router.get('/stats/dashboard', requireAdmin, async (req, res) => {
  try {
    const now = new Date();
    const year = Number(req.query.year || now.getFullYear());

    const qUsers =
      `SELECT MONTH(created_at) AS m, COUNT(*) AS n
       FROM users WHERE YEAR(created_at)=? GROUP BY MONTH(created_at)`;
    const qPosts =
      `SELECT indicator, COUNT(*) AS n
       FROM forum_posts GROUP BY indicator`;

    const [[usersRows], [postsRows]] = await Promise.all([
      pool.query(qUsers, [year]),
      pool.query(qPosts)
    ]);

    const months = Array(12).fill(0);
    for (const r of usersRows) {
      const idx = Math.min(Math.max((r.m || 1) - 1, 0), 11);
      months[idx] = Number(r.n) || 0;
    }

    const posts = { total:0, open:0, closed:0, ban:0 };
    for (const r of postsRows) {
      const k = (r.indicator || 'open').toLowerCase();
      if (posts[k] != null) posts[k] = Number(r.n) || 0;
      posts.total += Number(r.n) || 0;
    }

    res.json({
      ok: true,
      usersByMonth: { year, months },
      postsSummary: posts
    });
  } catch (e) {
    console.error('dashboard error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

module.exports = router;
