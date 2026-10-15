require('dotenv').config({ quiet: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('PostgreSQL end-to-end authentication, CRUD, isolation, calculations, reset and reminders', { skip: process.env.POSTGRES_INTEGRATION_TESTS !== 'true' }, async () => {
  if (!process.env.DB_NAME?.endsWith('_test')) throw new Error('Integration tests require a dedicated DB_NAME ending in _test');
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'integration-test-only-secret-over-thirty-two-characters';
  const { pool } = require('../src/config/db');
  const request = require('supertest');
  const app = require('../src/app');
  const mail = require('../src/services/mailService');
  const { processReminders } = require('../src/services/reminderService');
  const userIds = [];
  const originalMail = mail.sendReset;
  let resetToken;
  mail.sendReset = async (email, token) => { resetToken = token; return true; };
  try {
    const { rows: existing } = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    if (existing.length) throw new Error('Integration database must be empty; no existing data will be modified');
    const schema = fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8');
    await pool.query(schema);
    const email = `alice-${Date.now()}@example.com`;
    const register = await request(app).post('/api/auth/register').send({ name: 'Alice', email, password: 'strong-password-123' });
    assert.equal(register.status, 201); const token = register.body.data.token; userIds.push(register.body.data.user.id);
    const bob = await request(app).post('/api/auth/register').send({ name: 'Bob', email: `bob-${Date.now()}@example.com`, password: 'strong-password-123' });
    assert.equal(bob.status, 201); userIds.push(bob.body.data.user.id); const bobToken = bob.body.data.token;
    const api = (method, url, body, jwt = token) => { const req = request(app)[method](url).auth(jwt, { type: 'bearer' }); return body ? req.send(body) : req; };
    assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'wrong' })).status, 401);
    assert.equal((await request(app).post('/api/auth/login').send({ email, password: 'strong-password-123' })).status, 200);
    const category = await api('post', '/api/categories', { name: 'Food', type: 'expense' }); assert.equal(category.status, 201); const categoryId = category.body.data.id;
    const income = await api('post', '/api/categories', { name: 'Salary', type: 'income' }); const incomeId = income.body.data.id;
    const budget = await api('post', '/api/budgets', { category_id: categoryId, amount: '8000.00', month: 10, year: 2026 }); assert.equal(budget.status, 201);
    assert.equal((await api('post', '/api/budgets', { category_id: categoryId, amount: '8000', month: 10, year: 2026 })).status, 409);
    const expenseBody = { category_id: categoryId, type: 'expense', amount: '6500.00', transaction_date: '2026-10-09', description: 'Groceries' };
    const expense = await api('post', '/api/transactions', expenseBody); assert.equal(expense.status, 201); const expenseId = expense.body.data.id;
    assert.equal((await api('get', `/api/transactions/${expenseId}`)).status, 200);
    assert.equal((await api('get', `/api/transactions/${expenseId}`, null, bobToken)).status, 404);
    assert.equal((await api('put', `/api/transactions/${expenseId}`, expenseBody, bobToken)).status, 404);
    assert.equal((await api('delete', `/api/transactions/${expenseId}`, null, bobToken)).status, 404);
    assert.equal((await api('post', '/api/transactions', expenseBody, bobToken)).status, 400);
    assert.equal((await api('post', '/api/transactions', { ...expenseBody, amount: '-1' })).status, 400);
    assert.equal((await api('post', '/api/transactions', { ...expenseBody, category_id: incomeId })).status, 400);
    await api('post', '/api/transactions', { category_id: incomeId, type: 'income', amount: '20000', transaction_date: '2026-10-01' });
    const budgets = await api('get', '/api/budgets?month=10&year=2026'); assert.equal(budgets.body.data[0].usage_percentage, 81.25);
    const filtered = await api('get', '/api/transactions?type=expense&search=Groceries&start_date=2026-10-01&end_date=2026-10-31'); assert.equal(filtered.body.data.pagination.total, 1);
    const goal = await api('post', '/api/goals', { name: 'Laptop', target_amount: '80000' }); assert.equal(goal.status, 201); const goalId = goal.body.data.id;
    const contribution = await api('post', `/api/goals/${goalId}/contributions`, { amount: '30000', contribution_date: '2026-10-09' }); assert.equal(contribution.body.data.goal.progress_percentage, 37.5);
    assert.equal((await api('get', `/api/goals/${goalId}/contributions`)).body.data.length, 1);
    assert.equal((await api('post', `/api/goals/${goalId}/contributions`, { amount: '1', contribution_date: '2026-10-09' }, bobToken)).status, 404);
    const dashboard = await api('get', '/api/dashboard/summary?month=10&year=2026'); assert.equal(dashboard.status, 200); assert.equal(dashboard.body.data.monthly_net_savings, '13500.00'); assert.equal(dashboard.body.data.total_goal_contributions, '30000.00');
    assert.equal((await api('get', '/api/dashboard/summary?month=10&year=2026', null, bobToken)).body.data.total_expenses, '0.00');
    await api('put', `/api/transactions/${expenseId}`, { ...expenseBody, amount: '9000' });
    const notifications = await api('get', '/api/notifications'); assert.equal(notifications.body.data.items.filter(n => n.type === 'budget_exceeded').length, 1);
    await api('put', `/api/transactions/${expenseId}`, { ...expenseBody, amount: '9001' });
    assert.equal((await api('get', '/api/notifications')).body.data.items.filter(n => n.type === 'budget_exceeded').length, 1);
    const today = new Date().toISOString().slice(0, 10);
    const recurring = await api('post', '/api/recurring', { name: 'Internet', amount: '500', category_id: categoryId, frequency: 'monthly', next_payment_date: today }); assert.equal(recurring.status, 201);
    await processReminders(); await processReminders();
    assert.equal((await api('get', '/api/notifications')).body.data.items.filter(n => n.type === 'recurring_upcoming').length, 1);
    assert.equal((await api('delete', `/api/transactions/${expenseId}`)).status, 200);
    assert.equal((await api('get', `/api/transactions/${expenseId}`)).status, 404);
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email }); assert.equal(forgot.status, 200); assert.equal(forgot.body.data, null); assert.ok(resetToken);
    const { rows: tokens } = await pool.query('SELECT token_hash FROM password_reset_tokens WHERE user_id=$1', [userIds[0]]); assert.notEqual(tokens[0].token_hash, resetToken);
    const reset = { token: resetToken, new_password: 'new-strong-password-123' };
    assert.equal((await request(app).post('/api/auth/reset-password').send(reset)).status, 200);
    assert.equal((await request(app).post('/api/auth/reset-password').send(reset)).status, 400);
    assert.equal((await api('get', '/api/users/me')).status, 401);
  } finally {
    mail.sendReset = originalMail;
    for (const id of userIds) {
      for (const table of ['transactions', 'budgets', 'recurring_payments', 'savings_goals', 'categories']) await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [id]);
      await pool.query('DELETE FROM users WHERE id=$1', [id]);
    }
    // Keep schema for inspection; no DROP DATABASE/TABLE operations.
    await pool.end();
  }
});
