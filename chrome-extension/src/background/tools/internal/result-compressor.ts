/**
 * Universal tool-result compressor.
 *
 * When a tool's serialized result exceeds its declared cap, the full
 * payload is stashed into a working-memory bucket and the model receives
 * a small prose message instead — bucket name + first-N-byte preview + a
 * one-line instruction on how to read more via `memory_get`. The model
 * pages forward only when it actually needs more.
 *
 * Algorithm:
 *
 *   contentSize  = serialized text length
 *   threshold    = getPersistenceThreshold(declaredMaxResultSizeChars)
 *                = if Infinity → Infinity (opt-out, never compress)
 *                  else        → min(declared, DEFAULT_MAX_RESULT_SIZE_CHARS)
 *   if size <= threshold → return as-is
 *   else                 → write full content to a freshly-named bucket,
 *                          build a preview (first PREVIEW_SIZE_BYTES,
 *                          cut on newline when newline is past 50% of
 *                          the limit), and return a plain-text message
 *                          describing the bucket + how to seek forward
 *
 * The reply is plain prose (no XML wrap) so the model reads it like any
 * other tool output — bucket name, preview, "read more with …" hint.
 *
 * Empty results, image content, and tool returns containing an `error`
 * field are NEVER compressed.
 */

import { describeShape } from '../internal/json-introspect.js';
import { memorySet } from '../../agent/working-memory.js';

/**
 * Default cap on the serialized text length any tool result can carry
 * before it gets bucketed. Per-tool declarations may go LOWER but never
 * higher — `getPersistenceThreshold` clamps with `Math.min`.
 */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/**
 * Preview window emitted alongside the bucket name when a result
 * overflows. Preview is cut on the last newline within the limit IFF
 * that newline lies past 50% of the limit — preserves line integrity
 * without losing huge tail chunks to long lines.
 */
export const PREVIEW_SIZE_BYTES = 2_000;

const HANDLE_COUNTERS = new Map<string, number>();

export interface CompressorContext {
  conversationId: string;
  toolName: string;
  /**
   * Tool's declared maxResultSizeChars. `Infinity` opts the tool out of
   * compression entirely (used for `memory_get`, `skill`, `done` which must
   * never be wrapped to avoid recursion or result structure destruction).
   */
  declaredMaxResultSizeChars: number;
}

/**
 *   if !Number.isFinite(declared) → return declared        // hard opt-out
 *   else                          → min(declared, DEFAULT) // clamped to 50K
 *
 * The Infinity short-circuit MUST run before any override lookup so a
 * misconfigured override can't re-enable compression on a tool that
 * cannot tolerate it (e.g. `memory_get` would loop: bucket → memory_get →
 * compressed → bucket → memory_get …).
 */
export function getPersistenceThreshold(declared: number): number {
  if (!Number.isFinite(declared)) return declared;
  return Math.min(declared, DEFAULT_MAX_RESULT_SIZE_CHARS);
}

/**
 * Empty-result guard. When a tool returns nothing meaningful, replacing
 * it with `(${toolName} completed with no output)` prevents the model
 * from misinterpreting silence.
 */
function isToolResultEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') {
    const keys = Object.keys(value as object);
    if (keys.length === 0) return true;
  }
  return false;
}

/**
 * Cut on last newline within the byte cap, but only when that newline
 * lies past 50% of the cap. Otherwise cut hard at the cap. Naive
 * "always cut to last newline" loses half the preview when the file
 * has long lines; naive "always cut at byte" can split JSON / text
 * mid-key. The 50% guard splits the difference.
 */
export function generatePreview(content: string, maxBytes: number): { preview: string; hasMore: boolean } {
  if (content.length <= maxBytes) return { preview: content, hasMore: false };
  const truncated = content.slice(0, maxBytes);
  const lastNewline = truncated.lastIndexOf('\n');
  const cutPoint = lastNewline > maxBytes * 0.5 ? lastNewline : maxBytes;
  return { preview: content.slice(0, cutPoint), hasMore: true };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Mint a unique bucket name with the given prefix. Counter is per-prefix
 * and persists across the session (cleared by `resetHandleCounters` on
 * conversation reset). Exported so network tools can stash response
 * bodies into buckets named `inspect_response_*` / `replay_response_*`
 * without colliding with the compressor's auto-bucketed handles.
 */
export function nextHandle(toolName: string): string {
  const n = (HANDLE_COUNTERS.get(toolName) ?? 0) + 1;
  HANDLE_COUNTERS.set(toolName, n);
  return `${toolName}_${n}`;
}

/**
 * Plain-prose overflow message: bucket name + preview + a one-line
 * instruction on how to seek forward via `memory_get`. No XML wrap —
 * the model reads it as ordinary tool output.
 *
 * `payloadKind` selects the right `memory_get` hint so the agent's
 * follow-up call actually returns more data:
 *   - `array`  → `offset`/`limit` are item indexes; `fields` projects keys.
 *   - `string` → `offset`/`limit` are character positions over the string.
 *   - `object` → describe the shape first, then drill into a field with
 *                `path` (the object can't be char-sliced; only the string
 *                fields inside it can, after drilling).
 */
function buildLargeToolResultMessage(args: {
  bucket: string;
  originalSize: number;
  preview: string;
  hasMore: boolean;
  payloadKind: 'array' | 'string' | 'object';
  result: unknown;
}): string {
  const { bucket, originalSize, preview, hasMore, payloadKind, result } = args;
  const previewTrailer = hasMore ? '\n...' : '';
  let readHint: string;

  if (payloadKind === 'array') {
    const shape = describeShape(result);
    const shapeLine = `Shape: ${shape.schema} (${shape.total} items).`;
    readHint =
      `${shapeLine}\n` +
      `Read with: memory_get({ bucket: "${bucket}", offset: 0, limit: 50 }) — offset/limit are item indexes; pass \`fields\` to project keys.`;
  } else if (payloadKind === 'string') {
    readHint = `Read with: memory_get({ bucket: "${bucket}", offset: ${PREVIEW_SIZE_BYTES}, limit: 4000 }) — offset/limit slice characters; step \`offset\` forward by \`returned\` to keep paging.`;
  } else {
    // Object: embed shape + surface large string fields so the agent can
    // go straight to the right path without a describe round-trip.
    const shape = describeShape(result);
    const shapeLine = `Shape: ${shape.schema}.`;
    const obj = result as Record<string, unknown>;
    const largeFields = Object.entries(obj)
      .filter(([, v]) => typeof v === 'string' && (v as string).length > 500)
      .sort(([, a], [, b]) => (b as string).length - (a as string).length)
      .map(([k]) => k);

    if (largeFields.length > 0) {
      const listed = largeFields.slice(0, 3).map(f => `"${f}"`).join(', ');
      const primary = largeFields[0];
      readHint =
        `${shapeLine} Large string field(s): ${listed}.\n` +
        `Read the primary field: memory_get({ bucket: "${bucket}", path: "$[0].${primary}", offset: 0, limit: 4000 }) — offset/limit slice characters; step \`offset\` forward by \`returned\` to page.`;
    } else {
      readHint =
        `${shapeLine}\n` +
        `Drill into a field: memory_get({ bucket: "${bucket}", path: "$[0].<field>" }) — once a path resolves to a string, offset/limit slice characters.`;
    }
  }

  return (
    `Output too large (${formatBytes(originalSize)}) — saved to bucket "${bucket}".\n\n` +
    `Preview (first ${formatBytes(PREVIEW_SIZE_BYTES)}):\n${preview}${previewTrailer}\n\n` +
    readHint
  );
}

/**
 * Convert any value into the canonical string form persisted to the
 * bucket and previewed. Strings pass through; arrays/objects are
 * pretty-printed JSON for non-string blocks.
 */
function toCanonicalString(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function compressToolResult(result: unknown, ctx: CompressorContext): unknown {
  // Empty-result guard.
  if (isToolResultEmpty(result)) {
    return `(${ctx.toolName} completed with no output)`;
  }

  // Errors flow through untouched — the model needs the full message to recover.
  if (typeof result === 'object' && result !== null && 'error' in result) return result;

  // Image-content opt-out. When a tool sets `__doe_image: { base64,
  // mediaType }`, the result is destined for the Vercel AI SDK's
  // `content` tool-result output type (text + media parts) — see
  // `agent/conversion.ts`. Bucketing here would replace the structured
  // result with an overflow string, dropping the image bytes that
  // conversion needs to emit a `media` part. The image never enters the
  // prompt as text in either path, so size discipline is irrelevant.
  if (typeof result === 'object' && result !== null && '__doe_image' in result) {
    return result;
  }
  // Same opt-out for the multi-image marker emitted by `browser_batch`:
  // bucketing would JSON-stringify the result and drop the image bytes
  // that `browser_batch.toModelOutput` needs to fan out into per-image
  // `image-data` parts.
  if (typeof result === 'object' && result !== null && '__doe_batch_images' in result) {
    return result;
  }

  const threshold = getPersistenceThreshold(ctx.declaredMaxResultSizeChars);
  if (!Number.isFinite(threshold)) return result; // Infinity opt-out

  const canonical = toCanonicalString(result);
  if (canonical.length <= threshold) return result;

  // Persist full content into a working-memory bucket. Buckets are
  // arrays — wrap scalars/objects as a 1-item array so memory_get reads
  // it via `items[0]` and run_js({readBucket}) sees `__bucket[0]`.
  // `payloadKind` flows into the overflow message so the model gets the
  // right paging hint (array → item indexes, string → char offsets,
  // object → describe + drill via path).
  const bucket = nextHandle(ctx.toolName);
  const payloadKind: 'array' | 'string' | 'object' = Array.isArray(result)
    ? 'array'
    : typeof result === 'string'
      ? 'string'
      : 'object';
  const stored = payloadKind === 'array' ? (result as unknown[]) : [result];
  memorySet(ctx.conversationId, bucket, stored);

  const { preview, hasMore } = generatePreview(canonical, PREVIEW_SIZE_BYTES);
  return buildLargeToolResultMessage({
    bucket,
    originalSize: canonical.length,
    preview,
    hasMore,
    payloadKind,
    result,
  });
}

export function resetHandleCounters(): void {
  HANDLE_COUNTERS.clear();
}
