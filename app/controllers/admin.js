const { subDays } = require('../utils/datetime');
const Router = require('../router');
const store = require('../store');
const { sendJson } = require('../utils/http');
const { badRequest, notFound } = require('../utils/errors');
const { requireRoles } = require('../utils/auth');

const router = new Router();

router.register('GET', '/admin/users', async ({ req, res, query }) => {
  await requireRoles(req, ['ADMIN', 'SUPER_ADMIN']);
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize || '20', 10), 1), 100);
  const { total, items } = await store.listUsers(
    {
      status: query.status,
      search: query.search,
    },
    { skip: (page - 1) * pageSize, take: pageSize }
  );
  sendJson(res, 200, { data: items, pagination: { page, pageSize, total } });
});

router.register('PATCH', '/admin/users/:id/status', async ({ req, res, params, body }) => {
  await requireRoles(req, ['ADMIN', 'SUPER_ADMIN']);
  const data = body || {};
  if (!data.status) {
    throw badRequest('Thiếu trạng thái.');
  }
  const updated = await store.updateUser(params.id, { status: data.status });
  if (!updated) {
    throw notFound('Không tìm thấy người dùng.');
  }
  sendJson(res, 200, { id: updated.id, email: updated.email, phone: updated.phone, status: updated.status });
});

router.register('GET', '/admin/orders', async ({ req, res, query }) => {
  await requireRoles(req, ['ADMIN', 'SUPER_ADMIN']);
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize || '20', 10), 1), 100);
  const { total, items } = await store.listOrders({ skip: (page - 1) * pageSize, take: pageSize });
  const enriched = await Promise.all(
    items.map(async (order) => ({
      ...order,
      user: await store.findUserById(order.userId),
      package: await store.findPackageById(order.packageId),
    }))
  );
  sendJson(res, 200, { data: enriched, pagination: { page, pageSize, total } });
});

router.register('POST', '/admin/packages', async ({ req, res, body }) => {
  await requireRoles(req, ['ADMIN', 'SUPER_ADMIN']);
  const data = body || {};
  if (!data.code || !data.name || typeof data.price !== 'number') {
    throw badRequest('Thiếu thông tin gói.');
  }
  const exists = await store.findPackageByCode(data.code);
  if (exists) {
    throw badRequest('Mã gói đã tồn tại.');
  }
  const created = await store.createPackage({
    code: data.code,
    name: data.name,
    description: data.description || null,
    price: data.price,
    currency: data.currency || 'VND',
    durationDays: data.durationDays === null ? null : data.durationDays,
    quotaUsages: data.quotaUsages === null ? null : data.quotaUsages,
    isActive: data.isActive !== false,
  });
  sendJson(res, 201, created);
});

router.register('PATCH', '/admin/packages/:id', async ({ req, res, params, body }) => {
  await requireRoles(req, ['ADMIN', 'SUPER_ADMIN']);
  const updated = await store.updatePackage(params.id, body || {});
  if (!updated) {
    throw notFound('Không tìm thấy gói.');
  }
  sendJson(res, 200, updated);
});

router.register('DELETE', '/admin/packages/:id', async ({ req, res, params }) => {
  await requireRoles(req, ['ADMIN', 'SUPER_ADMIN']);
  const updated = await store.updatePackage(params.id, { isActive: false });
  if (!updated) {
    throw notFound('Không tìm thấy gói.');
  }
  sendJson(res, 200, updated);
});

router.register('GET', '/admin/dashboard/summary', async ({ req, res }) => {
  await requireRoles(req, ['ADMIN', 'SUPER_ADMIN']);
  const last7Days = subDays(new Date(), 7);
  const [totalUsers, activeUsers, paidOrders, revenue, totalNumberRequests, last7dayRequests, popularLottery] = await Promise.all([
    store.countUsers(),
    store.countUsers({ status: 'ACTIVE' }),
    store.countOrders({ status: 'PAID' }),
    store.sumOrders({ status: 'PAID' }),
    store.countNumberRequests({}),
    store.countNumberRequests({ createdAfter: last7Days }),
    store.groupNumberRequestsByLottery(5, { createdAfter: last7Days }),
  ]);
  sendJson(res, 200, {
    totals: {
      users: totalUsers,
      activeUsers,
      paidOrders,
      revenue,
      numberRequests: totalNumberRequests,
    },
    last7Days: {
      numberRequests: last7dayRequests,
    },
    popularLotteryTypes: popularLottery,
  });
});

module.exports = router;
