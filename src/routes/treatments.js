// src/routes/treatments.js
const router = require('express').Router();
const pool   = require('../db');

// normalize disease keys in case someone sends "Leaf Spot"
function keyify(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, '_');
}

/* ===========================================================
   LIST or GET-ONE (query-style)
   GET /api/treatments?limit=200&offset=0&q=...          -> list
   GET /api/treatments?disease=anthracnose               -> one
   Responses:
     list: { ok:true, items:[{disease, protocol}], total }
     one : { ok:true, treatment:{disease, protocol} }
   =========================================================== */
router.get('/treatments', async (req, res) => {
  try {
    const diseaseQ = (req.query.disease || '').trim();

    // ---- GET ONE (keep old behavior via ?disease=...) ----
    if (diseaseQ) {
      const key = keyify(diseaseQ);
      const [rows] = await pool.query(
        'SELECT disease, protocol FROM treatments WHERE disease = ? LIMIT 1',
        [key]
      );
      if (!rows.length) return res.status(404).json({ ok:false, error:'not_found' });
      return res.json({ ok:true, treatment: rows[0] });
    }

    // ---- LIST (used by Disease Library) ----
    const limit  = Math.min(parseInt(req.query.limit || 200, 10), 500);
    const offset = Math.max(parseInt(req.query.offset || 0, 10), 0);
    const q      = (req.query.q || '').trim();

    const where = [];
    const args  = [];
    if (q) {
      where.push('(disease LIKE ? OR protocol LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT disease, protocol
         FROM treatments
         ${whereSql}
         ORDER BY disease ASC
         LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [cnt] = await pool.query(
      `SELECT COUNT(*) AS n
         FROM treatments
         ${whereSql}`,
      args
    );

    return res.json({ ok:true, items: rows, total: cnt[0].n });
  } catch (e) {
    console.error('GET /api/treatments error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

/* ===========================================================
   GET-ONE (path-style)
   GET /api/treatments/:disease
   =========================================================== */
router.get('/treatments/:disease', async (req, res) => {
  try {
    const key = keyify(req.params.disease);
    if (!key) return res.status(400).json({ ok:false, error:'missing_disease' });

    const [rows] = await pool.query(
      'SELECT disease, protocol FROM treatments WHERE disease = ? LIMIT 1',
      [key]
    );
    if (!rows.length) return res.status(404).json({ ok:false, error:'not_found' });

    res.json({ ok:true, treatment: rows[0] });
  } catch (e) {
    console.error('GET /api/treatments/:disease error:', e);
    res.status(500).json({ ok:false, error:'server_error' });
  }
});

module.exports = router;
