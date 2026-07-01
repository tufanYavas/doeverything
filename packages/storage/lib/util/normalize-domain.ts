/**
 * Domain normaliser for the persistent agent-memory layer.
 *
 * Two domains in the same registrable family share a bucket: a write to
 * `m.trendyol.com` lands at `trendyol.com`, and a later read for
 * `www.trendyol.com` finds it. This matches user intuition (one site = one
 * bucket) and shrinks the key space the agent has to remember.
 *
 * Special tokens & fallbacks:
 *   - `*`                          â†’ kept as-is; the global namespace.
 *   - chrome:// / file:// / etc.   â†’ hostname pulled from URL, returned literally.
 *   - localhost / IP / unknown TLD â†’ returned as the lowercased hostname.
 *
 * The PSL lookup uses `tldts` (lazy-loaded so renderer bundles that import
 * @doeverything/storage for unrelated code don't pull the PSL table along).
 */

import { getDomain } from 'tldts';

const SPECIAL_SCHEMES = /^(chrome|file|about|chrome-extension|edge|opera):/i;

export function normalizeDomain(input: string): string {
  if (input === '*') return '*';

  const trimmed = input.trim().toLowerCase();
  if (!trimmed) {
    throw new Error('domain cannot be empty (use "*" for global)');
  }

  if (SPECIAL_SCHEMES.test(trimmed)) {
    try {
      return new URL(trimmed).hostname || trimmed;
    } catch {
      return trimmed;
    }
  }

  // Strip common URL prefixes/path so callers can pass either bare hostnames
  // or full URLs. eTLD+1 lookup wants a hostname.
  let host = trimmed;
  try {
    if (host.includes('://')) host = new URL(host).hostname;
  } catch {
    // fall through with the raw input
  }
  // Some sites pass `domain:port`; tldts handles that, but our IP fallback
  // wants a clean host.
  host = host.replace(/:\d+$/, '');

  const eTld1 = getDomain(host, { allowPrivateDomains: true });
  return eTld1 ?? host;
}

/**
 * Pull the registrable domain out of a tab URL. Used by the runner to
 * decide which persistent-memory namespace to surface. Returns `null` when
 * the URL is missing or unparseable so callers can fall back to "no
 * site-specific memory" instead of guessing.
 */
export function domainFromUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    return normalizeDomain(url);
  } catch {
    return null;
  }
}
