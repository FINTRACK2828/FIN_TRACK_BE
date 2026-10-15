const { pool, transaction } = require('../config/db');
const { owned, goals, notify } = require('../services/financeService');
const respond = require('../utils/response');
async function achievement(db, userId, goalId) {
  const goal = (await goals(db, userId, goalId))[0];
  if (goal.achieved) await notify(db, userId, 'goal_achieved', `Savings goal achieved: ${goal.name}`, `goal:${goalId}:achieved`);
  return goal;
}
exports.create = async (req, res) => {
  const b = req.validated.body;
  const result = await pool.query('INSERT INTO savings_goals (user_id,name,target_amount,target_date,description) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.user.id, b.name, b.target_amount, b.target_date || null, b.description]);
  respond(res, (await goals(pool, req.user.id, result.rows[0].id))[0], 'Savings goal created successfully', 201);
};
exports.list = async (req, res) => respond(res, await goals(pool, req.user.id));
exports.get = async (req, res) => { await owned(pool, 'savings_goals', req.validated.params.id, req.user.id); respond(res, (await goals(pool, req.user.id, req.validated.params.id))[0]); };
exports.update = async (req, res) => {
  const goal = await transaction(async db => {
    const id = req.validated.params.id; const b = req.validated.body;
    await owned(db, 'savings_goals', id, req.user.id, true);
    await db.query('UPDATE savings_goals SET name=$1,target_amount=$2,target_date=$3,description=$4 WHERE id=$5 AND user_id=$6', [b.name, b.target_amount, b.target_date || null, b.description, id, req.user.id]);
    return achievement(db, req.user.id, id);
  }); respond(res, goal, 'Savings goal updated successfully');
};
exports.remove = async (req, res) => {
  await transaction(async db => { await owned(db, 'savings_goals', req.validated.params.id, req.user.id, true); await db.query('DELETE FROM savings_goals WHERE id=$1 AND user_id=$2', [req.validated.params.id, req.user.id]); });
  respond(res, null, 'Savings goal and its contribution history deleted successfully');
};
exports.contribute = async (req, res) => {
  const result = await transaction(async db => {
    const id = req.validated.params.id; const b = req.validated.body;
    await owned(db, 'savings_goals', id, req.user.id, true);
    const insert = await db.query('INSERT INTO goal_contributions (user_id,goal_id,amount,contribution_date,note) VALUES ($1,$2,$3,$4,$5) RETURNING id', [req.user.id, id, b.amount, b.contribution_date, b.note]);
    return { contribution: { id: insert.rows[0].id, goal_id: id, ...b }, goal: await achievement(db, req.user.id, id) };
  }); respond(res, result, 'Contribution recorded successfully', 201);
};
exports.contributions = async (req, res) => {
  await owned(pool, 'savings_goals', req.validated.params.id, req.user.id);
  const { rows } = await pool.query('SELECT * FROM goal_contributions WHERE goal_id=$1 AND user_id=$2 ORDER BY contribution_date DESC,id DESC', [req.validated.params.id, req.user.id]); respond(res, rows);
};
