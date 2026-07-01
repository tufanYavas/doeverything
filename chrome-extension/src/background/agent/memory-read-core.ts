/**
 * Shared paging / describe / byte-budget logic for `memory_get`.
 *
 * Both the conversation-scoped RAM path
 * (`tools/browser/memory.ts` → `memoryRead`) and the persistent IDB path
 * (`tools/browser/memory.ts` → `recallGet`) hand `executeMemoryRead` a
 * resolved `items` array and the same read params; the response shape is
 * identical so the agent can't tell which backend served the read.
 *
 * Mirrors `memory_get`'s contract from the ground truth:
 *   - `path`     — JSONPath-subset drill into a sub-tree (delegated to
 *                  `tools/internal/json-introspect.ts`).
 *   - `describe` — shape-only mode (type, total, schema, homogeneity).
 *   - `offset` / `limit` / `fields` — paged values, with hard caps to
 *                  guarantee the response can never re-flood context.
 *
 * Per-call ceilings (hard, clamping if exceeded — same numbers RAM has
 * shipped with):
 *   - 30 K chars per single-string slice
 *   - 200 items per array slice
 *   - 30 KB serialized JSON per array slice (whichever item-cap fires first)
 *   - 10 keys per `fields` projection
 */

import { applySteps, describeShape, parseJsonPath } from '../tools/internal/json-introspect.js';

export const MAX_FIELDS_PER_CALL = 10;
export const MAX_STRING_CHARS_PER_CALL = 30_000;
export const MAX_ITEMS_PER_CALL = 200;
export const MAX_ITEMS_BYTES_PER_CALL = 30_000;

export interface MemoryReadOptions {
  bucket: string;
  path?: string;
  describe?: boolean;
  offset?: number;
  limit?: number;
  fields?: string[];
  /**
   * Extra fields spread into every response (e.g. `domain`, `persistent`)
   * so callers can tag the read without forking the response shape.
   */
  extra?: Record<string, unknown>;
  /**
   * Hint shown when the bucket is missing/empty. Lets the persistent path
   * say "no `seen-ids` for trendyol.com yet" instead of the generic
   * RAM-flavour message.
   */
  emptyHint?: string;
}

/**
 * Drives the same response shape `memory_get` always returned. Pass an
 * already-resolved items array (RAM bucket, IDB record items, or empty).
 * Returns the JSON-shaped response object the SDK ships back to the model.
 */
export function executeMemoryRead(items: unknown[], opts: MemoryReadOptions): unknown {
  const { bucket, path, describe, offset, limit, fields, extra, emptyHint } = opts;
  const tag = extra ?? {};

  if (items.length === 0) {
    return {
      bucket,
      ...tag,
      total: 0,
      items: [],
      hint: emptyHint ?? `Bucket "${bucket}" is empty or missing.`,
    };
  }

  // Resolve the working set: either the bucket-as-array or a JSONPath
  // drill-down result.
  let working: unknown[];
  if (path && path !== '$') {
    const parsed = parseJsonPath(path);
    if ('error' in parsed) return { ...tag, ...parsed };
    working = applySteps(items, parsed);
    if (working.length === 0) {
      return { bucket, ...tag, path, hint: `path matched no nodes: ${path}` };
    }
  } else {
    working = items;
  }

  if (describe) {
    const target: unknown = !path || path === '$' ? working : working.length === 1 ? working[0] : working;
    const shape = describeShape(target);
    return { bucket, ...tag, path: path ?? '$', ...shape };
  }

  // Single-string payload: char-indexed paging.
  const isStringTarget =
    (!!path && path !== '$' && working.length === 1 && typeof working[0] === 'string') ||
    ((!path || path === '$') && items.length === 1 && typeof items[0] === 'string');
  if (isStringTarget) {
    const text = (working.length === 1 ? working[0] : items[0]) as string;
    const start = offset ?? 0;
    const requestedSize = limit ?? 4000;
    const size = Math.min(requestedSize, MAX_STRING_CHARS_PER_CALL);
    const clamped = size < requestedSize;
    const slice = text.slice(start, start + size);
    const truncated = start + slice.length < text.length;
    return {
      bucket,
      ...tag,
      ...(path && path !== '$' ? { path } : {}),
      type: 'string',
      total: text.length,
      offset: start,
      returned: slice.length,
      truncated,
      text: slice,
      ...(truncated ? { nextOffset: start + slice.length } : {}),
      ...(clamped ? { clamped: { limitRequested: requestedSize, limitApplied: size } } : {}),
    };
  }

  // Array of items: item-indexed paging with byte budget.
  const total = working.length;
  const start = offset ?? 0;
  const requestedSize = limit ?? 50;
  const itemCountCap = Math.min(requestedSize, MAX_ITEMS_PER_CALL);
  const itemCountClamped = itemCountCap < requestedSize;
  let slice = working.slice(start, start + itemCountCap);
  let projected = fields && fields.length > 0 ? slice.map(item => projectFields(item, fields)) : slice;
  let serializedSize = byteLength(projected);
  let truncatedDueToSize = false;
  while (projected.length > 1 && serializedSize > MAX_ITEMS_BYTES_PER_CALL) {
    slice = slice.slice(0, slice.length - 1);
    projected = projected.slice(0, projected.length - 1);
    serializedSize = byteLength(projected);
    truncatedDueToSize = true;
  }
  const hasMore = start + slice.length < total;
  return {
    bucket,
    ...tag,
    ...(path && path !== '$' ? { path } : {}),
    total,
    offset: start,
    returned: slice.length,
    hasMore,
    items: projected,
    ...(hasMore ? { nextOffset: start + slice.length } : {}),
    ...(itemCountClamped ? { clamped: { limitRequested: requestedSize, limitApplied: itemCountCap } } : {}),
    ...(truncatedDueToSize
      ? {
          truncatedDueToSize: true,
          hint: `Slice exceeded ${Math.round(MAX_ITEMS_BYTES_PER_CALL / 1000)} KB; trimmed from the tail. Use \`fields\` to project narrower rows, or step \`offset\` by \`returned\` to keep paging.`,
        }
      : {}),
  };
}

function projectFields(item: unknown, fields: string[]): unknown {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) return item;
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f in (item as Record<string, unknown>)) {
      out[f] = (item as Record<string, unknown>)[f];
    }
  }
  return out;
}

function byteLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return String(value).length;
  }
}
