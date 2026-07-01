/**
 * Network body classifier + fetch-snippet builder.
 *
 * Why this is now THIN:
 *   The previous version owned a full hand-written JSON schema generator
 *   (`describeJsonShape`) so `inspect_network_request` and
 *   `replay_network_request` could inline a schema string into the
 *   tool's `output` text. That mechanism is gone.
 *
 *   The new contract: every captured body that isn't binary lands in a
 *   working-memory bucket. Inspection happens through `memory_get`'s
 *   `describe` / `path` / `offset` / `limit` params (one canonical
 *   inspection surface). This module's job is just to:
 *     (a) detect whether a body is JSON / text / binary / empty, and
 *     (b) parse JSON bodies once so callers don't double-parse, and
 *     (c) emit a `run_js` snippet that re-fetches the request and pushes
 *         the result into a bucket via `appendToBucket`.
 *
 * We deliberately do NOT shape, schematise, or sample bodies here. The
 * universal result-compressor + memory_get's `describe` mode handle that
 * uniformly for every JSON the agent encounters.
 */

export type BodyKind = 'json' | 'text' | 'binary' | 'empty';

export interface BodyClassification {
  kind: BodyKind;
  /** Original byte length. */
  originalBytes: number;
  /** Parsed JSON value (when `kind === 'json'`). */
  parsed?: unknown;
  /** Raw body string (when `kind === 'json' | 'text'`). */
  raw?: string;
  /** Content-type that drove the binary classification (when `kind === 'binary'`). */
  contentType?: string;
}

/** Detect application/json, application/*+json, text/json — RFC 8259 + extensions. */
const JSON_CONTENT_TYPE_RE = /^(application\/json|application\/[a-z0-9.\-+]*\+json|text\/json)/i;

/** Detect text-ish (not binary) content types. Heuristic, not exhaustive. */
const TEXT_CONTENT_TYPE_RE =
  /^(text\/|application\/(json|xml|javascript|x-www-form-urlencoded|graphql|rss\+xml|atom\+xml|x-ndjson)|image\/svg\+xml)/i;

/**
 * Classify a captured body. Single source of truth — both inspect and
 * replay tools call this before deciding how to surface the body.
 */
export function classifyBody(body: string | undefined, contentType: string | undefined): BodyClassification {
  if (body === undefined || body === null) {
    return { kind: 'empty', originalBytes: 0 };
  }
  const originalBytes = body.length;
  if (originalBytes === 0) {
    return { kind: 'empty', originalBytes };
  }

  // Binary detection — content-type is the authoritative signal. Without
  // a CT, we fall through to text/JSON detection (best-effort).
  if (contentType && !TEXT_CONTENT_TYPE_RE.test(contentType)) {
    return { kind: 'binary', originalBytes, contentType };
  }

  // JSON detection: explicit content-type OR shape that looks parseable.
  const ct = contentType ?? '';
  const looksByCT = JSON_CONTENT_TYPE_RE.test(ct);
  const trimmed = body.trim();
  const looksByShape =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (looksByCT || looksByShape) {
    try {
      const parsed = JSON.parse(trimmed);
      return { kind: 'json', originalBytes, parsed, raw: body };
    } catch {
      // Fall through to text — body claimed to be JSON but didn't parse.
    }
  }

  return { kind: 'text', originalBytes, raw: body };
}

/**
 * Parse a URL into a structured (path, queryParams) form so the model can
 * reason about parameters individually instead of staring at a pile of
 * percent-encoded `&` separators.
 */
export function summarizeUrl(rawUrl: string): {
  origin: string;
  path: string;
  queryParams: Record<string, string>;
  fragment?: string;
} {
  try {
    const u = new URL(rawUrl);
    const queryParams: Record<string, string> = {};
    for (const [k, v] of u.searchParams) queryParams[k] = v;
    return {
      origin: u.origin,
      path: u.pathname,
      queryParams,
      fragment: u.hash || undefined,
    };
  } catch {
    return { origin: '', path: rawUrl, queryParams: {} };
  }
}

/**
 * Headers the browser controls or auto-applies for `fetch()` calls — they
 * either CAN'T be set from JS (User-Agent, sec-ch-*) or get computed by
 * the network stack (Content-Length, Host) or are folded in by other
 * `fetch` knobs (Cookie via `credentials: 'include'`, Origin/Referer via
 * the calling document). Listing them in a replicated fetch snippet would
 * be at best noise and at worst (User-Agent) silently ignored — so we
 * filter them BOTH from the display AND from the snippet headers object.
 */
const BROWSER_CONTROLLED_HEADER_NAMES = new Set([
  'host',
  'connection',
  'content-length',
  'transfer-encoding',
  'cookie',
  'origin',
  'referer',
  'accept-encoding',
  'user-agent',
  'pragma',
  'cache-control',
  'upgrade-insecure-requests',
  'dnt',
  'priority',
]);

export function isBrowserControlledHeader(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith(':')) return true; // HTTP/2 pseudo-headers
  if (BROWSER_CONTROLLED_HEADER_NAMES.has(lower)) return true;
  if (lower.startsWith('sec-fetch-')) return true;
  if (lower.startsWith('sec-ch-')) return true;
  return false;
}

export interface FetchSnippetOptions {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
  /**
   * Map of header-name (lowercase) → opaque placeholder token. When
   * provided, the snippet uses the token in place of the real header
   * value. The runner's secrets-store substitutes real values back in
   * before execution, so the model never sees the secret AND the snippet
   * still works when copy-pasted into `run_js`.
   */
  sensitiveHeaderTokens?: Map<string, string>;
}

/**
 * Build a `run_js` snippet that replicates the captured request as a
 * `fetch()` call AND returns the parsed response body so the caller's
 * `appendToBucket` can stash it without round-tripping through chat.
 *
 * The snippet's last expression is `[body]` — a single-element Array — so
 * pasting it with `appendToBucket: "<name>"` puts the parsed JSON (or
 * text) into the bucket as exactly one item, ready for
 * `memory_get({ bucket, path: "$[0].…", describe: true })`.
 *
 * Why an Array of one item, not the body itself: `appendToBucket`
 * requires the script to return an Array, and pushes its items into the
 * named bucket. Wrapping the body in a one-item Array makes a
 * single-payload bucket with the same convention we use for any other
 * tool that compresses a large value into a bucket (e.g. the universal
 * result-compressor stores `[result]` for single-payload tools).
 */
export function buildFetchSnippet(opts: FetchSnippetOptions): string {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(opts.headers ?? {})) {
    if (isBrowserControlledHeader(k)) continue;
    const token = opts.sensitiveHeaderTokens?.get(k.toLowerCase());
    headers[k] = token ?? v;
  }

  const init: Record<string, unknown> = {
    method: opts.method.toUpperCase(),
    credentials: 'include',
  };
  if (Object.keys(headers).length > 0) init.headers = headers;
  if (opts.body !== undefined && opts.method.toUpperCase() !== 'GET' && opts.method.toUpperCase() !== 'HEAD') {
    init.body = opts.body;
  }

  const urlLiteral = JSON.stringify(opts.url);
  const initLiteral = JSON.stringify(init, null, 2);
  const indentedInit = initLiteral.replace(/\n/g, '\n  ');

  return [
    '(async () => {',
    `  const r = await fetch(${urlLiteral}, ${indentedInit});`,
    `  const ct = r.headers.get('content-type') || '';`,
    `  const body = /json/i.test(ct) ? await r.json() : await r.text();`,
    `  return [body];`,
    '})()',
  ].join('\n');
}
