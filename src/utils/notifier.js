// src/utils/notifier.js
const pool = require('../db');

/**
 * Insert a notification (if recipient != actor).
 * @param {Object} p
 * @param {number} p.recipientId - post owner
 * @param {number|null} p.actorId - who triggered
 * @param {string} p.type - 'comment_on_post' | 'upvote_on_post' | ...
 * @param {string} p.title
 * @param {string|null} p.body
 * @param {string|null} p.subjectType - 'post' | 'comment'
 * @param {number|null} p.subjectId
 * @param {Object|null} p.meta
 */
async function notify(p) {
  const {
    recipientId,
    actorId = null,
    type,
    title,
    body = null,
    subjectType = null,
    subjectId = null,
    meta = null,
  } = p;

  if (!recipientId || !type || !title) return { skipped: true };
  if (actorId && Number(actorId) === Number(recipientId)) return { skipped: true }; // don't notify self

  const metaJson = meta ? JSON.stringify(meta) : null;
  await pool.query(
  `INSERT INTO notifications
    (recipient_id, actor_id, type, title, message, subject_type, subject_id, meta)
   VALUES (?,?,?,?,?,?,?,?)`,
  [recipientId, actorId, type, title, body, subjectType, subjectId, metaJson]
);
  return { ok: true };
}

module.exports = { notify };
