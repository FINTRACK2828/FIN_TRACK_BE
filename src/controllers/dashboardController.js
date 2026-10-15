const { pool, transaction } = require('../config/db');
const f = require('../services/financeService');
const respond = require('../utils/response');
async function totals(db, userId, range) {
  const { rows } = await db.query(`SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE 0 END),0) AS income,
    COALESCE(SUM(CASE WHEN type='expense' THEN amount ELSE 0 END),0) AS expenses FROM transactions WHERE user_id=$1 ${range ? 'AND transaction_date>=$2 AND transaction_date<$3' : ''}`, range ? [userId, ...range] : [userId]);
  return { income: f.money(f.cents(rows[0].income)), expenses: f.money(f.cents(rows[0].expenses)), net: f.money(f.cents(rows[0].income) - f.cents(rows[0].expenses)) };
}
async function spending(db, userId, range) {
  const { rows } = await db.query(`SELECT c.id AS category_id,c.name, SUM(t.amount) AS amount FROM transactions t JOIN categories c ON c.id=t.category_id
    WHERE t.user_id=$1 AND t.type='expense' AND t.transaction_date>=$2 AND t.transaction_date<$3 GROUP BY c.id,c.name ORDER BY amount DESC`, [userId, ...range]); return rows;
}
async function recent(db, userId, limit) {
  const { rows } = await db.query(`SELECT t.*,c.name AS category_name FROM transactions t JOIN categories c ON c.id=t.category_id WHERE t.user_id=$1 ORDER BY transaction_date DESC,id DESC LIMIT ${limit}`, [userId]); return rows;
}
exports.summary = async (req, res) => {
  const period = f.period(req.validated.query); const range = f.dateRange(period.month, period.year);
  const data = await transaction(async db => {
    const all = await totals(db, req.user.id); const monthly = await totals(db, req.user.id, range);
    const { rows: saved } = await db.query('SELECT COALESCE(SUM(amount),0) AS total FROM goal_contributions WHERE user_id=$1', [req.user.id]);
    return { period, total_income: all.income, total_expenses: all.expenses, net_balance: all.net, monthly_income: monthly.income, monthly_expenses: monthly.expenses, monthly_net_savings: monthly.net,
      total_goal_contributions: f.money(f.cents(saved[0].total)), category_spending: await spending(db, req.user.id, range), budget_usage: await f.budgets(db, req.user.id, period), savings_goals: await f.goals(db, req.user.id), recent_transactions: await recent(db, req.user.id, 5) };
  }); respond(res, data);
};
exports.categorySpending = async (req, res) => { const p = f.period(req.validated.query); respond(res, { period: p, items: await spending(pool, req.user.id, f.dateRange(p.month, p.year)) }); };
exports.monthlySummary = async (req, res) => {
  const year = req.validated.query.year || new Date().getUTCFullYear();
  const { rows } = await pool.query(`SELECT EXTRACT(MONTH FROM transaction_date)::integer AS month,
    SUM(CASE WHEN type='income' THEN amount ELSE 0 END) AS income,SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) AS expenses
    FROM transactions WHERE user_id=$1 AND transaction_date>=$2 AND transaction_date<$3 GROUP BY EXTRACT(MONTH FROM transaction_date)::integer`, [req.user.id, `${year}-01-01`, `${year + 1}-01-01`]);
  respond(res, { year, months: Array.from({ length: 12 }, (_, i) => { const row = rows.find(r => r.month === i + 1); const income = row?.income || '0.00'; const expenses = row?.expenses || '0.00'; return { month: i + 1, income, expenses, net_savings: f.money(f.cents(income) - f.cents(expenses)) }; }) });
};
exports.recentTransactions = async (req, res) => respond(res, await recent(pool, req.user.id, req.validated.query.limit));
