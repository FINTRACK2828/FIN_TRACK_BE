module.exports = require('./buildRouter')(require('../controllers/recurringController'), [
 ['get','/','list'], ['post','/','create','recurring'], ['get','/:id','get'], ['put','/:id','update','recurring'], ['delete','/:id','remove'],
]);
