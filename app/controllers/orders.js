const crypto = require('crypto');
const { addMinutes } = require('../utils/datetime');
const Router = require('../router');
const store = require('../store');
const config = require('../config');
const { sendJson } = require('../utils/http');
const { badRequest, forbidden, notFound } = require('../utils/errors');
const { requireAuth } = require('../utils/auth');

const router = new Router();

const PROVIDERS = ['MOMO', 'ZALOPAY', 'VNPAY', 'BANK_TRANSFER'];

function buildPaymentUrl(provider, orderId) {
  const base = {
    MOMO: 'https://pay.momo.vn/order',
    ZALOPAY: 'https://pay.zalopay.vn/order',
    VNPAY: 'https://sandbox.vnpayment.vn/payment',
    BANK_TRANSFER: 'https://bank-transfer.example.com/order',
  }[provider];
  return `${base}/${orderId}`;
}

async function grantWallet(userId, packageId) {
  const pack = await store.findPackageById(packageId);
  if (!pack) return;
  const now = new Date();
  const expiredAt = pack.durationDays ? new Date(now.getTime() + pack.durationDays * 86400000) : null;
  await store.createWallet({
    userId,
    packageId,
    startedAt: now.toISOString(),
    expiredAt: expiredAt ? expiredAt.toISOString() : null,
    remainingUsages: pack.quotaUsages,
  });
}

router.register('POST', '/orders', async ({ req, res, body }) => {
  const { user } = await requireAuth(req);
  const data = body || {};
  if (!data.packageId || !data.provider) {
    throw badRequest('Thiếu thông tin đơn hàng.');
  }
  if (!PROVIDERS.includes(data.provider)) {
    throw badRequest('Nhà cung cấp không hợp lệ.');
  }
  const pack = await store.findPackageById(data.packageId);
  if (!pack || !pack.isActive) {
    throw notFound('Gói dịch vụ không tồn tại.');
  }
  const order = await store.createOrder({
    userId: user.id,
    packageId: pack.id,
    amount: pack.price,
    provider: data.provider,
    status: 'PENDING',
    expiredAt: addMinutes(new Date(), 15).toISOString(),
    paymentUrl: '',
  });
  const updated = await store.updateOrder(order.id, {
    paymentUrl: buildPaymentUrl(data.provider, order.id),
  });
  sendJson(res, 201, updated);
});

router.register('GET', '/orders', async ({ req, res }) => {
  const { user } = await requireAuth(req);
  const orders = await store.listOrdersByUser(user.id);
  sendJson(res, 200, orders);
});

router.register('GET', '/orders/:id', async ({ req, res, params }) => {
  const { user } = await requireAuth(req);
  const order = await store.findOrderById(params.id);
  if (!order) {
    throw notFound('Không tìm thấy đơn hàng.');
  }
  if (order.userId !== user.id) {
    throw forbidden('Bạn không có quyền xem đơn hàng này.');
  }
  sendJson(res, 200, order);
});

router.register('POST', '/orders/payments/:provider/callback', async ({ params, body, res }) => {
  const provider = params.provider.toUpperCase();
  if (!PROVIDERS.includes(provider)) {
    throw badRequest('Nhà cung cấp không hợp lệ.');
  }
  const data = body || {};
  if (!data.orderId || typeof data.amount !== 'number' || !data.status || !data.signature) {
    throw badRequest('Dữ liệu callback không hợp lệ.');
  }
  const expectedSignature = crypto
    .createHmac('sha256', config.paymentCallbackSecret)
    .update(`${data.orderId}|${data.status}|${data.amount}`)
    .digest('hex');
  if (expectedSignature !== data.signature) {
    throw badRequest('Chữ ký không hợp lệ.', 'INVALID_SIGNATURE');
  }
  const order = await store.findOrderById(data.orderId);
  if (!order) {
    throw notFound('Không tìm thấy đơn hàng.');
  }
  if (order.amount !== data.amount) {
    throw badRequest('Số tiền không khớp.');
  }
  let status = order.status;
  if (data.status === 'SUCCESS') status = 'PAID';
  else if (data.status === 'FAILED') status = 'FAILED';
  else status = 'CANCELED';
  const updated = await store.updateOrder(order.id, {
    status,
    providerTxnId: data.providerTxnId,
    paidAt: data.status === 'SUCCESS' ? new Date().toISOString() : order.paidAt,
  });
  if (status === 'PAID') {
    await grantWallet(order.userId, order.packageId);
  }
  sendJson(res, 200, { message: 'Đã ghi nhận callback.', order: updated });
});

module.exports = router;
