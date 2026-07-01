/**
 * Feature flags.
 *
 *   1. `DOE_LOCAL_FEATURE_FLAGS=true` (default) → ship the static
 *      `LOCAL_FLAGS` snapshot below. Works offline.
 *   2. Otherwise → fetch `DOE_FEATURE_FLAGS_URL` env var (set it to your own endpoint)
 *      at boot + every 30 minutes; merge into the local snapshot; persist
 *      under `doe:feature-flags`.
 *
 * `featureFlags.isEnabled(name)` and `.get(name, fallback)` are sync after
 * `bootstrap()` resolves.
 */

const FLAG_STORAGE_KEY = 'doe:feature-flags';
const REMOTE_URL_DEFAULT = 'https://doeverythi.ng/api/feature-flags';
const REMOTE_REFRESH_MS = 30 * 60 * 1000;

const LOCAL_FLAGS: Record<string, boolean | string> = {
  telemetry_segment: false,
};

let cache: Record<string, boolean | string> = { ...LOCAL_FLAGS };
let booted = false;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

async function persist(flags: Record<string, boolean | string>) {
  await chrome.storage.local.set({ [FLAG_STORAGE_KEY]: flags });
}

async function readCached(): Promise<Record<string, boolean | string> | null> {
  try {
    const record = await chrome.storage.local.get(FLAG_STORAGE_KEY);
    return (record?.[FLAG_STORAGE_KEY] as Record<string, boolean | string> | undefined) ?? null;
  } catch {
    return null;
  }
}

async function fetchRemote(): Promise<Record<string, boolean | string> | null> {
  const url = process.env['DOE_FEATURE_FLAGS_URL'] || REMOTE_URL_DEFAULT;
  if (!url) return null;
  try {
    const resp = await fetch(url, { headers: { 'X-doeverything-Client': 'chrome-extension' } });
    if (!resp.ok) return null;
    const json = (await resp.json()) as { flags?: Record<string, boolean | string> };
    return json?.flags ?? null;
  } catch {
    return null;
  }
}

function scheduleRefresh() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(async () => {
    const remote = await fetchRemote();
    if (remote) {
      cache = { ...LOCAL_FLAGS, ...remote };
      await persist(cache);
    }
    scheduleRefresh();
  }, REMOTE_REFRESH_MS);
}

export const featureFlags = {
  async bootstrap() {
    if (booted) return;
    const useLocal = (process.env['DOE_LOCAL_FEATURE_FLAGS'] ?? 'true') === 'true';
    if (useLocal) {
      cache = { ...LOCAL_FLAGS };
      await persist(cache);
      booted = true;
      return;
    }
    const cached = await readCached();
    if (cached) cache = { ...LOCAL_FLAGS, ...cached };
    const remote = await fetchRemote();
    if (remote) {
      cache = { ...LOCAL_FLAGS, ...remote };
      await persist(cache);
    }
    scheduleRefresh();
    booted = true;
  },
  isEnabled(flag: string): boolean {
    const value = cache[flag];
    return value === true || value === 'on' || value === 'true';
  },
  get<T = boolean | string>(flag: string, fallback: T): T {
    const value = cache[flag];
    return (value as T) ?? fallback;
  },
  set(flag: string, value: boolean | string) {
    cache[flag] = value;
    void persist(cache);
  },
  all(): Readonly<Record<string, boolean | string>> {
    return cache;
  },
};
