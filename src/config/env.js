require('dotenv').config({ quiet: true });
function validateEnvironment() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.includes('replace_')) throw new Error('JWT_SECRET must contain at least 32 characters and must not be a placeholder');
  if (!process.env.DB_USER || !process.env.DB_NAME) throw new Error('Configure DB_USER and DB_NAME');
  if (process.env.NODE_ENV === 'production' && (!process.env.SMTP_HOST || !process.env.PASSWORD_RESET_URL?.startsWith('https://') || !process.env.FRONTEND_ORIGIN?.startsWith('https://'))) throw new Error('Production requires SMTP_HOST and HTTPS reset/frontend URLs');
}
module.exports = { validateEnvironment };
