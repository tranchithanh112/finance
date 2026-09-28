// IndexedDB key-value nhỏ gọn (lịch sử giao dịch có thể vượt giới hạn 5MB của localStorage).
const DB = 'finance-dashboard';
const STORE = 'kv';
let dbp;

function db() {
  dbp ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

export async function idbGet(key) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const q = d.transaction(STORE).objectStore(STORE).get(key);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}

export async function idbSet(key, value) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
