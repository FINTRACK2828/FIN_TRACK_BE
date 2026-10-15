module.exports = require('./buildRouter')(require('../controllers/categoryController'), [
 ['get','/','list'], ['post','/','create','category'], ['put','/:id','update','category'], ['delete','/:id','remove'],
]);
