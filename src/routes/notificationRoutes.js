module.exports = require('./buildRouter')(require('../controllers/notificationController'), [
 ['get','/','list',null,'notifications'], ['patch','/read-all','readAll'], ['patch','/:id/read','read'],
]);
