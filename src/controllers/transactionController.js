const { pool, transaction } = require('../config/db');
const { owned, category, budgetNotifications } = require('../services/financeService');
const respond = require('../utils/response');
async function save(req, update) {
  return transaction(async db => {
    const b = req.validated.body;
    // Serialize each user's financial writes so threshold notifications see committed spending.
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
    if (update) await owned(db, 'transactions', req.validated.params.id, req.user.id, true);
    await category(db, b.category_id, req.user.id, b.type);
    let id = req.validated.params?.id;
    if (update) await db.query('UPDATE transactions SET category_id=$1,type=$2,amount=$3,description=$4,transaction_date=$5 WHERE id=$6 AND user_id=$7', [b.category_id, b.type, b.amount, b.description, b.transaction_date, id, req.user.id]);
    else {
      const result = await db.query('INSERT INTO transactions (user_id,category_id,type,amount,description,transaction_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [req.user.id, b.category_id, b.type, b.amount, b.description, b.transaction_date]); id = result.rows[0].id;
    }
    await budgetNotifications(db, req.user.id);
    return owned(db, 'transactions', id, req.user.id);
  });
}
exports.create = async (req, res) => respond(res, await save(req, false), 'Transaction created successfully', 201);
exports.update = async (req, res) => respond(res, await save(req, true), 'Transaction updated successfully');
exports.get = async (req, res) => respond(res, await owned(pool, 'transactions', req.validated.params.id, req.user.id));
exports.remove = async (req, res) => {
  await transaction(async db => {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
    await owned(db, 'transactions', req.validated.params.id, req.user.id, true);
    await db.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [req.validated.params.id, req.user.id]);
  }); respond(res, null, 'Transaction deleted successfully');
};
exports.list = async (req, res) => {
  const q = req.validated.query; const filters = ['t.user_id=$1']; const values = [req.user.id];
  for (const key of ['category_id', 'type']) if (q[key]) { filters.push(`t.${key}=$${values.length + 1}`); values.push(q[key]); }
  if (q.start_date) { filters.push(`t.transaction_date>=$${values.length + 1}`); values.push(q.start_date); }
  if (q.end_date) { filters.push(`t.transaction_date<=$${values.length + 1}`); values.push(q.end_date); }
  if (q.search) { filters.push(`t.description ILIKE $${values.length + 1} ESCAPE '='`); values.push(`%${q.search.replace(/[=%_]/g, c => '=' + c)}%`); }
  const where = filters.join(' AND ');
  const { rows: count } = await pool.query(`SELECT COUNT(*) AS total FROM transactions t WHERE ${where}`, values);
  // sort/order/page/limit are strictly validated; SQL identifiers cannot be bound parameters.
  const { rows } = await pool.query(`SELECT t.*,c.name AS category_name FROM transactions t JOIN categories c ON c.id=t.category_id WHERE ${where} ORDER BY t.${q.sort} ${q.order},t.id ${q.order} LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`, values);
  respond(res, { items: rows, pagination: { page: q.page, limit: q.limit, total: Number(count[0].total), total_pages: Math.ceil(count[0].total / q.limit) } });
};
