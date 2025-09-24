const http = require('http');
const config = require('./app/config');
const Router = require('./app/router');
const authRoutes = require('./app/controllers/auth');
const packageRoutes = require('./app/controllers/packages');
const orderRoutes = require('./app/controllers/orders');
const numberRoutes = require('./app/controllers/numbers');
const adminRoutes = require('./app/controllers/admin');
const store = require('./app/store');
const { sendJson } = require('./app/utils/http');

async function bootstrap() {
  await store.ready;
  const appRouter = new Router();
  const routers = [authRoutes, packageRoutes, orderRoutes, numberRoutes, adminRoutes];
  routers.forEach((router) => {
    router.routes.forEach((route) => appRouter.routes.push(route));
  });
  appRouter.register('GET', '/health', async ({ res }) => {
    sendJson(res, 200, { status: 'ok' });
  });

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    appRouter.handle(req, res);
  });

  server.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to bootstrap server', error);
  process.exit(1);
});
