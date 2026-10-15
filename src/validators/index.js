const { z } = require('zod');
const { ApiError } = require('../utils/errors');
const id = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const amount = z.union([z.string(), z.number()]).transform(String).refine(v => /^\d{1,10}(\.\d{1,2})?$/.test(v) && Number(v) > 0 && Number(v) <= 9999999999.99, 'Amount must be positive, within DECIMAL(12,2), with at most two decimal places');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => v >= '1000-01-01' && v <= '9999-12-31' && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, 'Invalid calendar date');
const type = z.enum(['income', 'expense']);
const name = z.string().trim().min(1).max(100);
const password = z.string().min(10).max(72).refine(v => Buffer.byteLength(v, 'utf8') <= 72, 'Password must not exceed 72 UTF-8 bytes');
const email = z.string().trim().email().max(254).transform(v => v.toLowerCase());
const month = z.coerce.number().int().min(1).max(12);
const year = z.coerce.number().int().min(1000).max(9998);
const pagination = { page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) };
const transaction = z.object({ category_id: id, type, amount, description: z.string().trim().max(500).default(''), transaction_date: date }).strict();
const budget = z.object({ category_id: id, amount, month, year }).strict();
const goal = z.object({ name, target_amount: amount, target_date: date.nullable().optional(), description: z.string().trim().max(500).default('') }).strict();
const recurring = z.object({ name, amount, frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly']), next_payment_date: date, category_id: id, active: z.boolean().default(true) }).strict();
const schemas = {
  register: z.object({ name, email, password }).strict(), login: z.object({ email, password: z.string().min(1).max(200) }).strict(),
  profile: z.object({ name: name.optional(), email: email.optional() }).strict().refine(v => Object.keys(v).length > 0, 'Provide name or email'),
  changePassword: z.object({ current_password: z.string().min(1).max(200), new_password: password }).strict(),
  forgot: z.object({ email }).strict(), reset: z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), new_password: password }).strict(),
  category: z.object({ name, type }).strict(), transaction, budget, goal, recurring,
  contribution: z.object({ amount, contribution_date: date, note: z.string().trim().max(500).default('') }).strict(),
  id: z.object({ id }),
  transactionsQuery: z.object({ ...pagination, category_id: id.optional(), type: type.optional(), start_date: date.optional(), end_date: date.optional(), search: z.string().trim().max(100).optional(), sort: z.enum(['transaction_date', 'amount', 'created_at']).default('transaction_date'), order: z.enum(['asc', 'desc']).default('desc') }).strict().refine(v => !v.start_date || !v.end_date || v.start_date <= v.end_date, 'start_date must precede end_date'),
  period: z.object({ month: month.optional(), year: year.optional() }).strict(),
  monthly: z.object({ year: year.optional() }).strict(),
  recent: z.object({ limit: pagination.limit }).strict(),
  notifications: z.object({ ...pagination, unread: z.enum(['true', 'false']).optional() }).strict(),
};
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) return next(new ApiError(400, result.error.issues.map(i => `${i.path.join('.') || source}: ${i.message}`).join('; ')));
    req.validated ||= {}; req.validated[source] = result.data; next();
  };
}
module.exports = { schemas, validate };
