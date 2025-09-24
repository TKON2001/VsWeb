const assert = require('assert');
const { PassThrough } = require('stream');
const store = require('../app/store');
const config = require('../app/config');
const Router = require('../app/router');
const authRoutes = require('../app/controllers/auth');
const packageRoutes = require('../app/controllers/packages');
const orderRoutes = require('../app/controllers/orders');
const numberRoutes = require('../app/controllers/numbers');
const adminRoutes = require('../app/controllers/admin');
const { createToken, verifyToken } = require('../app/utils/security');
const { generateNumbers, getRule } = require('../app/modules/numbers');

function buildRouter() {
  const router = new Router();
  [authRoutes, packageRoutes, orderRoutes, numberRoutes, adminRoutes].forEach((r) => {
    r.routes.forEach((route) => router.routes.push(route));
  });
  return router;
}

function createResponse() {
  let resolve;
  const done = new Promise((res) => {
    resolve = res;
  });
  return {
    headers: {},
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    write(chunk) {
      if (chunk) this.body += chunk.toString();
    },
    end(chunk) {
      if (chunk) this.body += chunk.toString();
      resolve();
    },
    wait() {
      return done;
    },
  };
}

async function sendRequest(router, method, url, options = {}) {
  const req = new PassThrough();
  req.method = method;
  req.url = url;
  req.headers = Object.assign({ host: 'test.local', 'user-agent': 'test-suite' }, options.headers || {});
  req.socket = { remoteAddress: options.remoteAddress || '127.0.0.1' };
  if (options.body !== undefined && options.body !== null) {
    if (!req.headers['content-type']) {
      req.headers['content-type'] = 'application/json';
    }
  }
  process.nextTick(() => {
    if (options.body !== undefined && options.body !== null) {
      req.end(JSON.stringify(options.body));
    } else {
      req.end();
    }
  });
  const res = createResponse();
  await router.handle(req, res);
  await res.wait();
  const parsed = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, body: parsed, headers: res.headers };
}

async function testTokenUtilities() {
  const token = createToken({ sub: 'user', role: 'ADMIN' }, 60);
  const payload = verifyToken(token);
  assert.strictEqual(payload.sub, 'user');
  const rule = getRule('MEGA_6_45');
  const results = generateNumbers(rule, { quantity: 3, avoidConsecutiveDuplicates: false });
  assert.strictEqual(results.length, 3);
  assert.strictEqual(results[0].length, 6);
}

async function testRefreshTokenFlow(router) {
  const email = 'user@example.com';
  const password = 'Secret123!';
  const register = await sendRequest(router, 'POST', '/auth/register', { body: { email, password } });
  assert.strictEqual(register.status, 201);
  assert.ok(register.body.verificationToken);

  const verify = await sendRequest(router, 'POST', '/auth/verify-email', { body: { token: register.body.verificationToken } });
  assert.strictEqual(verify.status, 200);

  const login = await sendRequest(router, 'POST', '/auth/login', { body: { email, password } });
  assert.strictEqual(login.status, 200);
  assert.ok(login.body.accessToken);
  assert.ok(login.body.refreshToken);
  const firstRefreshToken = login.body.refreshToken;
  const sessionId = firstRefreshToken.split('.')[0];
  let session = await store.findSessionById(sessionId);
  assert.ok(session);

  const refreshOnce = await sendRequest(router, 'POST', '/auth/refresh', { body: { refreshToken: firstRefreshToken } });
  assert.strictEqual(refreshOnce.status, 200);
  assert.ok(refreshOnce.body.accessToken);
  assert.ok(refreshOnce.body.refreshToken);
  assert.notStrictEqual(refreshOnce.body.refreshToken, firstRefreshToken);

  const refreshTwice = await sendRequest(router, 'POST', '/auth/refresh', {
    body: { refreshToken: refreshOnce.body.refreshToken },
  });
  assert.strictEqual(refreshTwice.status, 200);

  const reuseOld = await sendRequest(router, 'POST', '/auth/refresh', { body: { refreshToken: firstRefreshToken } });
  assert.strictEqual(reuseOld.status, 401);
  assert.strictEqual(reuseOld.body.error.message, 'Refresh token không hợp lệ.');
  session = await store.findSessionById(sessionId);
  assert.strictEqual(session, undefined);

  const loginAgain = await sendRequest(router, 'POST', '/auth/login', { body: { email, password } });
  assert.strictEqual(loginAgain.status, 200);
  const refreshTokenNew = loginAgain.body.refreshToken;
  const sessionIdNew = refreshTokenNew.split('.')[0];
  await store.updateSession(sessionIdNew, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const expiredAttempt = await sendRequest(router, 'POST', '/auth/refresh', { body: { refreshToken: refreshTokenNew } });
  assert.strictEqual(expiredAttempt.status, 401);
  assert.strictEqual(expiredAttempt.body.error.message, 'Phiên đã hết hạn.');
  const expiredSession = await store.findSessionById(sessionIdNew);
  assert.strictEqual(expiredSession, undefined);
}

async function testOtpFlow(router) {
  const ratePhone = '+84987654321';
  const sendFirst = await sendRequest(router, 'POST', '/auth/otp/send', { body: { phone: ratePhone } });
  assert.strictEqual(sendFirst.status, 200);
  assert.ok(sendFirst.body.debug.otp);
  assert.strictEqual(sendFirst.body.debug.otp.length, config.otp.length);

  const cooldown = await sendRequest(router, 'POST', '/auth/otp/send', { body: { phone: ratePhone } });
  assert.strictEqual(cooldown.status, 400);
  assert.strictEqual(cooldown.body.error.message, 'Vui lòng đợi trước khi yêu cầu OTP tiếp theo.');

  let latest = await store.findPendingOtp(ratePhone);
  await store.updateOtpRequest(latest.id, {
    createdAt: new Date(Date.now() - (config.otp.sendCooldownSeconds + 5) * 1000).toISOString(),
  });

  for (let i = 1; i < config.otp.maxPerWindow; i += 1) {
    const response = await sendRequest(router, 'POST', '/auth/otp/send', { body: { phone: ratePhone } });
    assert.strictEqual(response.status, 200);
    latest = await store.findPendingOtp(ratePhone);
    await store.updateOtpRequest(latest.id, {
      createdAt: new Date(Date.now() - (config.otp.sendCooldownSeconds + 5) * 1000).toISOString(),
    });
  }

  const limit = await sendRequest(router, 'POST', '/auth/otp/send', { body: { phone: ratePhone } });
  assert.strictEqual(limit.status, 400);
  assert.strictEqual(limit.body.error.message, 'Bạn đã yêu cầu OTP quá nhiều lần.');

  const verifyPhone = '+84876543210';
  const sendVerify = await sendRequest(router, 'POST', '/auth/otp/send', { body: { phone: verifyPhone } });
  assert.strictEqual(sendVerify.status, 200);
  const otpValue = sendVerify.body.debug.otp;
  const wrongOtp = otpValue === '000000' ? '111111' : '000000';
  const wrongAttempt = await sendRequest(router, 'POST', '/auth/otp/verify', { body: { phone: verifyPhone, otp: wrongOtp } });
  assert.strictEqual(wrongAttempt.status, 400);
  assert.strictEqual(wrongAttempt.body.error.message, 'OTP không chính xác.');
  const pendingAfterWrong = await store.findPendingOtp(verifyPhone);
  assert.ok(pendingAfterWrong);
  assert.strictEqual(pendingAfterWrong.attemptCount, 1);

  const success = await sendRequest(router, 'POST', '/auth/otp/verify', { body: { phone: verifyPhone, otp: otpValue } });
  assert.strictEqual(success.status, 200);
  assert.ok(success.body.accessToken);
  assert.ok(success.body.refreshToken);
  assert.strictEqual(success.body.user.phone, verifyPhone);
  const noPending = await store.findPendingOtp(verifyPhone);
  assert.strictEqual(noPending, undefined);
  const usedRecord = await store.findLatestOtp(verifyPhone);
  assert.strictEqual(usedRecord.status, 'USED');

  const expiryPhone = '+84888888888';
  const sendExpiry = await sendRequest(router, 'POST', '/auth/otp/send', { body: { phone: expiryPhone } });
  assert.strictEqual(sendExpiry.status, 200);
  let expiryRecord = await store.findPendingOtp(expiryPhone);
  await store.updateOtpRequest(expiryRecord.id, { expiresAt: new Date(Date.now() - 1000).toISOString() });
  const expiredVerify = await sendRequest(router, 'POST', '/auth/otp/verify', {
    body: { phone: expiryPhone, otp: sendExpiry.body.debug.otp },
  });
  assert.strictEqual(expiredVerify.status, 400);
  assert.strictEqual(expiredVerify.body.error.message, 'OTP đã hết hạn.');
  expiryRecord = await store.findLatestOtp(expiryPhone);
  assert.strictEqual(expiryRecord.status, 'EXPIRED');
}

async function testWalletAndNumberGeneration(router) {
  const email = 'wallet@example.com';
  const password = 'Secret123!';
  const register = await sendRequest(router, 'POST', '/auth/register', { body: { email, password } });
  const verify = await sendRequest(router, 'POST', '/auth/verify-email', { body: { token: register.body.verificationToken } });
  assert.strictEqual(verify.status, 200);
  const login = await sendRequest(router, 'POST', '/auth/login', { body: { email, password } });
  const { accessToken, user } = login.body;
  assert.ok(accessToken);
  const pack = await store.findPackageByCode('PKG_CREDITS_20');
  assert.ok(pack);
  const now = new Date();
  await store.createWallet({
    userId: user.id,
    packageId: pack.id,
    startedAt: now.toISOString(),
    expiredAt: new Date(now.getTime() + 86400000).toISOString(),
    remainingUsages: 2,
  });

  const first = await sendRequest(router, 'POST', '/numbers/generate', {
    headers: { authorization: `Bearer ${accessToken}` },
    body: { lotteryType: 'MEGA_6_45', quantity: 1 },
  });
  assert.strictEqual(first.status, 201);
  assert.strictEqual(first.body.results.length, 1);

  let wallets = await store.listWalletsByUser(user.id);
  assert.strictEqual(wallets[0].remainingUsages, 1);

  const second = await sendRequest(router, 'POST', '/numbers/generate', {
    headers: { authorization: `Bearer ${accessToken}` },
    body: { lotteryType: 'MEGA_6_45', quantity: 1 },
  });
  assert.strictEqual(second.status, 201);
  wallets = await store.listWalletsByUser(user.id);
  assert.strictEqual(wallets[0].remainingUsages, 0);

  const third = await sendRequest(router, 'POST', '/numbers/generate', {
    headers: { authorization: `Bearer ${accessToken}` },
    body: { lotteryType: 'MEGA_6_45', quantity: 1 },
  });
  assert.strictEqual(third.status, 400);
  assert.strictEqual(third.body.error.message, 'Bạn cần mua gói trước khi tạo số.');

  await store.createWallet({
    userId: user.id,
    packageId: pack.id,
    startedAt: new Date(now.getTime() - 86400000).toISOString(),
    expiredAt: new Date(now.getTime() - 1000).toISOString(),
    remainingUsages: 5,
  });

  const expiredWalletAttempt = await sendRequest(router, 'POST', '/numbers/generate', {
    headers: { authorization: `Bearer ${accessToken}` },
    body: { lotteryType: 'MEGA_6_45', quantity: 1 },
  });
  assert.strictEqual(expiredWalletAttempt.status, 400);
  assert.strictEqual(expiredWalletAttempt.body.error.message, 'Bạn cần mua gói trước khi tạo số.');
}

(async () => {
  await store.ready;
  const router = buildRouter();
  await store.reset();
  await testTokenUtilities();
  await store.reset();
  await testRefreshTokenFlow(router);
  await store.reset();
  await testOtpFlow(router);
  await store.reset();
  await testWalletAndNumberGeneration(router);
  console.log('Tests completed successfully.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
