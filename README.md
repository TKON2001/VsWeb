# VsWeb Backend (No-dependency Node.js implementation)

Dịch vụ backend tự chứa (self-hosted) cung cấp các API đăng ký/đăng nhập, OTP, nạp gói sử dụng, tạo số xổ số, lịch sử và bảng quản trị.
Toàn bộ mã nguồn chỉ sử dụng Node.js thuần, không phụ thuộc vào thư viện bên thứ ba để đảm bảo có thể chạy trong môi trường hạn chế mạng.

## Khởi chạy

```bash
npm install # không tải gói nào, chỉ đảm bảo scripts khả dụng
npm start
```

Máy chủ chạy tại `http://localhost:3000`. Có thể cấu hình cổng và các biến bảo mật thông qua biến môi trường (xem `app/config.js`).

## Kiểm thử

```bash
npm test
```

Tập lệnh kiểm tra đơn giản xác nhận các hàm tạo token và sinh số hoạt động như mong đợi.

## Kiến trúc

- `server.js`: khởi tạo router và máy chủ HTTP thuần.
- `app/store.js`: lưu trữ dữ liệu dưới dạng JSON, hỗ trợ seed gói dịch vụ và tài khoản admin.
- `app/controllers/*`: các tuyến API cho auth, packages, orders, numbers, admin.
- `app/modules/numbers.js`: logic sinh số theo từng loại xổ số.
- `app/utils/*`: tiện ích bảo mật, xác thực, xử lý HTTP và thời gian.

## Các tuyến chính

### Xác thực
- `POST /auth/register` – Đăng ký bằng email/mật khẩu.
- `POST /auth/verify-email` – Xác minh email bằng token.
- `POST /auth/login` – Đăng nhập email/mật khẩu.
- `POST /auth/otp/send` – Gửi OTP qua SMS (mock trả về OTP khi không ở production).
- `POST /auth/otp/verify` – Đăng nhập/đăng ký qua OTP điện thoại.
- `POST /auth/refresh` – Cấp lại access token.
- `POST /auth/logout` – Hủy session hiện tại.
- `GET /auth/me` – Lấy thông tin người dùng hiện tại.

### Nạp gói & đơn hàng
- `GET /packages` – Danh sách gói đang mở bán.
- `GET /packages/wallets` – Ví gói còn hạn của người dùng.
- `POST /orders` – Tạo đơn hàng mới.
- `GET /orders` – Lịch sử đơn hàng của người dùng.
- `POST /orders/payments/:provider/callback` – Endpoint nhận callback thanh toán (mock signature HMAC).

### Tạo số & lịch sử
- `POST /numbers/generate` – Sinh số theo gói đã mua.
- `GET /numbers/history` – Lịch sử yêu cầu tạo số.
- `GET /numbers/:id` – Chi tiết một lần yêu cầu.

### Bảng quản trị
- `GET /admin/users` – Danh sách người dùng.
- `PATCH /admin/users/:id/status` – Cập nhật trạng thái tài khoản.
- `GET /admin/orders` – Danh sách đơn hàng.
- `POST /admin/packages` – Tạo gói mới.
- `PATCH /admin/packages/:id` – Cập nhật gói.
- `DELETE /admin/packages/:id` – Vô hiệu hóa gói.
- `GET /admin/dashboard/summary` – Số liệu tổng hợp 7 ngày.

## Ghi chú

- OTP, email verification và callback thanh toán đều ở dạng mô phỏng (mock) để dễ dàng kiểm thử.
- Mật khẩu và OTP được băm bằng PBKDF2, token đăng nhập sử dụng JWT tùy chỉnh với HMAC SHA-256.
- Nếu chạy lần đầu, hệ thống tự seed tài khoản admin (`admin@example.com` / `ChangeMe123!`).
