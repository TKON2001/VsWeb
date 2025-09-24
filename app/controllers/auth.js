const crypto = require('crypto');
const { addSeconds, differenceInSeconds, subMinutes } = require('../utils/datetime');
const store = require('../store');
const config = require('../config');
const Router = require('../router');
const { sendJson } = require('../utils/http');
const { badRequest, unauthorized } = require('../utils/errors');
const { createToken, verifyToken } = require('../utils/security');

const router = new Router();

function parseBody(body) {
  return body || {};
}

async function issueTokens(user, req) {
  const sessionToken = crypto.randomBytes(32).toString('hex');
  const refreshTokenHash = store.createPasswordHash(sessionToken);
  const session = await store.createSession({
    userId: user.id,
    refreshTokenHash,
    userAgent: req.headers['user-agent'],
    ipAddress: req.socket.remoteAddress,
    expiresAt: new Date(Date.now() + config.refreshTokenTtl * 1000).toISOString(),
  });
  const refreshToken = `${session.id}.${sessionToken}`;
  const accessToken = createToken({ sub: user.id, role: user.role, sid: session.id }, config.accessTokenTtl);
  return { accessToken, refreshToken, expiresIn: config.accessTokenTtl };
}

router.register('POST', '/auth/register', async ({ req, res, body }) => {
  const data = parseBody(body);
  if (!data.email || !data.password) {
    throw badRequest('Email và mật khẩu là bắt buộc.');
  }
  const email = data.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw badRequest('Email không hợp lệ.');
  }
  const existingEmail = await store.findUserByEmail(email);
  if (existingEmail) {
    throw badRequest('Email đã tồn tại.');
  }
  if (data.phone) {
    const existingPhone = await store.findUserByPhone(data.phone);
    if (existingPhone) {
      throw badRequest('Số điện thoại đã được sử dụng.');
    }
  }
  if (String(data.password).length < 8) {
    throw badRequest('Mật khẩu tối thiểu 8 ký tự.');
  }
  const passwordHash = store.createPasswordHash(String(data.password));
  const user = await store.createUser({ email, phone: data.phone, passwordHash, status: 'ACTIVE' });
  const token = crypto.randomBytes(32).toString('hex');
  await store.createEmailToken(user.id, token, addSeconds(new Date(), 86400));
  sendJson(res, 201, {
    message: 'Đăng ký thành công. Vui lòng xác minh email.',
    verificationToken: config.env === 'production' ? undefined : token,
  });
});

router.register('POST', '/auth/verify-email', async ({ res, body }) => {
  const data = parseBody(body);
  if (!data.token) {
    throw badRequest('Thiếu token.');
  }
  const record = await store.findEmailToken(data.token);
  if (!record) {
    throw badRequest('Token không hợp lệ.');
  }
  if (new Date(record.expiresAt) < new Date()) {
    await store.deleteEmailToken(record.id);
    throw badRequest('Token đã hết hạn.');
  }
  await store.updateUser(record.userId, { emailVerifiedAt: new Date().toISOString() });
  await store.deleteEmailToken(record.id);
  sendJson(res, 200, { message: 'Xác minh email thành công.' });
});

router.register('POST', '/auth/login', async ({ req, res, body }) => {
  const data = parseBody(body);
  if (!data.email || !data.password) {
    throw badRequest('Thiếu thông tin đăng nhập.');
  }
  const user = await store.findUserByEmail(String(data.email).toLowerCase());
  if (!user || !store.verifyPassword(String(data.password), user.passwordHash)) {
    throw unauthorized('Email hoặc mật khẩu không chính xác.');
  }
  if (!user.emailVerifiedAt) {
    throw badRequest('Email chưa được xác minh.');
  }
  if (user.status !== 'ACTIVE') {
    throw unauthorized('Tài khoản đã bị khóa.');
  }
  const tokens = await issueTokens(user, req);
  sendJson(res, 200, { user: { id: user.id, email: user.email, phone: user.phone, role: user.role }, ...tokens });
});

router.register('POST', '/auth/refresh', async ({ res, body }) => {
  const data = parseBody(body);
  if (!data.refreshToken) {
    throw badRequest('Thiếu refresh token.');
  }
  const parts = String(data.refreshToken).split('.');
  if (parts.length !== 2) {
    throw badRequest('Refresh token không hợp lệ.');
  }
  const [sessionId, token] = parts;
  const session = await store.findSessionById(sessionId);
  if (!session) {
    throw unauthorized('Phiên không hợp lệ.');
  }
  if (new Date(session.expiresAt) < new Date()) {
    await store.deleteSession(session.id);
    throw unauthorized('Phiên đã hết hạn.');
  }
  if (!store.verifyPassword(token, session.refreshTokenHash)) {
    await store.deleteSession(session.id);
    throw unauthorized('Refresh token không hợp lệ.');
  }
  const user = await store.findUserById(session.userId);
  if (!user || user.status !== 'ACTIVE') {
    await store.deleteSession(session.id);
    throw unauthorized('Tài khoản không hợp lệ.');
  }
  const newToken = crypto.randomBytes(32).toString('hex');
  await store.updateSession(session.id, {
    refreshTokenHash: store.createPasswordHash(newToken),
    expiresAt: new Date(Date.now() + config.refreshTokenTtl * 1000).toISOString(),
  });
  const accessToken = createToken({ sub: user.id, role: user.role, sid: session.id }, config.accessTokenTtl);
  sendJson(res, 200, { accessToken, refreshToken: `${session.id}.${newToken}`, expiresIn: config.accessTokenTtl });
});

router.register('POST', '/auth/logout', async ({ res, body }) => {
  const data = parseBody(body);
  if (!data.refreshToken) {
    throw badRequest('Thiếu refresh token.');
  }
  const parts = String(data.refreshToken).split('.');
  if (parts.length === 2) {
    await store.deleteSession(parts[0]);
  }
  sendJson(res, 200, { message: 'Đăng xuất thành công.' });
});

router.register('POST', '/auth/otp/send', async ({ res, body }) => {
  const data = parseBody(body);
  if (!data.phone) {
    throw badRequest('Thiếu số điện thoại.');
  }
  const now = new Date();
  const windowStart = subMinutes(now, config.otp.windowMinutes);
  const count = await store.countOtpRequests(data.phone, windowStart);
  if (count >= config.otp.maxPerWindow) {
    throw badRequest('Bạn đã yêu cầu OTP quá nhiều lần.');
  }
  const last = await store.findLatestOtp(data.phone);
  if (last) {
    const seconds = differenceInSeconds(now, new Date(last.createdAt));
    if (seconds < config.otp.sendCooldownSeconds) {
      throw badRequest('Vui lòng đợi trước khi yêu cầu OTP tiếp theo.');
    }
  }
  const otp = crypto.randomInt(0, 10 ** config.otp.length).toString().padStart(config.otp.length, '0');
  await store.createOtpRequest({
    phone: data.phone,
    otpHash: store.createPasswordHash(otp),
    status: 'PENDING',
    expiresAt: new Date(Date.now() + config.otp.ttlSeconds * 1000).toISOString(),
    attemptCount: 0,
  });
  const payload = { message: 'Đã gửi OTP.', expiresAt: config.otp.ttlSeconds };
  if (config.env !== 'production') payload.debug = { otp };
  sendJson(res, 200, payload);
});

router.register('POST', '/auth/otp/verify', async ({ req, res, body }) => {
  const data = parseBody(body);
  if (!data.phone || !data.otp) {
    throw badRequest('Thiếu dữ liệu OTP.');
  }
  const record = await store.findPendingOtp(data.phone);
  if (!record) {
    throw badRequest('Không tìm thấy yêu cầu OTP.');
  }
  if (new Date(record.expiresAt) < new Date()) {
    await store.updateOtpRequest(record.id, { status: 'EXPIRED' });
    throw badRequest('OTP đã hết hạn.');
  }
  if (record.attemptCount >= config.otp.maxAttempts) {
    throw badRequest('Bạn đã nhập sai OTP quá số lần cho phép.');
  }
  if (!store.verifyPassword(String(data.otp), record.otpHash)) {
    await store.updateOtpRequest(record.id, { attemptCount: record.attemptCount + 1 });
    throw badRequest('OTP không chính xác.');
  }
  await store.updateOtpRequest(record.id, { status: 'USED' });
  let user = await store.findUserByPhone(data.phone);
  const now = new Date().toISOString();
  if (!user) {
    user = await store.createUser({ phone: data.phone, phoneVerifiedAt: now, status: 'ACTIVE' });
  } else if (user.status !== 'ACTIVE') {
    throw unauthorized('Tài khoản đã bị khóa.');
  } else if (!user.phoneVerifiedAt) {
    user = await store.updateUser(user.id, { phoneVerifiedAt: now });
  }
  const tokens = await issueTokens(user, req);
  sendJson(res, 200, { user: { id: user.id, email: user.email, phone: user.phone, role: user.role }, ...tokens });
});

router.register('GET', '/auth/me', async ({ req, res }) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw unauthorized('Thiếu token.');
  }
  let payload;
  try {
    payload = verifyToken(header.slice(7));
  } catch (error) {
    throw unauthorized(error.message);
  }
  const user = await store.findUserById(payload.sub);
  if (!user) {
    throw unauthorized('Tài khoản không tồn tại.');
  }
  sendJson(res, 200, {
    id: user.id,
    email: user.email,
    phone: user.phone,
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
  });
});

module.exports = router;
