function createError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

module.exports = {
  badRequest: (message, code = 'BAD_REQUEST') => createError(400, message, code),
  unauthorized: (message, code = 'UNAUTHORIZED') => createError(401, message, code),
  forbidden: (message, code = 'FORBIDDEN') => createError(403, message, code),
  notFound: (message, code = 'NOT_FOUND') => createError(404, message, code),
};
