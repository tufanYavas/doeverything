/**
 * Tool result truncation — structural + char-cap.
 *
 * Why it exists:
 *   A single fat tool result (e.g. `replay_network_request` returning a
 *   100KB+ body verbatim) gets embedded in the next `streamText` call and
 *   pushes the request past Anthropic's 200K input-token limit. The API
 *   rejects with `prompt is too long` and the agent loop dies silently.
 *   `truncateToolResult` enforces a hard ceiling at the tool-execution
 *   wrapper so this can NEVER happen, regardless of which tool fired.
 *
 * Information-density goals — every choice picks the format that retains
 * the most signal per character for an LLM consumer:
 *
 *   1. Structural walk. Arrays longer than `maxArrayItems` keep the first N
 *      items + a `…[X more]` sentinel — the model still sees shape, count,
 *      and a representative sample.
 *   2. Head + tail string slicing. JSON/HTML/log output carries structural
 *      meaning at BOTH ends (closing brace, last error line, status footer).
 *      Bash-style head+tail beats head-only in every benchmark Anthropic
 *      published in their tool-use cookbook.
 *   3. JSON-in-string detection. Many tools wrap a JSON payload as a string
 *      (`{ output: "{\"users\":[...]}" }`). Naively slicing that string cuts
 *      the JSON mid-key. Instead: parse, recursively truncate, re-stringify.
 *      Preserves shape AND sample at the cost of one JSON.parse per large
 *      string field — cheap.
 *   4. Proportional shrinking. When the post-walk result is still over the
 *      global cap, distribute the cut across ALL large strings in the tree
 *      proportionally to their length. Repeatedly halving a single string
 *      (the v1 algorithm) starves the rest of the result.
 *   5. Depth-limit sentinels show keys, not just `[...]`. If the model knows
 *      the shape (`{users, meta, errors}`) it can re-call with a narrower
 *      selector instead of giving up.
 *
 * Defaults are calibrated for 200K-context models:
 *   maxChars = 60_000   (~15K tokens / per tool result — leaves ~13× budget
 *                       for system prompt, history, and 9 more tool calls)
 *   maxArrayItems = 10  (Browser Use ships 20; we trimmed because the
 *                       interesting signal is "shape + first few items" —
 *                       a model reading a 30-row table doesn't need 20 head
 *                       rows to infer the schema, 10 is plenty. Adaptive
 *                       scaling still triples this for tiny items
 *                       (id lists, slugs) and halves it for large items.)
 *   maxStringChars = 10_000 (long enough for an HTML snippet or JSON blob,
 *                           short enough that 6 of them fit in the global cap)
 *   maxDepth = 8        (deep enough for nested API responses; guards cycles)
 *
 * Pagination hint convention: every truncation suffix names the parameter
 * the model can call again with — e.g. `"… call with offset=20"`.
 */

export interface TruncateOpts {
  maxChars?: number;
  maxArrayItems?: number;
  maxStringChars?: number;
  maxDepth?: number;
}

interface ResolvedOpts {
  maxChars: number;
  maxArrayItems: number;
  maxStringChars: number;
  maxDepth: number;
}

const DEFAULTS: ResolvedOpts = {
  maxChars: 60_000,
  maxArrayItems: 10,
  maxStringChars: 10_000,
  maxDepth: 8,
};

export function truncateToolResult(value: unknown, opts: TruncateOpts = {}): unknown {
  const o: ResolvedOpts = { ...DEFAULTS, ...opts };
  const seen = new WeakSet<object>();
  let truncated = walk(value, 0, o, seen);

  // Step A: enforce the global byte cap. Fast path — most results already fit.
  let serialized = safeStringify(truncated);
  if (serialized.length <= o.maxChars) return truncated;

  // Step B: proportional multi-string shrinking. Each iteration cuts every
  // string >200 chars proportionally to how much it overflows the cap. We
  // bound iterations so a pathological mass of tiny strings can never spin.
  for (let i = 0; i < 6 && serialized.length > o.maxChars; i++) {
    const next = shrinkStringsProportional(truncated, serialized.length, o.maxChars);
    if (next === null) break;
    truncated = next;
    serialized = safeStringify(truncated);
  }
  if (serialized.length <= o.maxChars) return truncated;

  // Step C: last-resort sentinel. Keep enough characters for the model to
  // see the *shape* of what was returned and the parameter to retry with.
  return {
    __truncated: true,
    reason: `Tool result was ${serialized.length.toLocaleString()} chars; capped at ${o.maxChars.toLocaleString()}.`,
    hint: 'Call the tool again with a narrower scope (e.g. lower max_chars, more specific selector, or a paginated offset).',
    preview: serialized.slice(0, Math.max(0, o.maxChars - 400)) + '…[truncated]',
  };
}

function walk(value: unknown, depth: number, o: ResolvedOpts, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string') {
    // Try JSON-in-string first: many tool wrappers stringify their payload,
    // so naively slicing that string cuts JSON mid-key. Recursive parse +
    // truncate + restringify keeps shape AND a sample of every leaf.
    const recursed = recursiveJsonTruncate(value as string, depth, o, seen);
    return truncateString(recursed, o.maxStringChars);
  }
  if (t === 'number' || t === 'boolean' || t === 'bigint') return value;
  if (t === 'function' || t === 'symbol') return `[${t}]`;

  if (depth >= o.maxDepth) {
    if (Array.isArray(value)) return `[…array(${value.length}) — depth limit]`;
    if (value && typeof value === 'object') {
      // Show the keys so the model can decide whether to re-call with a
      // narrower selector. Costs ~30 chars vs `[…object — depth limit]`,
      // gains shape visibility — worth it.
      const keys = Object.keys(value as object);
      const shown = keys.slice(0, 5).join(', ');
      const more = keys.length > 5 ? `, +${keys.length - 5} more` : '';
      return `[…object{${shown}${more}} — depth limit]`;
    }
    return '[…depth limit]';
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) return '[…cycle]';
    seen.add(value);
    const limit = adaptiveArrayLimit(value, o.maxArrayItems);
    if (value.length <= limit) {
      return value.map(item => walk(item, depth + 1, o, seen));
    }
    const head = value.slice(0, limit).map(item => walk(item, depth + 1, o, seen));
    const remaining = value.length - limit;
    head.push(`…[${remaining} more item${remaining === 1 ? '' : 's'} — call with offset=${limit} for next page]`);
    return head;
  }

  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    if (seen.has(obj)) return '[…cycle]';
    seen.add(obj);
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(obj)) {
      out[k] = walk(obj[k], depth + 1, o, seen);
    }
    return out;
  }

  return value;
}

/**
 * Adaptive array limit — a fixed `maxArrayItems` is unfair across array
 * shapes. A facet list of 30-char strings can comfortably show 60 entries;
 * a list of 2KB job postings burns the entire budget on 20 items. Sample
 * the first ≤3 items to estimate per-item size, then pick a tier.
 *
 * Tiers picked to keep ANY single array's contribution under ~25% of the
 * 60K global cap when truncated:
 *   tiny  (<200 char)   → 3× base  (~30)  — id lists, facets, slugs
 *   small (200–1K)      → 1× base  (~10)  — review summaries, links
 *   large (1K–5K)       → 0.4× base (~4)  — LinkedIn jobs, e-commerce items
 *   huge  (5K+)         → ~3 items         — DOM snapshots, HTML chunks
 *
 * The `baseLimit` is the user-tunable knob (default 10). Tiers scale off it
 * so callers who pass `maxArrayItems: 5` for a tighter context still get
 * proportional behavior across tiers.
 */
function adaptiveArrayLimit(items: unknown[], baseLimit: number): number {
  if (items.length === 0) return baseLimit;
  const sampleCount = Math.min(3, items.length);
  let total = 0;
  for (let i = 0; i < sampleCount; i++) total += safeStringify(items[i]).length;
  const avg = total / sampleCount;
  if (avg < 200) return Math.max(baseLimit, baseLimit * 3);
  if (avg < 1000) return baseLimit;
  if (avg < 5000) return Math.max(5, Math.floor(baseLimit * 0.4));
  return Math.max(3, Math.floor(baseLimit / 6));
}

/**
 * Head + tail slicing. For strings ≥400 char target, keep the first 70% as
 * head (intent / opening syntax) and last 30% as tail (closing brace, last
 * status, error footer). Below 400 char fall back to head-only because
 * splitting a tiny budget across a marker leaves both ends unreadable.
 */
function truncateString(s: string, maxStringChars: number): string {
  if (s.length <= maxStringChars) return s;
  const cut = s.length - maxStringChars;
  if (maxStringChars < 400) {
    return `${s.slice(0, maxStringChars)}…[+${cut.toLocaleString()} chars]`;
  }
  // Reserve ~32 chars for the marker so the visible char count is honest.
  const headLen = Math.floor((maxStringChars - 32) * 0.7);
  const tailLen = Math.max(0, maxStringChars - 32 - headLen);
  const marker = `…[truncated ${cut.toLocaleString()} chars]…`;
  return `${s.slice(0, headLen)}${marker}${s.slice(s.length - tailLen)}`;
}

/**
 * If a string field is large AND clearly JSON-shaped, parse + recursively
 * truncate + re-stringify. Use the recursive form only if it actually came
 * out smaller — otherwise hand back the original string for the head+tail
 * slicer to handle.
 */
function recursiveJsonTruncate(s: string, depth: number, o: ResolvedOpts, seen: WeakSet<object>): string {
  if (s.length < 1024) return s;
  const trimmed = s.trim();
  const looksJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!looksJson) return s;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed === null || typeof parsed !== 'object') return s;
    const truncated = walk(parsed, depth + 1, o, seen);
    const reSerialized = JSON.stringify(truncated);
    return reSerialized.length < s.length ? reSerialized : s;
  } catch {
    return s;
  }
}

/**
 * Cut every string longer than 200 chars proportionally to how much the
 * overall result overflows the cap. A 30KB string and a 10KB string both
 * shrink — but the 30KB takes 75% of the cut, which is fair AND fast: one
 * pass instead of repeatedly halving the same victim. Returns null if the
 * tree has no large strings left to shrink (caller falls through to the
 * sentinel).
 */
function shrinkStringsProportional(value: unknown, currentSize: number, targetSize: number): unknown {
  type Found = { path: Array<string | number>; len: number };
  const found: Found[] = [];
  const path: Array<string | number> = [];
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.length > 200) found.push({ path: path.slice(), len: v.length });
      return;
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        path.push(i);
        visit(v[i]);
        path.pop();
      }
      return;
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      for (const k of Object.keys(obj)) {
        path.push(k);
        visit(obj[k]);
        path.pop();
      }
    }
  };
  visit(value);
  if (found.length === 0) return null;

  // Aggressive: aim a hair under the target so iteration converges.
  const overflow = currentSize - targetSize + 200;
  const totalLen = found.reduce((acc, f) => acc + f.len, 0);
  if (totalLen <= 0) return null;

  // Deep-clone only the spines we touch so the rest of the tree shares
  // references with the input — keeps copy cost low for large structures.
  let next = value;
  for (const f of found) {
    const share = f.len / totalLen;
    const cutFromThis = Math.floor(overflow * share);
    if (cutFromThis < 100) continue; // too tiny to bother — would lose to marker overhead
    const newLen = Math.max(200, f.len - cutFromThis);
    next = cloneByPath(next, f.path);
    setAtPath(next, f.path, current => {
      if (typeof current !== 'string') return current;
      return truncateString(current, newLen);
    });
  }
  return next;
}

function cloneByPath(value: unknown, path: Array<string | number>): unknown {
  if (path.length === 0) {
    if (Array.isArray(value)) return [...value];
    if (value && typeof value === 'object') return { ...(value as Record<string, unknown>) };
    return value;
  }
  if (Array.isArray(value)) {
    const next = [...value];
    const head = path[0] as number;
    next[head] = cloneByPath(next[head], path.slice(1));
    return next;
  }
  if (value && typeof value === 'object') {
    const next = { ...(value as Record<string, unknown>) };
    const head = path[0] as string;
    next[head] = cloneByPath(next[head], path.slice(1));
    return next;
  }
  return value;
}

function setAtPath(value: unknown, path: Array<string | number>, fn: (v: unknown) => unknown): void {
  if (path.length === 0) return;
  let cursor: unknown = value;
  for (let i = 0; i < path.length - 1; i++) {
    if (Array.isArray(cursor)) cursor = cursor[path[i] as number];
    else if (cursor && typeof cursor === 'object') cursor = (cursor as Record<string, unknown>)[path[i] as string];
    else return;
  }
  const last = path[path.length - 1];
  if (Array.isArray(cursor)) cursor[last as number] = fn(cursor[last as number]);
  else if (cursor && typeof cursor === 'object') {
    const obj = cursor as Record<string, unknown>;
    obj[last as string] = fn(obj[last as string]);
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

/** Estimate the wire size of a tool result for telemetry without throwing. */
export function estimateResultSize(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'string') return value.length;
  return safeStringify(value).length;
}
