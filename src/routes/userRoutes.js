module.exports = require('./buildRouter')(require('../controllers/userController'), [
 ['get','/me','me'], ['put','/me','update','profile'],
]);
