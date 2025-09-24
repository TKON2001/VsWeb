const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const defaultData = {
  users: [],
  sessions: [],
  otpRequests: [],
  packages: [],
  orders: [],
  wallets: [],
  numberRequests: [],
  generatedNumbers: [],
  emailTokens: [],
};

function now() {
  return new Date().toISOString();
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = clone(defaultData);
    this.ready = this.init();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      this.data = Object.assign(clone(defaultData), JSON.parse(content));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.write();
    }
    await this.ensureSeedData();
    await this.write();
  }

  async write() {
    await fs.writeFile(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
  }

  async ensureSeedData() {
    if (this.data.packages.length === 0) {
      const seedPackages = [
        {
          code: 'PKG_DAY_1',
          name: 'Gói 1 ngày',
          description: 'Sử dụng không giới hạn trong 24 giờ.',
          price: 20000,
          currency: 'VND',
          durationDays: 1,
          quotaUsages: null,
          isActive: true,
        },
        {
          code: 'PKG_DAY_3',
          name: 'Gói 3 ngày',
          description: 'Thỏa sức tạo số trong 3 ngày.',
          price: 50000,
          currency: 'VND',
          durationDays: 3,
          quotaUsages: null,
          isActive: true,
        },
        {
          code: 'PKG_MONTH',
          name: 'Gói 1 tháng',
          description: 'Gói theo tháng cho người dùng thường xuyên.',
          price: 150000,
          currency: 'VND',
          durationDays: 30,
          quotaUsages: null,
          isActive: true,
        },
        {
          code: 'PKG_CREDITS_20',
          name: 'Gói 20 lượt',
          description: 'Sử dụng 20 lượt tạo số bất kỳ khi nào.',
          price: 70000,
          currency: 'VND',
          durationDays: null,
          quotaUsages: 20,
          isActive: true,
        },
      ];
      const nowIso = now();
      seedPackages.forEach((pkg) => {
        this.data.packages.push({ id: crypto.randomUUID(), createdAt: nowIso, updatedAt: nowIso, ...pkg });
      });
    }

    if (!this.data.users.some((user) => user.role === 'SUPER_ADMIN')) {
      const nowIso = now();
      const defaultPasswordHash = this.createPasswordHash('ChangeMe123!');
      this.data.users.push({
        id: crypto.randomUUID(),
        email: process.env.ADMIN_EMAIL || 'admin@example.com',
        emailVerifiedAt: nowIso,
        phone: process.env.ADMIN_PHONE || '+84900000000',
        phoneVerifiedAt: nowIso,
        passwordHash: process.env.ADMIN_PASSWORD_HASH || defaultPasswordHash,
        status: 'ACTIVE',
        role: 'SUPER_ADMIN',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }

  createPasswordHash(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  verifyPassword(password, stored) {
    if (!stored) return false;
    const [salt, hash] = stored.split(':');
    const computed = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(computed, 'hex'));
  }

  async createUser(data) {
    await this.ready;
    const user = {
      id: crypto.randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      email: data.email,
      emailVerifiedAt: data.emailVerifiedAt,
      phone: data.phone,
      phoneVerifiedAt: data.phoneVerifiedAt,
      passwordHash: data.passwordHash,
      status: data.status || 'ACTIVE',
      role: data.role || 'USER',
    };
    this.data.users.push(user);
    await this.write();
    return user;
  }

  async updateUser(id, updates) {
    await this.ready;
    const user = this.data.users.find((item) => item.id === id);
    if (!user) return undefined;
    Object.assign(user, updates, { updatedAt: now() });
    await this.write();
    return user;
  }

  async findUserByEmail(email) {
    await this.ready;
    return this.data.users.find((user) => user.email && user.email.toLowerCase() === email.toLowerCase());
  }

  async findUserByPhone(phone) {
    await this.ready;
    return this.data.users.find((user) => user.phone === phone);
  }

  async findUserById(id) {
    await this.ready;
    return this.data.users.find((user) => user.id === id);
  }

  async listUsers(filter, pagination) {
    await this.ready;
    let users = [...this.data.users];
    if (filter.status) users = users.filter((user) => user.status === filter.status);
    if (filter.search) {
      const query = filter.search.toLowerCase();
      users = users.filter((user) => (user.email && user.email.toLowerCase().includes(query)) || (user.phone && user.phone.includes(query)));
    }
    const total = users.length;
    const items = users
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(pagination.skip, pagination.skip + pagination.take)
      .map((user) => ({
        id: user.id,
        email: user.email,
        phone: user.phone,
        status: user.status,
        role: user.role,
        createdAt: user.createdAt,
        emailVerifiedAt: user.emailVerifiedAt,
        phoneVerifiedAt: user.phoneVerifiedAt,
      }));
    return { total, items };
  }

  async countUsers(filter = {}) {
    await this.ready;
    return this.data.users.filter((user) => (filter.status ? user.status === filter.status : true)).length;
  }

  async createEmailToken(userId, token, expiresAt) {
    await this.ready;
    const record = {
      id: crypto.randomUUID(),
      userId,
      token,
      expiresAt: expiresAt.toISOString(),
      createdAt: now(),
      updatedAt: now(),
    };
    this.data.emailTokens.push(record);
    await this.write();
    return record;
  }

  async findEmailToken(token) {
    await this.ready;
    return this.data.emailTokens.find((item) => item.token === token);
  }

  async deleteEmailToken(id) {
    await this.ready;
    this.data.emailTokens = this.data.emailTokens.filter((item) => item.id !== id);
    await this.write();
  }

  async createSession(data) {
    await this.ready;
    const session = {
      id: crypto.randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      ...data,
    };
    this.data.sessions.push(session);
    await this.write();
    return session;
  }

  async findSessionById(id) {
    await this.ready;
    return this.data.sessions.find((session) => session.id === id);
  }

  async updateSession(id, updates) {
    await this.ready;
    const session = this.data.sessions.find((item) => item.id === id);
    if (!session) return undefined;
    Object.assign(session, updates, { updatedAt: now() });
    await this.write();
    return session;
  }

  async deleteSession(id) {
    await this.ready;
    this.data.sessions = this.data.sessions.filter((session) => session.id !== id);
    await this.write();
  }

  async countOtpRequests(phone, since) {
    await this.ready;
    return this.data.otpRequests.filter((item) => item.phone === phone && new Date(item.createdAt) >= since).length;
  }

  async findLatestOtp(phone) {
    await this.ready;
    const records = this.data.otpRequests.filter((item) => item.phone === phone);
    return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  }

  async findPendingOtp(phone) {
    await this.ready;
    const records = this.data.otpRequests.filter((item) => item.phone === phone && item.status === 'PENDING');
    return records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
  }

  async createOtpRequest(data) {
    await this.ready;
    const record = {
      id: crypto.randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      ...data,
    };
    this.data.otpRequests.push(record);
    await this.write();
    return record;
  }

  async updateOtpRequest(id, updates) {
    await this.ready;
    const record = this.data.otpRequests.find((item) => item.id === id);
    if (!record) return undefined;
    Object.assign(record, updates, { updatedAt: now() });
    await this.write();
    return record;
  }

  async listActivePackages() {
    await this.ready;
    return this.data.packages.filter((pkg) => pkg.isActive).sort((a, b) => a.price - b.price);
  }

  async findPackageById(id) {
    await this.ready;
    return this.data.packages.find((pkg) => pkg.id === id);
  }

  async findPackageByCode(code) {
    await this.ready;
    return this.data.packages.find((pkg) => pkg.code === code);
  }

  async createPackage(data) {
    await this.ready;
    const pkg = { id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), ...data };
    this.data.packages.push(pkg);
    await this.write();
    return pkg;
  }

  async updatePackage(id, updates) {
    await this.ready;
    const pkg = this.data.packages.find((item) => item.id === id);
    if (!pkg) return undefined;
    Object.assign(pkg, updates, { updatedAt: now() });
    await this.write();
    return pkg;
  }

  async createOrder(data) {
    await this.ready;
    const order = { id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), ...data };
    this.data.orders.push(order);
    await this.write();
    return order;
  }

  async updateOrder(id, updates) {
    await this.ready;
    const order = this.data.orders.find((item) => item.id === id);
    if (!order) return undefined;
    Object.assign(order, updates, { updatedAt: now() });
    await this.write();
    return order;
  }

  async findOrderById(id) {
    await this.ready;
    return this.data.orders.find((order) => order.id === id);
  }

  async listOrdersByUser(userId) {
    await this.ready;
    return this.data.orders
      .filter((order) => order.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async listOrders(pagination) {
    await this.ready;
    const orders = [...this.data.orders].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const total = orders.length;
    const items = orders.slice(pagination.skip, pagination.skip + pagination.take);
    return { total, items };
  }

  async countOrders(filter = {}) {
    await this.ready;
    return this.data.orders.filter((order) => (filter.status ? order.status === filter.status : true)).length;
  }

  async sumOrders(filter = {}) {
    await this.ready;
    return this.data.orders
      .filter((order) => (filter.status ? order.status === filter.status : true))
      .reduce((sum, order) => sum + order.amount, 0);
  }

  async createWallet(data) {
    await this.ready;
    const wallet = { id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), ...data };
    this.data.wallets.push(wallet);
    await this.write();
    return wallet;
  }

  async updateWallet(id, updates) {
    await this.ready;
    const wallet = this.data.wallets.find((item) => item.id === id);
    if (!wallet) return undefined;
    Object.assign(wallet, updates, { updatedAt: now() });
    await this.write();
    return wallet;
  }

  async listWalletsByUser(userId) {
    await this.ready;
    return this.data.wallets
      .filter((wallet) => wallet.userId === userId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  async createNumberRequest(data, generated) {
    await this.ready;
    const request = { id: crypto.randomUUID(), createdAt: now(), updatedAt: now(), ...data };
    this.data.numberRequests.push(request);
    generated.forEach((numbers) => {
      this.data.generatedNumbers.push({
        id: crypto.randomUUID(),
        requestId: request.id,
        numbers,
        isFavorite: false,
        createdAt: request.createdAt,
        updatedAt: request.updatedAt,
      });
    });
    await this.write();
    return request;
  }

  async listNumberRequests(options) {
    await this.ready;
    let records = this.data.numberRequests.filter((item) => item.userId === options.userId);
    if (options.lotteryType) records = records.filter((item) => item.lotteryType === options.lotteryType);
    if (options.from) records = records.filter((item) => new Date(item.createdAt) >= options.from);
    if (options.to) records = records.filter((item) => new Date(item.createdAt) <= options.to);
    records = records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const total = records.length;
    const items = records.slice(options.skip, options.skip + options.take).map((request) => ({
      ...request,
      generated: this.data.generatedNumbers.filter((gen) => gen.requestId === request.id),
    }));
    return { total, items };
  }

  async countNumberRequests(filter = {}) {
    await this.ready;
    return this.data.numberRequests.filter((item) => (filter.createdAfter ? new Date(item.createdAt) >= filter.createdAfter : true)).length;
  }

  async findNumberRequestById(id) {
    await this.ready;
    const request = this.data.numberRequests.find((item) => item.id === id);
    if (!request) return undefined;
    return {
      ...request,
      generated: this.data.generatedNumbers.filter((gen) => gen.requestId === id),
    };
  }

  async groupNumberRequestsByLottery(take, filter = {}) {
    await this.ready;
    const counts = new Map();
    this.data.numberRequests.forEach((request) => {
      if (filter.createdAfter && new Date(request.createdAt) < filter.createdAfter) return;
      counts.set(request.lotteryType, (counts.get(request.lotteryType) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, take)
      .map(([lotteryType, count]) => ({ lotteryType, count }));
  }

  async reset(options = {}) {
    await this.ready;
    const { seed = true } = options;
    this.data = clone(defaultData);
    if (seed) {
      await this.ensureSeedData();
    }
    await this.write();
  }
}

module.exports = new Store(config.dataFile);
