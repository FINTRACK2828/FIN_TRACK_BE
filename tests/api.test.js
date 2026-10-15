process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-only-secret-with-more-than-thirty-two-characters';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('../src/config/db');
const app = require('../src/app');
const originalQuery = db.pool.query;
const token = (id = 1, version = 0) => jwt.sign({ version }, process.env.JWT_SECRET, { subject: String(id), issuer: 'fintrack', audience: 'fintrack-api', expiresIn: '1h' });
function mockQuery(handler) { db.pool.query = handler; }
after(async () => { db.pool.query = originalQuery; await db.pool.end(); });
test('health reports connection success and failure without secrets', async () => {
  mockQuery(async () => ({ rows: [{ ok: 1 }] })); const good = await request(app).get('/health'); assert.equal(good.status, 200);
  mockQuery(async () => { throw new Error('secret-password'); }); const bad = await request(app).get('/health'); assert.equal(bad.status, 503); assert.ok(!JSON.stringify(bad.body).includes('secret-password'));
});
test('JWT rejects absent, malformed, expired and revoked sessions', async () => {
  assert.equal((await request(app).get('/api/users/me')).status, 401);
  assert.equal((await request(app).get('/api/users/me').auth('broken', { type: 'bearer' })).status, 401);
  const expired = jwt.sign({ version: 0 }, process.env.JWT_SECRET, { subject: '1', issuer: 'fintrack', audience: 'fintrack-api', expiresIn: -1 });
  assert.equal((await request(app).get('/api/users/me').auth(expired, { type: 'bearer' })).status, 401);
  mockQuery(async () => ({ rows: [{ id: 1, token_version: 1 }] }));
  assert.equal((await request(app).get('/api/users/me').auth(token(), { type: 'bearer' })).status, 401);
});
test('registration hashes password and never returns its hash', async () => {
  let storedHash;
  mockQuery(async (sql, values) => {
    if (sql.startsWith('INSERT')) { storedHash = values[2]; return { rows: [{ id: 42 }], rowCount: 1 }; }
    return { rows: [{ id: 42, name: 'Alice', email: 'alice@example.com', token_version: 0 }] };
  });
  const result = await request(app).post('/api/auth/register').send({ name: 'Alice', email: 'ALICE@example.com', password: 'strong-pass-123' });
  assert.equal(result.status, 201); assert.ok(await bcrypt.compare('strong-pass-123', storedHash)); assert.equal(result.body.data.user.password_hash, undefined);
  assert.equal(jwt.verify(result.body.data.token, process.env.JWT_SECRET).sub, '42');
});
test('login accepts correct credentials and gives a uniform invalid-credentials error', async () => {
  const hash = await bcrypt.hash('strong-pass-123', 4);
  mockQuery(async () => ({ rows: [{ id: 1, name: 'Alice', email: 'alice@example.com', password_hash: hash, token_version: 0 }] }));
  assert.equal((await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'strong-pass-123' })).status, 200);
  const wrong = await request(app).post('/api/auth/login').send({ email: 'alice@example.com', password: 'wrong-password' });
  mockQuery(async () => ({ rows: [] }));
  const missing = await request(app).post('/api/auth/login').send({ email: 'missing@example.com', password: 'wrong-password' });
  assert.equal(wrong.status, 401); assert.deepEqual(wrong.body, missing.body);
});
test('transaction retrieval scopes ownership to verified JWT', async () => {
  mockQuery(async (sql, args) => {
    if (sql.includes('token_version')) return { rows: [{ id: 2, token_version: 0 }] };
    assert.ok(sql.includes('id = $1 AND user_id = $2')); assert.deepEqual(args, [9, 2]); return { rows: [] };
  });
  assert.equal((await request(app).get('/api/transactions/9').auth(token(2), { type: 'bearer' })).status, 404);
});
test('invalid input fails before any financial query', async () => {
  mockQuery(async sql => { assert.ok(sql.includes('token_version')); return { rows: [{ id: 1, token_version: 0 }] }; });
  const bad = await request(app).post('/api/transactions').auth(token(), { type: 'bearer' }).send({ category_id: 1, type: 'expense', amount: 0, transaction_date: '2026-10-09' });
  assert.equal(bad.status, 400); assert.equal(bad.body.success, false);
  assert.equal((await request(app).get('/api/transactions?sort=invalid').auth(token(), { type: 'bearer' })).status, 400);
  assert.equal((await request(app).post('/api/auth/register').set('Content-Type', 'application/json').send('{')).status, 400);
});
test('monthly dashboard computes real query aggregates and fills empty months', async () => {
  mockQuery(async (sql, args) => {
    if (sql.includes('token_version')) return { rows: [{ id: 1, token_version: 0 }] };
    assert.deepEqual(args, [1, '2026-01-01', '2027-01-01']);
    return { rows: [{ month: 10, income: '1000.10', expenses: '400.20' }] };
  });
  const result = await request(app).get('/api/dashboard/monthly-summary?year=2026').auth(token(), { type: 'bearer' });
  assert.equal(result.status, 200); assert.equal(result.body.data.months.length, 12); assert.equal(result.body.data.months[9].net_savings, '599.90'); assert.equal(result.body.data.months[0].net_savings, '0.00');
});
test('CORS denies unconfigured browser origins', async () => {
  const result = await request(app).get('/health').set('Origin', 'https://untrusted.example'); assert.equal(result.status, 403);
});
test('transaction filtering uses numbered parameters and converts PostgreSQL counts', async () => {
  mockQuery(async (sql, values) => {
    if (sql.includes('token_version')) return { rows: [{ id: 1, token_version: 0 }] };
    assert.ok(sql.includes('t.user_id=$1 AND t.category_id=$2 AND t.type=$3 AND t.transaction_date>=$4 AND t.transaction_date<=$5 AND t.description ILIKE $6'));
    assert.deepEqual(values, [1, 5, 'expense', '2026-10-01', '2026-10-31', '%Food%']);
    return { rows: sql.includes('COUNT(*)') ? [{ total: '1' }] : [{ id: 7 }] };
  });
  const result = await request(app).get('/api/transactions?category_id=5&type=expense&start_date=2026-10-01&end_date=2026-10-31&search=Food').auth(token(), { type: 'bearer' });
  assert.equal(result.status, 200); assert.equal(result.body.data.pagination.total, 1);
});
test('profile updates number dynamic name and email parameters correctly', async () => {
  mockQuery(async (sql, values) => {
    if (sql.includes('token_version')) return { rows: [{ id: 1, token_version: 0 }] };
    if (sql.startsWith('UPDATE')) { assert.equal(sql, 'UPDATE users SET name=$1,email=$2 WHERE id=$3'); assert.deepEqual(values, ['Alice', 'alice@example.com', 1]); return { rowCount: 1, rows: [] }; }
    return { rows: [{ id: 1, name: 'Alice', email: 'alice@example.com' }] };
  });
  assert.equal((await request(app).put('/api/users/me').auth(token(), { type: 'bearer' }).send({ name: 'Alice', email: 'alice@example.com' })).status, 200);
});
test('transaction CRUD commits writes, validates category types and rolls back failures', async () => {
  const originalConnect = db.pool.connect;
  let record; let commits = 0; let rollbacks = 0;
  const connection = {
    release: () => {},
    query: async (sql, args) => {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'COMMIT') { commits++; return { rows: [] }; }
      if (sql === 'ROLLBACK') { rollbacks++; return { rows: [] }; }
      if (sql.includes('SELECT id FROM users')) return { rows: [{ id: 1 }] };
      if (sql.includes('FROM categories')) return { rows: [{ id: 5, user_id: null, type: 'expense' }] };
      if (sql.startsWith('INSERT INTO transactions')) { record = { id: 7, user_id: args[0], category_id: args[1], type: args[2], amount: args[3], description: args[4], transaction_date: args[5] }; return { rows: [{ id: 7 }], rowCount: 1 }; }
      if (sql.startsWith('UPDATE transactions')) { record = { ...record, category_id: args[0], type: args[1], amount: args[2], description: args[3], transaction_date: args[4] }; return { rows: [], rowCount: 1 }; }
      if (sql.startsWith('DELETE FROM transactions')) { record = undefined; return { rows: [], rowCount: 1 }; }
      if (sql.includes('FROM transactions WHERE id')) return { rows: record && record.id === args[0] && record.user_id === args[1] ? [record] : [] };
      if (sql.includes('FROM budgets')) return { rows: [] };
      throw new Error('Unexpected query in CRUD test');
    },
  };
  db.pool.connect = async () => connection;
  mockQuery(async (sql, args) => sql.includes('token_version') ? { rows: [{ id: 1, token_version: 0 }] } : connection.query(sql, args));
  const api = (method, url, body) => { const req = request(app)[method](url).auth(token(), { type: 'bearer' }); return body ? req.send(body) : req; };
  const body = { category_id: 5, type: 'expense', amount: '12.34', description: 'Test purchase', transaction_date: '2026-10-09' };
  try {
    const created = await api('post', '/api/transactions', body); assert.equal(created.status, 201); assert.equal(created.body.data.user_id, 1);
    assert.equal((await api('get', '/api/transactions/7')).body.data.amount, '12.34');
    const updated = await api('put', '/api/transactions/7', { ...body, amount: '25.00' }); assert.equal(updated.status, 200); assert.equal(updated.body.data.amount, '25.00');
    assert.equal((await api('put', '/api/transactions/7', { ...body, type: 'income' })).status, 400); assert.equal(rollbacks, 1);
    assert.equal((await api('delete', '/api/transactions/7')).status, 200); assert.equal((await api('get', '/api/transactions/7')).status, 404); assert.equal(commits, 3);
  } finally { db.pool.connect = originalConnect; }
});
