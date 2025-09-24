const Router = require('../router');
const store = require('../store');
const { sendJson } = require('../utils/http');
const { requireAuth } = require('../utils/auth');

const router = new Router();

router.register('GET', '/packages', async ({ res }) => {
  const packages = await store.listActivePackages();
  sendJson(res, 200, packages);
});

router.register('GET', '/packages/wallets', async ({ req, res }) => {
  const { user } = await requireAuth(req);
  const now = new Date();
  const wallets = await store.listWalletsByUser(user.id);
  const enriched = await Promise.all(
    wallets
      .filter((wallet) => !wallet.expiredAt || new Date(wallet.expiredAt) > now)
      .map(async (wallet) => ({
        ...wallet,
        package: await store.findPackageById(wallet.packageId),
      }))
  );
  sendJson(res, 200, enriched);
});

module.exports = router;
