/**
 * Persistent agent memory — survives across conversations, browser
 * restarts, and reinstalls. The "long-term" half of doeverything's two-tier
 * memory; the conversation-scoped RAM scratchpad lives in
 * `chrome-extension/src/background/agent/working-memory.ts`.
 *
 * Storage shape mirrors RAM bucket exactly: each (`domain`, `bucket`)
 * pair maps to an `Array<item>`. The agent uses the same `memory_*` tools
 * (set / append / get / count / clear) with `persistent: true` + a
 * `domain` argument. Reads paginate, drill, and describe identically to
 * the RAM path.
 *
 * Backend: IndexedDB. `chrome.storage.local`'s 10 MB cap (shared across
 * the entire extension) is too tight for delta-tracking buckets that
 * collect thousands of listing IDs. IDB is per-origin and effectively
 * uncapped under typical eviction rules.
 *
 * Concurrency: single readwrite transaction per mutation. IDB serialises
 * overlapping transactions per object store, so two `recallAppend` calls
 * with the same key never lose items. `recallSet` is last-write-wins.
 *
 * Live updates: a `BroadcastChannel` fires on every mutation so the
 * Memory tab in Options can refresh without polling. The channel sits
 * on the same origin as both writers (background SW) and readers
 * (Options/SidePanel pages).
 */

const DB_NAME = 'de-agent-memory';
const DB_VERSION = 1;
const STORE_NAME = 'buckets';

const CHANNEL_NAME = 'doe:agent-memory';

let cachedDb: Promise<IDBDatabase> | null = null;

/* ------------------------------------------------------------------------ */
/*  Types                                                                   */
/* ------------------------------------------------------------------------ */

export interface PersistentBucketRecord {
  /** `${domain}::${bucket}` — also IDB key path. */
  id: string;
  /** Normalized eTLD+1 or "*" for global. */
  domain: string;
  /** Agent-chosen bucket name. */
  bucket: string;
  /** Exact same shape as the RAM working-memory bucket. */
  items: unknown[];
  /** Wall-clock ms of last write. */
  updatedAt: number;
  /** Approx serialized size in bytes — `JSON.stringify(items).length`. */
  sizeBytes: number;
}

export interface PersistentBucketSummary {
  domain: string;
  bucket: string;
  count: number;
  sizeBytes: number;
  updatedAt: number;
}

export interface PersistentDomainSummary {
  domain: string;
  bucketCount: number;
  totalSize: number;
  totalItems: number;
  /** Bucket names within this domain (no items, just the roster). */
  buckets: Array<{ bucket: string; count: number; sizeBytes: number; updatedAt: number }>;
}

export type PersistentMemoryEvent =
  | { type: 'set'; domain: string; bucket: string; count: number }
  | { type: 'append'; domain: string; bucket: string; appended: number; total: number }
  | { type: 'clear'; domain: string; bucket: string }
  | { type: 'delete-domain'; domain: string }
  | { type: 'wipe' }
  | { type: 'import' };

/* ------------------------------------------------------------------------ */
/*  Internals                                                               */
/* ------------------------------------------------------------------------ */

function compositeId(domain: string, bucket: string): string {
  return `${domain}::${bucket}`;
}

function approxSize(items: unknown[]): number {
  try {
    return JSON.stringify(items).length;
  } catch {
    // Cycles or BigInt — over-estimate rather than under.
    return String(items).length;
  }
}

function openDb(): Promise<IDBDatabase> {
  if (cachedDb) return cachedDb;
  cachedDb = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('byDomain', 'domain', { unique: false });
        store.createIndex('byBucket', 'bucket', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // If the SW unloads, drop the cache so the next call re-opens.
      db.onclose = () => {
        if (cachedDb) cachedDb = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      cachedDb = null;
      reject(req.error);
    };
  }).catch(err => {
    cachedDb = null;
    throw err;
  });
  return cachedDb;
}

function txGet<T = PersistentBucketRecord>(
  db: IDBDatabase,
  id: string,
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function txGetAll(db: IDBDatabase): Promise<PersistentBucketRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve((req.result as PersistentBucketRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

function txGetAllByDomain(db: IDBDatabase, domain: string): Promise<PersistentBucketRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const idx = tx.objectStore(STORE_NAME).index('byDomain');
    const req = idx.getAll(domain);
    req.onsuccess = () => resolve((req.result as PersistentBucketRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

function txGetAllByBucket(db: IDBDatabase, bucket: string): Promise<PersistentBucketRecord[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const idx = tx.objectStore(STORE_NAME).index('byBucket');
    const req = idx.getAll(bucket);
    req.onsuccess = () => resolve((req.result as PersistentBucketRecord[]) ?? []);
    req.onerror = () => reject(req.error);
  });
}

function txPut(db: IDBDatabase, record: PersistentBucketRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function txDelete(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function txClear(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Atomic read-modify-write for `recallAppend`. A single readwrite tx
 * holds both the get and the put so two concurrent appends never lose
 * items — IDB serialises overlapping txs on the same store.
 */
function txAppend(
  db: IDBDatabase,
  domain: string,
  bucket: string,
  items: unknown[],
): Promise<{ total: number; sizeBytes: number }> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const id = compositeId(domain, bucket);
    const getReq = store.get(id);
    let total = items.length;
    let sizeBytes = 0;
    getReq.onsuccess = () => {
      const existing = getReq.result as PersistentBucketRecord | undefined;
      const merged = existing ? [...existing.items, ...items] : [...items];
      total = merged.length;
      sizeBytes = approxSize(merged);
      const record: PersistentBucketRecord = {
        id,
        domain,
        bucket,
        items: merged,
        updatedAt: Date.now(),
        sizeBytes,
      };
      store.put(record);
    };
    getReq.onerror = () => reject(getReq.error);
    tx.oncomplete = () => resolve({ total, sizeBytes });
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* ------------------------------------------------------------------------ */
/*  Broadcast channel — live UI updates                                      */
/* ------------------------------------------------------------------------ */

let cachedChannel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  if (!cachedChannel) cachedChannel = new BroadcastChannel(CHANNEL_NAME);
  return cachedChannel;
}

function emit(event: PersistentMemoryEvent): void {
  try {
    getChannel()?.postMessage(event);
  } catch {
    // Channel can fail to post during SW shutdown; not fatal.
  }
}

/**
 * Subscribe to mutations across the whole DB. Returns an unsubscribe fn.
 * Used by the Memory tab in Options to refresh without polling.
 */
export function subscribePersistentMemory(listener: (event: PersistentMemoryEvent) => void): () => void {
  const channel = getChannel();
  if (!channel) return () => {};
  const handler = (e: MessageEvent<PersistentMemoryEvent>) => listener(e.data);
  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}

/* ------------------------------------------------------------------------ */
/*  Public API — agent-facing primitives                                     */
/* ------------------------------------------------------------------------ */

export async function recallSet(
  domain: string,
  bucket: string,
  items: unknown[],
): Promise<{ count: number; sizeBytes: number }> {
  const db = await openDb();
  const sizeBytes = approxSize(items);
  const record: PersistentBucketRecord = {
    id: compositeId(domain, bucket),
    domain,
    bucket,
    items: [...items],
    updatedAt: Date.now(),
    sizeBytes,
  };
  await txPut(db, record);
  emit({ type: 'set', domain, bucket, count: items.length });
  return { count: items.length, sizeBytes };
}

export async function recallAppend(
  domain: string,
  bucket: string,
  items: unknown[],
): Promise<{ appended: number; total: number; sizeBytes: number }> {
  const db = await openDb();
  const { total, sizeBytes } = await txAppend(db, domain, bucket, items);
  emit({ type: 'append', domain, bucket, appended: items.length, total });
  return { appended: items.length, total, sizeBytes };
}

export async function recallGet(domain: string, bucket: string): Promise<unknown[]> {
  const db = await openDb();
  const record = await txGet<PersistentBucketRecord>(db, compositeId(domain, bucket));
  return record ? [...record.items] : [];
}

export async function recallCount(domain: string, bucket: string): Promise<number> {
  const db = await openDb();
  const record = await txGet<PersistentBucketRecord>(db, compositeId(domain, bucket));
  return record ? record.items.length : 0;
}

export async function recallClear(domain: string, bucket: string): Promise<boolean> {
  const db = await openDb();
  const id = compositeId(domain, bucket);
  const existing = await txGet<PersistentBucketRecord>(db, id);
  if (!existing) return false;
  await txDelete(db, id);
  emit({ type: 'clear', domain, bucket });
  return true;
}

/* ------------------------------------------------------------------------ */
/*  Discovery — bucket / domain rosters                                      */
/* ------------------------------------------------------------------------ */

export async function listBucketsForDomain(domain: string): Promise<PersistentBucketSummary[]> {
  const db = await openDb();
  const rows = await txGetAllByDomain(db, domain);
  return rows.map(r => ({
    domain: r.domain,
    bucket: r.bucket,
    count: r.items.length,
    sizeBytes: r.sizeBytes,
    updatedAt: r.updatedAt,
  }));
}

export async function listDomainsWithBuckets(): Promise<PersistentDomainSummary[]> {
  const db = await openDb();
  const rows = await txGetAll(db);
  const byDomain = new Map<string, PersistentDomainSummary>();
  for (const r of rows) {
    let entry = byDomain.get(r.domain);
    if (!entry) {
      entry = { domain: r.domain, bucketCount: 0, totalSize: 0, totalItems: 0, buckets: [] };
      byDomain.set(r.domain, entry);
    }
    entry.bucketCount += 1;
    entry.totalSize += r.sizeBytes;
    entry.totalItems += r.items.length;
    entry.buckets.push({
      bucket: r.bucket,
      count: r.items.length,
      sizeBytes: r.sizeBytes,
      updatedAt: r.updatedAt,
    });
  }
  // Sort: global "*" first, then alpha; buckets within a domain alpha.
  const out = Array.from(byDomain.values()).sort((a, b) => {
    if (a.domain === '*') return -1;
    if (b.domain === '*') return 1;
    return a.domain.localeCompare(b.domain);
  });
  for (const d of out) d.buckets.sort((a, b) => a.bucket.localeCompare(b.bucket));
  return out;
}

export async function listOccurrencesOfBucket(bucket: string): Promise<PersistentBucketSummary[]> {
  const db = await openDb();
  const rows = await txGetAllByBucket(db, bucket);
  return rows.map(r => ({
    domain: r.domain,
    bucket: r.bucket,
    count: r.items.length,
    sizeBytes: r.sizeBytes,
    updatedAt: r.updatedAt,
  }));
}

/* ------------------------------------------------------------------------ */
/*  Admin — UI-only helpers                                                  */
/* ------------------------------------------------------------------------ */

export async function deleteDomain(domain: string): Promise<number> {
  const db = await openDb();
  const rows = await txGetAllByDomain(db, domain);
  for (const r of rows) await txDelete(db, r.id);
  if (rows.length > 0) emit({ type: 'delete-domain', domain });
  return rows.length;
}

export async function wipeAllPersistentMemory(): Promise<void> {
  const db = await openDb();
  await txClear(db);
  emit({ type: 'wipe' });
}

export async function deleteItemAt(
  domain: string,
  bucket: string,
  index: number,
): Promise<{ ok: boolean; newCount: number }> {
  const db = await openDb();
  const id = compositeId(domain, bucket);
  const existing = await txGet<PersistentBucketRecord>(db, id);
  if (!existing) return { ok: false, newCount: 0 };
  if (index < 0 || index >= existing.items.length) return { ok: false, newCount: existing.items.length };
  const next = [...existing.items.slice(0, index), ...existing.items.slice(index + 1)];
  if (next.length === 0) {
    await txDelete(db, id);
    emit({ type: 'clear', domain, bucket });
    return { ok: true, newCount: 0 };
  }
  const sizeBytes = approxSize(next);
  await txPut(db, {
    id,
    domain,
    bucket,
    items: next,
    updatedAt: Date.now(),
    sizeBytes,
  });
  emit({ type: 'set', domain, bucket, count: next.length });
  return { ok: true, newCount: next.length };
}

export async function replaceItemAt(
  domain: string,
  bucket: string,
  index: number,
  item: unknown,
): Promise<{ ok: boolean }> {
  const db = await openDb();
  const id = compositeId(domain, bucket);
  const existing = await txGet<PersistentBucketRecord>(db, id);
  if (!existing) return { ok: false };
  if (index < 0 || index >= existing.items.length) return { ok: false };
  const next = [...existing.items];
  next[index] = item;
  const sizeBytes = approxSize(next);
  await txPut(db, {
    id,
    domain,
    bucket,
    items: next,
    updatedAt: Date.now(),
    sizeBytes,
  });
  emit({ type: 'set', domain, bucket, count: next.length });
  return { ok: true };
}

/* ------------------------------------------------------------------------ */
/*  Export / Import                                                          */
/* ------------------------------------------------------------------------ */

export interface PersistentMemorySnapshot {
  schema: 1;
  exportedAt: number;
  records: Array<{ domain: string; bucket: string; items: unknown[]; updatedAt: number }>;
}

export async function exportAllPersistentMemory(): Promise<PersistentMemorySnapshot> {
  const db = await openDb();
  const rows = await txGetAll(db);
  return {
    schema: 1,
    exportedAt: Date.now(),
    records: rows.map(r => ({ domain: r.domain, bucket: r.bucket, items: r.items, updatedAt: r.updatedAt })),
  };
}

export async function exportDomainPersistentMemory(domain: string): Promise<PersistentMemorySnapshot> {
  const db = await openDb();
  const rows = await txGetAllByDomain(db, domain);
  return {
    schema: 1,
    exportedAt: Date.now(),
    records: rows.map(r => ({ domain: r.domain, bucket: r.bucket, items: r.items, updatedAt: r.updatedAt })),
  };
}

export type ImportStrategy = 'overwrite' | 'skip' | 'append';

export async function importPersistentMemory(
  snapshot: PersistentMemorySnapshot,
  strategy: ImportStrategy = 'overwrite',
): Promise<{ merged: number }> {
  if (!snapshot || snapshot.schema !== 1 || !Array.isArray(snapshot.records)) {
    throw new Error('Invalid snapshot format (expected schema:1 with `records` array)');
  }
  const db = await openDb();
  let merged = 0;
  for (const rec of snapshot.records) {
    if (typeof rec.domain !== 'string' || typeof rec.bucket !== 'string' || !Array.isArray(rec.items)) {
      continue;
    }
    const id = compositeId(rec.domain, rec.bucket);
    const existing = await txGet<PersistentBucketRecord>(db, id);

    if (strategy === 'skip' && existing) continue;

    let nextItems: unknown[];
    if (strategy === 'append' && existing) {
      nextItems = [...existing.items, ...rec.items];
    } else {
      nextItems = [...rec.items];
    }

    await txPut(db, {
      id,
      domain: rec.domain,
      bucket: rec.bucket,
      items: nextItems,
      updatedAt: Date.now(),
      sizeBytes: approxSize(nextItems),
    });
    merged += 1;
  }
  if (merged > 0) emit({ type: 'import' });
  return { merged };
}
