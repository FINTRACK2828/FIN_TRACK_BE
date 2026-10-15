const nodemailer = require('nodemailer');
async function sendReset(email, token) {
  if (!process.env.SMTP_HOST) return false;
  const url = new URL(process.env.PASSWORD_RESET_URL);
  url.searchParams.set('token', token);
  const transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE === 'true', auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD } : undefined });
  await transport.sendMail({ from: process.env.SMTP_FROM, to: email, subject: 'Reset your FinTrack password', text: `Reset your password using this link within 30 minutes: ${url.toString()}\nIf you did not request this, ignore this email.` });
  return true;
}
module.exports = { sendReset };
