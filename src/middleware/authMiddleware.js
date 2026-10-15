const jwt = require('jsonwebtoken');
const { pool } = require('../config/db');
const { ApiError } = require('../utils/errors');
module.exports = async (req, res, next) => {
  try {
    const header = req.get('authorization');
    if (!header?.startsWith('Bearer ')) throw new ApiError(401, 'Authentication required');
    let payload;
    try { payload = jwt.verify(header.slice(7), process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'fintrack', audience: 'fintrack-api' }); }
    catch { throw new ApiError(401, 'Invalid or expired access token'); }
    if (!/^\d+$/.test(String(payload.sub))) throw new ApiError(401, 'Invalid access token');
    const { rows } = await pool.query('SELECT id, token_version FROM users WHERE id = $1', [payload.sub]);
    if (!rows.length || rows[0].token_version !== payload.version) throw new ApiError(401, 'Session expired; please log in again');
    req.user = { id: rows[0].id }; next();
  } catch (error) { next(error); }
};
