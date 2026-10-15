const { pool } = require('../config/db');
async function processReminders() {
  const days = Number(process.env.REMINDER_DAYS || 3);
  if (!Number.isInteger(days) || days < 0 || days > 30) throw new Error('REMINDER_DAYS must be 0 through 30');
  // One atomic statement + unique keys makes concurrent schedulers idempotent.
  const result = await pool.query(`INSERT INTO notifications (user_id,type,message,dedupe_key)
    SELECT user_id,'recurring_upcoming',CONCAT(name, ': ', amount, ' due ', next_payment_date),CONCAT('recurring:',id,':',next_payment_date)
    FROM recurring_payments WHERE active=TRUE AND next_payment_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $1::integer
    ON CONFLICT (user_id,dedupe_key) DO NOTHING`, [days]);
  return result.rowCount;
}
module.exports = { processReminders };
