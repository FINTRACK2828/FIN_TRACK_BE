module.exports = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  let status = error.status || 500;
  let message = error.status ? error.message : 'An internal server error occurred';
  if (error.code === '23505') { status = 409; message = 'This record already exists'; }
  if (['23503', '23001'].includes(error.code)) { status = 409; message = 'A related record prevents this operation'; }
  if (['23514', '22003', '22007', '22P02'].includes(error.code)) { status = 400; message = 'Invalid database value'; }
  if (error.type === 'entity.parse.failed') { status = 400; message = 'Invalid JSON body'; }
  if (error.type === 'entity.too.large') { status = 413; message = 'Request body is too large'; }
  // Never log request bodies, credentials, SQL parameters, or token values.
  if (status >= 500) console.error('Request failed', { code: error.code || 'INTERNAL_ERROR' });
  res.status(status).json({ success: false, message });
};
