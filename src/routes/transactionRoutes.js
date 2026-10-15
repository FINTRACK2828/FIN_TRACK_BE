module.exports = require('./buildRouter')(require('../controllers/transactionController'), [
 ['get','/','list',null,'transactionsQuery'], ['post','/','create','transaction'], ['get','/:id','get'], ['put','/:id','update','transaction'], ['delete','/:id','remove'],
]);
