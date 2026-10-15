const { pool, transaction } = require('../config/db');
const { ApiError } = require('../utils/errors');
const { owned } = require('../services/financeService');
const respond = require('../utils/response');
exports.list = async (req, res) => {
  const { rows } = await pool.query('SELECT id,user_id,name,type,created_at FROM categories WHERE user_id=$1 OR user_id IS NULL ORDER BY type,name', [req.user.id]); respond(res, rows);
};
exports.create = async (req, res) => {
  const { name, type } = req.validated.body;
  const result = await pool.query('INSERT INTO categories (user_id,name,type) VALUES ($1,$2,$3) RETURNING id', [req.user.id, name, type]);
  respond(res, { id: result.rows[0].id, name, type }, 'Category created successfully', 201);
};
exports.update = async (req, res) => {
  const { name, type } = req.validated.body; const id = req.validated.params.id;
  await transaction(async db => {
    const row = await owned(db, 'categories', id, req.user.id, true);
    if (row.type !== type) {
      const { rows: used } = await db.query('SELECT (EXISTS(SELECT 1 FROM transactions WHERE category_id=$1) OR EXISTS(SELECT 1 FROM budgets WHERE category_id=$2) OR EXISTS(SELECT 1 FROM recurring_payments WHERE category_id=$3)) AS used', [id, id, id]);
      if (used[0].used) throw new ApiError(409, 'Cannot change the type of a category in use');
    }
    await db.query('UPDATE categories SET name=$1,type=$2 WHERE id=$3 AND user_id=$4', [name, type, id, req.user.id]);
  }); respond(res, { id, name, type }, 'Category updated successfully');
};
exports.remove = async (req, res) => {
  const result = await pool.query('DELETE FROM categories WHERE id=$1 AND user_id=$2', [req.validated.params.id, req.user.id]);
  if (!result.rowCount) throw new ApiError(404, 'Category not found or is a shared default');
  respond(res, null, 'Category deleted successfully');
};
