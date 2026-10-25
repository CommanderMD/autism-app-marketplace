// Offline progress queue (Phase 5): IndexedDB, one store, FIFO.
//
// POST /api/progress bodies that could not be sent are stored here and sent
// in order when the browser is back online (the 'online' event, and at boot).
// What is stored is exactly the request body: a child id, an app id, a lesson
// id, a step index, seconds, completed. Nothing personal, nothing else
// (Rule A4). clearQueue() is called on sign-out so nothing outlives the
// session on a shared device.
//
// No timers: flush runs only on 'online' and when the shell asks.

const DB_NAME = 'act1-offline';
const DB_VERSION = 1;
const STORE = 'progress';

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'seq', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try { out = fn(store); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(out && 'result' in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function enqueue(body) {
  const db = await open();
  try {
    await tx(db, 'readwrite', (s) => s.add({ body, queued_at: Date.now() }));
  } finally {
    db.close();
  }
}

export async function pending() {
  let db;
  try { db = await open(); } catch { return []; }
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function queueLength() {
  return (await pending()).length;
}

async function remove(seq) {
  const db = await open();
  try { await tx(db, 'readwrite', (s) => s.delete(seq)); } finally { db.close(); }
}

export async function clearQueue() {
  let db;
  try { db = await open(); } catch { return; }
  try { await tx(db, 'readwrite', (s) => s.clear()); } finally { db.close(); }
}

// Sends queued bodies oldest first with `send(body)` (which must throw on a
// network failure). Stops at the first failure so order is kept; a 4xx from
// the server (bad or stale body) is dropped so one bad row cannot block the
// rest. Returns { sent, left }.
let inFlight = null;
export function flush(send) {
  // One flush at a time: 'online' can fire twice in a row, and two flushes
  // reading the same rows would post every body twice.
  if (!inFlight) inFlight = flushOnce(send).finally(() => { inFlight = null; });
  return inFlight;
}

async function flushOnce(send) {
  const rows = await pending();
  let sent = 0;
  for (const row of rows) {
    try {
      await send(row.body);
      await remove(row.seq);
      sent += 1;
    } catch (err) {
      const status = err && typeof err.status === 'number' ? err.status : 0;
      if (status >= 400 && status < 500 && status !== 401 && status !== 429) {
        await remove(row.seq); // rejected for good; keep going
        continue;
      }
      break; // offline, 401 (sign in again), 429 or 5xx: try again later
    }
  }
  return { sent, left: (await pending()).length };
}
