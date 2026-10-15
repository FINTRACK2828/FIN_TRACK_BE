const { pool } = require('../config/db');
const respond = require('../utils/response');
exports.me = async (req, res) => {
  const { rows } = await pool.query('SELECT id,name,email,created_at,updated_at FROM users WHERE id=$1', [req.user.id]);
  respond(res, rows[0]);
};
exports.update = async (req, res) => {
  const values = req.validated.body;
  await pool.query(`UPDATE users SET ${Object.keys(values).map((k, i) => `${k}=$${i + 1}`).join(',')} WHERE id=$${Object.keys(values).length + 1}`, [...Object.values(values), req.user.id]);
  return exports.me(req, res);
};
