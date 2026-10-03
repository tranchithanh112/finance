// Đa ngôn ngữ (vi / en). Giao diện viết bằng tiếng Việt; khi chọn English, sau mỗi lần render
// app dịch các đoạn chữ trong DOM (text, placeholder, title…) theo từ điển bên dưới.
//  - EXACT: câu cố định (so khớp cả đoạn, đã trim)
//  - RULES: câu có số / tên chèn vào (regex, áp dụng lần lượt)

let lang = (() => {
  try { return localStorage.getItem('fin.lang') || 'vi'; } catch { return 'vi'; }
})();

export const getLang = () => lang;
export const locale = () => (lang === 'en' ? 'en-US' : 'vi-VN');
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'vi';
  try { localStorage.setItem('fin.lang', lang); } catch { /* ignore */ }
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
}

const EXACT = {
  // ---- điều hướng & chung
  'Tổng quan': 'Overview', 'Thu chi': 'Budget', 'Crypto': 'Crypto', 'Danh mục': 'Portfolio', 'Lãi/lỗ': 'P&L',
  'Futures': 'Futures', 'Chứng khoán': 'Stocks', 'Cài đặt': 'Settings', 'Thêm': 'Add', 'Xóa': 'Delete', 'Sửa': 'Edit',
  'Lưu': 'Save', 'Hủy': 'Cancel', 'Mở': 'Open', 'Thu gọn': 'Collapse', 'Mặc định': 'Default', 'Lên': 'Up', 'Xuống': 'Down',
  'Tiền tệ hiển thị': 'Display currency', 'Giao diện sáng / tối': 'Light / dark mode', 'Làm mới số dư & giá': 'Refresh balances & prices',
  'Ghi thu chi': 'Add transaction', 'Ẩn / hiện số dư': 'Hide / show balances', 'Ẩn số dư': 'Hide balances', 'Hiện số dư': 'Show balances', 'Điều hướng': 'Navigation', '☁ Chưa sync': '☁ Not synced',
  'Bấm để đồng bộ ngay': 'Tap to sync now', 'Kết nối Dropbox / Google Drive trong Cài đặt': 'Connect Dropbox / Google Drive in Settings',

  // ---- tổng quan
  'Tài sản ròng': 'Net worth', 'Dòng tiền tháng này': 'Cash flow this month', 'Tỷ lệ tiết kiệm': 'Savings rate',
  'Quỹ dự phòng': 'Emergency fund', 'Lãi/lỗ đầu tư': 'Investment P&L', 'Tháng này': 'This month',
  'Nhập thu chi ở tab Thu chi': 'Add income & expenses in Budget',
  'Tiền mặt + stablecoin · nhập chi tiêu ở tab Thu chi để tính số tháng': 'Cash + stablecoins · add expenses in Budget to compute months',
  'Sức khỏe tài chính:': 'Financial health:',
  'Tổng hợp từ tỷ lệ tiết kiệm, quỹ dự phòng, nợ, mức rủi ro danh mục và việc giữ đúng ngân sách hũ.':
    'Combines savings rate, emergency fund, debt, portfolio risk and sticking to your jar budgets.',
  'Nợ / thu nhập': 'Debt / income', 'Mức rủi ro danh mục': 'Portfolio risk', 'Giữ đúng ngân sách hũ': 'Staying within jar budgets',
  'Rất tốt': 'Excellent', 'Khá': 'Good', 'Trung bình': 'Fair', 'Cần cải thiện': 'Needs work', 'Chưa đủ dữ liệu': 'Not enough data',
  'Nhập thu chi và làm mới số dư để tính điểm.': 'Add income/expenses and refresh balances to get a score.',
  'Chưa có dữ liệu thu chi — vào tab': 'No budget data yet — open the',
  'để thêm lương (định kỳ) và các khoản chi.': 'tab to add your salary (recurring) and expenses.',
  'Phân bổ tài sản': 'Asset allocation', 'Thu chi 6 tháng': 'Income & spending, 6 months', 'Chưa có dữ liệu thu chi.': 'No budget data yet.',
  'Tài sản ròng theo thời gian': 'Net worth over time', 'Mỗi ngày lưu 1 điểm khi bạn mở app': 'One point is saved per day when you open the app',
  'Cần ít nhất 2 ngày dữ liệu để vẽ biểu đồ.': 'Need at least 2 days of data to draw the chart.',
  'Top tài sản': 'Top assets', 'Tiền mặt & tài sản khác': 'Cash & other assets',
  'Tự cộng/trừ theo thu chi · tính vào quỹ dự phòng': 'Auto-adjusted by transactions · counts toward emergency fund',
  'Sửa số dư': 'Edit balance', 'Chưa có — tiền gửi ngân hàng, tiền mặt, vàng…': 'None yet — bank deposits, cash, gold…',
  'Tên (vd: Tiết kiệm VCB)': 'Name (e.g. Savings account)', 'Số dư (vd 52tr)': 'Balance (e.g. 52m)',
  'Nợ': 'Debts', 'Không có nợ': 'No debts', 'Sửa dư nợ': 'Edit balance',
  'Thẻ tín dụng, vay mua nhà/xe, vay người quen…': 'Credit cards, mortgage/car loans, personal loans…',
  'Tên khoản nợ': 'Debt name', 'Dư nợ': 'Balance', 'Trả / tháng': 'Payment / month', 'Lãi %/năm': 'Rate %/yr',
  'Stablecoin': 'Stablecoins', 'Tiền mặt & khác': 'Cash & other', 'Thu': 'Income', 'Tiêu dùng': 'Spending',
  'Để dành & đầu tư': 'Saved & invested', 'Khác': 'Other',

  // ---- thu chi
  'Tháng trước': 'Previous month', 'Tháng sau': 'Next month', 'Chi': 'Expense',
  'Số tiền — vd 45k, 1.2tr': 'Amount — e.g. 45k, 1.2m', 'Ghi chú (tuỳ chọn)': 'Note (optional)',
  'Tự cộng/trừ vào tài khoản': 'Auto-apply to account', 'Không trừ vào tài khoản': "Don't apply to an account",
  'Thu nhập': 'Income', 'Thiết yếu + Hưởng thụ': 'Essentials + Fun', 'Chưa phân bổ': 'Unallocated',
  'Thu − tiêu − để dành': 'Income − spending − saved', '(Thu − tiêu dùng) / thu': '(Income − spending) / income',
  'Các hũ tháng này': 'Jars this month', 'Chi theo danh mục': 'Spending by category', 'Chưa có khoản chi.': 'No expenses yet.',
  '6 tháng gần nhất': 'Last 6 months', 'Giao dịch': 'Transactions', 'định kỳ': 'recurring',
  'Chưa có giao dịch trong tháng.': 'No transactions this month.',
  'Thiết lập hũ, khoản định kỳ & danh mục': 'Jars, recurring items & categories',
  'Lưu tỷ lệ': 'Save ratios', 'Quỹ dự phòng mục tiêu (tháng)': 'Emergency fund target (months)',
  'Khoản định kỳ (tự thêm mỗi tháng)': 'Recurring items (added automatically)',
  'Khoản': 'Item', 'Số tiền': 'Amount', 'Ngày': 'Date', 'Chu kỳ': 'Frequency', 'Từ tháng': 'From month',
  'Chưa có — vd Lương ngày 5, Netflix 3 tháng/lần.': 'None yet — e.g. salary on the 5th, Netflix every 3 months.',
  'Số tiền (vd 15tr)': 'Amount (e.g. 15m)', 'Ngày trong tháng (1–28)': 'Day of month (1–28)',
  'Tháng trả lần đầu (tính từ đó theo chu kỳ)': 'First payment month (repeats from there)', 'Ghi chú': 'Note',
  'Thêm danh mục': 'Add category', 'Tên danh mục': 'Category name', 'thu': 'income',
  'Hằng tháng': 'Monthly', '2 tháng/lần': 'Every 2 months', '3 tháng/lần': 'Every 3 months', '6 tháng/lần': 'Every 6 months', 'Hằng năm': 'Yearly',
  'Chọn danh mục': 'Pick a category', 'Số tiền không hợp lệ': 'Invalid amount',
  'Số tiền không hợp lệ (vd 45k, 1.2tr, 150000)': 'Invalid amount (e.g. 45k, 1.2m, 150000)', 'Số không hợp lệ': 'Invalid number',
  'Đã lưu tỷ lệ hũ': 'Jar ratios saved',
  'Xóa khoản định kỳ này? (Các giao dịch đã sinh vẫn được giữ)': 'Delete this recurring item? (Existing transactions are kept)',
  'Xóa khoản nợ này?': 'Delete this debt?',

  // ---- crypto
  'Chưa có dữ liệu Binance': 'No Binance data yet', 'Tải số dư Binance': 'Load Binance balances',
  'Tổng giá trị crypto': 'Total crypto value', 'Futures (ký quỹ)': 'Futures (margin)', 'Phân bổ danh mục': 'Allocation',
  'Tỷ trọng': 'Weight', 'Coin': 'Coin', 'Số lượng': 'Quantity', 'Giá': 'Price', 'Giá trị': 'Value', 'Giá vốn TB': 'Avg cost',
  'Lãi/lỗ chưa chốt': 'Unrealized P&L', 'Tổng PnL': 'Total P&L',
  'Cột giá vốn / PnL cần đồng bộ lịch sử ở tab "Lịch sử & PnL".': 'Cost / P&L columns need a history sync in the P&L tab.',

  // ---- lãi/lỗ spot
  'Đồng bộ lịch sử Binance': 'Binance history sync', 'Đồng bộ nhanh': 'Quick sync', 'Quét toàn bộ': 'Full scan',
  'Chưa có dữ liệu lịch sử. Bấm "Đồng bộ nhanh" hoặc "Quét toàn bộ".': 'No history yet. Tap "Quick sync" or "Full scan".',
  'Tổng PnL từ trước tới nay': 'All-time P&L', 'Đã chốt (realized)': 'Realized', 'Chưa chốt (unrealized)': 'Unrealized',
  'Tổng tiền đã mua': 'Total bought', 'Coin lãi / lỗ': 'Winners / losers', 'Lãi/lỗ đã chốt cộng dồn': 'Cumulative realized P&L',
  'Đã chốt cộng dồn': 'Cumulative realized', 'Tổng lãi/lỗ': 'Total P&L',
  'Tổng = chưa chốt (giá trị coin đang nắm − vốn) + đã chốt cộng dồn. Dựng lại theo giá đóng cửa từng ngày; không gồm stablecoin và futures. Điểm hôm nay lấy đúng các ô số liệu phía trên.':
    'Total = unrealized (value of coins held − cost) + cumulative realized. Rebuilt from daily closing prices; excludes stablecoins and futures. Today\'s point uses the figures above.',
  'Tất cả': 'All', 'Đang giữ': 'Holding', 'Đã thoát': 'Exited', 'Tìm coin…': 'Search coin…', 'Trạng thái': 'Status',
  'Đã mua': 'Bought', 'Giá hiện tại': 'Current price', 'Đã chốt': 'Realized', 'Chưa chốt': 'Unrealized', 'ROI': 'ROI',
  'GD cuối': 'Last trade', 'thiếu dữ liệu': 'missing data',
  'Có lượng coin bị bán/rút nhưng không tìm thấy nguồn mua/nạp (thiếu lịch sử)': 'Some coins were sold/withdrawn without a known source (missing history)',
  'Giá vốn còn lại': 'Remaining cost', 'Tiền đã mua / bán': 'Bought / sold', 'Số lệnh': 'Trades', 'Thời gian': 'Time',
  'Loại': 'Type', 'Cặp': 'Pair', 'Giá trị (USD)': 'Value (USD)', 'Lãi/lỗ chốt': 'Realized', 'Giá vốn TB sau': 'Avg cost after',
  'Số dư sau': 'Balance after', 'Mua': 'Buy', 'Bán': 'Sell', 'Phí': 'Fee', 'Nạp': 'Deposit', 'Rút': 'Withdraw',
  'Mua bằng fiat': 'Fiat purchase', 'Bắt đầu…': 'Starting…', 'Hoàn tất': 'Done',
  'Tải danh sách cặp giao dịch…': 'Loading trading pairs…', 'Tải lịch sử nạp / rút…': 'Loading deposits / withdrawals…',
  'Tải lịch sử Auto-Invest (DCA), staking, mua fiat…': 'Loading Auto-Invest (DCA), staking and fiat purchases…',
  'Đã hủy (dữ liệu đã tải vẫn được giữ)': 'Cancelled (loaded data is kept)',

  // ---- futures
  'Lịch sử Futures': 'Futures history', 'Đồng bộ qua API': 'Sync via API', 'Nhập CSV': 'Import CSV',
  'Xóa dữ liệu futures': 'Clear futures data',
  'Chưa có dữ liệu futures. Bấm "Đồng bộ qua API" và/hoặc "Nhập CSV".': 'No futures data yet. Tap "Sync via API" and/or "Import CSV".',
  'Tổng lãi/lỗ futures (đã chốt, sau phí)': 'Total futures P&L (realized, after fees)', 'Lãi/lỗ đóng lệnh': 'Realized P&L',
  'Phí giao dịch': 'Trading fees', 'Funding': 'Funding', 'Thanh lý': 'Liquidation', 'Vị thế đang mở': 'Open positions',
  'Lãi/lỗ cộng dồn': 'Cumulative P&L', 'Theo tháng': 'By month', 'Theo cặp giao dịch': 'By pair', 'Tìm cặp…': 'Search pair…',
  'Đóng lệnh': 'Closed', 'Tổng': 'Total', 'Số lần chốt': 'Closes', 'Lần cuối': 'Last', 'Không rõ cặp (CSV)': 'Unknown pair (CSV)',
  'Cộng dồn': 'Cumulative', 'Chiều': 'Side', 'Khối lượng': 'Size', 'Giá vào': 'Entry', 'Giá mark': 'Mark',
  'Thanh lý / quỹ bảo hiểm': 'Liquidation / insurance', 'Hoàn phí': 'Fee rebate', 'Tất toán HĐ quý': 'Delivery settlement',
  'Tải giá lịch sử…': 'Loading price history…', 'Đang tải lịch sử futures…': 'Loading futures history…',
  'Xóa toàn bộ lịch sử futures đã tải / nhập?': 'Delete all loaded / imported futures history?',

  // ---- chứng khoán
  'Giá trị chứng khoán / quỹ': 'Stocks / funds value', 'Vốn đang nắm': 'Cost basis', 'Hôm nay': 'Today', 'Phân bổ': 'Allocation',
  'Chưa có vị thế.': 'No positions yet.', 'Thêm quỹ / mã chứng khoán': 'Add fund / ticker', 'Mã': 'Ticker', 'Tên': 'Name',
  'Tiền tệ': 'Currency', 'Nguồn giá': 'Price source', 'Yahoo Finance (tự động)': 'Yahoo Finance (auto)',
  'Nhập tay (NAV quỹ mở)': 'Manual (open-end fund NAV)', 'Giá nhập tay': 'Manual price', 'NAV / giá hiện tại': 'NAV / current price',
  'Thêm mã': 'Add ticker', '↻ Cập nhật giá': '↻ Update prices', 'Số CCQ/CP': 'Units', '%': '%', 'nhập tay': 'manual',
  'Chưa có mã nào — thêm ở form phía trên.': 'No tickers yet — add one above.', 'Giá / đơn vị': 'Price / unit',
  'Thành tiền': 'Total', 'Chưa có giao dịch.': 'No transactions yet.', 'Mã đã tồn tại': 'Ticker already exists',

  // ---- cài đặt
  'Thứ tự tab': 'Tab order', 'Kết nối server (Vercel)': 'Server connection (Vercel)',
  'Mật khẩu ứng dụng (APP_PASSWORD)': 'App password (APP_PASSWORD)', 'Giá trị bạn đặt trong env của Vercel': 'The value you set in Vercel env',
  'Lưu & kiểm tra': 'Save & check', 'Đồng bộ đám mây (JSON)': 'Cloud sync (JSON)', 'Kết nối Dropbox': 'Connect Dropbox',
  'Kết nối Google Drive': 'Connect Google Drive', 'Ngắt kết nối': 'Disconnect', 'Đồng bộ ngay': 'Sync now',
  '↑ Ghi đè lên cloud': '↑ Overwrite cloud', '↓ Tải từ cloud (ghi đè máy này)': '↓ Download from cloud (overwrite this device)',
  'Tự động đồng bộ khi mở app và sau mỗi thay đổi': 'Auto-sync on open and after every change',
  'Hiển thị & tính toán': 'Display & calculation', 'Lịch sử Binance bắt đầu từ': 'Binance history starts from',
  'Quote dùng để quét lệnh (phẩy ngăn cách)': 'Quote assets for full scan (comma separated)',
  'Coin bổ sung cần quét (đã từng giao dịch nhưng không còn giữ / chưa từng nạp)': 'Extra coins to scan (traded before but no longer held / never deposited)',
  'Bao gồm lịch sử Binance Convert (quét chậm hơn ~1s / 30 ngày)': 'Include Binance Convert history (slower, ~1s per 30 days)',
  'Sao lưu thủ công': 'Manual backup', 'Xuất JSON': 'Export JSON', 'Nhập JSON': 'Import JSON',
  'Xóa lịch sử Binance': 'Clear Binance history', 'Xóa toàn bộ dữ liệu': 'Delete all data',
  'Ẩn coin bụi dưới (USD)': 'Hide dust below (USD)', 'Giao diện': 'Appearance', 'Ngôn ngữ': 'Language', 'Chế độ': 'Mode',
  'Tự động': 'Auto', 'Sáng': 'Light', 'Tối': 'Dark', 'Màu sắc': 'Color theme',
  'Đồng': 'Bronze', 'Trong suốt': 'Glass',
  'Mật khẩu đúng': 'Password OK', 'Mật khẩu sai hoặc server chưa cấu hình': 'Wrong password or server not configured',
  'Đã kết nối Google Drive': 'Google Drive connected', 'Đã ngắt kết nối': 'Disconnected', 'Đã nhận dữ liệu từ cloud': 'Received data from cloud',
  'Đã tải lên cloud': 'Uploaded to cloud', 'Đã gộp dữ liệu 2 bên': 'Merged both sides', 'Đã đồng bộ': 'In sync',
  'Đã ghi đè lên cloud': 'Cloud overwritten', 'Đã tải từ cloud': 'Downloaded from cloud', 'Chưa có file trên cloud': 'No file on cloud yet',
  'Dữ liệu trên máy này sẽ bị thay bằng dữ liệu trên cloud. Tiếp tục?': 'Data on this device will be replaced by the cloud copy. Continue?',
  'Đã lưu cài đặt': 'Settings saved', 'Đã nhập dữ liệu': 'Data imported',
  'Xóa toàn bộ lịch sử giao dịch Binance đã tải? (Có thể đồng bộ lại)': 'Delete all loaded Binance history? (You can sync again)',
  'Xóa TOÀN BỘ dữ liệu trên máy này? Nếu đang bật tự động đồng bộ, file trên cloud cũng sẽ bị ghi đè. Hãy xuất JSON trước nếu cần.':
    'Delete ALL data on this device? If auto-sync is on, the cloud file will be overwritten too. Export JSON first if needed.',
  'Đã kết nối Dropbox': 'Dropbox connected',
  'chỉ bật quyền Read': 'Read permission only', '(hoặc': '(or', 'Redirect URI cần khai báo:': 'Required redirect URI:',
  '. Khi đồng bộ, lịch sử giao dịch của các máy được gộp lại (không mất bản ghi); dữ liệu tự nhập lấy theo lần sửa gần nhất.':
    '. When syncing, transaction history from all devices is merged (nothing is lost); manually entered data follows the most recent edit.',

  // ---- thông báo chung
  'Nhập mật khẩu ứng dụng trong tab Cài đặt trước': 'Enter the app password in Settings first',
  'Đã cập nhật số dư Binance': 'Binance balances updated', 'Đã cập nhật giá': 'Prices updated',
  'Giao diện: theo hệ thống': 'Mode: follow system', 'Giao diện: sáng': 'Mode: light', 'Giao diện: tối': 'Mode: dark',
  'File JSON không đúng định dạng': 'Invalid JSON file', 'Chưa kết nối Dropbox / Google Drive': 'Dropbox / Google Drive not connected',
  'Chưa có Dropbox App Key': 'Missing Dropbox App Key', 'Chưa có Google Client ID': 'Missing Google Client ID',

  // ---- đăng nhập / bảo mật
  'iFinance đang khóa': 'iFinance is locked', 'Đã có bản mới — chạm để cập nhật': 'A new version is available — tap to update', 'Mật khẩu ứng dụng': 'App password', 'Mã xác thực 2 bước': '2-step code',
  'Đăng nhập để xem số liệu. Dữ liệu trên máy được ẩn cho tới khi đăng nhập.': 'Sign in to see your numbers. Data on this device stays hidden until you do.',
  'Xóa dữ liệu trên thiết bị này': 'Erase data on this device', 'Sai mật khẩu ứng dụng': 'Wrong app password',
  'Không kết nối được server — kiểm tra mạng rồi thử lại.': 'Cannot reach the server — check your connection and try again.',
  'Xóa toàn bộ dữ liệu của app trên thiết bị này? File trên cloud (Dropbox / Drive) không bị ảnh hưởng.': 'Erase all app data on this device? Files in the cloud (Dropbox / Drive) are not affected.',
  'Đăng nhập': 'Sign in', 'Đăng xuất thiết bị này': 'Sign out this device', 'Đã đăng nhập': 'Signed in',
  'Mã xác thực 2 bước (Google Authenticator)': '2-step verification code (Google Authenticator)', '6 số': '6 digits',
  'Sai mật khẩu hoặc mã xác thực 2 bước': 'Wrong password or 2-step code',
  'Bật xác thực 2 bước (Google Authenticator)': 'Turn on 2-step verification (Google Authenticator)', 'Tạo khóa': 'Generate key',
  'Mở Google Authenticator': 'Open Google Authenticator', 'Sao chép khóa': 'Copy key', 'Kiểm tra': 'Check', 'Mã đúng ✓': 'Code OK ✓',
  'Thêm vào Google Authenticator.': 'Add to Google Authenticator.', 'Kiểm tra.': 'Verify.', 'Bật trên Vercel.': 'Turn on in Vercel.',
  'Hủy, tạo lại sau': 'Cancel, do it later', 'Đã sao chép khóa': 'Key copied', 'Không sao chép được — hãy chép tay': 'Could not copy — copy it by hand',
  'Mã đúng — giờ thêm TOTP_SECRET trên Vercel': 'Code OK — now add TOTP_SECRET on Vercel',
  'Mã chưa đúng, kiểm tra lại khóa đã nhập vào Authenticator': 'Wrong code — check the key entered in Authenticator',
  'Tạo khóa ngay trên máy này (không gửi đi đâu), thêm vào Google Authenticator, rồi dán khóa vào Vercel.': 'Generate a key on this device (it is not sent anywhere), add it to Google Authenticator, then paste it into Vercel.',
  'Phiên đăng nhập Dropbox không hợp lệ, hãy thử lại': 'Invalid Dropbox sign-in session, please try again',
  'Đã hủy kết nối Dropbox': 'Dropbox connection cancelled',

  // ---- giao diện gọn
  '↻ Đồng bộ': '↻ Sync', 'Lịch sử Binance': 'Binance history', 'Lãi nhất · lỗ nhất': 'Best · worst', 'Ẩn cảnh báo': 'Hide warning',
  'Tỷ trọng & lãi/lỗ': 'Weight & P&L', 'Theo tài sản': 'By asset',
  'Cột cuối: lãi/lỗ chưa chốt so với giá vốn của số coin đang giữ.': 'Last column: unrealized P&L vs. cost of the coins held.',

  // ---- đối chiếu lịch sử với ví
  'Đối chiếu lịch sử với ví': 'History vs wallet', 'Bỏ phần dư': 'Drop excess', 'Đã bỏ:': 'Dropped:', 'Không còn phần dư để bỏ': 'Nothing left to drop', 'Đổi dust': 'Dust', 'Unstake': 'Unstake', 'Stake': 'Stake', 'Theo lịch sử': 'Per history', 'Trong ví': 'In wallet',
  'Chênh lệch': 'Difference', '≈ Giá trị': '≈ Value', 'Lịch sử nhiều hơn ví': 'History above wallet', 'Ví nhiều hơn lịch sử': 'Wallet above history',

  // ---- futures theo năm
  'Theo năm': 'By year', 'Năm': 'Year', 'Đối chiếu với báo cáo PnL của Binance': 'Compare with Binance PnL report',

  'Kết nối': 'Connect', '↻ Cập nhật': '↻ Update', 'Ngắt kết nối': 'Disconnect', 'Đang tải…': 'Loading…',
  // ---- mục tiêu, tóm tắt tháng, mua định kỳ, lãi/lỗ theo coin
  'Hiện tab Futures': 'Show Futures tab', '(dữ liệu cũ vẫn được giữ)': '(existing data is kept)',
  'Lãi/lỗ theo coin': 'P&L by coin', 'Chi tiết': 'Details',
  'So với giá vốn của số coin đang giữ, xếp từ lời nhiều nhất đến lỗ nhiều nhất.': 'Against the cost basis of the coins you hold, from biggest gain to biggest loss.',
  'Mục tiêu tài sản': 'Net worth goal', 'vd 1 tỷ, 500tr, 50000': 'e.g. 1b, 500m, 50000', 'Đã đạt mục tiêu.': 'Goal reached.',
  'Tài sản ròng bạn muốn đạt. App hiện tiến độ và ước tính khi nào đạt dựa trên mức để dành hằng tháng.': 'The net worth you want to reach. The app shows progress and estimates when you will get there from your monthly savings.',
  'Xóa mục tiêu tài sản?': 'Delete the net worth goal?',
  'Chi tiêu': 'Spending', 'Chưa nhập thu chi': 'No budget entries', 'Kéo lên:': 'Top gainer:', 'Kéo xuống:': 'Top loser:',
  'Tháng này chưa mua': 'Not bought yet this month:', 'chưa có giá': 'no price yet', 'Mua thêm →': 'Buy more →', 'Mua thêm': 'Buy more',
  // ---- biểu đồ theo thời gian
  'Theo loại': 'By class', '1T': '1M', '3T': '3M', '6T': '6M', '1N': '1Y', 'từ đầu': 'since start', 'chưa chốt': 'unrealized', 'lãi/lỗ từ đầu': 'P&L since start',
  'Mỗi ngày lưu 1 điểm khi bạn mở app / làm mới số dư.': 'One point is saved per day when you open the app / refresh balances.',
  'Coin đang nắm theo thời gian': 'Coins held over time', 'Tổng ví crypto theo thời gian': 'Crypto wallet over time',
  'Giá trị vs vốn': 'Value vs cost', 'Tổng ví': 'Wallet total', 'Giá trị coin': 'Coin value',
  'Danh mục chứng khoán theo thời gian': 'Stock portfolio over time', 'Thêm giao dịch mua để xem biểu đồ.': 'Add a buy transaction to see the chart.',
  'Chưa đủ dữ liệu — cần ít nhất 2 ngày.': 'Not enough data yet — needs at least 2 days.',
  'Dựng lại từ lịch sử giao dịch Binance và giá đóng cửa từng ngày; không gồm stablecoin và ví futures. Khoảng cách giữa hai đường là lãi/lỗ chưa chốt.':
    'Rebuilt from your Binance trade history and daily closing prices; excludes stablecoins and the futures wallet. The gap between the two lines is unrealized P&L.',
  'Số dư thực tế của ví (gồm stablecoin), mỗi ngày lưu 1 điểm khi bạn mở app.': 'Actual wallet balance (incl. stablecoins), one point saved per day when you open the app.',
  'Số dư thực tế của ví (gồm stablecoin), mỗi ngày lưu 1 điểm khi bạn mở app. Đồng bộ lịch sử ở tab Lãi/lỗ để xem được từ ngày đầu tiên.':
    'Actual wallet balance (incl. stablecoins), one point saved per day when you open the app. Sync history in the P&L tab to see it from day one.',
  'Tính từ các giao dịch bạn nhập và giá đóng cửa từng ngày (Yahoo Finance; mã nhập tay dùng giá giao dịch gần nhất). Khoảng cách giữa hai đường là lãi/lỗ chưa chốt.':
    'Computed from your transactions and daily closing prices (Yahoo Finance; manual symbols use the latest transaction price). The gap between the two lines is unrealized P&L.',

};

// Danh mục & hũ mặc định (xuất hiện chen trong chuỗi, vd "🍜 Ăn uống", "Hũ Thiết yếu")
const TERMS = [
  ['Hóa đơn & điện thoại', 'Bills & phone'], ['Cafe & đi chơi', 'Coffee & going out'], ['Gửi tiết kiệm', 'Savings deposit'],
  ['Mua CK / quỹ', 'Buy stocks / funds'], ['Thu nhập phụ', 'Side income'], ['Gửi gia đình', 'Family support'],
  ['Nạp crypto', 'Crypto deposit'], ['Lãi đầu tư', 'Investment income'], ['Quỹ dự phòng', 'Emergency fund'],
  ['Ăn uống', 'Food'], ['Di chuyển', 'Transport'], ['Sức khỏe', 'Health'], ['Trả nợ', 'Debt payment'], ['Mua sắm', 'Shopping'],
  ['Du lịch', 'Travel'], ['Giải trí', 'Entertainment'], ['Quà tặng', 'Gifts'], ['Thu khác', 'Other income'],
  ['Thưởng', 'Bonus'], ['Lương', 'Salary'], ['Danh mục', 'Portfolio'], ['Lãi/lỗ', 'P&L'],
  ['Thiết yếu', 'Essentials'], ['Tiết kiệm', 'Savings'], ['Đầu tư', 'Investing'], ['Hưởng thụ', 'Fun'],
  ['Hũ ', 'Jar '],
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const RULES = [
  [/^Yahoo Finance không có giá cho (.+) \(thường là quỹ mở\) — đã chuyển sang nhập tay\. Nhập NAV hiện tại của quỹ\.$/, 'Yahoo Finance has no price for $1 (usually an open-ended fund) — switched to manual. Enter the fund\'s current NAV.'],
  [/^Tháng (\d\d\/\d{4})$/, 'Month $1'],
  [/^(.+) so với tháng trước$/, '$1 vs last month'],
  [/^Để dành & đầu tư (.+)$/, 'Saved & invested $1'],
  [/^của (.+)$/, 'of $1'],
  [/^Còn (.+) · nhập thu chi vài tháng để ước tính ngày đạt$/, '$1 to go · log a few months of budget to estimate a date'],
  [/^Còn (.+?)( · dự kiến đạt khoảng)?$/, (m, v, eta) => `${v} to go` + (eta ? ' · expected around' : '')],
  [/^\(~(\d+) tháng\), với mức tăng ~(.+)\/tháng (từ thu chi|theo xu hướng tài sản)$/,
    (m, n, v, from) => `(~${n} months), growing ~${v}/month ${from === 'từ thu chi' ? 'from your budget' : 'on the net worth trend'}`],
  [/^Nhập mã 6 số đang hiện trong Authenticator:$/, 'Enter the 6-digit code shown in Authenticator:'],
  [/^Trên điện thoại bấm$/, 'On your phone tap'],
  [/^— hoặc trong app bấm$/, '— or in the app tap'],
  [/^Settings → Environment Variables → thêm$/, 'Settings → Environment Variables → add'],
  [/^= khóa ở bước 1 → Save → Redeploy\.[\s\S]*$/, '= the key from step 1 → Save → Redeploy. Then sign in here again with password + 6-digit code.'],
  [/^Giữ kín khóa này [\s\S]*$/, 'Keep this key secret and store a copy somewhere safe (a password manager) — if you lose your phone, delete'],
  [/^trên Vercel để tắt 2FA\.$/, 'on Vercel to turn 2FA off.'],
  [/^Xác thực 2 bước \(TOTP\): (.+)$/, (m, v) => '2-step verification (TOTP): ' + (v === 'đang bật' ? 'on' : 'off')],
  [/^Đã đăng nhập đến (.+)$/, 'Signed in until $1'],
  [/^Mật khẩu không được lưu trên máy: [\s\S]*$/, 'The password is not stored on this device: the app exchanges it for a 30-day session. Changing APP_PASSWORD on Vercel signs out every device.'],
  [/^· cập nhật (.+)$/, '· updated $1'],
  [/^(\d[\d,.]*) lệnh · (\d+) cặp · (\d+) nạp · (\d+) rút · (\d+) DCA · (\d+) convert · (\d+) staking$/, '$1 trades · $2 pairs · $3 deposits · $4 withdrawals · $5 DCA · $6 convert · $7 staking'],
  [/^"Đồng bộ" quét [\s\S]*$/, '"Sync" scans coins you hold / deposited / withdrew / converted plus pairs with past trades. "Full scan" tries every quoted pair to also find coins you bought and fully sold (slow, a few minutes).'],
  [/^Bỏ (\S+) (\S+) khỏi lịch sử \(coi như đã rời ví từ (\S+), không tính lãi\/lỗ\)\?$/, 'Drop $1 $2 from history (treated as having left the wallet since $3, no P&L)?'],
  [/^([\d.,]+ \S+) \(từ (.+)\)$/, '$1 (since $2)'],
  [/^trong (1T|3T|6T|1N)$/, (m, r) => `in ${{ '1T': '1M', '3T': '3M', '6T': '6M', '1N': '1Y' }[r]}`],
  [/^Lũy kế tới nay:$/, 'Cumulative to date:'],
  [/^Lịch sử nhiều hơn ví (.+?)( · ví nhiều hơn lịch sử (.+))?$/, (m, a, _x, b) => `History above wallet ${a}${b ? ` · wallet above history ${b}` : ''}`],
  [/^ví nhiều hơn lịch sử (.+)$/, 'Wallet above history $1'],
  [/^\+ (.+) trong ví futures$/, '+ $1 in futures wallet'],
  [/^: coin đã rời ví qua kênh [\s\S]*$/, ': coins left the wallet through channels the app cannot read (Auto-Invest redemptions, Binance Pay, transfers to COIN-M futures / Margin, P2P sales, gifts…) — the "Value vs cost" chart still counts them, so it runs higher than reality.'],
  [/^: lãi Earn, airdrop[\s\S]*$/, ': Earn interest, airdrops, Pay receipts… (zero cost basis, normal).'],
  [/^(.+): phát hiện giờ UTC([+-]\d+), đã quy về UTC$/, '$1: detected UTC$2 times, converted to UTC'],
  [/^Chưa có phí funding [\s\S]*$/, 'No funding fees yet (liquidation fees may also be missing). Trade History files don\'t include them — also import the Transaction History file for the same years; duplicates are skipped automatically.'],
  // thời gian tương đối & đơn vị
  [/(\d+) phút trước/g, '$1 min ago'], [/(\d+) giờ trước/g, '$1 h ago'], [/(\d+) ngày trước/g, '$1 d ago'],
  [/vừa xong/g, 'just now'], [/chưa bao giờ/g, 'never'],
  [/^Tháng (\d+)\/(\d+)$/, (m, a, y) => `${MONTHS[a - 1]} ${y}`],
  [/^([\d.,]+) tháng$/, '$1 months'],
  [/^TB (\d+) tháng gần nhất$/, 'Avg of last $1 months'],
  [/^Thu (.+) · tiêu (.+)$/, 'In $1 · spent $2'],
  [/^Tiền mặt \+ stablecoin (.+)$/, 'Cash + stablecoins $1'],
  [/ · CK /, ' · Stocks '],
  [/^Tài sản (.+?)( − nợ (.+?))? · cập nhật (.+)$/, (m, a, _d, d, t) => `Assets ${a}${d ? ` − debt ${d}` : ''} · updated ${t}`],
  [/^Cập nhật (.+)$/, 'Updated $1'], [/^Giá cập nhật (.+)$/, 'Prices updated $1'],
  [/^Trả hằng tháng (.+)$/, 'Monthly payments $1'],
  [/Chốt (.+?) lúc (.+?)(\s*·|$)/, 'Set $1 at $2$3'], [/từ (\d+) khoản thu chi/, 'from $1 transactions'],
  [/%\/năm/g, '%/yr'], [/\/th$/, '/mo'],
  // sức khỏe tài chính
  [/^Tỷ lệ tiết kiệm dưới 10% — thử giảm hũ Hưởng thụ hoặc tăng thu nhập\.$/, 'Savings rate below 10% — trim the Fun jar or grow income.'],
  [/^Nên nâng tỷ lệ tiết kiệm lên ≥ 30% khi còn sống cùng gia đình\.$/, 'Aim for a savings rate ≥ 30% while living with family.'],
  [/^Quỹ dự phòng mới đủ ([\d.]+) tháng chi tiêu, mục tiêu (\d+) tháng \(tiền mặt \+ stablecoin\)\.$/, 'Emergency fund covers $1 months of spending; target is $2 months (cash + stablecoins).'],
  [/^Tiền trả nợ chiếm (\d+)% thu nhập — nên dưới 30%\.$/, 'Debt payments take $1% of income — keep it under 30%.'],
  [/^(\d+)% tài sản nằm ở crypto \(không tính stablecoin\) — cân nhắc đa dạng hóa sang quỹ chỉ số \/ tiết kiệm\.$/, '$1% of assets are in crypto (excl. stablecoins) — consider diversifying into index funds / savings.'],
  [/^(\d+) hũ tiêu dùng \(Thiết yếu \/ Hưởng thụ\) đang vượt hạn mức tháng này\.$/, '$1 spending jar(s) (Essentials / Fun) are over budget this month.'],
  // thu chi
  [/^Chia thu nhập (.+) theo tỷ lệ$/, 'Splitting income $1 by ratio'],
  [/^vượt mục tiêu (.+)$/, 'above target by $1'], [/^vượt (.+)$/, 'over by $1'], [/^còn (.+)$/, '$1 left'], [/^cần thêm (.+)$/, '$1 to go'],
  [/ · hạn mức$/, ' · limit'], [/ · mục tiêu$/, ' · target'],
  [/^(\d+) khoản$/, '$1 items'],
  [/^\(tổng (\d+)%( — cần bằng 100%)?\)$/, (m, a, b) => `(total ${a}%${b ? ' — must equal 100%' : ''})`],
  [/^Tỷ lệ các hũ$/, 'Jar ratios'],
  [/^Đã lưu khoản thu (.+)$/, 'Income saved: $1'], [/^Đã lưu khoản chi (.+)$/, 'Expense saved: $1'],
  [/^Tổng tỷ lệ đang là (\d+)%, cần bằng 100%$/, 'Ratios add up to $1%, they must equal 100%'],
  [/^(\d+) tháng$/, '$1 months'],
  [/^Số dư thực tế hiện tại của "(.+)" \((\w+)(, vd 52tr hoặc 52\.000\.000)?\)$/, (m, n, c, v) => `Actual current balance of "${n}" (${c}${v ? ', e.g. 52m or 52,000,000' : ''})`],
  [/^Dư nợ mới của "(.+)"$/, 'New balance of "$1"'],
  // crypto / pnl
  [/^Hiện coin bụi \(< (.+)\)$/, 'Show dust (< $1)'],
  [/^Spot \/ Funding \/ Earn/, 'Spot / Funding / Earn'],
  [/^Lần cuối: ([\s\S]+)$/, (m, rest) => 'Last: ' + rest
    .replace(/ lệnh/g, ' trades').replace(/ cặp/g, ' pairs').replace(/ nạp/g, ' deposits').replace(/ rút/g, ' withdrawals')
    .replace(/ bản ghi/g, ' records').replace(/ · từ /g, ' · since ')],
  [/^"Đồng bộ nhanh" quét (.|\n)*$/, (m) => {
    const q = (m.match(/quote (.+?) để/) || [])[1] || 'USDT';
    return `"Quick sync" scans coins you hold / deposited / withdrew / converted plus pairs with past trades. "Full scan" tries every pair quoted in ${q} to also find coins you bought and fully sold (slow, a few minutes — only needed the first time).`;
  }],
  [/^(.+) trên tổng vốn đã mua$/, '$1 of total amount bought'],
  [/^Phí \(coin non-stable\): (.+)$/, 'Fees (non-stable coins): $1'],
  [/^Không tìm được giá lịch sử cho:$/, 'No price history for:'],
  [/^— giao dịch liên quan được định giá 0, PnL các coin này có thể sai\.$/, '— related trades are valued at 0, P&L for these coins may be off.'],
  [/^Sổ sách: (.+)$/, 'Ledger: $1'],
  [/^Hiển thị 300 \/ (\d+) sự kiện gần nhất\.$/, 'Showing 300 / $1 latest events.'],
  [/^Phương pháp: (.|\n)*$/, 'Method: weighted average cost, converted to USD at the trade-day price. Fees paid in BNB are added to the traded coin\'s cost. Deposits use the market price at deposit time as cost; withdrawals realize no P&L. Coins from Earn/airdrops have zero cost.'],
  [/^Quét giao dịch (\d+)\/(\d+) cặp \((\d+) lệnh mới\)$/, 'Scanning trades $1/$2 pairs ($3 new)'],
  [/^Tải giá lịch sử (\d+)\/(\d+) tài sản$/, 'Loading price history $1/$2 assets'],
  [/^Nạp: (\d+) bản ghi$/, 'Deposits: $1 records'], [/^Rút: (\d+) bản ghi$/, 'Withdrawals: $1 records'],
  [/^Đổi dust sang BNB: (\d+) bản ghi$/, 'Dust to BNB: $1 records'],
  [/^Auto-Invest \(DCA\): (\d+) lần mua mới$/, 'Auto-Invest (DCA): $1 new purchases'],
  [/^Convert: đã quét tới (.+)$/, 'Convert: scanned up to $1'],
  [/^Mua bằng fiat: (\d+) bản ghi mới$/, 'Fiat purchases: $1 new records'],
  [/^(\w+) (stake|unstake): (\d+) bản ghi mới$/, '$1 $2: $3 new records'],
  [/: bỏ qua \((.+)\)$/, ': skipped ($1)'], [/: (\d+) bản ghi mới…$/, ': $1 new records…'],
  [/^Xong: (\d+) lệnh mới$/, 'Done: $1 new trades'], [/^Đồng bộ xong — (\d+) lệnh mới$/, 'Sync complete — $1 new trades'],
  [/^Lỗi: (.+)$/, 'Error: $1'],
  // futures
  [/^API Binance chỉ trả [\s\S]*$/, 'The Binance API only returns recent futures history (~3 months). For all-time P&L, export a CSV from Binance and tap "Import CSV":'],
  [/^Từ (.+?)( · tính cả vị thế mở: (.+))?$/, (m, d, _x, v) => `Since ${d}${v ? ` · incl. open positions: ${v}` : ''}`],
  [/^Hoàn phí (.+)$/, 'Rebates $1'], [/^(\d+) vị thế$/, '$1 positions'],
  [/^(\d+) lãi$/, '$1 winning'], [/^(\d+) lỗ$/, '$1 losing'],
  [/^Không có giá lịch sử cho:$/, 'No price history for:'], [/^\(được tính 0\)\.$/, '(counted as 0).'],
  [/^Tổng = lãi\/lỗ (.|\n)*$/, 'Total = realized P&L + fees + funding + liquidations + rebates, converted to USD at the day\'s price. Includes USDⓈ-M and COIN-M. Transfers in/out of the futures wallet are not counted.'],
  [/^Futures: (\d+) bản ghi mới$/, 'Futures: $1 new records'],
  [/^Đã nhập (\d+) bản ghi futures mới \((\d+) trùng \/ đã có\)$/, 'Imported $1 new futures records ($2 duplicates)'],
  // chứng khoán
  [/^Sửa mã (.+)$/, 'Edit $1'],
  [/^Lãi\/lỗ (1T|3T|6T|1N|từ đầu):$/, (m, r) => `P&L ${{ '1T': '1M', '3T': '3M', '6T': '6M', '1N': '1Y', 'từ đầu': 'since start' }[r]}:`],
  [/^= chưa chốt (.+) · đã chốt (.+)$/, '= unrealized $1 · realized $2'],
  [/^lãi\/lỗ (1T|3T|6T|1N)$/, (m, r) => `P&L ${{ '1T': '1M', '3T': '3M', '6T': '6M', '1N': '1Y' }[r]}`],
  [/^Đã kết nối đến (.+)$/, 'Connected until $1'],
  [/^Mã Yahoo: [\s\S]*$/, 'Yahoo symbols: US stocks/ETFs as-is (VOO, VTI, QQQ); for Vietnam exchanges add'],
  [/^Xóa (.+) và toàn bộ giao dịch của mã này\?$/, 'Delete $1 and all its transactions?'],
  [/^Không lấy được giá: (.+)$/, 'Could not fetch prices: $1'], [/^Lỗi lấy giá: (.+)$/, 'Price error: $1'],
  // cài đặt
  [/^Lưu riêng trên thiết bị này\. Trên điện thoại, (\d+) tab đầu nằm ở thanh dưới(, còn lại trong "Thêm")?\.$/, (m, n, r) => `Saved on this device only. On phones, the first ${n} tabs are in the bottom bar${r ? ', the rest under "More"' : ''}.`],
  [/^APP_PASSWORD trên server: (.+)$/, (m, v) => 'APP_PASSWORD on server: ' + ({ 'đã cấu hình': 'configured', 'CHƯA cấu hình': 'NOT configured' }[v] || 'cannot reach /api (running locally without vercel dev?)')],
  [/^Mật khẩu trên thiết bị này: (.+)$/, (m, v) => 'Password on this device: ' + (v === 'đúng' ? 'correct' : 'wrong / not entered')],
  [/^Binance API key: (.+)$/, (m, v) => 'Binance API key: ' + ({ 'đã cấu hình': 'configured', 'CHƯA cấu hình': 'NOT configured' }[v] || v)],
  [/^Key Binance chỉ nằm [\s\S]*$/, 'Binance keys live only in Vercel Environment Variables; the browser never sees them. Create an API key with'],
  [/^Trạng thái: đã kết nối$/, 'Status: connected to'],
  [/^Trạng thái: chưa kết nối\.\s+File:$/, 'Status: not connected. File:'],
  [/^· lần sync cuối (.+?)\.\s+File:$/, '· last sync $1. File:'],
  [/^\(đã có từ env (\w+)\)$/, '(provided by env $1)'],
  [/^Cấu hình$/, 'Set'],
  [/^trên Vercel,\s+nhập mật khẩu ứng dụng trong tab Cài đặt rồi bấm làm mới\.$/, 'in Vercel, enter the app password in Settings, then refresh.'],
  [/^\(vd E1VFVN30\.VN\)\.\s+Quỹ mở [\s\S]*$/, '(e.g. E1VFVN30.VN). Open-end funds (VESAF, DCDS, VFMVSF…): choose "Manual" and update the NAV periodically.'],
  [/^\), chọn định dạng CSV[\s\S]*$/, '), choose CSV, up to 1 year per file — import one year at a time. Duplicates between CSV and API are skipped automatically. Trade History files also work — they include P&L and fees, but not funding.'],
  [/^\(trống = tự động, hiện (.+)\)$/, '(empty = automatic, currently $1)'],
  [/^Tỷ giá USD\/VND cố định$/, 'Fixed USD/VND rate'],
  [/^Xuất \/ nhập toàn bộ dữ liệu (.|\n)*$/, 'Export / import all data (portfolio, Binance history, stock transactions, settings) as JSON. Passwords and tokens are not included.'],
  // lỗi
  [/^Không nhận ra cột thời gian \/ số tiền trong file CSV$/, 'Could not find time / amount columns in the CSV file'],
];

const TERMS_RE = TERMS.map(([vi, en]) => [new RegExp(vi.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'g'), en]);

/** Dịch 1 chuỗi (giữ nguyên khoảng trắng đầu/cuối). */
export function tr(s) {
  if (lang === 'vi' || s == null) return s;
  const str = String(s);
  const core = str.trim();
  if (!core) return str;
  let out = EXACT[core];
  if (out == null) {
    if (/ · CK /.test(core)) return str.replace(' · CK ', ' · Stocks ');
    if (!/[À-ỹ]/i.test(core)) return str; // không có dấu tiếng Việt → giữ nguyên
    out = core;
    for (const [re, rep] of RULES) {
      if (re.test(out)) {
        re.lastIndex = 0;
        out = out.replace(re, rep);
      }
      re.lastIndex = 0;
    }
    for (const [re, en] of TERMS_RE) out = out.replace(re, en);
  }
  return str.replace(core, out);
}

const ATTRS = ['placeholder', 'title', 'aria-label', 'label'];

/** Dịch toàn bộ chữ trong 1 vùng DOM. */
export function translateDom(root) {
  if (lang === 'vi' || !root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    if (n.parentElement?.closest('script,style,code')) continue;
    const v = tr(n.nodeValue);
    if (v !== n.nodeValue) n.nodeValue = v;
  }
  for (const el of [root, ...root.querySelectorAll('[placeholder],[title],[aria-label],optgroup[label]')]) {
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v) {
        const t = tr(v);
        if (t !== v) el.setAttribute(a, t);
      }
    }
  }
}

// confirm / prompt dùng chuỗi tiếng Việt trong code → dịch khi hiển thị
if (typeof window !== 'undefined' && window.confirm) {
  const nativeConfirm = window.confirm.bind(window);
  const nativePrompt = window.prompt.bind(window);
  window.confirm = (m) => nativeConfirm(tr(m));
  window.prompt = (m, d) => nativePrompt(tr(m), d);
  document.documentElement.lang = lang;
}
