module.exports = (res, data, message = 'Request successful', status = 200) => res.status(status).json({ success: true, message, data });
