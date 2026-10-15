require('../config/env');
const { pool } = require('../config/db');
const { processReminders } = require('./reminderService');
processReminders().then(() => console.log('Reminder processing completed')).catch(() => { console.error('Reminder processing failed; check database configuration'); process.exitCode = 1; }).finally(() => pool.end());
