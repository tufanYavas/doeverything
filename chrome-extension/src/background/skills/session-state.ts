/**
 * Tiny helper that backs the skill trackers with `chrome.storage.session`.
 *
 * The in-memory Maps the trackers used to keep would vanish whenever the MV3
 * service worker got evicted (every ~30 s of idleness on Chrome). That cost
 * us model-override carry-over, the allowed-tools allow-list, the skill
 * invocation log used by post-compaction rehydration, and the per-session
 * "already announced" set used by the listing tracker — every one of those
 * is keyed by `conversationId` and is meant to live as long as the
 * conversation does.
 *
 * `chrome.storage.session` survives SW eviction within a single browser
 * session and is cleared on browser restart, which is exactly the lifetime
 * we want for these caches: a conversation that's mid-flight when the SW
 * sleeps must come back with the same state, but a fresh browser launch is
 * a clean slate.
 *
 * Each tracker calls `loadSessionState(KEY, fallback)` once on its first
 * read; the loader caches the value in module scope so subsequent reads are
 * synchronous. Writes go through `commitSessionState(KEY, value)` which
 * updates the cache and persists asynchronously (callers can `void` the
 * promise — the cache is already updated, so subsequent reads see the new
 * value immediately).
 */

const STATE_KEY_PREFIX = 'doe:skills:';

const caches = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();

function fullKey(key: string): string {
  return STATE_KEY_PREFIX + key;
}

/**
 * Loads `key` from chrome.storage.session into module-scope cache. Returns
 * `fallback` (and seeds the cache with it) if nothing is persisted yet.
 * Multiple concurrent loaders dedupe via the `inflight` map.
 */
export async function loadSessionState<T>(key: string, fallback: () => T): Promise<T> {
  if (caches.has(key)) return caches.get(key) as T;
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    try {
      const stored = await chrome.storage.session.get(fullKey(key));
      const value = (stored[fullKey(key)] as T | undefined) ?? fallback();
      caches.set(key, value);
      return value;
    } catch {
      // chrome.storage.session unavailable (tests / non-extension contexts)
      const value = fallback();
      caches.set(key, value);
      return value;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/**
 * Synchronous accessor that throws if the cache hasn't been primed yet.
 * Trackers always `await loadSessionState` once at the top of every
 * exported function before calling this, so the throw should never fire in
 * practice — it's just a guard against accidental mis-use.
 */
export function readSessionState<T>(key: string): T {
  if (!caches.has(key)) {
    throw new Error(`Skill session state "${key}" read before load — call loadSessionState first.`);
  }
  return caches.get(key) as T;
}

/**
 * Updates the cache and persists asynchronously. Callers who don't care
 * about persistence finishing before they return can `void` the promise.
 */
export function commitSessionState<T>(key: string, value: T): Promise<void> {
  caches.set(key, value);
  return chrome.storage.session.set({ [fullKey(key)]: value }).catch(() => {
    // Persisting failures shouldn't break the in-flight tool call.
  });
}

/** Test/dev helper — wipes both the cache and the persisted record. */
export async function clearSessionState(key: string): Promise<void> {
  caches.delete(key);
  await chrome.storage.session.remove(fullKey(key)).catch(() => undefined);
}

/** Test helper — drops module-scope caches without touching storage. */
export function dropSessionStateCache(): void {
  caches.clear();
  inflight.clear();
}
