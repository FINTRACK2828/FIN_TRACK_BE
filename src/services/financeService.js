const { ApiError } = require('../utils/errors');
// Integer cents keep aggregate money calculations exact; API money values are strings.
function cents(value) {
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}
function money(value) { const sign = value < 0n ? '-' : ''; const v = value < 0n ? -value : value; return `${sign}${v / 100n}.${String(v % 100n).padStart(2, '0')}`; }
function percentage(part, total) { return Number((part * 10000n + total / 2n) / total) / 100; }
function budgetMetrics(row) {
  const spent = cents(row.spent || '0'); const target = cents(row.amount);
  return { ...row, spent: money(spent), remaining: money(target - spent), usage_percentage: percentage(spent, target), exceeded: spent > target };
}
function goalMetrics(row) {
  const saved = cents(row.saved_amount || '0'); const target = cents(row.target_amount);
  return { ...row, saved_amount: money(saved), remaining_amount: money(target > saved ? target - saved : 0n), progress_percentage: percentage(saved, target), achieved: saved >= target };
}
async function owned(db, table, id, userId, lock = false) {
  // Table names are internal constants, never supplied by a client.
  const { rows } = await db.query(`SELECT * FROM ${table} WHERE id = $1 AND user_id = $2${lock ? ' FOR UPDATE' : ''}`, [id, userId]);
  if (!rows.length) throw new ApiError(404, 'Record not found');
  return rows[0];
}
async function category(db, categoryId, userId, type) {
  const { rows } = await db.query('SELECT * FROM categories WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) FOR SHARE', [categoryId, userId]);
  if (!rows.length) throw new ApiError(400, 'Invalid category');
  if (rows[0].type !== type) throw new ApiError(400, `Category must be of type ${type}`);
  return rows[0];
}
function period(query = {}) {
  const now = new Date(); return { month: query.month || now.getUTCMonth() + 1, year: query.year || now.getUTCFullYear() };
}
function dateRange(month, year) {
  return [`${year}-${String(month).padStart(2, '0')}-01`, month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`];
}
async function budgets(db, userId, query = {}) {
  const filters = ['b.user_id = $1']; const values = [userId];
  if (query.month) { filters.push(`b.month = $${values.length + 1}`); values.push(query.month); }
  if (query.year) { filters.push(`b.year = $${values.length + 1}`); values.push(query.year); }
  const { rows } = await db.query(`SELECT b.*, c.name AS category_name,
    COALESCE((SELECT SUM(t.amount) FROM transactions t WHERE t.user_id=b.user_id AND t.category_id=b.category_id AND t.type='expense'
    AND EXTRACT(YEAR FROM t.transaction_date)=b.year AND EXTRACT(MONTH FROM t.transaction_date)=b.month),0) AS spent
    FROM budgets b JOIN categories c ON c.id=b.category_id WHERE ${filters.join(' AND ')} ORDER BY b.year DESC,b.month DESC,b.id DESC`, values);
  return rows.map(budgetMetrics);
}
async function goals(db, userId, goalId) {
  const { rows } = await db.query(`SELECT g.*, COALESCE(SUM(c.amount),0) AS saved_amount FROM savings_goals g
    LEFT JOIN goal_contributions c ON c.goal_id=g.id AND c.user_id=g.user_id WHERE g.user_id=$1 ${goalId ? 'AND g.id=$2' : ''}
    GROUP BY g.id ORDER BY g.id DESC`, goalId ? [userId, goalId] : [userId]);
  return rows.map(goalMetrics);
}
async function notify(db, userId, type, message, key) {
  await db.query('INSERT INTO notifications (user_id,type,message,dedupe_key) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,dedupe_key) DO NOTHING', [userId, type, message, key]);
}
async function budgetNotifications(db, userId) {
  for (const b of await budgets(db, userId)) {
    if (cents(b.spent) >= cents(b.amount)) {
      const type = b.exceeded ? 'budget_exceeded' : 'budget_reached';
      await notify(db, userId, type, `${b.category_name}: budget ${b.exceeded ? 'exceeded' : 'limit reached'} for ${b.year}-${String(b.month).padStart(2, '0')}`, `budget:${b.id}:${b.year}:${b.month}:${type}`);
    }
  }
}
module.exports = { cents, money, percentage, budgetMetrics, goalMetrics, owned, category, period, dateRange, budgets, goals, notify, budgetNotifications };
