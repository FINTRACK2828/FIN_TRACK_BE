require('dotenv').config({ quiet: true });
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('frontend service, HTTP API and PostgreSQL retain every module across fresh sessions', { skip: process.env.POSTGRES_INTEGRATION_TESTS !== 'true' }, async () => {
  assert.ok(process.env.DB_NAME?.endsWith('_test'), 'Use a dedicated test database');
  process.env.NODE_ENV = 'test';
  process.env.FRONTEND_ORIGIN = 'http://localhost:3101';
  const { pool } = require('../src/config/db');
  const { Client } = require('pg');
  const app = require('../src/app');
  let server;
  const userIds = [];
  const nativeFetch = global.fetch;
  const frontend = process.env.E2E_FRONTEND_URL;
  const storage = () => {
    const values = new Map();
    return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: k => values.delete(k) };
  };
  try {
    const tables = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    assert.equal(tables.rows.length, 0, 'Test database must be empty');
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/schema.sql'), 'utf8'));
    await pool.query(fs.readFileSync(path.join(__dirname, '../database/seed.sql'), 'utf8'));
    server = await new Promise(resolve => {
      const instance = app.listen(frontend ? 5101 : 0, '127.0.0.1', () => resolve(instance));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    global.localStorage = storage(); global.sessionStorage = storage();
    global.window = { dispatchEvent() {} };
    global.fetch = (url, options) => nativeFetch(frontend ? `${frontend}${url}` : `${base}${url.replace('/api/backend', '/api')}`, options);
    const sourcePath = process.env.E2E_FRONTEND_SOURCE || path.resolve(__dirname, '../../../Fin_Track_Frontend/fintrack-frontend/src/lib/api.js');
    const api = await import(`data:text/javascript;base64,${Buffer.from(fs.readFileSync(sourcePath, 'utf8')).toString('base64')}`);
    const { request, FinanceService: finance, saveSession, clearSession } = api;
    const password = 'e2e-strong-password-123';
    const email = `e2e-${Date.now()}@example.com`;
    const alice = await request('/auth/register', { method: 'POST', body: { name: 'E2E Alice', email, password }, token: null });
    userIds.push(alice.user.id); saveSession(alice);
    const bob = await request('/auth/register', { method: 'POST', body: { name: 'E2E Bob', email: `bob-${email}`, password }, token: null });
    userIds.push(bob.user.id);
    const now = new Date();
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
    const month = now.getMonth() + 1; const year = now.getFullYear();
    const category = await request('/categories', { method: 'POST', body: { name: 'E2E Food', type: 'expense' } });
    await request(`/categories/${category.id}`, { method: 'PUT', body: { name: 'E2E Groceries', type: 'expense' } });
    const expense = await finance.saveTransaction({ title: 'Saved groceries', category: 'E2E Groceries', type: 'expense', amount: 120.35, date }, false);
    const income = await finance.saveTransaction({ title: 'Saved salary', category: 'Salary', type: 'income', amount: 1000.50, date }, false);
    const budget = await finance.saveBudget({ category: 'E2E Groceries', allocated: 100, month, year }, false);
    const goal = await finance.addGoal({ title: 'Laptop', targetAmount: 500, currentAmount: 100, deadline: date, notes: 'Keep history' });
    await finance.contribute(goal.id, 400);
    const bill = await finance.saveRecurring({ title: 'Internet', amount: 40.50, category: 'E2E Groceries', billingCycle: 'Monthly', dueDate: date }, false);
    await finance.updateUser({ name: 'Alice Updated', email });
    let loaded = await finance.load();
    assert.equal(loaded.user.name, 'Alice Updated');
    assert.equal(loaded.transactions.find(t => t.id === expense.id).amount, 120.35);
    assert.equal(loaded.budgets.find(b => b.id === budget.id).spent, 120.35);
    assert.equal(loaded.savingsGoals.find(g => g.id === goal.id).currentAmount, 500);
    assert.equal(loaded.recurringBills.find(b => b.id === bill.id).dueDate, date);
    assert.equal((await request(`/goals/${goal.id}/contributions`)).length, 2);
    const summary = await request(`/dashboard/summary?month=${month}&year=${year}`);
    assert.equal(summary.monthly_net_savings, '880.15');
    assert.equal((await request(`/dashboard/category-spending?month=${month}&year=${year}`)).items.length, 1);
    assert.equal((await request('/dashboard/recent-transactions?limit=1')).length, 1);
    const notes = await request('/notifications?unread=true');
    assert.ok(notes.items.some(n => n.type === 'budget_exceeded'));
    assert.ok(notes.items.some(n => n.type === 'goal_achieved'));
    await request(`/notifications/${notes.items[0].id}/read`, { method: 'PATCH' });
    await request('/notifications/read-all', { method: 'PATCH' });
    assert.equal((await request('/notifications?unread=true')).items.length, 0);
    console.log('PASS: all modules create, calculate, list and store notification read state');

    await finance.saveTransaction({ id: expense.id, title: 'Updated groceries', category: 'E2E Groceries', type: 'expense', amount: 130.25, date }, true);
    await finance.saveBudget({ id: budget.id, category: 'E2E Groceries', allocated: 200, month, year }, true);
    await request(`/goals/${goal.id}`, { method: 'PUT', body: { name: 'Updated laptop', target_amount: '600', target_date: date, description: 'Updated history' } });
    await finance.saveRecurring({ id: bill.id, title: 'Updated internet', amount: 50, category: 'E2E Groceries', billingCycle: 'Monthly', dueDate: date, active: false }, true);
    await assert.rejects(request(`/categories/${category.id}`, { method: 'DELETE' }), /referenced|use|related/i);
    const fresh = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    await fresh.connect();
    try {
      const persisted = await fresh.query('SELECT amount,description,transaction_date::text FROM transactions WHERE id=$1', [expense.id]);
      assert.equal(persisted.rows[0].amount, '130.25'); assert.equal(persisted.rows[0].description, 'Updated groceries'); assert.equal(persisted.rows[0].transaction_date, date);
      assert.equal((await fresh.query('SELECT SUM(amount)::text AS total FROM goal_contributions WHERE goal_id=$1', [goal.id])).rows[0].total, '500.00');
    } finally { await fresh.end(); }
    clearSession();
    const login = await request('/auth/login', { method: 'POST', body: { email, password }, token: null });
    saveSession(login, false);
    loaded = await finance.load();
    assert.equal(loaded.transactions.find(t => t.id === expense.id).title, 'Updated groceries');
    assert.equal(loaded.budgets.find(b => b.id === budget.id).allocated, 200);
    assert.equal(loaded.savingsGoals.find(g => g.id === goal.id).title, 'Updated laptop');
    assert.equal(loaded.recurringBills.find(b => b.id === bill.id).active, false);
    assert.equal((await request('/notifications?unread=true')).items.length, 0);
    console.log('PASS: edits survive fresh database connections, logout, login and full frontend reload');

    if (process.env.E2E_BROWSER_URL) {
      assert.ok(frontend, 'Browser tests require E2E_FRONTEND_URL');
      try { await require('./browserFlow.cjs')({ base: frontend, email, password, fetch: nativeFetch }); }
      finally {
        const signup = await pool.query('SELECT id FROM users WHERE email=$1', [`browser-${email}`]);
        for (const row of signup.rows) userIds.push(row.id);
      }
      const browserRows = await pool.query("SELECT id,amount FROM transactions WHERE user_id=$1 AND description='Browser persisted expense'", [alice.user.id]);
      assert.equal(browserRows.rows.length, 1); assert.equal(browserRows.rows[0].amount, '17.25');
      await finance.remove('transactions', browserRows.rows[0].id);
      const ui = await finance.load();
      assert.equal(ui.user.name, 'Alice Browser');
      const browserGoal = ui.savingsGoals.find(g => g.title === 'Browser savings goal');
      assert.equal(browserGoal.currentAmount, 25);
      await finance.remove('goals', browserGoal.id);
      const browserBill = ui.recurringBills.find(b => b.title === 'Browser recurring bill');
      assert.equal(browserBill.amount, 30);
      await finance.remove('recurring', browserBill.id);
      const browserBudget = ui.budgets.find(b => b.id !== budget.id);
      assert.equal(browserBudget.allocated, 250);
      await finance.remove('budgets', browserBudget.id);
    }

    saveSession(bob);
    const isolated = await finance.load();
    for (const key of ['transactions', 'budgets', 'savingsGoals', 'recurringBills']) assert.equal(isolated[key].length, 0, key);
    for (const resource of [`transactions/${expense.id}`, `goals/${goal.id}`, `recurring/${bill.id}`]) await assert.rejects(request(`/${resource}`), /not found/i);
    await assert.rejects(request(`/notifications/${notes.items[0].id}/read`, { method: 'PATCH' }), /not found/i);
    console.log('PASS: another account cannot see or modify saved data');

    saveSession(login);
    await pool.query("INSERT INTO transactions(user_id,category_id,type,amount,description,transaction_date) SELECT $1,$2,'expense',1,'Pagination fixture',$3 FROM generate_series(1,101)", [alice.user.id, category.id, date]);
    assert.equal((await finance.load()).transactions.length, 103);
    const filtered = await request(`/transactions?search=Updated%20groceries&start_date=${date}&end_date=${date}`);
    assert.equal(filtered.pagination.total, 1);
    console.log('PASS: pagination retrieves all 103 records and date/search filters return saved data');
    await pool.query("DELETE FROM transactions WHERE user_id=$1 AND description='Pagination fixture'", [alice.user.id]);
    await finance.remove('transactions', expense.id); await finance.remove('transactions', income.id);
    await finance.remove('budgets', budget.id); await finance.remove('goals', goal.id); await finance.remove('recurring', bill.id); await finance.remove('categories', category.id);
    loaded = await finance.load();
    for (const key of ['transactions', 'budgets', 'savingsGoals', 'recurringBills']) assert.equal(loaded[key].length, 0);
    assert.equal(Number((await pool.query('SELECT COUNT(*) FROM goal_contributions WHERE goal_id=$1', [goal.id])).rows[0].count), 0);
    await request('/auth/change-password', { method: 'POST', body: { current_password: password, new_password: 'e2e-new-password-456' } });
    await assert.rejects(request('/users/me'), /session|token|unauthorized|authentication/i);
    await assert.rejects(request('/auth/login', { method: 'POST', body: { email, password }, token: null }), /invalid/i);
    assert.ok((await request('/auth/login', { method: 'POST', body: { email, password: 'e2e-new-password-456' }, token: null })).token);
    console.log('PASS: deletions persist, contribution history cascades and password changes revoke sessions');
  } finally {
    global.fetch = nativeFetch;
    delete global.window; delete global.localStorage; delete global.sessionStorage;
    if (server) await new Promise(resolve => server.close(resolve));
    for (const id of userIds) {
      for (const table of ['transactions', 'budgets', 'recurring_payments', 'savings_goals', 'categories']) await pool.query(`DELETE FROM ${table} WHERE user_id=$1`, [id]);
      await pool.query('DELETE FROM users WHERE id=$1', [id]);
    }
    await pool.end();
  }
});
