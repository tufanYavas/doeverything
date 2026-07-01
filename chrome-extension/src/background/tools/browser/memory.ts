import {
  MAX_FIELDS_PER_CALL,
  MAX_ITEMS_BYTES_PER_CALL,
  MAX_ITEMS_PER_CALL,
  MAX_STRING_CHARS_PER_CALL,
  executeMemoryRead,
} from '../../agent/memory-read-core.js';
import {
  clearWorkingMemory,
  memoryAppend,
  memoryBuckets,
  memoryClear,
  memoryCount,
  memoryRead,
  memorySet,
} from '../../agent/working-memory.js';
import {
  listBucketsForDomain,
  listDomainsWithBuckets,
  listOccurrencesOfBucket,
  normalizeDomain,
  recallAppend,
  recallClear,
  recallCount,
  recallGet,
  recallSet,
} from '@doeverything/storage';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';

/**
 * Two-tier memory tools â€” RAM scratchpad + persistent IndexedDB layer
 * sharing one tool surface.
 *
 * `persistent: false` (default) is the conversation-scoped RAM bucket
 * model. Uses `maxResultSizeChars: Infinity` to opt out of compression.
 * Buckets clear at next conversation.
 *
 * `persistent: true` (with required `domain`) is the long-term IDB
 * bucket â€” survives across conversations, browser restarts, and
 * reinstalls. Same shape, same paging, same describe/path inspection;
 * the only differences are lifetime and the domain namespace. `domain`
 * is normalized to its registrable form (eTLD+1) so writes from
 * `m.trendyol.com` and reads from `www.trendyol.com` see the same
 * bucket.
 *
 * `memory_get` is the SINGLE inspection surface for any JSON value the
 * agent might encounter. Network bodies, scrape rows, parsed API
 * responses, persistent state â€” all flow into a bucket, all read out
 * via this one tool. Two extensions on top of Read-style paging:
 *
 *   - `path`     â€” JSONPath subset that drills into a sub-tree before
 *                  paging.
 *   - `describe` â€” return the SHAPE only.
 *
 * `memory_clear` over the persistent path is intentionally narrow:
 *   - `{persistent:true, domain, bucket}`     â†’ OK, one bucket gone.
 *   - `{persistent:true, domain}` (no bucket) â†’ ERROR. Bulk delete is UI-only.
 *   - `{persistent:true, bucket}` (no domain) â†’ ERROR. Cross-domain wipe is UI-only.
 *   - `{persistent:true}`                     â†’ ERROR.
 */

const PERSIST_DOMAIN_REQUIRED =
  '`persistent: true` requires `domain` ("*" for global, or a registrable domain like "trendyol.com")';

function resolveDomain(rawDomain: string | undefined, persistent: boolean | undefined): string | { error: string } {
  if (!persistent) return '';
  if (!rawDomain || !rawDomain.trim()) return { error: PERSIST_DOMAIN_REQUIRED };
  try {
    return normalizeDomain(rawDomain);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function memoryTools(ctx: AgentToolContext) {
  return {
    memory_set: tool({
      description:
        'Replaces a memory bucket with the given array. Default: RAM (cleared next conversation). Set `persistent: true` + `domain` ("*" for global, "trendyol.com" for site-specific) to write to the long-term store that survives across conversations. For >6 KB, use `run_js({ appendToBucket })` instead â€” items skip chat.',
      inputSchema: z.object({
        bucket: z.string(),
        value: z.array(z.unknown()),
        persistent: z.boolean().optional(),
        domain: z.string().optional(),
      }),
      execute: async ({ bucket, value, persistent, domain }) => {
        if (persistent) {
          const resolved = resolveDomain(domain, true);
          if (typeof resolved !== 'string') return resolved;
          const { count } = await recallSet(resolved, bucket, value);
          return { bucket, domain: resolved, persistent: true, count };
        }
        const count = memorySet(ctx.conversationId, bucket, value);
        return { bucket, count };
      },
    }),

    memory_append: tool({
      description:
        'Pushes items onto a bucket (creates if missing). Default: RAM. Set `persistent: true` + `domain` to append to the long-term store (e.g. tracking new listing IDs across runs). For large script-produced arrays use `run_js({ appendToBucket })` â€” items skip chat and gain server-side `dedupeBy`.',
      inputSchema: z.object({
        bucket: z.string(),
        items: z.array(z.unknown()),
        persistent: z.boolean().optional(),
        domain: z.string().optional(),
      }),
      execute: async ({ bucket, items, persistent, domain }) => {
        if (persistent) {
          const resolved = resolveDomain(domain, true);
          if (typeof resolved !== 'string') return resolved;
          const { total } = await recallAppend(resolved, bucket, items);
          return { bucket, domain: resolved, persistent: true, appended: items.length, total };
        }
        const total = memoryAppend(ctx.conversationId, bucket, items);
        return { bucket, appended: items.length, total };
      },
    }),

    memory_get: tool({
      description: `Reads from a bucket â€” the SINGLE inspection surface for any payload. Default: RAM bucket. Set \`persistent: true\` + \`domain\` to read from the long-term store. Three layered modes:
- **Drill** \`path\` (JSONPath subset): \`$.foo.bar\`, \`$['k']\`, \`$[0]\`/\`$[-1]\`, \`$[1:3]\`, \`$.*\`/\`$[*]\`, \`$..foo\`. No \`?(...)\` filters â€” use \`run_js({ readBucket })\`.
- **Describe** \`describe: true\`: returns SHAPE only (type/total/schema/homogeneity/firstKeys). Use BEFORE writing extraction logic.
- **Page** \`offset\` + \`limit\` (+ optional \`fields\`, â‰¤${MAX_FIELDS_PER_CALL}): slice the resolved value.
  - When the resolved value is an **array of items**, \`offset\`/\`limit\` are item indexes (max ${MAX_ITEMS_PER_CALL} items AND â‰¤${Math.round(MAX_ITEMS_BYTES_PER_CALL / 1000)} KB serialized per call); \`fields\` projects keys per item.
  - When the resolved value is a single **string** (e.g. a giant outerHTML payload at \`$[0]\`), \`offset\`/\`limit\` are CHARACTER positions over that string (max ${Math.round(MAX_STRING_CHARS_PER_CALL / 1000)} K chars per call).

Per-call ceilings are hard â€” values above them get clamped silently and the response carries a \`clamped\`/\`truncatedDueToSize\` flag. Step \`offset\` forward by \`returned\` to keep paging.

Buckets are \`Array<item>\`. Single-payload buckets (network body, big HTML/text) hold \`[payload]\` â€” drill with \`$[0].â€¦\` or just read with no path to get the whole array.`,
      inputSchema: z.object({
        bucket: z.string(),
        path: z
          .string()
          .optional()
          .describe('JSONPath subset to drill into a sub-tree. E.g. "$[0].users", "$[*].url", "$..price".'),
        describe: z
          .boolean()
          .optional()
          .describe('Return shape (type/total/schema/homogeneous/firstKeys) instead of values. Token-cheap mode for unfamiliar data.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Start position. For arrays: first item index (default 0). For strings: first character index (default 0).'),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            `Slice size. Arrays: max items (default 50, hard cap ${MAX_ITEMS_PER_CALL} or ${Math.round(MAX_ITEMS_BYTES_PER_CALL / 1000)} KB serialized). Strings: max characters (default 4000, hard cap ${MAX_STRING_CHARS_PER_CALL}). Step \`offset\` by \`returned\` to page forward.`,
          ),
        fields: z
          .array(z.string())
          .max(MAX_FIELDS_PER_CALL)
          .optional()
          .describe(
            `Project only these keys per item (max ${MAX_FIELDS_PER_CALL}). Useful for wide objects (e.g. ["title","price","url"] when each row has 30+ fields). Ignored when the resolved value is a string.`,
          ),
        persistent: z.boolean().optional(),
        domain: z.string().optional(),
      }),
      execute: async ({ bucket, path, describe, offset, limit, fields, persistent, domain }) => {
        if (persistent) {
          const resolved = resolveDomain(domain, true);
          if (typeof resolved !== 'string') return resolved;
          const items = await recallGet(resolved, bucket);
          return executeMemoryRead(items, {
            bucket,
            path,
            describe,
            offset,
            limit,
            fields,
            extra: { domain: resolved, persistent: true },
            emptyHint: `Bucket "${bucket}" not found in persistent memory for domain "${resolved}".`,
          });
        }

        const items = memoryRead(ctx.conversationId, bucket);
        return executeMemoryRead(items, {
          bucket,
          path,
          describe,
          offset,
          limit,
          fields,
        });
      },
    }),

    memory_count: tool({
      description:
        "Returns bucket size(s). Default: RAM. Set `persistent: true` to query the long-term store: pass `domain` + `bucket` for one count; `domain` alone lists every bucket in that domain; `bucket` alone shows occurrences of that bucket name across all domains; both omitted lists every domain with its bucket roster.",
      inputSchema: z.object({
        bucket: z.string().optional(),
        persistent: z.boolean().optional(),
        domain: z.string().optional(),
      }),
      execute: async ({ bucket, persistent, domain }) => {
        if (persistent) {
          // Mode resolution: which dimension is fixed?
          if (domain && bucket) {
            const resolved = resolveDomain(domain, true);
            if (typeof resolved !== 'string') return resolved;
            const count = await recallCount(resolved, bucket);
            return { bucket, domain: resolved, persistent: true, count };
          }
          if (domain) {
            const resolved = resolveDomain(domain, true);
            if (typeof resolved !== 'string') return resolved;
            const buckets = await listBucketsForDomain(resolved);
            return {
              domain: resolved,
              persistent: true,
              buckets: buckets.map(b => ({
                name: b.bucket,
                count: b.count,
                sizeBytes: b.sizeBytes,
                updatedAt: b.updatedAt,
              })),
            };
          }
          if (bucket) {
            const occurrences = await listOccurrencesOfBucket(bucket);
            return {
              bucket,
              persistent: true,
              occurrences: occurrences.map(o => ({ domain: o.domain, count: o.count, sizeBytes: o.sizeBytes })),
            };
          }
          const all = await listDomainsWithBuckets();
          return {
            persistent: true,
            domains: all.map(d => ({
              domain: d.domain,
              bucketCount: d.bucketCount,
              totalSize: d.totalSize,
              totalItems: d.totalItems,
              buckets: d.buckets.map(b => ({ name: b.bucket, count: b.count })),
            })),
          };
        }

        if (bucket) return { bucket, count: memoryCount(ctx.conversationId, bucket) };
        return { buckets: memoryBuckets(ctx.conversationId) };
      },
    }),

    memory_clear: tool({
      description:
        'Drops one bucket. RAM mode: pass `bucket` for one, omit for all (auto-cleared on new conversation anyway). PERSISTENT mode: requires BOTH `bucket` AND `domain` â€” bulk deletes are UI-only to prevent accidental cross-conversation wipes. Never call as post-task tidying.',
      inputSchema: z.object({
        bucket: z.string().optional(),
        persistent: z.boolean().optional(),
        domain: z.string().optional(),
      }),
      execute: async ({ bucket, persistent, domain }) => {
        if (persistent) {
          if (!bucket || !domain) {
            return {
              error:
                'Persistent clear requires BOTH `bucket` and `domain`. Bulk delete (whole domain or all-of-memory) is intentionally UI-only â€” open the Memory tab in Options.',
            };
          }
          const resolved = resolveDomain(domain, true);
          if (typeof resolved !== 'string') return resolved;
          const cleared = await recallClear(resolved, bucket);
          return { bucket, domain: resolved, persistent: true, cleared };
        }

        if (bucket) return { bucket, cleared: memoryClear(ctx.conversationId, bucket) };
        clearWorkingMemory(ctx.conversationId);
        return { clearedAll: true };
      },
    }),
  };
}
