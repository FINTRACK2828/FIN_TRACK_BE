const { pool } = require('../config/db');
const { ApiError } = require('../utils/errors');
const respond = require('../utils/response');
exports.list = async (req, res) => {
  const q = req.validated.query; const where = `user_id=$1${q.unread === 'true' ? ' AND is_read=FALSE' : q.unread === 'false' ? ' AND is_read=TRUE' : ''}`;
  const { rows: count } = await pool.query(`SELECT COUNT(*) AS total FROM notifications WHERE ${where}`, [req.user.id]);
  const { rows } = await pool.query(`SELECT id,type,message,is_read,created_at FROM notifications WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`, [req.user.id]);
  respond(res, { items: rows, pagination: { page: q.page, limit: q.limit, total: Number(count[0].total), total_pages: Math.ceil(count[0].total / q.limit) } });
};
exports.read = async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM notifications WHERE id=$1 AND user_id=$2', [req.validated.params.id, req.user.id]);
  if (!rows.length) throw new ApiError(404, 'Notification not found');
  await pool.query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_id=$2', [req.validated.params.id, req.user.id]); respond(res, null, 'Notification marked as read');
};
exports.readAll = async (req, res) => { await pool.query('UPDATE notifications SET is_read=TRUE WHERE user_id=$1 AND is_read=FALSE', [req.user.id]); respond(res, null, 'All notifications marked as read'); };
