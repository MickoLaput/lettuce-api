// src/utils/notifier.js
const pool = require('../db');

async function notify(p) {
  const {
    recipientId,
    actorId = null,
    type,
    title,
    body = null,
    subjectType = null,   // 'post' | 'comment' | null
    subjectId = null,
    meta = null,
  } = p;

  if (!recipientId || !type || !title) return { skipped: true };
  if (actorId && Number(actorId) === Number(recipientId)) return { skipped: true };

  const postId    = subjectType === 'post'    ? subjectId : null;
  const commentId = subjectType === 'comment' ? subjectId : null;
  const metaJson  = meta ? JSON.stringify(meta) : null;

  await pool.query(
    `INSERT INTO notifications
       (recipient_id, actor_id, type, title, body, post_id, comment_id, meta)
     VALUES (?,?,?,?,?,?,?,?)`,
    [recipientId, actorId, type, title, body, postId, commentId, metaJson]
  );
  return { ok: true };
}

module.exports = { notify };
