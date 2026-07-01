/**
 * URL pattern matcher for skill `domains` frontmatter.
 *
 *   - `example.com`              exact hostname
 *   - `*.example.com`            single-level subdomain
 *   - `**.example.com`           any subdomain depth, including bare
 *   - `https://example.com/p/*`  URL prefix with `*` glob in path
 *   - `*://example.com/p`        any scheme
 */

const compileCache = new Map<string, RegExp>();

const escapeRegex = (s: string): string => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

function compilePattern(pattern: string): RegExp {
  const cached = compileCache.get(pattern);
  if (cached) return cached;

  let re: RegExp;
  const isFullUrl = /^[a-zA-Z]+:\/\//.test(pattern) || pattern.startsWith('*://');

  if (isFullUrl) {
    const DOUBLESTAR = 'D';
    const SINGLESTAR = 'S';
    let p = pattern.replace(/\*\*/g, DOUBLESTAR).replace(/\*/g, SINGLESTAR);
    p = escapeRegex(p);
    p = p.split(DOUBLESTAR).join('.*').split(SINGLESTAR).join('[^/]*');
    re = new RegExp('^' + p + '$');
  } else if (pattern.startsWith('**.')) {
    re = new RegExp('^(?:.+\\.)?' + escapeRegex(pattern.slice(3)) + '$');
  } else if (pattern.startsWith('*.')) {
    re = new RegExp('^[^.]+\\.' + escapeRegex(pattern.slice(2)) + '$');
  } else {
    re = new RegExp('^' + escapeRegex(pattern) + '$');
  }

  compileCache.set(pattern, re);
  return re;
}

export function urlMatchesAny(url: string | undefined, patterns: string[] | undefined): boolean {
  if (!url || !patterns || patterns.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const hostname = parsed.hostname;
  const canonicalUrl = parsed.origin + parsed.pathname;
  for (const pattern of patterns) {
    if (!pattern) continue;
    const re = compilePattern(pattern);
    const isFullUrl = /^[a-zA-Z]+:\/\//.test(pattern) || pattern.startsWith('*://');
    if (isFullUrl ? re.test(canonicalUrl) : re.test(hostname)) {
      return true;
    }
  }
  return false;
}

export function clearUrlMatcherCache(): void {
  compileCache.clear();
}
