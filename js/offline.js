// ── OFFLINE QUEUE ─────────────────────────────────────────────────
// Failed inserts are saved to IndexedDB and replayed on reconnect.
import { db }    from '../supabase.js';
import { toast } from './utils.js';

function openOfflineDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('neo-offline', 1);
    req.onupgradeneeded = e => e.target.result.createObjectStore('sales', { keyPath: 'qid' });
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

export async function queueSale(sale) {
  const idb = await openOfflineDB();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction('sales', 'readwrite');
    tx.objectStore('sales').add({ qid: crypto.randomUUID(), ...sale, queued_at: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror    = e => reject(e.target.error);
  });
}

export async function drainQueue() {
  let idb;
  try { idb = await openOfflineDB(); } catch { return; }

  const pending = await new Promise(resolve => {
    const tx  = idb.transaction('sales', 'readonly');
    const req = tx.objectStore('sales').getAll();
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => resolve([]);
  });

  if (!pending.length) return;
  toast(`Syncing ${pending.length} queued sale(s)…`, 3000);

  let synced = 0;
  for (const item of pending) {
    const { qid, queued_at, ...sale } = item;
    const { error } = await db.from('sales').insert(sale);
    if (!error) {
      synced++;
      await new Promise(resolve => {
        const tx = idb.transaction('sales', 'readwrite');
        tx.objectStore('sales').delete(qid);
        tx.oncomplete = resolve;
        tx.onerror    = resolve;
      });
    }
  }

  if (synced > 0) toast(`✓ Synced ${synced} offline sale(s)`);
}
