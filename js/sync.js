import { state, local, saveLocal, replaceState, cleanupState } from './store.js';
import { mergeStates } from './merge.js';

// Đồng bộ toàn bộ dữ liệu dưới dạng 1 file JSON lên Dropbox hoặc Google Drive.
// Chỉ dùng OAuth phía trình duyệt (PKCE / Google Identity Services), không cần server.

const FILE_NAME = 'finance-portfolio.json';
export const publicConfig = { dropboxAppKey: '', googleClientId: '' };

const redirectUri = () => location.origin + location.pathname;
const dropboxKey = () => local.dropboxAppKey || publicConfig.dropboxAppKey;
const googleId = () => local.googleClientId || publicConfig.googleClientId;

function payload() {
  return JSON.stringify({ app: 'finance-dashboard', exportedAt: Date.now(), state });
}
export function parsePayload(text) {
  const obj = JSON.parse(text);
  if (obj?.app === 'finance-dashboard' && obj.state) return obj.state;
  if (obj?.version && obj.settings) return obj;
  throw new Error('File JSON không đúng định dạng');
}

// ================= Dropbox (OAuth PKCE) =================

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function dropboxLogin() {
  const key = dropboxKey();
  if (!key) throw new Error('Chưa có Dropbox App Key');
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  sessionStorage.setItem('dbx_verifier', verifier);
  const q = new URLSearchParams({
    client_id: key, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256',
    token_access_type: 'offline', redirect_uri: redirectUri(), state: 'dropbox',
  });
  location.href = `https://www.dropbox.com/oauth2/authorize?${q}`;
}

/** Xử lý khi Dropbox redirect về với ?code=… */
export async function handleOAuthCallback() {
  const p = new URLSearchParams(location.search);
  if (p.get('state') !== 'dropbox' || !p.get('code')) return false;
  history.replaceState(null, '', location.pathname + location.hash);
  const verifier = sessionStorage.getItem('dbx_verifier');
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      code: p.get('code'), grant_type: 'authorization_code', client_id: dropboxKey(),
      code_verifier: verifier, redirect_uri: redirectUri(),
    }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error(t.error_description || 'Dropbox đăng nhập thất bại');
  local.dropbox = { access: t.access_token, refresh: t.refresh_token, exp: Date.now() + t.expires_in * 1000 };
  local.syncProvider = 'dropbox';
  saveLocal();
  return true;
}

async function dropboxToken() {
  const d = local.dropbox;
  if (!d?.refresh) throw new Error('Chưa kết nối Dropbox');
  if (d.access && d.exp > Date.now() + 60000) return d.access;
  const r = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: d.refresh, client_id: dropboxKey() }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error(t.error_description || 'Không làm mới được token Dropbox');
  d.access = t.access_token;
  d.exp = Date.now() + t.expires_in * 1000;
  saveLocal();
  return d.access;
}

const dropbox = {
  async upload(text) {
    const r = await fetch('https://content.dropboxapi.com/2/files/upload', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await dropboxToken()}`,
        'Dropbox-API-Arg': JSON.stringify({ path: '/' + FILE_NAME, mode: 'overwrite', mute: true }),
        'Content-Type': 'application/octet-stream',
      },
      body: text,
    });
    if (!r.ok) throw new Error(`Dropbox upload lỗi ${r.status}`);
  },
  async download() {
    const r = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await dropboxToken()}`,
        'Dropbox-API-Arg': JSON.stringify({ path: '/' + FILE_NAME }),
      },
    });
    if (r.status === 409) return null; // chưa có file
    if (!r.ok) throw new Error(`Dropbox download lỗi ${r.status}`);
    return r.text();
  },
};

// ================= Google Drive (GIS token client) =================

let gisLoaded;
function loadGis() {
  gisLoaded ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Không tải được Google Identity Services'));
    document.head.appendChild(s);
  });
  return gisLoaded;
}

function gSession() {
  try { return JSON.parse(sessionStorage.getItem('g_token') || 'null'); } catch { return null; }
}

export async function googleLogin(interactive = true) {
  const id = googleId();
  if (!id) throw new Error('Chưa có Google Client ID');
  await loadGis();
  await new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        sessionStorage.setItem('g_token', JSON.stringify({ token: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 }));
        resolve();
      },
      error_callback: (e) => reject(new Error(e?.message || e?.type || 'Google đăng nhập thất bại')),
    });
    client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
  });
  local.syncProvider = 'google';
  local.googleConnected = true;
  saveLocal();
}

async function gToken() {
  const s = gSession();
  if (s && s.exp > Date.now()) return s.token;
  await googleLogin(false); // có thể mở popup ngắn nếu hết hạn
  return gSession().token;
}

async function gFetch(url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${await gToken()}` } });
  if (!r.ok) throw new Error(`Google Drive lỗi ${r.status}`);
  return r;
}

async function gFindId() {
  if (local.googleFileId) return local.googleFileId;
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const r = await gFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`);
  const id = (await r.json()).files?.[0]?.id || null;
  if (id) { local.googleFileId = id; saveLocal(); }
  return id;
}

const google = {
  async upload(text) {
    const id = await gFindId();
    if (id) {
      await gFetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text,
      }).catch((e) => { local.googleFileId = null; saveLocal(); throw e; });
      return;
    }
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' })], { type: 'application/json' }));
    form.append('file', new Blob([text], { type: 'application/json' }));
    const r = await gFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form });
    local.googleFileId = (await r.json()).id;
    saveLocal();
  },
  async download() {
    const id = await gFindId();
    if (!id) return null;
    return (await gFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)).text();
  },
};

// ================= API chung =================

function provider() {
  if (local.syncProvider === 'dropbox' && local.dropbox?.refresh) return dropbox;
  if (local.syncProvider === 'google' && local.googleConnected) return google;
  return null;
}
export const syncEnabled = () => Boolean(provider());
export const providerName = () => (local.syncProvider === 'dropbox' ? 'Dropbox' : local.syncProvider === 'google' ? 'Google Drive' : '');

export function disconnect() {
  delete local.dropbox;
  delete local.googleConnected;
  delete local.googleFileId;
  delete local.syncProvider;
  sessionStorage.removeItem('g_token');
  saveLocal();
}

export async function push() {
  const p = provider();
  if (!p) throw new Error('Chưa kết nối Dropbox / Google Drive');
  await p.upload(payload());
  local.lastSync = Date.now();
  saveLocal();
}

export async function pull() {
  const p = provider();
  if (!p) throw new Error('Chưa kết nối Dropbox / Google Drive');
  const text = await p.download();
  if (!text) return false;
  replaceState(parsePayload(text));
  local.lastSync = Date.now();
  saveLocal();
  return true;
}

/**
 * Tải bản trên cloud, GỘP với máy này (không mất lịch sử của bên nào), rồi ghi lại nếu cần.
 * Trả về 'pulled' (máy này nhận thêm dữ liệu) | 'pushed' | 'merged' (cả hai) | 'same'.
 */
let syncing = Promise.resolve();
export function smartSync() {
  // Xếp hàng: không cho 2 lần đồng bộ chạy chồng lên nhau
  const run = syncing.then(doSmartSync, doSmartSync);
  syncing = run.catch(() => {});
  return run;
}

async function doSmartSync() {
  const p = provider();
  if (!p) return null;
  const text = await p.download();
  if (!text) {
    await push();
    return 'pushed';
  }
  const remote = cleanupState(parsePayload(text));
  const merged = mergeStates(JSON.parse(JSON.stringify(state)), remote);
  const mergedText = JSON.stringify(merged);
  const localChanged = mergedText !== JSON.stringify(state);
  const remoteChanged = mergedText !== JSON.stringify(remote);
  if (localChanged) replaceState(merged);
  if (remoteChanged) await p.upload(JSON.stringify({ app: 'finance-dashboard', exportedAt: Date.now(), state: merged }));
  local.lastSync = Date.now();
  saveLocal();
  if (localChanged && remoteChanged) return 'merged';
  return localChanged ? 'pulled' : remoteChanged ? 'pushed' : 'same';
}
