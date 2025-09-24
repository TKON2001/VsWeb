const Router = require('../router');
const { sendJson } = require('../utils/http');
const { badRequest, notFound } = require('../utils/errors');
const { requireAuth } = require('../utils/auth');
const store = require('../store');
const { getRule, generateNumbers } = require('../modules/numbers');

const router = new Router();

router.register('POST', '/numbers/generate', async ({ req, res, body }) => {
  const { user } = await requireAuth(req);
  const data = body || {};
  if (!data.lotteryType || !data.quantity) {
    throw badRequest('Thiếu dữ liệu tạo số.');
  }
  const rule = getRule(String(data.lotteryType));
  if (!rule) {
    throw badRequest('Loại xổ số không được hỗ trợ.');
  }
  const quantity = Number(data.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    throw badRequest('Số lượng không hợp lệ.');
  }
  const wallets = await store.listWalletsByUser(user.id);
  const now = new Date();
  const wallet = wallets.find((item) => (!item.expiredAt || new Date(item.expiredAt) > now) && (item.remainingUsages === null || (item.remainingUsages || 0) > 0));
  if (!wallet) {
    throw badRequest('Bạn cần mua gói trước khi tạo số.');
  }
  const results = generateNumbers(rule, {
    quantity,
    avoidConsecutiveDuplicates: !!data.avoidConsecutiveDuplicates,
  });
  if (wallet.remainingUsages !== null && wallet.remainingUsages !== undefined) {
    if (wallet.remainingUsages <= 0) {
      throw badRequest('Gói của bạn đã hết lượt sử dụng.');
    }
    await store.updateWallet(wallet.id, { remainingUsages: wallet.remainingUsages - 1 });
  }
  const request = await store.createNumberRequest(
    {
      userId: user.id,
      packageId: wallet.packageId,
      lotteryType: rule.code,
      quantity,
      params: { avoidConsecutiveDuplicates: !!data.avoidConsecutiveDuplicates },
    },
    results
  );
  sendJson(res, 201, { requestId: request.id, results });
});

router.register('GET', '/numbers/history', async ({ req, res, query }) => {
  const { user } = await requireAuth(req);
  const page = Math.max(parseInt(query.page || '1', 10), 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize || '10', 10), 1), 50);
  let fromDate;
  let toDate;
  if (query.from) {
    fromDate = new Date(query.from);
    if (Number.isNaN(fromDate.getTime())) throw badRequest('Thời gian bắt đầu không hợp lệ.');
  }
  if (query.to) {
    toDate = new Date(query.to);
    if (Number.isNaN(toDate.getTime())) throw badRequest('Thời gian kết thúc không hợp lệ.');
  }
  const { total, items } = await store.listNumberRequests({
    userId: user.id,
    lotteryType: query.lotteryType,
    from: fromDate,
    to: toDate,
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  sendJson(res, 200, { data: items, pagination: { page, pageSize, total } });
});

router.register('GET', '/numbers/:id', async ({ req, res, params }) => {
  const { user } = await requireAuth(req);
  const record = await store.findNumberRequestById(params.id);
  if (!record) {
    throw notFound('Không tìm thấy lịch sử.');
  }
  if (record.userId !== user.id) {
    throw badRequest('Bạn không có quyền truy cập.');
  }
  sendJson(res, 200, record);
});

module.exports = router;
