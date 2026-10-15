const { validateEnvironment } = require('./config/env');
const { pool } = require('./config/db');
const { processReminders } = require('./services/reminderService');
async function main() {
  validateEnvironment();
  await pool.query('SELECT 1');
  const interval = Number(process.env.REMINDER_INTERVAL_MS || 3600000);
  if (!Number.isSafeInteger(interval) || interval < 60000 || interval > 2147483647) throw new Error('REMINDER_INTERVAL_MS must be between 60000 and 2147483647');
  const app = require('./app');
  const server = app.listen(Number(process.env.PORT || 5000), () => console.log(`FinTrack API listening on port ${process.env.PORT || 5000}`));
  let running = false;
  const reminders = async () => { if (running) return; running = true; try { await processReminders(); } catch { console.error('Scheduled reminder processing failed'); } finally { running = false; } };
  const timer = setInterval(reminders, interval); timer.unref(); void reminders();
  let closing = false;
  const shutdown = () => { if (closing) return; closing = true; clearInterval(timer); server.close(async () => { await pool.end(); }); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
main().catch(async () => { console.error('Startup failed; check environment settings and PostgreSQL connectivity'); await pool.end(); process.exitCode = 1; });
