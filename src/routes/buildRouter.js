const { Router } = require('express');
const auth = require('../middleware/authMiddleware');
const { schemas, validate } = require('../validators');
module.exports = (controller, definitions) => {
  const router = Router(); router.use(auth);
  for (const [method, path, handler, body, query] of definitions) {
    const middleware = [];
    if (path.includes(':id')) middleware.push(validate(schemas.id, 'params'));
    if (body) middleware.push(validate(schemas[body]));
    if (query) middleware.push(validate(schemas[query], 'query'));
    router[method](path, ...middleware, controller[handler]);
  }
  return router;
};
