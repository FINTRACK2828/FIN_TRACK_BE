const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const { pool, transaction } = require('../config/db');
const { ApiError } = require('../utils/errors');
const respond = require('../utils/response');
const mail = require('../services/mailService');
const safeUser = row => ({ id: row.id, name: row.name, email: row.email, created_at: row.created_at });
const accessToken = row => jwt.sign({ version: row.token_version }, process.env.JWT_SECRET, { algorithm: 'HS256', subject: String(row.id), expiresIn: process.env.JWT_EXPIRES_IN || '1h', issuer: 'fintrack', audience: 'fintrack-api' });
exports.register = async (req, res) => {
  const { name, email, password } = req.validated.body;
  const hash = await bcrypt.hash(password, 12);
  const result = await pool.query('INSERT INTO users (name,email,password_hash) VALUES ($1,$2,$3) RETURNING id', [name, email, hash]);
  const { rows } = await pool.query('SELECT id,name,email,created_at,token_version FROM users WHERE id=$1', [result.rows[0].id]);
  respond(res, { user: safeUser(rows[0]), token: accessToken(rows[0]) }, 'Registration successful', 201);
};
// A valid hash gives missing accounts comparable bcrypt work without revealing existence.
const dummyHash = bcrypt.hashSync('dummy-password-never-accepted', 12);
exports.login = async (req, res) => {
  const { email, password } = req.validated.body;
  const { rows } = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
  const valid = await bcrypt.compare(password, rows[0]?.password_hash || dummyHash);
  if (!rows.length || !valid) throw new ApiError(401, 'Invalid email or password');
  respond(res, { user: safeUser(rows[0]), token: accessToken(rows[0]) }, 'Login successful');
};
exports.changePassword = async (req, res) => {
  const { current_password, new_password } = req.validated.body;
  const hash = await bcrypt.hash(new_password, 12);
  await transaction(async db => {
    const { rows } = await db.query('SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [req.user.id]);
    if (!await bcrypt.compare(current_password, rows[0].password_hash)) throw new ApiError(400, 'Current password is incorrect');
    await db.query('UPDATE users SET password_hash=$1,token_version=token_version+1 WHERE id=$2', [hash, req.user.id]);
    await db.query('UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL', [req.user.id]);
  });
  respond(res, null, 'Password changed; please log in again');
};
exports.forgotPassword = async (req, res) => {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const { rows } = await pool.query('SELECT id,email FROM users WHERE email=$1', [req.validated.body.email]);
  if (rows.length) {
    await transaction(async db => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [rows[0].id]);
      await db.query('UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL', [rows[0].id]);
      await db.query('INSERT INTO password_reset_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,CURRENT_TIMESTAMP + INTERVAL \'30 minutes\') RETURNING id', [rows[0].id, tokenHash]);
    });
    // Delivery is intentionally detached from the uniform HTTP response.
    void mail.sendReset(rows[0].email, token).catch(() => console.error('Password reset email delivery failed'));
  }
  // Token is never returned, including development. Use a local SMTP inbox for testing.
  respond(res, null, 'If an account exists, password reset instructions will be sent');
};
exports.resetPassword = async (req, res) => {
  const tokenHash = crypto.createHash('sha256').update(req.validated.body.token).digest('hex');
  const hash = await bcrypt.hash(req.validated.body.new_password, 12);
  await transaction(async db => {
    const { rows: candidate } = await db.query('SELECT user_id FROM password_reset_tokens WHERE token_hash=$1', [tokenHash]);
    if (!candidate.length) throw new ApiError(400, 'Invalid or expired reset token');
    // Consistent user-before-token lock order serializes reset/change/forgot operations.
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [candidate[0].user_id]);
    const { rows } = await db.query('SELECT * FROM password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>CURRENT_TIMESTAMP FOR UPDATE', [tokenHash]);
    if (!rows.length) throw new ApiError(400, 'Invalid or expired reset token');
    await db.query('UPDATE users SET password_hash=$1,token_version=token_version+1 WHERE id=$2', [hash, rows[0].user_id]);
    await db.query('UPDATE password_reset_tokens SET used_at=CURRENT_TIMESTAMP WHERE user_id=$1 AND used_at IS NULL', [rows[0].user_id]);
  });
  respond(res, null, 'Password reset successful; please log in again');
};
exports.safeUser = safeUser;
