# Thông báo toàn app + làm lại tab Thu chi — thiết kế

Ngày: 2026-10-06 · Trạng thái: đã duyệt hướng (phần 1 duyệt từng mục, phần 2–3 người dùng giao "hoàn thành đi")

## Mục tiêu

1. Mọi thao tác **ghi / xóa dữ liệu hoặc gọi mạng** đều báo rõ **thành công** hoặc **thất bại** (kèm cách xử lý). Không còn báo sai (báo thành công khi thất bại / khi người dùng bấm Hủy).
2. Tab Thu chi dùng được với người **không rành công nghệ**: ít chữ chuyên môn, ít cuộn, nhập nhanh trên điện thoại, sửa được giao dịch, thiết lập có nhãn rõ ràng.
3. Người mới tự cài app (bản deploy riêng) mở tab Thu chi lần đầu vẫn biết phải làm gì.

Không đổi: mô hình dữ liệu (`state.budget`), cách đồng bộ / gộp dữ liệu, tab Tổng quan (điểm sức khỏe vẫn dùng hũ).

Làm 2 đợt nối tiếp, mỗi đợt push riêng: **Đợt 1** thông báo toàn app → **Đợt 2** Thu chi (dùng thông báo của đợt 1).

---

## Đợt 1 — Thông báo toàn app

### 1.1 Thành phần `toast()` (js/util.js)

- Giữ chữ ký cũ `toast(msg, type = 'info', ms)`; tham số thứ 3 nhận thêm dạng `{ ms, action: { label, run } }`.
- Biểu tượng theo loại: `ok` ✓, `error` ⚠, `info` ℹ (SVG trong `js/icons.js`, không dùng emoji).
- Mặc định: `ok`/`info` 4 giây, `error` 7 giây, có `action` 6 giây.
- `error` có `role="alert"` (đọc ngay cho trình đọc màn hình); loại khác `role="status"`.
- Chạm vào thông báo để tắt. Nút hành động (vd **Hoàn tác**) chạy `run()` rồi tắt.
- Tối đa 3 thông báo cùng lúc (bỏ cái cũ nhất).
- Chữ vẫn qua `tr()` như hiện tại.
- `flashAfterReload(msg, type)`: lưu vào `sessionStorage`, app hiện ra sau khi tải lại trang (dùng cho thao tác kết thúc bằng `location.reload()`).

### 1.2 Quy tắc

- Thao tác ghi / xóa dữ liệu hoặc gọi mạng do người dùng bấm → **luôn** có thông báo thành công và thất bại.
- Thao tác mà kết quả hiện ngay trên màn hình (đổi giao diện sáng/tối, màu, ngôn ngữ, ẩn số dư, tiền tệ hiển thị, thứ tự tab, hiện tab Futures) → **không** cần thông báo.
- Tác vụ nền (tự đồng bộ, tải lịch sử giá) → chỉ báo khi **lỗi**, không báo thành công (tránh làm phiền).
- Xóa **một mục** (giao dịch, tài khoản tiền mặt, giao dịch CK, danh mục, khoản định kỳ) → xóa ngay + thông báo có **Hoàn tác** (không hỏi lại).
- Ghi đè / thay **toàn bộ** dữ liệu (ghi đè lên cloud, nhập JSON, tải từ cloud, xóa toàn bộ) → hỏi lại bằng `confirm()` như các chỗ đang có.
- Lời thông báo: thành công bắt đầu bằng "Đã …"; lỗi nói chuyện gì xảy ra + cách xử lý, không in nguyên lỗi kỹ thuật nếu có lời dễ hiểu hơn. Không dùng "thành công", không dấu "!".

### 1.3 Sửa chỗ báo sai (đã kiểm tra lại trong code)

| Chỗ | Hiện tại | Sửa |
|---|---|---|
| settings.js `#sy-pull` | Bấm Hủy ở hộp xác nhận vẫn báo "Đã tải từ cloud" | `run()` bỏ qua thông báo khi hàm trả `false` (đã hủy) |
| futures.js (lib) 400/401/403/404 | Bỏ qua, cuối cùng báo "Futures: 0 bản ghi mới" | Trả về danh sách nguồn bị bỏ qua; app báo `info` kèm lý do; nếu **mọi** nguồn bị từ chối quyền (401/403) → `error` "API key chưa bật quyền đọc Futures" |
| store.js `login()` | Mất mạng / server lỗi → "Sai mật khẩu" | 401 → `false` (sai mật khẩu); lỗi khác → `throw` với lời "Không kết nối được server…"; nơi gọi hiện đúng lỗi |
| binance.js Funding / Earn / futures account | Lỗi bị nuốt, vẫn báo "Đã cập nhật số dư Binance" | Ghi lại phần lỗi; thông báo `info` "Đã cập nhật số dư Binance — chưa lấy được: Funding, Earn" |
| store.js `persist()` | Hết bộ nhớ → mất dữ liệu im lặng | Phát sự kiện `fin:save-failed`; app báo `error` "Không lưu được vào máy (bộ nhớ trình duyệt đầy). Hãy Xuất JSON để sao lưu." (chỉ báo 1 lần mỗi phiên) |

### 1.4 Bổ sung thông báo (theo kết quả rà soát)

- **app.js**: đăng nhập ở màn khóa → "Đã đăng nhập"; xóa dữ liệu thiết bị → `flashAfterReload`; nút đồng bộ ở thanh trên: khóa nút + xoay biểu tượng khi đang chạy; "↻ Cập nhật giá" khi hết phiên → báo lỗi thay vì im lặng.
- **overview.js**: lưu / xóa mục tiêu; thêm / sửa số dư / xóa (Hoàn tác) tài khoản tiền mặt; thêm / sửa dư nợ / xóa khoản nợ. Hộp `prompt()` bị bỏ trống hoặc Hủy → không đổi gì (hiện tại USD trống thành 0). Tên chỉ có khoảng trắng → lỗi "Nhập tên".
- **pnl.js**: "Bỏ phần dư" → "Đã bỏ phần dư N coin"; hủy điều chỉnh → "Đã hoàn tác".
- **futures (view + app.js)**: xóa dữ liệu futures → thông báo; nhập CSV mà mọi file đều lỗi → không hiện thông báo tổng kiểu thành công.
- **stocks.js**: thêm / lưu mã → "Đã thêm mã X" / "Đã lưu mã X"; không kiểm tra được giá → `info`; thêm giao dịch → "Đã thêm giao dịch" + kiểm tra số lượng ≠ 0, giá > 0, không bán quá số đang giữ; xóa mã → thông báo; xóa giao dịch → Hoàn tác; nút cập nhật giá khóa khi đang chạy.
- **settings.js**: đăng xuất → "Đã đăng xuất"; bật/tắt tự động đồng bộ → thông báo; **ghi đè lên cloud** và **nhập JSON** → thêm `confirm()`; xuất JSON → "Đã xuất file …"; xóa lịch sử Binance / xóa toàn bộ → thông báo; các nút trong `run()` khóa khi đang chạy.
- **budget.js**: không sửa ở đợt 1 — đợt 2 viết lại toàn bộ (đã có thông báo đầy đủ).

---

## Đợt 2 — Làm lại tab Thu chi

### 2.1 Bố cục

- Đầu tab: điều hướng tháng `‹ Tháng 10/2026 ›` (không đi quá tháng hiện tại) + 3 nút chuyển **Giao dịch** (mặc định) · **Báo cáo** · **Thiết lập**.
- Máy tính: thêm nút "Ghi khoản mới" ở đầu tab (điện thoại dùng nút + nổi sẵn có).
- Tab Thu chi **luôn hiện VND** (không theo nút USD/VND); vẫn tôn trọng chế độ ẩn số dư.

### 2.2 Màn Giao dịch

- **Thẻ "Còn tiêu được"** (logic thuần trong `js/budget.js`, có test):
  - Ngân sách = phần thu nhập của hũ Thiết yếu + Hưởng thụ; đã tiêu = chi của 2 hũ này; còn = ngân sách − đã tiêu.
  - Tháng hiện tại: "≈ X mỗi ngày" = còn ÷ số ngày còn lại (tính cả hôm nay). Tháng cũ: chỉ "Còn lại".
  - Chưa có thu nhập trong tháng: "Ghi lương hoặc thu nhập để biết còn tiêu được bao nhiêu" + nút **Ghi khoản thu**.
  - Tiêu quá: chữ đỏ "Đã tiêu quá X".
  - "Xem 4 hũ" mở chi tiết, lời thường: hũ tiêu dùng "còn X" / "vượt X"; hũ để dành "đã để X / mục tiêu Y".
- Dòng tổng: **Thu vào · Tiêu · Để dành**.
- **Danh sách**: nhóm "Hôm nay / Hôm qua / Thứ 7, 03/10"; mỗi dòng là 1 nút → mở bảng sửa. Dòng phụ (chữ nhỏ): ghi chú · "Tự động hằng tháng" (khoản sinh từ định kỳ) · tên tài khoản. Bỏ nút ✕ và các thẻ tag.
- Tháng trống: "Chưa có khoản nào trong tháng 10" + nút **Ghi khoản đầu tiên**.

### 2.3 Bảng nhập / sửa (dùng chung `js/sheet.js`)

- `js/sheet.js`: dùng `<dialog>` gốc của trình duyệt (`showModal()` có sẵn khóa focus, phím Esc, nền mờ). Điện thoại: trượt từ dưới lên; máy tính: hộp giữa màn hình. Dialog nằm **ngoài** `<main>` để các lần vẽ lại nền không xóa form đang nhập. Đóng khi bấm nền / ✕ / Esc.
- Nút + nổi mở bảng **ngay trên tab hiện tại** (không chuyển tab); lưu xong vẽ lại tab.
- Nội dung: Chi | Thu → **Số tiền** (chữ to, `inputmode="decimal"`, tự thêm dấu chấm khi chỉ có số; nút nhanh **000 · nghìn · triệu**; máy tính vẫn gõ "45k", "1,5tr" — hiện dòng "= 45.000 ₫" khi gõ kiểu tắt) → **lưới danh mục** thấy hết (4 cột) → Ghi chú (không bắt buộc) → hàng **Ngày** (ô ngày gốc + chữ "Hôm nay"/"Hôm qua") và **Tài khoản** (chỉ hiện khi có tài khoản VND; nhớ lựa chọn trên máy như hiện tại) → nút **Lưu khoản chi / Lưu khoản thu**.
- Không chọn sẵn danh mục; thiếu số tiền / danh mục → thông báo lỗi + đánh dấu ô thiếu, giữ nguyên bảng.
- Chế độ sửa: tiêu đề "Sửa khoản chi/thu", nút **Lưu thay đổi** + **Xóa khoản này**. Đổi Chi↔Thu thì phải chọn lại danh mục.
- Lưu khoản ở tháng khác tháng đang xem → chuyển tới tháng đó (như hiện tại).

### 2.4 Báo cáo

- Một câu tóm tắt: "Tháng này bạn giữ lại được 73% thu nhập" (tỷ lệ tiết kiệm, lời thường; ẩn khi chưa có thu nhập).
- **Tiêu vào đâu**: danh sách danh mục tiêu dùng xếp giảm dần, thanh ngang + số tiền + %; bỏ biểu đồ tròn.
- **Để dành & đầu tư**: danh sách ngắn theo danh mục.
- **6 tháng gần nhất**: giữ biểu đồ cột (Thu vào · Tiêu · Để dành).

### 2.5 Thiết lập (mỗi mục là danh sách; bấm để sửa trong bảng có nhãn rõ)

- **Khoản tự động hằng tháng** (định kỳ): dòng "Lương · +25.000.000 ₫ · ngày 5 · hằng tháng · Vietcombank". **Mới: sửa được.** Bảng: Chi | Thu, danh mục (lưới), số tiền, "Vào ngày" (1–28), "Lặp lại" (Hằng tháng / 2 / 3 / 6 tháng / Hằng năm), "Bắt đầu từ" (chọn tháng, ±12 tháng), ghi chú, tài khoản. Ghi chú trong bảng: "Thay đổi áp dụng cho các lần sau". Nếu lưu làm phát sinh khoản cho các tháng trước → thông báo "… đã ghi N khoản cho các tháng trước". Xóa → Hoàn tác; các khoản đã ghi vẫn giữ (nói rõ trong thông báo).
- **Danh mục**: 2 nhóm Chi / Thu. **Mới: sửa được** tên, biểu tượng, nhóm hũ. Biểu tượng chọn từ lưới emoji có sẵn (không phải tự gõ). Nhóm hũ có mô tả: Thiết yếu — chi tiêu cần thiết; Hưởng thụ — chi cho bản thân; Tiết kiệm — tiền để dành; Đầu tư — tiền đầu tư. Không đổi loại Chi/Thu của danh mục đã có. Tên trống / trùng tên cùng loại → lỗi. Xóa: chỉ khi chưa dùng (như hiện tại); đang dùng → lỗi "Còn N giao dịch dùng danh mục này"; chưa dùng → xóa + Hoàn tác.
- **Chia thu nhập** (tỷ lệ hũ): 4 ô % có mô tả, dòng tổng sống "Tổng 100% ✓" / "Tổng 95% — cần đúng 100%"; lưu khi khác 100% → lỗi. Ô "Quỹ dự phòng nên đủ mấy tháng chi tiêu".

### 2.6 Thông báo trong Thu chi

Lưu / cập nhật / xóa (Hoàn tác) giao dịch, khoản tự động, danh mục; lưu tỷ lệ hũ; mọi lỗi kiểm tra dữ liệu.

**Hoàn tác xóa giao dịch** = thêm lại **bản sao với id mới** (id cũ đã có dấu xóa và dấu xóa được gộp giữa các máy; nếu chỉ gỡ dấu xóa thì lần đồng bộ sau sẽ xóa lại). Khoản định kỳ / danh mục / tài khoản / giao dịch CK là cấu hình theo "bên sửa sau thắng" → hoàn tác bằng cách chèn lại đúng mục đó.

### 2.7 Code

- `js/views/budget.js` — khung tab, chuyển màn, màn Giao dịch.
- `js/views/budget-entry.js` — bảng nhập / sửa giao dịch (+ dùng cho FAB).
- `js/views/budget-report.js` — Báo cáo.
- `js/views/budget-settings.js` — Thiết lập.
- `js/sheet.js` — bảng trượt dùng chung.
- `js/budget.js` — thêm hàm thuần: ngân sách tiêu dùng tháng, nhãn ngày tương đối, xử lý ô số tiền.
- CSS mới trong `css/style.css` (+ `refined.css` nếu cần); xóa CSS chỉ phục vụ giao diện cũ.
- Mọi chuỗi mới có bản tiếng Anh trong `js/i18n.js`.

---

## Kiểm thử

- `npm test` xanh. Test mới (node:test): ngân sách tiêu dùng (chưa có thu nhập / bình thường / vượt / tháng cũ / số ngày còn lại), nhãn ngày tương đối, xử lý ô số tiền (định dạng, nút nghìn/triệu, kiểu tắt), `login()` phân biệt 401 và lỗi khác, futures trả danh sách nguồn bị bỏ qua.
- Kiểm tra tay trên dev server (khổ điện thoại 375px + máy tính, sáng/tối, tiếng Anh): thêm/sửa/xóa/hoàn tác giao dịch; FAB từ tab khác; khoản tự động thêm/sửa/xóa; danh mục thêm/sửa/xóa (đang dùng & chưa dùng); tỷ lệ hũ sai/đúng; tháng trống; tháng chưa có thu nhập; một lượt các thông báo của đợt 1.

## Ngoài phạm vi (làm sau)

- Thay `prompt()` sửa số dư / dư nợ ở tab Tổng quan bằng bảng nhập.
- Lỗi `scripts/dev.js` trả 404 cho `/` trên Windows (đã tách việc riêng).
- Gộp từng giao dịch cho `cash` / `stocks.txs` khi sửa đồng thời trên 2 máy.
