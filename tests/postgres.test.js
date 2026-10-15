const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { pool, transaction } = require('../src/config/db');
const { budgets, goals, notify } = require('../src/services/financeService');
const { processReminders } = require('../src/services/reminderService');
const errorMiddleware = require('../src/middleware/errorMiddleware');
after(() => pool.end());
test('budget period filters use correctly numbered PostgreSQL parameters', async () => {
  const db = { query: async (sql, values) => {
    assert.ok(sql.includes('b.user_id = $1 AND b.month = $2 AND b.year = $3'));
    assert.ok(sql.includes('EXTRACT(MONTH FROM t.transaction_date)'));
    assert.deepEqual(values, [7, 10, 2026]);
    return { rows: [{ amount: '8000.00', spent: '6500.00' }] };
  } };
  assert.equal((await budgets(db, 7, { month: 10, year: 2026 }))[0].remaining, '1500.00');
});
test('individual goal lookup binds owner and goal independently', async () => {
  const db = { query: async (sql, values) => {
    assert.ok(sql.includes('WHERE g.user_id=$1 AND g.id=$2'));
    assert.deepEqual(values, [7, 42]); return { rows: [{ target_amount: '100.00', saved_amount: '50.00' }] };
  } };
  assert.equal((await goals(db, 7, 42))[0].progress_percentage, 50);
});
test('notification insert deduplicates using PostgreSQL ON CONFLICT', async () => {
  await notify({ query: async (sql, values) => {
    assert.ok(sql.includes('VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,dedupe_key) DO NOTHING'));
    assert.deepEqual(values, [7, 'goal_achieved', 'Goal achieved', 'goal:42:achieved']);
    return { rowCount: 0, rows: [] };
  } }, 7, 'goal_achieved', 'Goal achieved', 'goal:42:achieved');
});
test('reminders bind integer date window and use boolean active status', async () => {
  const original = pool.query; const originalDays = process.env.REMINDER_DAYS;
  process.env.REMINDER_DAYS = '3';
  pool.query = async (sql, values) => {
    assert.ok(sql.includes('active=TRUE')); assert.ok(sql.includes('CURRENT_DATE + $1::integer'));
    assert.ok(sql.includes('ON CONFLICT (user_id,dedupe_key) DO NOTHING'));
    assert.deepEqual(values, [3]); return { rowCount: 2, rows: [] };
  };
  try { assert.equal(await processReminders(), 2); }
  finally { pool.query = original; if (originalDays === undefined) delete process.env.REMINDER_DAYS; else process.env.REMINDER_DAYS = originalDays; }
});
test('database transactions use one client and release on success and rollback', async () => {
  const original = pool.connect; const commands = []; let releases = 0;
  const client = { query: async sql => { commands.push(sql); return { rows: [] }; }, release: () => releases++ };
  pool.connect = async () => client;
  try {
    assert.equal(await transaction(async db => { assert.equal(db, client); await db.query('SELECT 1'); return 42; }), 42);
    await assert.rejects(transaction(async () => { throw new Error('failure'); }), /failure/);
    assert.deepEqual(commands, ['BEGIN', 'SELECT 1', 'COMMIT', 'BEGIN', 'ROLLBACK']); assert.equal(releases, 2);
  } finally { pool.connect = original; }
});
test('PostgreSQL uniqueness and constraint errors use sanitized API responses', () => {
  for (const [code, expected] of [['23505', 409], ['23503', 409], ['23001', 409], ['23514', 400]]) {
    let status; let body;
    errorMiddleware({ code, message: 'private database detail' }, {}, { headersSent: false, status(v) { status = v; return this; }, json(v) { body = v; } }, () => {});
    assert.equal(status, expected); assert.equal(body.success, false); assert.ok(!body.message.includes('private'));
  }
});
