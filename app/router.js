const { readBody, parseUrl, sendError } = require('./utils/http');

function pathToRegex(path) {
  const parts = path.split('/').filter(Boolean);
  const keys = [];
  const regexParts = parts.map((part) => {
    if (part.startsWith(':')) {
      keys.push(part.slice(1));
      return '([^/]+)';
    }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  const regex = new RegExp(`^/${regexParts.join('/')}${path.endsWith('/') ? '/' : ''}$`);
  return { regex, keys };
}

class Router {
  constructor() {
    this.routes = [];
  }

  register(method, path, handler) {
    const { regex, keys } = pathToRegex(path);
    this.routes.push({ method: method.toUpperCase(), regex, keys, handler });
  }

  async handle(req, res) {
    const { pathname, query } = parseUrl(req);
    const method = req.method.toUpperCase();
    const route = this.routes.find((r) => r.method === method && r.regex.test(pathname));
    if (!route) {
      sendError(res, 404, 'Không tìm thấy API.', 'NOT_FOUND');
      return;
    }
    const match = route.regex.exec(pathname);
    const params = {};
    route.keys.forEach((key, index) => {
      params[key] = match[index + 1];
    });

    let body = null;
    if (['POST', 'PUT', 'PATCH'].includes(method)) {
      try {
        body = await readBody(req);
      } catch (error) {
        if (error.message === 'INVALID_JSON') {
          sendError(res, 400, 'JSON không hợp lệ.', 'INVALID_JSON');
          return;
        }
        sendError(res, 400, error.message, 'BAD_REQUEST');
        return;
      }
    }

    try {
      await route.handler({ req, res, params, query, body });
    } catch (error) {
      if (error && error.statusCode) {
        sendError(res, error.statusCode, error.message, error.code || 'ERROR');
        return;
      }
      console.error(error);
      sendError(res, 500, 'Đã xảy ra lỗi không mong muốn.', 'INTERNAL_SERVER_ERROR');
    }
  }
}

module.exports = Router;
