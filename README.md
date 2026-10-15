# FinTrack Backend

An independent CommonJS Node.js / Express REST API for personal finance, backed by PostgreSQL. No frontend is included. All financial APIs require a Bearer JWT and derive ownership from the verified session. Shared default categories are read-only; custom categories belong to their creator.

## Requirements and installation

- Node.js 20 or newer and npm (implemented and tested with Node.js 24).
- PostgreSQL 14 or newer.
- Postman, or any HTTP client.
- An SMTP server for password recovery. A local SMTP inbox is suitable for development.

From PowerShell in the workspace:

```powershell
cd fintrack-backend
npm ci
Copy-Item .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Put the generated secret into `JWT_SECRET` and replace database placeholders in `.env`. Never commit `.env`. The application deliberately refuses to start with a missing, short, or placeholder JWT secret. `npm ci` uses the committed dependency lockfile.

## PostgreSQL setup

Create the role and database once using pgAdmin or psql as a PostgreSQL administrator:

```sql
CREATE ROLE fintrack_app LOGIN PASSWORD 'YOUR_OWN_STRONG_PASSWORD';
CREATE DATABASE fintrack OWNER fintrack_app;
```

Run the schema and seed against that database:

```powershell
psql -h localhost -p 5432 -U fintrack_app -d fintrack -v ON_ERROR_STOP=1 -f database/schema.sql
psql -h localhost -p 5432 -U fintrack_app -d fintrack -v ON_ERROR_STOP=1 -f database/seed.sql
```

Alternatively open the fintrack database in pgAdmin Query Tool and execute each file. The scripts create missing tables and seed missing default categories without deleting data. They do not create the database automatically. Existing incompatible PostgreSQL tables require a reviewed migration. Existing data in the previous database engine is untouched and is not automatically imported. Back up and plan a separate data transfer if needed.

Use a separate restricted runtime role for production: grant schema USAGE, table SELECT/INSERT/UPDATE/DELETE, and sequence USAGE/SELECT after applying the schema as the owner. The development role above owns its database for convenient initialization.

## Environment settings

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production` |
| `PORT` | HTTP port, defaults to 5000 |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | PostgreSQL connection; port defaults to 5432; normal database is `fintrack` |
| `DB_SSL` | `true` enables TLS with certificate verification; default false for local development |
| `DB_CONNECTION_LIMIT` | Connection pool size, defaults to 10 |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Random signing secret; default token lifetime 1 hour |
| `FRONTEND_ORIGIN` | Exact allowed browser origin; comma-separated origins supported |
| `PASSWORD_RESET_URL` | Frontend reset page URL used in emailed links |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | SMTP host, port, and implicit TLS (`true` for typical port 465) |
| `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | SMTP authentication and sender |
| `REMINDER_INTERVAL_MS` | Reminder polling interval, defaults to 1 hour; minimum 1 minute |
| `REMINDER_DAYS` | Upcoming due-date window, 0–30, default 3 |
| `POSTGRES_INTEGRATION_TESTS` | Opt-in live database test switch; defaults to false |

Production startup requires SMTP and HTTPS frontend/reset URLs. Serve the API over HTTPS through your deployment infrastructure. The authentication rate limiter uses the direct socket IP and an in-memory store. For multiple API instances, configure a shared limiter store. Before placing the server behind a proxy, configure Express `trust proxy` precisely for your trusted infrastructure; do not blindly trust arbitrary forwarded IP headers.

Without SMTP, forgot-password still returns the same generic response but cannot deliver a reset email. No reset token is ever exposed in an API response or log. Configure SMTP before testing recovery through Postman. Do not store real passwords in exported Postman environments.

## Run

```powershell
npm run dev
# or
npm start
```

Startup verifies PostgreSQL connectivity before listening. `GET http://localhost:5000/health` returns server/database health; database failure produces HTTP 503 without connection details. You must initialize the schema before calling application endpoints.

```json
{"success":true,"message":"Healthy","data":{"server":"up","database":"connected"}}
```

## Architecture and files

```text
src/
  config/         environment validation and pg connection pool
  controllers/    authentication, users, categories, transactions, budgets,
                  goals, dashboard, recurring payments, notifications
  routes/         endpoint registration and reusable protected router builder
  middleware/     JWT/session verification and centralized error handling
  services/       exact finance arithmetic, owner/category checks, SMTP, reminders
  validators/     strict Zod request schemas
  utils/          error and response helpers
  app.js          Express app exported for tests
  server.js       startup, reminders and graceful shutdown
database/         non-destructive schema and default category seed
tests/            calculation, mocked HTTP and opt-in live PostgreSQL tests
postman/          collection and local environment
scripts/          Postman artifact generator
```

SQL values use bound parameters. Sorting columns come from strict allowlists. Mutating financial operations validate accessible categories and matching income/expense type. User-supplied ownership fields are rejected. Transactions serialize each user's expense/budget writes and atomically create threshold notifications. Contributions lock the goal, insert history and create achievement notifications together. Password resets lock the user and token, change the hash and revoke all sessions atomically.

The schema includes foreign keys, positive `DECIMAL(12,2)` values, category uniqueness, unique monthly budgets and notification deduplication keys. Cross-user category access is enforced in the API because shared categories require nullable owners. Contributions additionally use a composite goal/owner foreign key. Direct database writes must preserve the API's ownership and category-type rules.

## API reference

All paths below start with `/api`. Public endpoints are registration, login, forgot/reset-password. All other endpoints require `Authorization: Bearer <token>`.

| Module | Endpoints |
| --- | --- |
| Auth | `POST /auth/register`, `/auth/login`, `/auth/change-password`, `/auth/forgot-password`, `/auth/reset-password` |
| Profile | `GET /users/me`, `PUT /users/me` |
| Categories | `GET /categories`, `POST /categories`, `PUT /categories/:id`, `DELETE /categories/:id` |
| Transactions | `GET /transactions`, `POST /transactions`, `GET /transactions/:id`, `PUT /transactions/:id`, `DELETE /transactions/:id` |
| Budgets | `GET /budgets`, `POST /budgets`, `PUT /budgets/:id`, `DELETE /budgets/:id` |
| Goals | `GET /goals`, `POST /goals`, `GET /goals/:id`, `PUT /goals/:id`, `DELETE /goals/:id`, `POST /goals/:id/contributions`, `GET /goals/:id/contributions` |
| Recurring | `GET /recurring`, `POST /recurring`, `GET /recurring/:id`, `PUT /recurring/:id`, `DELETE /recurring/:id` |
| Dashboard | `GET /dashboard/summary`, `/dashboard/category-spending`, `/dashboard/monthly-summary`, `/dashboard/recent-transactions` |
| Notifications | `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` |

`PUT` for financial resources requires the complete resource body; profile updates may provide name, email, or both. Optional descriptions default to empty strings, target dates to null, and recurring active status to true.

| Resource | Required body fields |
| --- | --- |
| Register | `name`, `email`, `password` (10–72 UTF-8 bytes) |
| Login | `email`, `password` |
| Profile | `name` and/or `email` |
| Change password | `current_password`, `new_password` |
| Forgot password | `email` |
| Reset password | `token`, `new_password` |
| Category | `name`, `type` (`income` or `expense`) |
| Transaction | `category_id`, `type`, `amount`, `transaction_date`; optional `description` |
| Budget | `category_id` (expense category), `amount`, `month`, `year` |
| Goal | `name`, `target_amount`; optional `target_date`, `description` |
| Contribution | `amount`, `contribution_date`; optional `note` |
| Recurring | `name`, `amount`, `frequency`, `next_payment_date`, `category_id`; optional `active` |

Dates use `YYYY-MM-DD`. Monetary amounts must be positive, at most `9999999999.99`, with at most two fractional digits; send decimal strings to preserve precision. Monetary responses are decimal strings. Percentages are numeric and rounded to two decimals. Budget/dashboard years support 1000–9998 to allow an exclusive next-year date boundary. Database timestamps and reminder processing use UTC; date-only entries retain the submitted calendar date. No currency conversion is performed; all records are assumed to use the same application currency (e.g. INR).

Transaction list parameters: `start_date`, `end_date` (inclusive), `category_id`, `type`, `search` (literal description substring), `page` (default 1), `limit` (default 20, max 100), `sort` (`transaction_date`, `amount`, `created_at`), `order` (`asc`, `desc`). Ties sort by ID. Lists return `data.items` and `data.pagination` where pagination is supported.

Budgets accept optional `month`/`year` filters; omitting both returns all budgets. Dashboard summary/category-spending accept `month`/`year`, defaulting to the current UTC month/year. Monthly summary accepts `year` and returns all twelve months with zeroes for empty months. Recent transactions accepts `limit`. Notifications accept `page`, `limit`, and `unread=true` (unread only) or `unread=false` (read only).

## Sample requests and responses

Register:

```json
{"name":"Alice","email":"alice@example.com","password":"Strong-password-123"}
```

Successful registration/login returns `data.user` (no password hash) and `data.token`. Subsequent requests use that token as a Bearer token.

Create an expense after selecting an accessible expense category:

```json
{"category_id":5,"type":"expense","amount":"6500.00","description":"Groceries","transaction_date":"2026-10-09"}
```

```json
{"success":true,"message":"Transaction created successfully","data":{"id":1,"user_id":1,"category_id":5,"type":"expense","amount":"6500.00","description":"Groceries","transaction_date":"2026-10-09","created_at":"2026-10-09 12:00:00","updated_at":"2026-10-09 12:00:00"}}
```

Create a budget:

```json
{"category_id":5,"amount":"8000.00","month":10,"year":2026}
```

Budget responses include `spent`, `remaining`, `usage_percentage`, and `exceeded`. For the examples above these are `"6500.00"`, `"1500.00"`, `81.25`, and `false`.

Create a goal, then contribute using its ID:

```json
{"name":"Buy Laptop","target_amount":"80000.00","target_date":"2027-10-01"}
```

```json
{"amount":"30000.00","contribution_date":"2026-10-09","note":"Savings allocation"}
```

Goal responses include summed `saved_amount`, `remaining_amount`, `progress_percentage` (37.5 here) and `achieved`. Oversaving is allowed and progress can exceed 100%. Deleting a goal also deletes its contribution history.

Errors use a uniform envelope:

```json
{"success":false,"message":"Invalid email or password"}
```

Created resources use 201; reads/updates/deletions use 200. Validation uses 400, missing/expired JWTs use 401, denied browser origins use 403, unavailable or other users' resources use 404, duplicates/in-use categories use 409, rate limits use 429, and internal failures use a sanitized 500.

## Accounting, reminders and notifications

`net_balance` is all recorded income minus expenses; it is not a bank-account balance. `monthly_net_savings` is that difference for the selected month. `total_goal_contributions` is explicitly allocated goal savings, reported separately. Contributions do not create expense transactions, and budgets count only expense transactions in the matching category and calendar month.

Recurring frequencies are `daily`, `weekly`, `monthly`, and `yearly`. The scheduler creates one notification per recurring record/due date within the upcoming window, including today. It does not create transactions, execute payments or advance due dates. After handling a payment, update `next_payment_date` yourself; `frequency` records the intended schedule. Past-due reminders are not generated by this upcoming reminder rule.

Reminder processing runs on startup and periodically while the server is running. A job runner can alternatively invoke `npm run reminders`. Unique deduplication keys prevent duplicates across restarts/concurrent schedulers. Budget reached and exceeded notifications are each emitted at most once per budget/month/year, and goal achievement once per goal. Notifications record historical events; later editing an expense or target does not remove a previously emitted notification.

## Postman

Import both JSON files in `postman/` and select **FinTrack Local**. Set a unique demo email/password and confirm `base_url`. Run registration or login; their scripts automatically save the token. Create categories to populate category IDs, then run transaction, budget, goal, dashboard and recurring folders. Creation scripts capture IDs for later requests.

The **Manual password recovery and cleanup** folder contains actions to run individually: get the reset token from your SMTP inbox, set `reset_token`, then reset. Password changes invalidate the saved JWT; log in with the new password before further requests. Delete financial records before their categories. Mark-one-read needs an existing notification; exceeding a budget or running a due-date reminder creates one. Fixed sample dates use October 2026; adjust them when testing current reminders.

Collection tests check the envelope and successful status. Expected-error scenarios can be tested manually by removing a token, entering zero amount, supplying another user's resource ID, or creating a duplicate monthly budget. Regenerate artifacts with `node scripts/generatePostman.js` after editing that script.

## Automated verification

```powershell
npm test
```

Calculation/validation tests and HTTP tests with mocked database responses run without PostgreSQL. They cover hashing/login, invalid credentials, JWT expiry/revocation, ownership-scoped reads, request rejection, health, CORS, exact money, budgets, goals and monthly dashboard arithmetic. Mocked tests validate application behavior; they do not verify PostgreSQL SQL execution.

Live integration is opt-in and requires an **empty dedicated database ending in `_test`**:

```sql
CREATE DATABASE fintrack_test OWNER fintrack_app;
-- Use a dedicated test account with ownership of this empty test database.
```

```powershell
$env:DB_NAME = 'fintrack_test'
$env:POSTGRES_INTEGRATION_TESTS = 'true'
npm run test:integration
Remove-Item Env:POSTGRES_INTEGRATION_TESTS
Remove-Item Env:DB_NAME
```

Set test-account credentials in your environment as needed. The suite refuses a nonempty database, creates its schema, and tests actual transaction CRUD, isolation, category types, duplicate budgets, spending/progress/dashboard calculations, notification deduplication, reminders and single-use reset/session revocation. It mocks SMTP delivery, not database operations. It cleans up its created user records but leaves tables for inspection. Use a new empty dedicated test database for subsequent runs; the suite never drops a database or table.

Migration verification: 22 local calculation, mocked HTTP, and PostgreSQL query/transaction regression tests passed; one live integration test was skipped. PostgreSQL connectivity returned ECONNREFUSED on the configured local port 5432, so schema execution and live APIs remain unverified until PostgreSQL is installed/running and credentials are configured. The production dependency audit reported zero vulnerabilities. SMTP delivery requires separate configuration.

## Dependency audit

Nodemailer was upgraded to a patched release after the initial dependency audit. Three high-severity audit entries remain in the **development-only** nodemon → chokidar → braces chain; the registry offered no patched braces version during verification. Do not use `npm audit fix --force` to downgrade nodemon to an obsolete release. Production installs can use `npm ci --omit=dev` and `npm start`; the production dependency audit is checked separately. Recheck advisories with `npm audit` when updating dependencies.

## Common errors

| Symptom | Resolution |
| --- | --- |
| Startup failure | Set a valid JWT secret and database credentials; ensure PostgreSQL is running and the database exists |
| `ECONNREFUSED` / database health 503 | Check host/port and start PostgreSQL |
| Access denied | Match account user/password and grant permissions on the correct database |
| Table does not exist | Run schema then seed before calling APIs |
| Category invalid | Use a default or your own category with the matching income/expense type |
| Budget 409 | Update the existing budget for that category/month/year |
| Category deletion 409 | Remove/reassign referencing financial records first |
| JWT session expired | Log in again after password change/reset or token expiry |
| Browser CORS 403 | Match exact scheme, host and port in `FRONTEND_ORIGIN`; Postman is unaffected unless it sends Origin |
| No reset email | Configure SMTP and check its delivery/inbox; the API always returns a generic recovery response |
| Live test skipped | Set the opt-in flag and an empty `_test` database with a test account |
| Test runner spawn EPERM | Run from a terminal permitting Node subprocesses |

## PostgreSQL migration notes

The backend uses native `$1`, `$2` parameter binding and `RETURNING id`, PostgreSQL SQLSTATE errors, `ON CONFLICT DO NOTHING` notification deduplication, and one checked-out pg client per transaction. Database DATE values remain calendar strings and DECIMAL amounts remain strings; timestamps are returned in UTC ISO format. Update triggers maintain `updated_at`. Notification and recurring status fields are booleans. API endpoint paths and request bodies are unchanged. The private `.env` port was moved to 5432 and old database credentials replaced with PostgreSQL placeholders; enter your PostgreSQL credentials before starting.

Driver references: [parameterized queries](https://node-postgres.com/features/queries), [transactions](https://node-postgres.com/features/transactions).
