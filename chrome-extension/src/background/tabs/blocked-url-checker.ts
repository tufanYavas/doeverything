/**
 * BlockedUrlChecker — checks a URL against the enterprise managed-policy
 * `blockedUrlPatterns` list (declared in `chrome-extension/public/managed_schema.json`).
 *
 * Pattern semantics (standard URL pattern matching):
 *   - Match against `<host><path>` (scheme + leading `www.` stripped).
 *   - `*` is a wildcard segment.
 *   - A bare domain is interpreted as `<domain>/*`.
 *   - Matching is case-insensitive.
 *
 * Patterns are read from `chrome.storage.managed`. The browser populates
 * that area with the admin-deployed policy; in development it's empty.
 */

let cachedPatterns: string[] | null = null;
let watching = false;

const ensureWatcher = () => {
  if (watching) return;
  watching = true;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'managed' && changes.blockedUrlPatterns) {
      cachedPatterns = null;
    }
  });
};

async function loadPatterns(): Promise<string[]> {
  ensureWatcher();
  if (cachedPatterns) return cachedPatterns;
  try {
    const record = await chrome.storage.managed.get('blockedUrlPatterns');
    const value = record?.blockedUrlPatterns;
    cachedPatterns = Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    cachedPatterns = [];
  }
  return cachedPatterns;
}

function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(input);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    const host = u.hostname.replace(/^www\./i, '');
    return `${host}${u.pathname}`.toLowerCase();
  } catch {
    return null;
  }
}

function normalizePattern(pattern: string): string {
  let p = pattern.trim().toLowerCase();
  p = p.replace(/^https?:\/\//, '').replace(/^www\./, '');
  if (!p.includes('/')) p = `${p}/*`;
  return p;
}

function patternToRegex(pattern: string): RegExp {
  // Escape regex metacharacters except `*`, then turn `*` into `.*`.
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

export async function isBlockedUrl(url: string): Promise<{ blocked: boolean; reason?: string }> {
  const normalized = normalizeUrl(url);
  if (!normalized) return { blocked: false };

  const patterns = await loadPatterns();
  for (const raw of patterns) {
    const regex = patternToRegex(normalizePattern(raw));
    if (regex.test(normalized)) {
      return { blocked: true, reason: `managed-policy:${raw}` };
    }
  }
  return { blocked: false };
}
