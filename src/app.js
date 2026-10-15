require('./config/env');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { pool } = require('./config/db');
const { ApiError } = require('./utils/errors');
const respond = require('./utils/response');
const app = express();
app.disable('x-powered-by');
app.use(helmet());
const origins = (process.env.FRONTEND_ORIGIN || 'http://localhost:3000').split(',').map(v => v.trim());
app.use(cors({ origin(origin, callback) { callback(origin && !origins.includes(origin) ? new ApiError(403, 'Origin is not allowed') : null, true); }, credentials: false }));
app.use(express.json({ limit: '32kb' }));
app.get('/health', async (req, res) => {
  try { await pool.query('SELECT 1'); respond(res, { server: 'up', database: 'connected' }, 'Healthy'); }
  catch { res.status(503).json({ success: false, message: 'Database unavailable', data: { server: 'up', database: 'disconnected' } }); }
});
for (const [path, file] of Object.entries({ auth: 'auth', users: 'user', categories: 'category', transactions: 'transaction', budgets: 'budget', goals: 'goal', recurring: 'recurring', dashboard: 'dashboard', notifications: 'notification' })) app.use(`/api/${path}`, require(`./routes/${file}Routes`));
app.use((req, res, next) => next(new ApiError(404, 'Endpoint not found')));
app.use(require('./middleware/errorMiddleware'));
module.exports = app;
