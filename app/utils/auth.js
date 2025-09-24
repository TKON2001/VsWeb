const store = require('../store');
const { unauthorized, forbidden } = require('./errors');
const { verifyToken } = require('./security');

async function requireAuth(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw unauthorized('Thiếu token.');
  }
  const token = header.slice(7);
  let payload;
  try {
    payload = verifyToken(token);
  } catch (error) {
    throw unauthorized(error.message);
  }
  const user = await store.findUserById(payload.sub);
  if (!user || user.status !== 'ACTIVE') {
    throw unauthorized('Tài khoản không hợp lệ.');
  }
  return { user, sessionId: payload.sid };
}

async function requireRoles(req, roles) {
  const { user, sessionId } = await requireAuth(req);
  if (!roles.includes(user.role)) {
    throw forbidden('Bạn không có quyền truy cập.');
  }
  return { user, sessionId };
}

module.exports = { requireAuth, requireRoles };
