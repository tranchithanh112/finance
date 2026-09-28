# Finance Dashboard

Dashboard danh mục đầu tư cá nhân: **crypto trên Binance** + **chứng khoán / quỹ chỉ số** + tiền mặt, không cần build, deploy lên Vercel.

- **Tổng quan**: tổng tài sản, phân bổ theo loại tài sản & theo từng tài sản, lịch sử tổng tài sản theo ngày, tiền mặt / tài sản khác.
- **Crypto**: số dư Spot + Funding + Simple Earn, giá trị, tỷ trọng %, giá vốn TB và PnL từng coin.
- **Lịch sử & PnL**: đọc toàn bộ lịch sử lệnh, nạp/rút, Convert, đổi dust → tính lãi/lỗ **đã chốt + chưa chốt** của từng coin đang giữ, đã thoát hoặc từng nắm giữ; xem chi tiết từng lệnh.
- **Futures**: lãi/lỗ USDⓈ-M + COIN-M từ trước tới nay (đóng lệnh, phí, funding, thanh lý), theo cặp và theo tháng, vị thế đang mở; ví futures được cộng vào tổng tài sản.
- **Chứng khoán**: quỹ ETF/quỹ chỉ số (VOO, VTI, E1VFVN30.VN, FUEVFVND.VN…) lấy giá tự động từ Yahoo Finance, hoặc nhập NAV tay cho quỹ mở; nhập giao dịch mua/bán (DCA).
- **Đồng bộ** toàn bộ dữ liệu dưới dạng 1 file JSON lên **Dropbox** hoặc **Google Drive**, hoặc xuất/nhập file thủ công.
- Hiển thị USD hoặc VND (tỷ giá tự động hoặc cố định).

## Kiến trúc

```
index.html, css/, js/     ← frontend thuần (HTML + ES modules, Chart.js từ CDN)
api/binance.js           ← proxy CHỈ ĐỌC tới Binance, ký HMAC bằng key trong env Vercel
api/quote.js             ← giá chứng khoán / tỷ giá từ Yahoo Finance
api/config.js            ← cấu hình công khai (client id Dropbox/Google) + kiểm tra mật khẩu
```

Binance không cho gọi API có chữ ký trực tiếp từ trình duyệt (CORS, và secret sẽ bị lộ), nên key được giữ trong **Environment Variables của Vercel** và một serverless function nhỏ ký request thay bạn. Proxy chỉ cho phép một danh sách endpoint đọc dữ liệu cố định; mọi request đều cần header mật khẩu `APP_PASSWORD`.

Dữ liệu (lịch sử lệnh, danh mục…) lưu trong IndexedDB của trình duyệt. Mật khẩu và token OAuth chỉ nằm trên thiết bị, không bao giờ được sync.

## Deploy lên Vercel

1. **Tạo API key Binance**: Binance → Account → API Management → Create API (System generated).
   Chỉ bật **Enable Reading**, tắt mọi quyền giao dịch / rút tiền.
2. Import repo vào Vercel (Framework preset: *Other*, không cần build command).
3. Thêm **Environment Variables** (Settings → Environment Variables):

   | Biến | Bắt buộc | Mô tả |
   |---|---|---|
   | `BINANCE_API_KEY` | ✔ | API key (chỉ quyền Read) |
   | `BINANCE_API_SECRET` | ✔ | Secret key |
   | `APP_PASSWORD` | ✔ | Mật khẩu bạn tự đặt, nhập trong tab Cài đặt của web |
   | `DROPBOX_APP_KEY` | | App key Dropbox (có thể nhập trong Cài đặt thay vì env) |
   | `GOOGLE_CLIENT_ID` | | OAuth Client ID Google (tương tự) |
   | `BINANCE_BASE_URL` | | Mặc định `https://api.binance.com` |

4. Deploy, mở web → tab **Cài đặt** → nhập mật khẩu → **Làm mới**.

> **Lỗi 451 / "restricted location"**: Binance chặn IP Mỹ, trong khi Vercel mặc định chạy function ở Mỹ.
> `vercel.json` đã đặt `"regions": ["hnd1"]` (Tokyo). Nếu vẫn bị chặn, đổi sang `sin1`, `hkg1` hoặc `fra1` rồi deploy lại.

## Đồng bộ Dropbox / Google Drive

**Dropbox**
1. https://www.dropbox.com/developers/apps → Create app → *Scoped access* → *App folder*.
2. Tab Permissions: bật `files.content.write`, `files.content.read`.
3. Tab Settings → *OAuth 2 Redirect URIs*: thêm `https://<tên-app>.vercel.app/` (đúng như hiển thị trong tab Cài đặt).
4. Copy **App key** vào env `DROPBOX_APP_KEY` hoặc ô trong Cài đặt → **Kết nối Dropbox**.

**Google Drive**
1. https://console.cloud.google.com → tạo project → bật **Google Drive API**.
2. OAuth consent screen (External, thêm email của bạn vào Test users).
3. Credentials → Create OAuth client ID → *Web application* → *Authorized JavaScript origins*: `https://<tên-app>.vercel.app`.
4. Copy Client ID vào env `GOOGLE_CLIENT_ID` hoặc ô trong Cài đặt → **Kết nối Google Drive**.
   App chỉ dùng scope `drive.file` (chỉ thấy file do chính app tạo).

File đồng bộ: `finance-portfolio.json`. Khi tự động đồng bộ, bên nào có `updatedAt` mới hơn sẽ thắng.

## Cách tính PnL crypto

- **Giá vốn bình quân gia quyền**, mọi giá trị quy đổi USD. Cặp quote stablecoin (USDT, FDUSD, USDC, BUSD…) = 1 USD; cặp quote khác (BTC, ETH, BNB) dùng giá ngày của quote.
- Lệnh `ETH/BTC` được ghi nhận thành 2 chân: mua ETH và bán BTC (có lãi/lỗ trên BTC).
- Phí trả bằng BNB/coin khác được cộng vào giá vốn (hoặc trừ vào tiền bán) của coin giao dịch.
- **Nạp coin**: giá vốn = giá thị trường ngày nạp. **Rút coin**: giảm vị thế theo giá vốn, không tính lãi/lỗ.
- **Số dư thực > sổ sách** (lãi Earn, airdrop, staking): phần dư có giá vốn 0.
- Bán/rút nhiều hơn lượng đã ghi nhận → đánh dấu *thiếu dữ liệu* (không tạo lãi ảo).

**Đồng bộ nhanh** chỉ quét các coin đang giữ / từng nạp / rút / convert / đã có lệnh. Lần đầu nên chạy **Quét toàn bộ** để tìm cả coin đã mua rồi bán hết (thử mọi cặp có quote trong danh sách, mất vài phút do rate limit). Hoặc thêm tên coin vào ô *Coin bổ sung* trong Cài đặt.

Hạn chế: Binance API không trả lịch sử lệnh của cặp đã bị xoá hẳn khỏi sàn; không tính Margin/P2P; giá lịch sử dùng giá trung bình mở/đóng cửa của nến ngày nên là ước tính.

## Lãi/lỗ Futures

- **Đồng bộ qua API** (`/fapi/v1/income`, `/dapi/v1/income`): Binance chỉ trả khoảng 3 tháng gần nhất. App lưu dồn lại nên từ lúc bắt đầu dùng sẽ không mất dữ liệu.
- **Lịch sử cũ hơn**: trên web Binance vào *Orders → Transaction History → Export* (hoặc *Futures → Transaction History → Export*), chọn CSV, mỗi lần tối đa 1 năm → tab Futures → **Nhập CSV** (chọn được nhiều file). Bản ghi trùng giữa CSV và API tự bỏ qua.
- Tổng = lãi/lỗ đóng lệnh + phí + funding + thanh lý + hoàn phí. Tiền chuyển vào/ra ví futures không tính. COIN-M quy đổi USD theo giá ngày phát sinh.

## Chạy local

```bash
cp .env.example .env.local   # điền key
npm run dev                  # http://localhost:3000 (không cần Vercel CLI)
npm test                     # unit test engine PnL
```
