const { pool, transaction } = require('../config/db');
const { category, owned, budgets, budgetNotifications } = require('../services/financeService');
const respond = require('../utils/response');
async function save(req, update) {
  return transaction(async db => {
    const b = req.validated.body;
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
    if (update) await owned(db, 'budgets', req.validated.params.id, req.user.id, true);
    await category(db, b.category_id, req.user.id, 'expense');
    let id = req.validated.params?.id;
    if (update) await db.query('UPDATE budgets SET category_id=$1,amount=$2,month=$3,year=$4 WHERE id=$5 AND user_id=$6', [b.category_id, b.amount, b.month, b.year, id, req.user.id]);
    else { const result = await db.query('INSERT INTO budgets (user_id,category_id,amount,month,year) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.user.id, b.category_id, b.amount, b.month, b.year]); id = result.rows[0].id; }
    await budgetNotifications(db, req.user.id);
    return (await budgets(db, req.user.id, { month: b.month, year: b.year })).find(row => row.id === id);
  });
}
exports.create = async (req, res) => respond(res, await save(req, false), 'Budget created successfully', 201);
exports.update = async (req, res) => respond(res, await save(req, true), 'Budget updated successfully');
exports.list = async (req, res) => respond(res, await budgets(pool, req.user.id, req.validated.query));
exports.remove = async (req, res) => {
  await transaction(async db => { await owned(db, 'budgets', req.validated.params.id, req.user.id, true); await db.query('DELETE FROM budgets WHERE id=$1 AND user_id=$2', [req.validated.params.id, req.user.id]); });
  respond(res, null, 'Budget deleted successfully');
};
