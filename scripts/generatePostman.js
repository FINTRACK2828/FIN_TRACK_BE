const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'postman'); fs.mkdirSync(root, { recursive: true });
const request = (name, method, url, body, capture, publicRoute = false) => ({
  name,
  request: { method, header: body ? [{ key: 'Content-Type', value: 'application/json' }] : [], url: '{{base_url}}' + url, ...(publicRoute ? { auth: { type: 'noauth' } } : {}), ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } } } : {}) },
  event: [{ listen: 'test', script: { type: 'text/javascript', exec: [
    "pm.test('Response uses the API envelope', () => { const json = pm.response.json(); pm.expect(json.success).to.be.a('boolean'); pm.expect(json.message).to.be.a('string'); });",
    "pm.test('Successful status', () => pm.expect(pm.response.code).to.be.within(200, 299));",
    ...(capture ? [capture] : []),
  ] } }],
});
const transaction = { category_id: '{{expense_category_id}}', type: 'expense', amount: '6500.00', description: 'Groceries', transaction_date: '2026-10-09' };
const budget = { category_id: '{{expense_category_id}}', amount: '8000.00', month: 10, year: 2026 };
const goal = { name: 'Buy Laptop', target_amount: '80000.00', target_date: '2027-10-01' };
const recurring = { name: 'Internet', amount: '799.00', frequency: 'monthly', next_payment_date: '2026-10-12', category_id: '{{expense_category_id}}', active: true };
const captureId = variable => `if (pm.response.code < 300) pm.environment.set('${variable}', pm.response.json().data.id);`;
const captureToken = "if (pm.response.code < 300) pm.environment.set('token', pm.response.json().data.token);";
const folder = (name, item) => ({ name, item });
const collection = {
  info: { name: 'FinTrack Backend', description: 'Run Authentication first, then categories and financial modules. Destructive requests and password changes are in a separate folder. Reset tokens come only from your SMTP inbox.', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  item: [
    request('Health', 'GET', '/health', null, null, true),
    folder('Authentication', [request('Register', 'POST', '/api/auth/register', { name: 'Demo User', email: '{{email}}', password: '{{password}}' }, captureToken, true), request('Login', 'POST', '/api/auth/login', { email: '{{email}}', password: '{{password}}' }, captureToken, true), request('Profile', 'GET', '/api/users/me'), request('Update profile', 'PUT', '/api/users/me', { name: 'FinTrack Demo' })]),
    folder('Categories', [request('List categories', 'GET', '/api/categories'), request('Create expense category', 'POST', '/api/categories', { name: 'Demo Groceries', type: 'expense' }, captureId('expense_category_id')), request('Create income category', 'POST', '/api/categories', { name: 'Demo Salary', type: 'income' }, captureId('income_category_id')), request('Update expense category', 'PUT', '/api/categories/{{expense_category_id}}', { name: 'Demo Food', type: 'expense' })]),
    folder('Transactions', [request('Create expense', 'POST', '/api/transactions', transaction, captureId('transaction_id')), request('Create income', 'POST', '/api/transactions', { category_id: '{{income_category_id}}', type: 'income', amount: '20000', transaction_date: '2026-10-01', description: 'Salary' }, captureId('income_transaction_id')), request('Filter and paginate', 'GET', '/api/transactions?type=expense&start_date=2026-10-01&end_date=2026-10-31&page=1&limit=20&sort=amount&order=desc&search=Groceries'), request('Get transaction', 'GET', '/api/transactions/{{transaction_id}}'), request('Update expense', 'PUT', '/api/transactions/{{transaction_id}}', { ...transaction, amount: '6500.00' })]),
    folder('Budgets', [request('Create budget', 'POST', '/api/budgets', budget, captureId('budget_id')), request('List with spending', 'GET', '/api/budgets?month=10&year=2026'), request('Update budget', 'PUT', '/api/budgets/{{budget_id}}', budget)]),
    folder('Savings goals', [request('Create goal', 'POST', '/api/goals', goal, captureId('goal_id')), request('List goals', 'GET', '/api/goals'), request('Get goal', 'GET', '/api/goals/{{goal_id}}'), request('Update goal', 'PUT', '/api/goals/{{goal_id}}', goal), request('Contribute', 'POST', '/api/goals/{{goal_id}}/contributions', { amount: '30000.00', contribution_date: '2026-10-09', note: 'Savings allocation' }), request('Contribution history', 'GET', '/api/goals/{{goal_id}}/contributions')]),
    folder('Dashboard', [request('Summary', 'GET', '/api/dashboard/summary?month=10&year=2026'), request('Category spending', 'GET', '/api/dashboard/category-spending?month=10&year=2026'), request('Monthly summary', 'GET', '/api/dashboard/monthly-summary?year=2026'), request('Recent transactions', 'GET', '/api/dashboard/recent-transactions?limit=5')]),
    folder('Recurring payments', [request('Create recurring', 'POST', '/api/recurring', recurring, captureId('recurring_id')), request('List recurring', 'GET', '/api/recurring'), request('Get recurring', 'GET', '/api/recurring/{{recurring_id}}'), request('Update recurring', 'PUT', '/api/recurring/{{recurring_id}}', recurring)]),
    folder('Notifications', [request('List notifications', 'GET', '/api/notifications?page=1&limit=20', null, "const items = pm.response.json().data.items; if (items.length) pm.environment.set('notification_id', items[0].id);"), request('Mark one read (requires notification)', 'PATCH', '/api/notifications/{{notification_id}}/read'), request('Mark all read', 'PATCH', '/api/notifications/read-all')]),
    folder('Manual password recovery and cleanup', [request('Forgot password', 'POST', '/api/auth/forgot-password', { email: '{{email}}' }, null, true), request('Reset password (copy token from email)', 'POST', '/api/auth/reset-password', { token: '{{reset_token}}', new_password: '{{new_password}}' }, null, true), request('Change password (revokes session)', 'POST', '/api/auth/change-password', { current_password: '{{password}}', new_password: '{{new_password}}' }), request('Delete expense', 'DELETE', '/api/transactions/{{transaction_id}}'), request('Delete income', 'DELETE', '/api/transactions/{{income_transaction_id}}'), request('Delete budget', 'DELETE', '/api/budgets/{{budget_id}}'), request('Delete goal and history', 'DELETE', '/api/goals/{{goal_id}}'), request('Delete recurring', 'DELETE', '/api/recurring/{{recurring_id}}'), request('Delete expense category', 'DELETE', '/api/categories/{{expense_category_id}}'), request('Delete income category', 'DELETE', '/api/categories/{{income_category_id}}')]),
  ],
};
const values = { base_url: 'http://localhost:5000', email: 'demo@example.com', password: 'Demo-password-123', new_password: 'New-demo-password-123', token: '', expense_category_id: '', income_category_id: '', transaction_id: '', income_transaction_id: '', budget_id: '', goal_id: '', recurring_id: '', notification_id: '', reset_token: '' };
fs.writeFileSync(path.join(root, 'FinTrack.postman_collection.json'), JSON.stringify(collection, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'FinTrack.local.postman_environment.json'), JSON.stringify({ name: 'FinTrack Local', values: Object.entries(values).map(([key, value]) => ({ key, value, enabled: true, type: key.includes('password') || key.includes('token') ? 'secret' : 'default' })), _postman_variable_scope: 'environment' }, null, 2) + '\n');
