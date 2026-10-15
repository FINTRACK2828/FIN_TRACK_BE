const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cents, money, budgetMetrics, goalMetrics, dateRange } = require('../src/services/financeService');
const { schemas } = require('../src/validators');
test('money arithmetic preserves exact cents and negative net amounts', () => {
  assert.equal(money(cents('0.10') + cents('0.20')), '0.30');
  assert.equal(money(cents('10.01') - cents('20.02')), '-10.01');
  assert.equal(money(cents('9999999999.99')), '9999999999.99');
});
test('budget calculations report remaining, percentage, reached and exceeded', () => {
  const b = budgetMetrics({ amount: '8000.00', spent: '6500.00' });
  assert.equal(b.remaining, '1500.00'); assert.equal(b.usage_percentage, 81.25); assert.equal(b.exceeded, false);
  assert.equal(budgetMetrics({ amount: '8000.00', spent: '8000.01' }).exceeded, true);
  assert.equal(budgetMetrics({ amount: '8000.00', spent: '8000.00' }).usage_percentage, 100);
});
test('goal calculations include accurate history aggregate and oversaving', () => {
  assert.equal(goalMetrics({ target_amount: '80000.00', saved_amount: '30000.00' }).progress_percentage, 37.5);
  const g = goalMetrics({ target_amount: '100.00', saved_amount: '120.00' });
  assert.equal(g.achieved, true); assert.equal(g.remaining_amount, '0.00'); assert.equal(g.progress_percentage, 120);
});
test('December date ranges cross year boundary', () => assert.deepEqual(dateRange(12, 2026), ['2026-12-01', '2027-01-01']));
test('financial validation rejects invalid dates, amounts, owners and SQL sort injection', () => {
  const valid = { category_id: 1, type: 'expense', amount: '12.34', transaction_date: '2026-10-09' };
  assert.equal(schemas.transaction.safeParse(valid).success, true);
  for (const amount of ['0', '-1', '12.345', '10000000000', '1e2', NaN]) assert.equal(schemas.transaction.safeParse({ ...valid, amount }).success, false);
  for (const transaction_date of ['2026-02-29', '2026-04-31', '2026-13-01']) assert.equal(schemas.transaction.safeParse({ ...valid, transaction_date }).success, false);
  assert.equal(schemas.transaction.safeParse({ ...valid, user_id: 2 }).success, false);
  assert.equal(schemas.transactionsQuery.safeParse({ sort: 'amount; DROP TABLE users' }).success, false);
  assert.equal(schemas.transactionsQuery.safeParse({ start_date: '2026-10-10', end_date: '2026-10-01' }).success, false);
  assert.equal(schemas.register.safeParse({ name: 'Test', email: 'test@example.com', password: '😀'.repeat(20) }).success, false);
});
