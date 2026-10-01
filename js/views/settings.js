import { state, local, saveLocal, commit, replaceState, login, logout } from '../store.js';
import * as sync from '../sync.js';
import { esc, toast, downloadFile, timeAgo, todayKey, fmtDate } from '../util.js';
import { fxRate } from '../calc.js';
import { tabOrder, setTabOrder, resetTabOrder, BOTTOM_MAX } from '../nav.js';
import { icon } from '../icons.js';

export function renderSettings(root, ctx) {
  const s = state.settings;
  const cfg = ctx.serverConfig();
  const prov = sync.providerName();

  const order = tabOrder();
  const PALETTES = [['bronze', 'Đồng'], ['solana', 'Solana'], ['okx', 'OKX'], ['glass', 'Trong suốt']];
  const MODES = [['auto', 'Tự động'], ['light', 'Sáng'], ['dark', 'Tối']];
  root.innerHTML = `
    <div class="card">
      <h3>Giao diện</h3>
      <h4>Màu sắc</h4>
      <div class="theme-grid">
        ${PALETTES.map(([id, label]) => `
          <button type="button" class="theme-opt ${ctx.palette() === id ? 'on' : ''}" data-palette="${id}">
            <span class="sw sw-${id}"><i></i></span><b>${label}</b>
          </button>`).join('')}
      </div>
      <div class="grid2 mt">
        <div>
          <h4>Chế độ</h4>
          <div class="seg">${MODES.map(([id, label]) => `<button type="button" data-mode="${id}" class="${ctx.mode() === id ? 'on' : ''}">${label}</button>`).join('')}</div>
        </div>
        <div>
          <h4>Ngôn ngữ</h4>
          <div class="seg">
            <button type="button" data-lang="vi" class="${ctx.lang() === 'vi' ? 'on' : ''}">Tiếng Việt</button>
            <button type="button" data-lang="en" class="${ctx.lang() === 'en' ? 'on' : ''}">English</button>
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h3>Thứ tự tab</h3><button class="link" id="tab-reset">Mặc định</button></div>
      <p class="muted small">Lưu riêng trên thiết bị này. Trên điện thoại, ${BOTTOM_MAX} tab đầu nằm ở thanh dưới${order.length > BOTTOM_MAX ? ', còn lại trong "Thêm"' : ''}.</p>
      <div class="order-list">
        ${order.map((n, i) => `
          <div class="order-item">
            <span class="ico">${icon(n.icon)}</span>
            <span class="grow"><b>${esc(n.label)}</b>${n.subs ? `<span class="muted small"> · ${n.subs.map((x) => esc(x.label)).join(', ')}</span>` : ''}</span>
            <button class="icon-btn" data-move="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} aria-label="Lên">↑</button>
            <button class="icon-btn" data-move="${i}" data-dir="1" ${i === order.length - 1 ? 'disabled' : ''} aria-label="Xuống">↓</button>
          </div>`).join('')}
      </div>
    </div>
    <div class="grid2">
      <div class="card">
        <h3>Kết nối server (Vercel)</h3>
        ${local.session && local.session.exp > Date.now() ? `
        <div class="row gap"><span class="tag ok">Đã đăng nhập đến ${fmtDate(local.session.exp)}</span>
          <button class="btn" id="pw-logout">Đăng xuất thiết bị này</button></div>` : `
        <form id="pw-form" class="form-grid one">
          <label>Mật khẩu ứng dụng (APP_PASSWORD)
            <input name="pw" type="password" autocomplete="current-password" placeholder="Giá trị bạn đặt trong env của Vercel"></label>
          <div class="form-actions"><button class="btn primary">Đăng nhập</button></div>
        </form>`}
        <p class="muted small">Mật khẩu không được lưu trên máy: app đổi nó lấy một phiên đăng nhập 30 ngày.
          Đổi APP_PASSWORD trên Vercel sẽ đăng xuất mọi thiết bị.</p>
        <ul class="status-list">
          <li class="${cfg.passwordConfigured ? 'ok' : 'bad'}">APP_PASSWORD trên server: ${cfg.passwordConfigured ? 'đã cấu hình' : cfg.offline ? 'không kết nối được /api (chạy local không có vercel dev?)' : 'CHƯA cấu hình'}</li>
          <li class="${cfg.authOk ? 'ok' : 'bad'}">Mật khẩu trên thiết bị này: ${cfg.authOk ? 'đúng' : 'chưa đúng / chưa nhập'}</li>
          <li class="${cfg.binanceConfigured ? 'ok' : 'bad'}">Binance API key: ${cfg.binanceConfigured ? 'đã cấu hình' : cfg.authOk ? 'CHƯA cấu hình' : '—'}</li>
          ${cfg.tcbsConfigured ? '<li class="ok">TCBS API key: đã cấu hình</li>' : ''}
        </ul>
        <p class="muted small">Key Binance chỉ nằm trong Environment Variables của Vercel, trình duyệt không bao giờ thấy.
          Hãy tạo API key <b>chỉ bật quyền Read</b> (Enable Reading).</p>
      </div>

      <div class="card">
        <h3>Đồng bộ đám mây (JSON)</h3>
        <p class="muted small">Trạng thái: ${prov ? `đã kết nối <b>${prov}</b> · lần sync cuối ${timeAgo(local.lastSync)}` : 'chưa kết nối'}.
          File: <code>finance-portfolio.json</code>. Khi đồng bộ, lịch sử giao dịch của các máy được gộp lại (không mất bản ghi); dữ liệu tự nhập lấy theo lần sửa gần nhất.</p>
        <form id="oauth-form" class="form-grid one">
          <label>Dropbox App Key ${cfg.dropboxAppKey ? '<small class="muted">(đã có từ env DROPBOX_APP_KEY)</small>' : ''}
            <input name="dropboxAppKey" value="${esc(local.dropboxAppKey || '')}" placeholder="${esc(cfg.dropboxAppKey || 'xxxxxxxxxxxx')}"></label>
          <label>Google OAuth Client ID ${cfg.googleClientId ? '<small class="muted">(đã có từ env GOOGLE_CLIENT_ID)</small>' : ''}
            <input name="googleClientId" value="${esc(local.googleClientId || '')}" placeholder="${esc(cfg.googleClientId || '…apps.googleusercontent.com')}"></label>
        </form>
        <div class="row gap wrap">
          <button class="btn" id="sy-dropbox">Kết nối Dropbox</button>
          <button class="btn" id="sy-google">Kết nối Google Drive</button>
          ${prov ? '<button class="btn danger" id="sy-disconnect">Ngắt kết nối</button>' : ''}
        </div>
        ${prov ? `<div class="row gap wrap mt">
          <button class="btn primary" id="sy-smart">Đồng bộ ngay</button>
          <button class="btn" id="sy-push">↑ Ghi đè lên cloud</button>
          <button class="btn" id="sy-pull">↓ Tải từ cloud (ghi đè máy này)</button>
        </div>
        <label class="check mt"><input type="checkbox" id="sy-auto" ${local.autoSync !== false ? 'checked' : ''}> Tự động đồng bộ khi mở app và sau mỗi thay đổi</label>` : ''}
        <p class="muted small">Redirect URI cần khai báo: <code>${esc(location.origin + location.pathname)}</code> (Dropbox) ·
          Authorized JavaScript origin: <code>${esc(location.origin)}</code> (Google).</p>
      </div>
    </div>

    <div class="grid2">
      <div class="card">
        <h3>Hiển thị & tính toán</h3>
        <form id="st-form" class="form-grid">
          <label>Tiền tệ hiển thị<select name="displayCurrency">${['USD', 'VND'].map((c) => `<option ${s.displayCurrency === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>Ẩn coin bụi dưới (USD)<input name="dustUsd" type="number" step="any" value="${esc(s.dustUsd)}"></label>
          <label>Tỷ giá USD/VND cố định <small class="muted">(trống = tự động, hiện ${Math.round(fxRate()).toLocaleString('vi-VN')})</small>
            <input name="fxManual" type="number" step="any" value="${esc(s.fxManual ?? '')}"></label>
          <label>Lịch sử Binance bắt đầu từ<input name="historyStart" type="date" value="${esc(s.historyStart)}"></label>
          <label class="span2">Quote dùng để quét lệnh (phẩy ngăn cách)<input name="scanQuotes" value="${esc(s.scanQuotes.join(', '))}"></label>
          <label class="span2">Coin bổ sung cần quét (đã từng giao dịch nhưng không còn giữ / chưa từng nạp)<input name="extraAssets" value="${esc(s.extraAssets.join(', '))}" placeholder="LUNA, FTT, SHIB"></label>
          <label class="check span2"><input type="checkbox" name="includeConvert" ${s.includeConvert ? 'checked' : ''}> Bao gồm lịch sử Binance Convert (quét chậm hơn ~1s / 30 ngày)</label>
          <div class="form-actions"><button class="btn primary">Lưu</button></div>
        </form>
      </div>

      <div class="card">
        <h3>Sao lưu thủ công</h3>
        <p class="muted small">Xuất / nhập toàn bộ dữ liệu (danh mục, lịch sử Binance, giao dịch chứng khoán, cài đặt) dưới dạng JSON.
          Không chứa mật khẩu hay token.</p>
        <div class="row gap wrap">
          <button class="btn" id="bk-export">Xuất JSON</button>
          <label class="btn">Nhập JSON<input type="file" id="bk-import" accept="application/json,.json" hidden></label>
          <button class="btn danger" id="bk-clear-history">Xóa lịch sử Binance</button>
          <button class="btn danger" id="bk-reset">Xóa toàn bộ dữ liệu</button>
        </div>
      </div>
    </div>`;

  root.querySelectorAll('[data-move]').forEach((b) => {
    b.onclick = () => {
      const ids = order.map((n) => n.id);
      const i = Number(b.dataset.move);
      const j = i + Number(b.dataset.dir);
      [ids[i], ids[j]] = [ids[j], ids[i]];
      setTabOrder(ids);
      ctx.rebuildNav();
    };
  });
  root.querySelector('#tab-reset').onclick = () => { resetTabOrder(); ctx.rebuildNav(); };
  root.querySelectorAll('[data-palette]').forEach((b) => { b.onclick = () => ctx.setPalette(b.dataset.palette); });
  root.querySelectorAll('[data-mode]').forEach((b) => { b.onclick = () => ctx.setMode(b.dataset.mode); });
  root.querySelectorAll('[data-lang]').forEach((b) => { b.onclick = () => ctx.setLang(b.dataset.lang); });

  const pwForm = root.querySelector('#pw-form');
  if (pwForm) pwForm.onsubmit = async (e) => {
    e.preventDefault();
    const ok = await login(new FormData(e.target).get('pw')).catch(() => false);
    await ctx.loadServerConfig();
    toast(ok ? 'Mật khẩu đúng' : 'Mật khẩu sai hoặc server chưa cấu hình', ok ? 'ok' : 'error');
    ctx.rerender();
  };
  root.querySelector('#pw-logout')?.addEventListener('click', async () => {
    logout();
    await ctx.loadServerConfig();
    ctx.rerender();
  });

  const saveOauth = () => {
    const f = new FormData(root.querySelector('#oauth-form'));
    local.dropboxAppKey = f.get('dropboxAppKey').trim();
    local.googleClientId = f.get('googleClientId').trim();
    saveLocal();
  };
  const run = (fn, ok) => async () => {
    try {
      const r = await fn();
      if (ok) toast(typeof ok === 'function' ? ok(r) : ok, 'ok');
    } catch (err) {
      toast(err.message, 'error', 7000);
    }
    ctx.rerender();
  };
  const bind = (id, fn) => { const el = root.querySelector(id); if (el) el.onclick = fn; };

  bind('#sy-dropbox', run(async () => { saveOauth(); await sync.dropboxLogin(); }));
  bind('#sy-google', run(async () => { saveOauth(); await sync.googleLogin(true); await ctx.smartSync(); }, 'Đã kết nối Google Drive'));
  bind('#sy-disconnect', run(async () => sync.disconnect(), 'Đã ngắt kết nối'));
  bind('#sy-smart', run(() => ctx.smartSync(), (r) => ({ pulled: 'Đã nhận dữ liệu từ cloud', pushed: 'Đã tải lên cloud', merged: 'Đã gộp dữ liệu 2 bên', same: 'Đã đồng bộ' }[r] || 'OK')));
  bind('#sy-push', run(() => sync.push(), 'Đã ghi đè lên cloud'));
  bind('#sy-pull', run(async () => {
    if (!confirm('Dữ liệu trên máy này sẽ bị thay bằng dữ liệu trên cloud. Tiếp tục?')) return;
    if (!(await sync.pull())) throw new Error('Chưa có file trên cloud');
    ctx.afterStateReplaced();
  }, 'Đã tải từ cloud'));
  const auto = root.querySelector('#sy-auto');
  if (auto) auto.onchange = () => { local.autoSync = auto.checked; saveLocal(); };

  root.querySelector('#st-form').onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const list = (k) => String(f.get(k) || '').split(',').map((x) => x.trim().toUpperCase()).filter(Boolean);
    Object.assign(s, {
      displayCurrency: f.get('displayCurrency'),
      dustUsd: Number(f.get('dustUsd')) || 0,
      fxManual: f.get('fxManual') ? Number(f.get('fxManual')) : null,
      historyStart: f.get('historyStart') || '2018-01-01',
      scanQuotes: list('scanQuotes'),
      extraAssets: list('extraAssets'),
      includeConvert: f.get('includeConvert') === 'on',
    });
    commit({ edit: true });
    ctx.invalidatePnl();
    toast('Đã lưu cài đặt', 'ok');
    ctx.rerender();
  };

  root.querySelector('#bk-export').onclick = () => {
    downloadFile(`finance-portfolio-${todayKey()}.json`, JSON.stringify({ app: 'finance-dashboard', exportedAt: Date.now(), state }));
  };
  root.querySelector('#bk-import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      replaceState(sync.parsePayload(await file.text()));
      commit({ edit: true });
      ctx.afterStateReplaced();
      toast('Đã nhập dữ liệu', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    }
  };
  root.querySelector('#bk-clear-history').onclick = () => {
    if (!confirm('Xóa toàn bộ lịch sử giao dịch Binance đã tải? (Có thể đồng bộ lại)')) return;
    state.history = { trades: {}, meta: {}, checked: {}, deposits: [], withdrawals: [], dust: [], converts: [], cursors: {}, updatedAt: 0 };
    commit();
    ctx.afterStateReplaced();
  };
  root.querySelector('#bk-reset').onclick = () => {
    if (!confirm('Xóa TOÀN BỘ dữ liệu trên máy này? Nếu đang bật tự động đồng bộ, file trên cloud cũng sẽ bị ghi đè. Hãy xuất JSON trước nếu cần.')) return;
    replaceState({});
    commit({ edit: true });
    ctx.afterStateReplaced();
  };
}
