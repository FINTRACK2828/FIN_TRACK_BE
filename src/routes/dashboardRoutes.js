module.exports = require('./buildRouter')(require('../controllers/dashboardController'), [
 ['get','/summary','summary',null,'period'], ['get','/category-spending','categorySpending',null,'period'], ['get','/monthly-summary','monthlySummary',null,'monthly'], ['get','/recent-transactions','recentTransactions',null,'recent'],
]);
