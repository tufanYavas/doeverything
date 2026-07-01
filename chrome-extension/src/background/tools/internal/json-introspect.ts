/**
 * Canonical JSON introspection helpers — JSONPath-subset evaluator and
 * shape-describer. Used by `memory_get` to expose `path` + `describe`
 * params, and by network tools when they want to advertise a bucket's
 * top-level schema after stashing a response body.
 *
 * Single implementation. Replaces the parallel walkers that previously
 * lived in `network-summary.ts` (`describeJsonShape`) and
 * `tools/browser/json.ts` (`buildSchema` + `detectHomogeneity` +
 * `parseJsonPath` + `applySteps`).
 *
 * JSONPath subset (deterministic — no `eval`/`Function`, MV3 SW CSP-safe):
 *   $.foo.bar     property chain
 *   $['foo bar']  bracket-quoted property
 *   $[0]          array index
 *   $[-1]         negative index (Pythonic, from end)
 *   $[1:3]        slice
 *   $.* / $[*]    wildcard (children of current node)
 *   $..foo        recursive descent into key `foo` at any depth
 *
 * Filters (`?(...)`) are intentionally absent. Inside a `run_js` call the
 * agent already has full JS over `__bucket`; `__bucket.filter(...)` is
 * more powerful than a JSONPath filter expression and avoids shipping an
 * expression evaluator into the SW bundle.
 *
 * Schema describer (`buildSchema` + `detectHomogeneity`):
 *   - Homogeneous map: `Record<string, string>` (all values same prim type)
 *   - Homogeneous map of objects: `Record<string, { id: number; name: string }>`
 *   - Homogeneous array: `Array<T>` (all elements same shape, sampled)
 *   - Heterogeneous: TS-like signature with first 8 keys/items
 *   - Recursion-depth-capped: the inner shape signature stops at 1 level so
 *     we don't blow up the budget on deeply nested data.
 */

export type Step =
  | { kind: 'prop'; key: string }
  | { kind: 'index'; idx: number }
  | { kind: 'slice'; start: number | null; end: number | null }
  | { kind: 'wildcard' }
  | { kind: 'recursive' };

export interface PathParseError {
  error: string;
}

export function parseJsonPath(path: string): Step[] | PathParseError {
  // Strip leading `$`. Allow both "$.foo" and "foo" forms.
  const s = path.startsWith('$') ? path.slice(1) : path;
  const out: Step[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '.') {
      i++;
      if (s[i] === '.') {
        out.push({ kind: 'recursive' });
        i++;
      }
      if (s[i] === '*') {
        out.push({ kind: 'wildcard' });
        i++;
        continue;
      }
      let j = i;
      while (j < s.length && s[j] !== '.' && s[j] !== '[') j++;
      const key = s.slice(i, j);
      if (key) out.push({ kind: 'prop', key });
      i = j;
    } else if (c === '[') {
      const close = s.indexOf(']', i);
      if (close === -1) return { error: `unmatched '[' in path: ${path}` };
      const inner = s.slice(i + 1, close).trim();
      if (inner === '*') {
        out.push({ kind: 'wildcard' });
      } else if (inner.includes(':')) {
        const [a, b] = inner.split(':');
        out.push({
          kind: 'slice',
          start: a === '' ? null : Number.parseInt(a, 10),
          end: b === '' ? null : Number.parseInt(b, 10),
        });
      } else if (/^-?\d+$/.test(inner)) {
        out.push({ kind: 'index', idx: Number.parseInt(inner, 10) });
      } else if (/^['"].*['"]$/.test(inner)) {
        out.push({ kind: 'prop', key: inner.slice(1, -1) });
      } else {
        return {
          error: `unsupported bracket expression: [${inner}] (filters are not supported — use run_js({readBucket}) to filter with native JS)`,
        };
      }
      i = close + 1;
    } else {
      i++;
    }
  }
  return out;
}

export function applySteps(root: unknown, steps: Step[]): unknown[] {
  let current: unknown[] = [root];
  for (const step of steps) {
    const next: unknown[] = [];
    if (step.kind === 'prop') {
      for (const v of current) {
        if (v != null && typeof v === 'object' && !Array.isArray(v)) {
          if (step.key in (v as Record<string, unknown>)) {
            next.push((v as Record<string, unknown>)[step.key]);
          }
        }
      }
    } else if (step.kind === 'index') {
      for (const v of current) {
        if (Array.isArray(v)) {
          const idx = step.idx < 0 ? v.length + step.idx : step.idx;
          if (idx >= 0 && idx < v.length) next.push(v[idx]);
        }
      }
    } else if (step.kind === 'slice') {
      for (const v of current) {
        if (Array.isArray(v)) {
          const start = step.start ?? 0;
          const end = step.end ?? v.length;
          next.push(...v.slice(start, end));
        }
      }
    } else if (step.kind === 'wildcard') {
      for (const v of current) {
        if (Array.isArray(v)) next.push(...v);
        else if (v != null && typeof v === 'object') next.push(...Object.values(v));
      }
    } else if (step.kind === 'recursive') {
      // BFS so nodes appear in document order. The recursive step alone
      // collects every descendant including the root — the next step
      // (typically a `prop`) filters/extracts.
      for (const v of current) {
        const queue: unknown[] = [v];
        while (queue.length > 0) {
          const n = queue.shift();
          next.push(n);
          if (n && typeof n === 'object') {
            if (Array.isArray(n)) queue.push(...n);
            else queue.push(...Object.values(n as Record<string, unknown>));
          }
        }
      }
    }
    current = next;
  }
  return current;
}

export function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Render a property name safely for embedding into a schema string.
 *
 * Why: schema text gets read by the LLM as part of the agent's context.
 * Attacker-controlled JSON property names ARE possible (we describe
 * arbitrary network bodies fetched from the open web), and a key like
 * `</system-reminder>` or `IGNORE PREVIOUS INSTRUCTIONS\n` would bleed
 * directly into the schema string as legal characters. JSON.stringify
 * escapes control chars, quotes, and backslashes, neutralising the
 * worst injection vectors. Identifier-shaped keys still render bare for
 * readability — that's the 99% case for real APIs.
 *
 * Also caps the rendered length at 80 chars so a pathologically long
 * key (e.g. an entire stack trace as a JSON property name) can't
 * dominate the schema preview.
 */
function safeKey(k: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(k)) {
    return k.length > 80 ? `${k.slice(0, 77)}…` : k;
  }
  const escaped = JSON.stringify(k);
  return escaped.length > 80 ? `${escaped.slice(0, 79)}…"` : escaped;
}

/**
 * Detect whether every value at this level shares a single shape.
 * Sampling-based (max 10 picks across the range) — exact for small data,
 * heuristic for huge data, cheap either way.
 *
 * Returns:
 *   - primitive type name ("string", "number", …) when all values are
 *     the same primitive
 *   - "array" when all values are arrays (we don't dive deeper)
 *   - inner-object signature ("{ id: number; name: string }") when all
 *     values are objects with the same key set
 *   - null when the values are heterogeneous
 */
export function detectHomogeneity(value: unknown): string | null {
  if (value == null || typeof value !== 'object') return null;
  const isArray = Array.isArray(value);
  const entries = isArray ? (value as unknown[]) : Object.values(value as Record<string, unknown>);
  if (entries.length < 3) return null;
  const sampleSize = Math.min(10, entries.length);
  const step = Math.max(1, Math.floor(entries.length / sampleSize));
  const samples: unknown[] = [];
  for (let i = 0; i < entries.length && samples.length < sampleSize; i += step) {
    samples.push(entries[i]);
  }
  const types = samples.map(typeOf);
  const t0 = types[0];
  if (!types.every(t => t === t0)) return null;
  if (t0 !== 'object' && t0 !== 'array') return t0;
  if (t0 === 'array') return 'array';
  const shapeOf = (o: unknown) =>
    Object.keys(o as Record<string, unknown>).sort().slice(0, 12).join(',');
  const shapes = samples.map(shapeOf);
  if (!shapes.every(s => s === shapes[0])) return null;
  const inner = samples[0] as Record<string, unknown>;
  const ik = Object.keys(inner).slice(0, 8);
  return (
    '{ ' +
    ik.map(k => `${safeKey(k)}: ${typeOf(inner[k])}`).join('; ') +
    (Object.keys(inner).length > 8 ? '; …' : '') +
    ' }'
  );
}

export function buildSchema(target: unknown, homo: string | null): string {
  if (homo != null) {
    return Array.isArray(target) ? `Array<${homo}>` : `Record<string, ${homo}>`;
  }
  if (Array.isArray(target)) {
    const items = target.slice(0, 8).map(typeOf);
    return '[' + items.join(', ') + (target.length > 8 ? ', …' : '') + ']';
  }
  if (target == null || typeof target !== 'object') return typeOf(target);
  const obj = target as Record<string, unknown>;
  const keys = Object.keys(obj).slice(0, 8);
  const sigs = keys.map(k => {
    const v = obj[k];
    const t = typeOf(v);
    const sk = safeKey(k);
    if (t === 'array') return `${sk}: ${typeOf((v as unknown[])[0] ?? '')}[${(v as unknown[]).length}]`;
    return `${sk}: ${t}`;
  });
  return '{ ' + sigs.join('; ') + (Object.keys(obj).length > 8 ? '; …' : '') + ' }';
}

/**
 * Build the same shape report `memory_get({describe:true})` returns for an
 * arbitrary value. Used by tools that want to advertise a bucket's
 * top-level schema right after they stash a body (e.g.
 * `inspect_network_request`).
 */
export function describeShape(value: unknown): {
  type: string;
  total?: number;
  schema: string;
  homogeneous?: string;
  firstKeys?: string[];
  lastKeys?: string[];
} {
  const t = typeOf(value);
  if (t !== 'object' && t !== 'array') {
    return { type: t, schema: t };
  }
  const isArray = Array.isArray(value);
  const total = isArray
    ? (value as unknown[]).length
    : Object.keys(value as Record<string, unknown>).length;
  const homo = detectHomogeneity(value);
  const out: ReturnType<typeof describeShape> = {
    type: t,
    total,
    schema: buildSchema(value, homo),
  };
  if (homo != null) out.homogeneous = homo;
  if (!isArray) {
    const keys = Object.keys(value as Record<string, unknown>);
    // Cap each key at 200 chars — pathological JSON can have arbitrarily
    // long property names (entire stack traces seen in the wild). The
    // array itself is JSON.serialised by the AI SDK which escapes
    // control chars and quotes, so the structural envelope is safe;
    // the cap is purely about budget.
    const capKey = (k: string) => (k.length > 200 ? `${k.slice(0, 197)}…` : k);
    out.firstKeys = keys.slice(0, 3).map(capKey);
    if (keys.length > 6) out.lastKeys = keys.slice(-3).map(capKey);
  }
  return out;
}
