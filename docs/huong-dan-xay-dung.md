# Hướng dẫn xây dựng website tạo số xổ số có thu phí

Tài liệu này mô tả kiến trúc tổng thể, các module cần triển khai và quy trình kỹ thuật để xây dựng website đáp ứng yêu cầu: đăng ký/đăng nhập bằng email, mật khẩu hoặc OTP điện thoại; nạp tiền/mua gói dịch vụ (paywall); tạo số xổ số; quản lý lịch sử, thống kê và bảng quản trị.

## 1. Kiến trúc tổng quan

```
Client (Web SPA / SSR)
   ├── Trang người dùng: Đăng ký, Đăng nhập, Nạp tiền, Tạo số, Lịch sử, Hồ sơ
   └── Trang quản trị (Admin SPA)
Backend (REST/GraphQL API)
   ├── Module Auth: Email+Password, OTP, Session/JWT, Rate limiting
   ├── Module Billing: Gói dịch vụ, Đơn hàng, Cổng thanh toán (MoMo, ZaloPay, VNPay, Chuyển khoản)
   ├── Module Generator: Thuật toán sinh số, tích hợp dữ liệu phân tích nội bộ
   ├── Module History & Search: Lưu, truy vấn, xuất lịch sử
   ├── Module Admin: Quản lý user, gói, giao dịch, cấu hình, log
   └── Module Reporting: Thống kê sử dụng, doanh thu, tần suất số
Database
   ├── PostgreSQL/MySQL (dữ liệu nghiệp vụ)
   ├── Redis (cache session, rate limit, OTP)
   └── Data warehouse/OLAP (tuỳ chọn cho báo cáo nâng cao)
External services: Email SMTP, SMS (Twilio/Firebase/nhà mạng), MoMo, ZaloPay, VNPay, dịch vụ lưu trữ log (ELK/CloudWatch), CDN.
```

### Đề xuất công nghệ
- **Frontend:** Next.js/React hoặc Vue/Nuxt. Sử dụng TypeScript + Tailwind/Ant Design để dựng giao diện nhanh.
- **Backend:** Node.js (NestJS/Express), hoặc Laravel (PHP), hoặc Django (Python). Tài liệu này giả định sử dụng NestJS vì dễ modular hóa.
- **Database:** PostgreSQL với hỗ trợ JSONB, full-text search, index đa dạng. Redis cho OTP và rate limit.
- **Hạ tầng:** Deploy container (Docker/Kubernetes) hoặc sử dụng dịch vụ PaaS (Heroku, Render, Railway). Bắt buộc cấu hình HTTPS (Let's Encrypt/Cloudflare).

## 2. Thiết kế cơ sở dữ liệu

| Bảng | Mục đích chính | Các cột chính |
| --- | --- | --- |
| `users` | Tài khoản người dùng | id, email, email_verified_at, phone, phone_verified_at, password_hash, status, role, created_at |
| `user_profiles` | Thông tin bổ sung | user_id (FK), full_name, avatar_url, locale, notes |
| `otp_requests` | OTP SMS | id, phone, otp_hash, expired_at, attempt_count, last_sent_at, status |
| `auth_sessions` | Phiên đăng nhập | id, user_id, user_agent, ip_address, refresh_token_hash, expires_at |
| `packages` | Gói dịch vụ | id, code, name, description, price, currency, duration_days, quota_usages |
| `orders` | Đơn nạp tiền | id, user_id, package_id, amount, provider, status, payment_url, provider_txn_id, expired_at, paid_at |
| `wallets` | Số dư gói/lượt | user_id, package_id, started_at, expired_at, remaining_usages |
| `number_requests` | Lịch sử yêu cầu tạo số | id, user_id, package_id, lottery_type, params (JSON), result_summary, created_at |
| `generated_numbers` | Chi tiết dãy số | id, request_id, numbers (JSON/ARRAY), is_favorite |
| `rate_limit_rules` | Cấu hình hạn mức | id, key, value, description |
| `audit_logs` | Log hệ thống | id, actor_id, action, metadata (JSON), created_at |
| `reports_daily` | Số liệu tổng hợp | id, report_date, dau, mau, total_orders, revenue, generated_count |

*Lưu ý:* OTP nên lưu dạng hash để tránh lộ mã. Sử dụng index trên `users.email`, `users.phone`, `number_requests.created_at`, `orders.provider_txn_id`, `generated_numbers.numbers` (GIN cho JSONB nếu cần).

## 3. Module xác thực (Auth)

### 3.1 Email + Mật khẩu
1. **Đăng ký:**
   - API `POST /auth/register` nhận email, mật khẩu, số điện thoại (tuỳ chọn), captcha token.
   - Kiểm tra định dạng, trùng email/phone. Hash mật khẩu bằng Bcrypt (>= 10 rounds).
   - Tạo user ở trạng thái `pending_email`. Gửi email xác minh chứa token (JWT ngắn hạn hoặc random string lưu DB).
2. **Xác minh email:**
   - API `GET /auth/verify-email?token=...`. Giải mã token, đối chiếu user, cập nhật `email_verified_at`.
3. **Đăng nhập:**
   - API `POST /auth/login` nhận email + mật khẩu. Kiểm tra hash, nếu ok tạo access token (JWT 15 phút) + refresh token (JWT 30 ngày, lưu hash trong `auth_sessions`).
   - Sử dụng guard middleware bảo vệ API user/admin.
4. **Quên mật khẩu:**
   - API `POST /auth/forgot-password` gửi email reset, token lưu DB.
   - API `POST /auth/reset-password` đặt lại mật khẩu.

### 3.2 Số điện thoại + OTP
1. **Gửi OTP:**
   - API `POST /auth/otp/send` nhận phone, type (`login` hoặc `register`).
   - Kiểm tra rate limit (ví dụ Redis key `otp:send:<phone>` giới hạn 5 lần/10 phút).
   - Sinh OTP 6 chữ số, lưu `otp_hash = bcrypt(otp)`, `expired_at = now + 5 phút`, `status = pending`.
   - Gửi SMS qua provider (Twilio/Firebase/nhà mạng) kèm template brandname. Log request-id.
2. **Xác thực OTP:**
   - API `POST /auth/otp/verify` nhận phone + otp.
   - Lấy bản ghi `otp_requests` hợp lệ (`status=pending`, chưa hết hạn, attempt_count < 5). So sánh bcrypt.
   - Nếu phone chưa có user -> tạo user mới (mật khẩu ngẫu nhiên) và đánh dấu `phone_verified_at`.
   - Tạo session/JWT tương tự email login.
   - Đặt `status=used`, tăng `attempt_count` mỗi lần nhập sai, hết hạn -> `status=expired`.

### 3.3 Rate limiting & bảo mật
- Dùng Redis hoặc middleware (e.g., `rate-limiter-flexible` trong Node) cho API `/auth/*`.
- Ghi log đăng nhập thành công/thất bại.
- Bật HTTPS, HSTS, Content Security Policy, hạn chế cookie `HttpOnly`, `Secure`.
- Tùy chọn bật 2FA (password + OTP) cho người dùng quan trọng.

## 4. Module Paywall & thanh toán

### 4.1 Quản lý gói dịch vụ
- Bảng `packages` lưu cấu hình: `duration_days` (thời hạn), `quota_usages` (số lượt tạo), cờ `is_active`.
- API admin CRUD gói. Giao diện hiển thị danh sách gói cho người dùng.
- Khi người dùng mua, tạo bản ghi `orders` trạng thái `pending`. Sau thanh toán thành công, tạo `wallets` hoặc cập nhật gói hiện tại.

### 4.2 Quy trình thanh toán chung
1. Người dùng chọn gói & phương thức.
2. Backend tạo đơn hàng `orders` với mã `order_code` (UUID), số tiền.
3. Gọi API cổng tương ứng để tạo link/QR, trả về cho frontend.
4. Người dùng thanh toán trên app/ví.
5. Cổng gọi `callback/notify` tới backend. Backend xác minh chữ ký (checksum).
6. Backend cập nhật `orders.status=paid`, ghi nhận `provider_txn_id`, tạo `wallet`/gia hạn gói.
7. Frontend poll API `GET /orders/{id}` hoặc sử dụng webhook kết hợp Socket để cập nhật trạng thái.

### 4.3 Tích hợp cụ thể
- **MoMo:**
  - Sử dụng API `createOrder`. Tham số gồm `partnerCode`, `accessKey`, `requestId`, `orderId`, `amount`, `orderInfo`, `returnUrl`, `notifyUrl`, `requestType`.
  - Tạo `signature = hmacSHA256(accessKey + ... + secretKey)` theo tài liệu.
  - Nhận URL `payUrl`/`deeplink`. Redirect người dùng.
  - Callback `notifyUrl` cần xác minh `signature` với `secretKey`, kiểm tra `resultCode==0`.
- **ZaloPay:**
  - Sử dụng REST API `CreateOrder`. Dữ liệu JSON: `app_id`, `app_trans_id`, `app_time`, `item`, `embed_data`, `amount`...
  - Tính `mac = HMACSHA256(app_id|app_trans_id|appuser|amount|app_time|embed_data|item, key1)`.
  - Callback `callback_url` trả về `data`, `mac` -> kiểm tra `mac` với `key2`.
- **VNPay:**
  - Build URL `/paymentv2/vpcpay.html` với các tham số `vnp_Version`, `vnp_Command`, `vnp_TmnCode`, `vnp_Amount`, `vnp_TxnRef`, `vnp_OrderInfo`, `vnp_ReturnUrl`, `vnp_IpAddr`,...
  - Tính `vnp_SecureHash = HMACSHA512(secretKey, sortedParams)`.
  - Sau thanh toán, VNPay redirect đến `ReturnUrl` với `vnp_ResponseCode`. Cần xác minh hash.
- **Chuyển khoản thủ công:**
  - Hiển thị thông tin tài khoản, QR static.
  - Người dùng gửi biên lai -> admin duyệt trong `orders` (chuyển `status` từ `pending` sang `paid`).
  - Có thể tích hợp webhook ngân hàng (nếu có) để tự động cập nhật.

### 4.4 Bảo mật thanh toán
- Lưu log toàn bộ request/response (đã ẩn thông tin nhạy cảm).
- Hạn chế IP callback (nhà cung cấp thường có whitelist).
- Gửi email/sms thông báo khi thanh toán thành công.
- Thêm cơ chế chống giả mạo: xác minh số tiền trùng khớp gói, tránh thay đổi orderId.

## 5. Module “Tạo số”

### 5.1 Cấu hình loại xổ số
Tạo bảng cấu hình `lottery_types` (code, name, description, number_count, min_value, max_value, allow_duplicates, extra_rules). Ví dụ:
- Mega 6/45: 6 số, phạm vi 1–45, không trùng.
- Power 6/55: 6 số 1–55 + 1 số Power 1–45.
- Truyền thống: 6 chữ số 0–9, cho phép trùng.

### 5.2 Thuật toán sinh số
- **Ngẫu nhiên thuần:** Sử dụng `crypto.randomInt` để đảm bảo tính ngẫu nhiên.
- **Đảm bảo điều kiện:**
  - Không trùng: dùng `Set` để loại trùng, nếu trùng thì sinh lại.
  - Không lặp liên tiếp: sau khi sinh chuỗi, kiểm tra `numbers[i] != numbers[i-1]`.
- **Thuật toán trọng số:**
  - Lưu bảng `number_weights` (lottery_type, number, weight, updated_at).
  - Khi sinh số, sử dụng Weighted Random Sampling.
- **Tích hợp phần mềm phân tích:**
  - Export dữ liệu phân tích vào bảng `analysis_snapshots`.
  - Module generator đọc snapshot mới nhất, apply logic do công ty cung cấp (có thể dưới dạng service `POST /internal/generator`).

Pseudo-code cho Mega 6/45:
```ts
function generateMega(request) {
  const results = [];
  while (results.length < request.quantity) {
    const set = new Set<number>();
    while (set.size < 6) {
      const number = cryptoRandomInt(1, 45);
      if (!request.allowConsecutiveDuplicate) {
        // optional rule check
      }
      set.add(number);
    }
    const sorted = Array.from(set).sort((a, b) => a - b);
    results.push(sorted);
  }
  return results;
}
```
Sau khi sinh, lưu vào `generated_numbers` gắn với `number_requests`.

### 5.3 Quản lý quota
- Trước khi cho phép tạo số, kiểm tra `wallet` của user còn hạn/lượt.
- Sau mỗi yêu cầu thành công, trừ `remaining_usages` hoặc cập nhật `last_used_at`.
- Hết hạn -> yêu cầu nạp tiền.

## 6. Lịch sử & Tìm kiếm

### 6.1 Lưu lịch sử
- Khi user gửi yêu cầu, tạo bản ghi `number_requests` chứa metadata: `{lotteryType, quantity, rules}`.
- Kết quả dãy số lưu JSON `generated_numbers`.
- Cho phép người dùng gắn tag hoặc ghi chú (thêm cột `note`).

### 6.2 Giao diện lịch sử
- Trang `History` hiển thị bảng: Ngày, Loại, Số lượng dãy, Tóm tắt (3 dãy đầu), Gói sử dụng.
- Click -> modal/route chi tiết, hiển thị toàn bộ dãy số, nút tải CSV/PDF.

### 6.3 Tìm kiếm & lọc
- API `GET /number-requests` hỗ trợ query: `from`, `to`, `lotteryType`, `packageId`, `keyword`, `minAmount`, `maxAmount`.
- Sử dụng index trên `created_at`, `lottery_type`, `package_id`.
- Đối với search theo số, lưu thêm cột `search_text` dạng string "01-05-12-34-45" và tạo index `GIN` với `pg_trgm` để `ILIKE` nhanh.
- Tùy chọn: tích hợp ElasticSearch nếu cần full-text lớn.

## 7. Bảng quản trị (Admin Panel)

### 7.1 Phân quyền
- `users.role` gồm: `user`, `staff`, `admin`, `super_admin`.
- Middleware kiểm tra quyền. Staff chỉ xem, không xóa; admin được CRUD, super_admin quản lý phân quyền.

### 7.2 Chức năng chính
- **Dashboard:** Biểu đồ doanh thu, lượt tạo số, người dùng hoạt động.
- **User Management:**
  - Danh sách user, filter theo trạng thái, gói.
  - Thao tác: khóa/mở khóa (`status=blocked`), reset mật khẩu, cấp gói thủ công.
- **Orders:**
  - Bảng giao dịch với bộ lọc theo trạng thái, cổng thanh toán.
  - Nút xác nhận thủ công, hoàn tiền (nếu cổng hỗ trợ API refund).
- **Packages:** CRUD gói, upload banner, sắp xếp thứ tự hiển thị.
- **Generator Config:** Cập nhật rule, import file phân tích.
- **Rate Limit:** Form chỉnh các tham số (OTP per phone, request per day...).
- **Logs:** View audit log, đăng nhập, lỗi hệ thống. Kết nối tới hệ thống log (Elastic/Kibana) nếu có.
- **Reports:** Xuất CSV/PDF, xem biểu đồ.

### 7.3 Triển khai giao diện
- Sử dụng template AdminLTE, React Admin, hoặc Ant Design Pro.
- Sử dụng chart library (Chart.js, ECharts) hiển thị số liệu.
- Bảo vệ đường dẫn `/admin` bằng middleware + 2FA + IP whitelist (tuỳ nhu cầu).

## 8. Bảo mật & vận hành

### 8.1 Thực hành bảo mật
- Băm mật khẩu bằng Bcrypt/Argon2. Không log plaintext.
- OTP chỉ hiệu lực 5 phút, tối đa 5 lần nhập sai -> khóa trong 15 phút.
- Bật HTTPS, dùng WAF/CDN (Cloudflare) nếu có.
- Áp dụng rate limit: đăng nhập (5 lần/phút/ip), gửi OTP (3 lần/5 phút), tạo số (30 lần/phút/user), thanh toán (tối đa 3 đơn pending).
- Content Security Policy, X-Frame-Options, X-Content-Type-Options.
- Kiểm tra đầu vào chống SQL Injection/XSS. Sử dụng ORM (Prisma/TypeORM/Eloquent).

### 8.2 Logging & giám sát
- Log API (status code, latency) bằng Winston/Log4j, gửi sang ELK/CloudWatch.
- Log bảo mật: đăng nhập thất bại, OTP sai, thanh toán bất thường.
- Thiết lập alert (PagerDuty/Slack) khi lỗi 5xx tăng, doanh thu giảm bất thường.

### 8.3 Sao lưu & DR
- Backup database hàng ngày, lưu trữ 30 ngày.
- Sử dụng migration tool (Prisma Migrate, Flyway) để quản lý schema.
- Kịch bản khôi phục: staging/test khôi phục định kỳ.

### 8.4 CI/CD
- Sử dụng GitHub Actions/GitLab CI:
  - Chạy test unit/integration.
  - Chạy lint (ESLint/Prettier, PHPStan/Pylint).
  - Build Docker image, deploy staging -> production.
- Sử dụng `.env` và secret manager (AWS Secrets Manager, Vault).

## 9. Trải nghiệm người dùng

### 9.1 Luồng người dùng chính
1. Khách truy cập trang chủ -> thấy paywall giới thiệu gói.
2. Đăng ký email/mật khẩu hoặc login OTP.
3. Sau khi đăng nhập, hệ thống kiểm tra gói -> nếu chưa có, chuyển đến trang nạp tiền.
4. Người dùng chọn gói, thanh toán qua ví.
5. Sau khi thanh toán, user được chuyển đến trang tạo số.
6. User nhập loại xổ số, số lượng, quy tắc -> nhận kết quả.
7. Có thể lưu yêu thích, tải CSV, xem lịch sử.

### 9.2 UI/UX gợi ý
- Paywall rõ ràng: hiển thị lợi ích, so sánh gói, CTA rõ.
- Thêm onboarding (tooltips) giải thích cách sử dụng.
- Trang lịch sử hỗ trợ copy nhanh từng bộ số.
- Hiển thị thời hạn gói/bộ đếm lượt trong header.

## 10. Thống kê & báo cáo

### 10.1 Thu thập dữ liệu
- Cron job cuối ngày tổng hợp `number_requests`, `orders` vào bảng `reports_daily`.
- Sử dụng Materialized View cho báo cáo nhanh.

### 10.2 Chỉ số chính
- **Doanh thu:** tổng `orders.amount` theo ngày/tháng, phân tách theo `provider` và `package`.
- **Lượt sử dụng:** tổng `number_requests` theo ngày, user active.
- **Top số:** đếm frequency trong `generated_numbers` (có thể precompute, lưu vào bảng `number_statistics`).
- **Tỷ lệ chuyển đổi:** `orders.successful_users / users.total_registered`.
- **Giao dịch lỗi:** số lượng `orders` `status=failed/canceled` -> cảnh báo.

### 10.3 Trình bày
- Dashboard admin: biểu đồ đường cho doanh thu, cột cho lượng tạo số, bảng top user.
- Xuất báo cáo PDF hàng tháng gửi email cho quản trị.

## 11. Lộ trình triển khai (Roadmap)

| Sprint | Phạm vi |
| --- | --- |
| Sprint 1 (2 tuần) | Thiết lập dự án, CI/CD, Auth email/mật khẩu + OTP cơ bản, UI đăng ký/đăng nhập |
| Sprint 2 | Quản lý gói, luồng tạo đơn hàng, tích hợp MoMo (ưu tiên), UI paywall |
| Sprint 3 | Hoàn thiện tạo số, lưu lịch sử, giới hạn gói, trang người dùng |
| Sprint 4 | Tích hợp thêm ZaloPay/VNPay, admin panel cơ bản |
| Sprint 5 | Thống kê, báo cáo, tối ưu bảo mật, log, monitoring |
| Sprint 6 | Hoàn thiện UI/UX, tối ưu hiệu năng, kiểm thử toàn diện |

## 12. Kiểm thử & đảm bảo chất lượng

- **Unit test:** Auth service, OTP service, generator logic.
- **Integration test:** Luồng thanh toán (mock cổng), API tạo số, rate limit.
- **E2E test:** Cypress/Playwright cho luồng user (đăng ký -> nạp -> tạo số -> lịch sử).
- **Bảo mật:** Kiểm thử penetration, OWASP ZAP, check CSRF/XSS.
- **Hiệu năng:** Stress test API tạo số và gửi OTP bằng k6/JMeter.

## 13. Tài liệu & vận hành

- Viết tài liệu API (OpenAPI/Swagger), tài liệu hướng dẫn admin.
- SOP khi nhận lỗi thanh toán (kiểm tra callback, manual update).
- Quy trình hỗ trợ khách hàng (reset OTP, hoàn tiền).

---
Tài liệu này là nền tảng để đội ngũ phát triển triển khai hệ thống thực tế. Có thể mở rộng thêm tuỳ theo yêu cầu cụ thể (ví dụ: mobile app, tích hợp AI phân tích số).
