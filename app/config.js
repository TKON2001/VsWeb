const path = require('path');

const env = process.env.NODE_ENV || 'development';

function intFromEnv(key, defaultValue) {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

module.exports = {
  env,
  port: intFromEnv('PORT', 3000),
  dataFile: path.join(__dirname, '..', 'data', 'db.json'),
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  accessTokenTtl: intFromEnv('ACCESS_TOKEN_TTL_SECONDS', 900),
  refreshTokenTtl: intFromEnv('REFRESH_TOKEN_TTL_SECONDS', 60 * 60 * 24 * 30),
  otp: {
    length: intFromEnv('OTP_LENGTH', 6),
    ttlSeconds: intFromEnv('OTP_TTL_SECONDS', 300),
    maxAttempts: intFromEnv('OTP_MAX_ATTEMPTS', 5),
    sendCooldownSeconds: intFromEnv('OTP_SEND_COOLDOWN_SECONDS', 60),
    windowMinutes: intFromEnv('OTP_WINDOW_MINUTES', 10),
    maxPerWindow: intFromEnv('OTP_MAX_PER_WINDOW', 5),
  },
  paymentCallbackSecret: process.env.PAYMENT_CALLBACK_SECRET || 'callback-secret',
};
