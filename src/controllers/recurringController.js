const { pool, transaction } = require('../config/db');
const { category, owned } = require('../services/financeService');
const respond = require('../utils/response');
async function save(req, update) {
  return transaction(async db => {
    const b = req.validated.body; let id = req.validated.params?.id;
    if (update) await owned(db, 'recurring_payments', id, req.user.id, true);
    await category(db, b.category_id, req.user.id, 'expense');
    if (update) await db.query('UPDATE recurring_payments SET name=$1,amount=$2,frequency=$3,next_payment_date=$4,category_id=$5,active=$6 WHERE id=$7 AND user_id=$8', [b.name, b.amount, b.frequency, b.next_payment_date, b.category_id, b.active, id, req.user.id]);
    else { const result = await db.query('INSERT INTO recurring_payments (user_id,name,amount,frequency,next_payment_date,category_id,active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [req.user.id, b.name, b.amount, b.frequency, b.next_payment_date, b.category_id, b.active]); id = result.rows[0].id; }
    return owned(db, 'recurring_payments', id, req.user.id);
  });
}
exports.create = async (req, res) => respond(res, await save(req, false), 'Recurring payment created successfully', 201);
exports.update = async (req, res) => respond(res, await save(req, true), 'Recurring payment updated successfully');
exports.list = async (req, res) => { const { rows } = await pool.query('SELECT r.*,c.name AS category_name FROM recurring_payments r JOIN categories c ON c.id=r.category_id WHERE r.user_id=$1 ORDER BY next_payment_date,id', [req.user.id]); respond(res, rows); };
exports.get = async (req, res) => respond(res, await owned(pool, 'recurring_payments', req.validated.params.id, req.user.id));
exports.remove = async (req, res) => { await transaction(async db => { await owned(db, 'recurring_payments', req.validated.params.id, req.user.id, true); await db.query('DELETE FROM recurring_payments WHERE id=$1 AND user_id=$2', [req.validated.params.id, req.user.id]); }); respond(res, null, 'Recurring payment deleted successfully'); };
