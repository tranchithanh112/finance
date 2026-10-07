import { translateDom } from './i18n.js';
import { esc } from './util.js';

// Bảng trượt từ dưới lên (điện thoại) / hộp giữa màn hình (máy tính), dựa trên <dialog> gốc:
// showModal() có sẵn khóa focus, phím Esc và nền mờ. Gắn vào <body> — ngoài <main> — để các lần
// vẽ lại tab do đồng bộ / làm mới giá chạy nền không xóa form đang nhập dở.

let current = null;

/** openSheet({ title, body, onMount }) → { el, close }. body là HTML; onMount(el, close) để gắn sự kiện. */
export function openSheet({ title, body, onMount }) {
  current?.close();
  const back = document.activeElement;
  const dlg = document.createElement('dialog');
  dlg.className = 'sheet-dlg';
  dlg.setAttribute('aria-labelledby', 'sheet-title');
  dlg.innerHTML = `
    <div class="sheet-inner">
      <div class="sheet-head">
        <h3 id="sheet-title">${esc(title)}</h3>
        <button type="button" class="icon-btn sheet-x" aria-label="Đóng">✕</button>
      </div>
      ${body}
    </div>
    <div class="sheet-toasts" aria-live="polite"></div>`;
  document.body.appendChild(dlg);
  // iOS: bàn phím ảo không thu nhỏ layout viewport → bảng neo đáy bị đẩy khuất phần trên (ô số tiền).
  // Bám theo visualViewport: chiều cao bảng = vùng còn thấy, đáy bảng = mép trên bàn phím.
  const vv = window.visualViewport;
  const fit = () => {
    dlg.style.setProperty('--vvh', `${vv.height}px`);
    dlg.style.setProperty('--kb', `${Math.max(0, window.innerHeight - vv.offsetTop - vv.height)}px`);
    if (dlg.contains(document.activeElement)) document.activeElement.scrollIntoView({ block: 'nearest' });
  };
  vv?.addEventListener('resize', fit);
  vv?.addEventListener('scroll', fit);
  let gone = false;
  const cleanup = () => {
    if (gone) return;
    gone = true;
    vv?.removeEventListener('resize', fit);
    vv?.removeEventListener('scroll', fit);
    dlg.remove(); // gỡ ngay — sự kiện 'close' đến sau (bất đồng bộ), form cũ không được nằm lại trong trang
    if (current?.el === dlg) current = null;
    back?.focus?.({ preventScroll: true });
  };
  const close = () => { if (dlg.open) dlg.close(); cleanup(); };
  dlg.addEventListener('close', cleanup); // đóng bằng phím Esc
  // .sheet-inner phủ kín hộp thoại → click trúng chính <dialog> nghĩa là bấm vào nền mờ.
  // Phải nhấn xuống cũng ở nền: kéo chọn chữ trong ô nhập rồi thả ra ngoài không được đóng bảng.
  let downOnBackdrop = false;
  dlg.addEventListener('pointerdown', (e) => { downOnBackdrop = e.target === dlg; });
  dlg.addEventListener('click', (e) => { if (e.target === dlg && downOnBackdrop) close(); });
  dlg.querySelector('.sheet-x').onclick = close;
  translateDom(dlg);
  dlg.showModal();
  current = { el: dlg, close };
  onMount?.(dlg, close);
  return current;
}
