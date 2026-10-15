module.exports = require('./buildRouter')(require('../controllers/budgetController'), [
 ['get','/','list',null,'period'], ['post','/','create','budget'], ['put','/:id','update','budget'], ['delete','/:id','remove'],
]);
