// Persistencia local de procedimientos concursales.
// Sigue el patrón de adapter local del repositorio "legal": IndexedDB primero,
// con fallback a localStorage para no bloquear la aplicación.
const DB_NAME = 'concursal-local';
const DB_VERSION = 1;
const STORE = 'procedimientos';
const FALLBACK_KEY = 'concursal.procedimientos.v1';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('INDEXEDDB_UNAVAILABLE'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' });
        store.createIndex('updatedAt', 'updatedAt');
        store.createIndex('sourceHash', 'source.hash');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('INDEXEDDB_OPEN_ERROR'));
  });
}

async function withStore(mode, action) {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = action(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('INDEXEDDB_REQUEST_ERROR'));
      tx.onerror = () => reject(tx.error || new Error('INDEXEDDB_TX_ERROR'));
    });
  } finally {
    db.close();
  }
}

function fallbackRead() {
  try {
    const raw = localStorage.getItem(FALLBACK_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function fallbackWrite(rows) {
  localStorage.setItem(FALLBACK_KEY, JSON.stringify(rows));
}
function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export async function listProcedimientos() {
  try {
    const rows = await withStore('readonly', (store) => store.getAll());
    return (rows || []).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).map(clone);
  } catch {
    return fallbackRead().sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).map(clone);
  }
}

export async function getProcedimiento(id) {
  try {
    const row = await withStore('readonly', (store) => store.get(id));
    return row ? clone(row) : null;
  } catch {
    return clone(fallbackRead().find((row) => row.id === id) || null);
  }
}

export async function putProcedimiento(record) {
  const row = clone(record);
  try {
    await withStore('readwrite', (store) => store.put(row));
  } catch {
    const rows = fallbackRead();
    const i = rows.findIndex((item) => item.id === row.id);
    if (i >= 0) rows[i] = row; else rows.push(row);
    fallbackWrite(rows);
  }
  return clone(row);
}

export async function deleteProcedimiento(id) {
  try {
    await withStore('readwrite', (store) => store.delete(id));
  } catch {
    fallbackWrite(fallbackRead().filter((row) => row.id !== id));
  }
}

export async function findBySourceHash(hash) {
  if (!hash) return null;
  const rows = await listProcedimientos();
  return rows.find((row) => row.source?.hash === hash) || null;
}

export async function clearProcedimientos() {
  try {
    await withStore('readwrite', (store) => store.clear());
  } catch {
    fallbackWrite([]);
  }
}
