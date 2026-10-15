require('./env');
const { Pool, types } = require('pg');
types.setTypeParser(1082, value => value); // Preserve DATE calendar values.
const pool = new Pool({
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME || 'fintrack',
  max: Number(process.env.DB_CONNECTION_LIMIT || 10), connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000, options: '-c timezone=UTC',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
});
pool.on('error', () => console.error('Idle database connection failed'));
async function transaction(work) {
  const connection = await pool.connect();
  try { await connection.query('BEGIN'); const result = await work(connection); await connection.query('COMMIT'); return result; }
  catch (error) { try { await connection.query('ROLLBACK'); } catch { /* Preserve original failure. */ } throw error; }
  finally { connection.release(); }
}
module.exports = { pool, transaction };
