module.exports = require('./buildRouter')(require('../controllers/goalController'), [
 ['get','/','list'], ['post','/','create','goal'], ['get','/:id','get'], ['put','/:id','update','goal'], ['delete','/:id','remove'],
 ['post','/:id/contributions','contribute','contribution'], ['get','/:id/contributions','contributions'],
]);
