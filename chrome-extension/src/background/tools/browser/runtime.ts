import { memoryAppend, memoryCount, memoryRead, memorySet } from '../../agent/working-memory.js';
import { PermissionDeniedError } from '../../permissions/manager.js';
import { gateOnHost } from '../internal/helpers.js';
import { describeShape } from '../internal/json-introspect.js';
import { nextHandle, PREVIEW_SIZE_BYTES } from '../internal/result-compressor.js';
import { buildFetchSnippet, classifyBody, isBrowserControlledHeader, summarizeUrl } from '../network-summary.js';
import { registerSecret, replaceTokens } from '../secrets-store.js';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';

export function runtimeTools(ctx: AgentToolContext) {
  return {
    run_js: tool({
      description:
        "Runs JS in the active tab. Last expression returns (no top-level `return`; wrap in IIFE for `await`/early-exit). Reach `[N]` elements via `___selectorMap[N].sourceElement` — never guess `querySelector`. `appendToBucket` pushes Array results into a bucket (with optional `dedupeBy`); `readBucket` exposes a bucket as `__bucket`. Forbidden in file content: `data:` URLs, `encodeURI` on content, literal `\\n` in `Blob` strings. Use `computer` for clicks/screenshots.",
      inputSchema: z.object({
        text: z.string().describe("Code. Last expression is the return value. With `readBucket`, `__bucket` (Array) is in scope."),
        appendToBucket: z
          .string()
          .optional()
          .describe('If the script returns an Array, push items into this bucket. Items never enter chat.'),
        dedupeBy: z
          .string()
          .optional()
          .describe(
            'Field name to dedupe by (e.g. "url", "id", "data-id"). Items whose value already exists in the bucket are dropped server-side. Use on every paginated/scroll re-extract — when two consecutive calls return `appended:0`, the bottom is reached.',
          ),
        readBucket: z.string().optional().describe('Expose this bucket as `__bucket` (Array) inside the script.'),
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
      }),
      execute: async ({ text, appendToBucket, dedupeBy, readBucket, tabId: requestedTabId }) => {
        if (!text) return { error: 'Code parameter is required' };
        // Defensive runtime guards — these are LLM mistake patterns the
        // system prompt forbids, but models still occasionally emit them.
        // Catching at runtime returns a teaching error instead of letting
        // the broken file slip through.
        if (/data:(text|application)\/[\w+-]+(?:;[^,]*)?,/i.test(text)) {
          return {
            error:
              'Forbidden: `data:` URLs corrupt content (URL-encoding eats newlines and special chars). Use `URL.createObjectURL(new Blob([content], { type }))` instead.',
          };
        }
        if (/\bencodeURI(?:Component)?\s*\(/.test(text)) {
          return {
            error:
              'Forbidden: `encodeURI` / `encodeURIComponent` corrupts CSV / JSON content. Pass raw bytes to `Blob`; URL-encoding belongs only on URL params, never on file content.',
          };
        }
        // `\\n` (3-byte sequence: backslash + backslash + n) inside a
        // string or template literal evaluates to literal text "\n" (2
        // chars), NOT a newline. When the script also constructs a
        // `Blob`, that's almost always the "single-line CSV" bug we
        // saw in production — caught here so the model retries with
        // a single-backslash `\n`.
        if (/\bnew\s+Blob\b/.test(text) && /\\\\n/.test(text)) {
          return {
            error:
              'Forbidden: `\\\\n` inside a string/template literal is a 2-char "\\n" literal — not a line break. Use single-backslash `\\n` (or a real line break inside a `` `template` ``). The CSV / file content needs real LF (`0x0A`) bytes, not the text "\\n".',
          };
        }
        // `__bucket` only exists when the caller passed `readBucket`. Without
        // it, V8 throws `ReferenceError: __bucket is not defined` and burns a
        // turn — return a teaching error instead so the model adds the arg.
        if (!readBucket && /\b__bucket\b/.test(text)) {
          return {
            error:
              '`__bucket` is only defined when you pass `readBucket: "<bucket-name>"` alongside `text`. Either add `readBucket` so the bucket payload is exposed inside the script, or remove the `__bucket` reference. (Single-payload buckets — e.g. inspect_network_request bodies — live at `__bucket[0]`; multi-item buckets are iterated as `__bucket`.)',
          };
        }
        let scriptText = text;
        // Some models (Gemini in particular) double-escape newlines on
        // the JSON wire: they emit `\\n` (3 bytes on wire) where they
        // meant `\n` (2 bytes on wire). After JSON.parse our `text`
        // arg ends up with literal 2-char `\n` (backslash + n) where
        // real LF should be — V8 then throws `SyntaxError: Invalid or
        // unexpected token` at the first `\` outside a string,
        // killing the script at col ~30. Detection is conservative:
        // require zero real LF AND a statement-boundary `;\n` or
        // `}\n` literal (which never legitimately appears inside a
        // single-line string the model would write). When triggered,
        // replace ALL `\n` literals with real LF — if the bug is
        // present at one boundary, it's present everywhere (the
        // tokenizer doesn't mix correct and broken escapes in one
        // call).
        if (!scriptText.includes('\n') && /[;}]\s*\\n/.test(scriptText)) {
          scriptText = scriptText.replace(/\\n/g, '\n');
          console.warn(
            '[doeverything] run_js: auto-normalized double-escaped `\\\\n` to LF (model emitted `\\n` on the wire where it meant a real newline)',
          );
        }
        // Top-level `return` is a SyntaxError in our IIFE wrapper. The
        // model keeps writing it (despite the system-prompt rule),
        // wasting a turn. Auto-wrap the script in `(()=>{ ... })()` so
        // the return becomes valid. Only triggered when we detect a
        // top-level return — code that already wraps in an IIFE is
        // unaffected.
        if (/^\s*return\s/.test(scriptText) || /\n\s*return\s/.test(scriptText)) {
          // Heuristic: if the script doesn't already start with `(`/`(async`,
          // wrap it. False-positive risk: a `return` deep inside an
          // existing IIFE looks the same to this regex but the wrapping
          // double-IIFE still works (the inner return returns from the
          // inner function).
          if (!/^\s*\(\s*(?:async\s*)?(?:function|\()/.test(scriptText)) {
            scriptText = `(()=>{${scriptText}})()`;
          }
        }
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        try {
          // Permission preview uses the ORIGINAL text (with placeholders
          // still in place) so the user / permission UI never sees real
          // secret values. Resolution happens AFTER the gate.
          await gateOnHost(ctx, tabId, 'browser_control', {
            reason: 'Run JavaScript',
            preview: text.slice(0, 200),
            toolName: 'run_js',
          });
        } catch (err) {
          if (err instanceof PermissionDeniedError) return { error: 'Denied by user' };
          throw err;
        }
        // Substitute every `__doeverything_SECRET_…__` placeholder the model
        // pasted with its real value (registered earlier when
        // inspect_network_request showed a sensitive header). The real
        // values never entered the model's context — this is the first
        // place they materialise, and they go straight from here into
        // page-context eval. Logged to the SW console (NEVER the LLM)
        // so a developer can see "3 secrets swapped".
        const resolved = replaceTokens(scriptText);
        if (resolved.replaced > 0) {
          console.info(
            `[doeverything] run_js: substituted ${resolved.replaced} secret placeholder${resolved.replaced === 1 ? '' : 's'} before execution`,
          );
        }
        // If `readBucket` is set, embed the bucket payload directly into
        // the wrapped expression as a `__bucket` declaration. The
        // serialisation cost is on the SW↔page CDP wire (cheap, native)
        // — the model never sees it, which is the whole point. Strict
        // mode lets eval-d code READ enclosing-scope vars without
        // mutating them.
        const bucketPayload = readBucket ? memoryRead(ctx.conversationId, readBucket) : null;
        const bucketDecl = bucketPayload !== null ? `var __bucket = ${JSON.stringify(bucketPayload)};` : '';
        const wrapped = `(function(){'use strict';${bucketDecl}try{return eval(${JSON.stringify(resolved.text)});}catch(e){throw e;}})()`;
        const evalRes = (await ctx.cdp.send(tabId, 'Runtime.evaluate', {
          expression: wrapped,
          returnByValue: true,
          awaitPromise: true,
          timeout: 30_000,
        })) as {
          result?: { type?: string; subtype?: string; value?: unknown; description?: string };
          exceptionDetails?: { exception?: { description?: string; value?: unknown }; text?: string };
        };
        if (evalRes.exceptionDetails) {
          const ex = evalRes.exceptionDetails;
          const desc = ex.exception?.description ?? ex.text ?? 'Unknown error';
          const wasTimeout = typeof desc === 'string' && desc.includes('execution was terminated');
          return {
            error: `JavaScript execution error: ${wasTimeout ? 'Execution timeout: code exceeded 30-second limit' : desc}`,
          };
        }
        const r = evalRes.result;
        // (Output size is no longer hard-capped here — the universal
        // result-compressor in tool-wrapper.ts wraps oversized returns
        // into a handle envelope automatically.)
        // ── appendToBucket fast path ──────────────────────────────────
        // The script's deserialised result is in r.value (because we
        // requested returnByValue). If the model asked for a bucket
        // append AND we have an array, push the items into RAM and
        // return only the counters. The raw items never round-trip
        // through the LLM context.
        if (appendToBucket) {
          const value = r?.value;
          if (!Array.isArray(value)) {
            return {
              error: `appendToBucket="${appendToBucket}" requires the script to return an Array; got ${
                value === undefined ? 'undefined' : typeof value
              }. Drop the parameter, or fix the script so its last expression is an Array.`,
            };
          }
          // Server-side dedupe: when `dedupeBy` is set, drop incoming items
          // whose `dedupeBy` value already exists in the bucket. The model
          // can't see the bucket items (they never enter chat), so without
          // this it has no way to detect "I just re-scraped the same 143
          // visible cards" — every scroll cycle would inflate the bucket
          // by another full page-worth, and the skill's "appended:0 means
          // bottom reached" stop-rule becomes unreachable.
          let kept = value;
          let deduped = 0;
          if (dedupeBy) {
            const existing = memoryRead(ctx.conversationId, appendToBucket);
            const seen = new Set<unknown>();
            for (const item of existing) {
              if (item && typeof item === 'object' && dedupeBy in (item as Record<string, unknown>)) {
                seen.add((item as Record<string, unknown>)[dedupeBy]);
              }
            }
            kept = [];
            for (const item of value) {
              if (item && typeof item === 'object' && dedupeBy in (item as Record<string, unknown>)) {
                const key = (item as Record<string, unknown>)[dedupeBy];
                if (seen.has(key)) {
                  deduped++;
                  continue;
                }
                seen.add(key);
              }
              kept.push(item);
            }
          }
          const total = memoryAppend(ctx.conversationId, appendToBucket, kept);
          // When the appended payload is small, include it inline so the
          // model doesn't have to spend an extra `memory_get` turn just to
          // read what it literally just produced. Threshold matches the
          // result-compressor preview size — anything larger should stay
          // bucket-only to keep `appendToBucket`'s "items never enter chat"
          // guarantee for big extractions intact.
          let inlineItems: unknown[] | undefined;
          if (kept.length > 0) {
            try {
              if (JSON.stringify(kept).length <= PREVIEW_SIZE_BYTES) inlineItems = kept;
            } catch {
              // Non-serializable items (cycles, etc.) — fall back to bucket-only.
            }
          }
          const base = dedupeBy
            ? { bucket: appendToBucket, appended: kept.length, deduped, total }
            : { bucket: appendToBucket, appended: kept.length, total };
          return inlineItems !== undefined ? { ...base, items: inlineItems } : base;
        }
        let output: string;
        if (!r) output = 'undefined';
        else if (r.type === 'undefined') output = 'undefined';
        else if (r.type === 'object' && r.subtype === 'null') output = 'null';
        else if (r.type === 'function') output = r.description ?? '[Function]';
        else if (r.type === 'object') {
          if (r.subtype === 'node') output = r.description ?? '[DOM Node]';
          else if (r.subtype === 'array') output = r.description ?? '[Array]';
          else output = r.description ?? JSON.stringify(r.value ?? {}, null, 2);
        } else if (r.value !== undefined) {
          output = typeof r.value === 'string' ? r.value : JSON.stringify(r.value, null, 2);
        } else {
          output = r.description ?? String(r.value);
        }
        // (No internal length cap — the universal compressor in
        // tool-wrapper.ts handles oversize results uniformly.)
        // When `readBucket` was used (without an append), include the
        // bucket size in the response so the model has a reliable check
        // ("download script reported __bucket.length === 1234 → match").
        if (readBucket) {
          return { output, bucket: readBucket, bucketSize: memoryCount(ctx.conversationId, readBucket) };
        }
        return { output };
      },
    }),

    read_console_messages: tool({
      description:
        'Reads captured console output (log/info/warn/error + uncaught exceptions) for a tab. Always pass `pattern` (regex) — busy pages flood otherwise. Capture starts on first call, so reload if the page already loaded.',
      inputSchema: z.object({
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
        onlyErrors: z
          .boolean()
          .optional()
          .describe('If true, only return error and exception messages. Default false.'),
        clear: z.boolean().optional().describe('If true, clear messages after reading. Default false.'),
        pattern: z
          .string()
          .optional()
          .describe(
            "Regex pattern to filter console messages (e.g., 'error|warning'). Always provide one to avoid noise.",
          ),
      }),
      execute: async ({ tabId: requestedTabId, onlyErrors, clear, pattern }) => {
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        await ctx.cdp.enableConsoleTracking(tabId);
        const level = onlyErrors === true ? 'error' : 'all';
        const messages = ctx.cdp.getConsole(tabId, { level, pattern });
        if (clear) ctx.cdp.clearConsole(tabId);
        if (messages.length === 0) {
          return {
            output: `No console ${onlyErrors ? 'errors or exceptions' : 'messages'} found for this tab.\n\nNote: Console tracking starts when this tool is first called. If the page loaded before calling this tool, you may need to refresh the page.`,
          };
        }
        const formatted = messages
          .map((msg, idx) => {
            const time = new Date(msg.ts).toLocaleTimeString();
            const loc = msg.url ? ` (${msg.url})` : '';
            return `[${idx + 1}] [${time}] [${msg.level.toUpperCase()}]${loc}\n${msg.text}`;
          })
          .join('\n\n');
        const messageType = onlyErrors ? 'error/exception messages' : 'console messages';
        const header = `Found ${messages.length} ${messageType}:`;
        return {
          output: `${header}\n\n${formatted}`,
        };
      },
    }),

    read_network_requests: tool({
      description:
        'Lists captured HTTP requests for a tab as one-liners (`requestId`, method, status, type, size). Default `kind: "data"` drops asset/tracking noise; pass `"all"`/`"assets"`/`"tracking"` to widen. Follow up with `inspect_network_request` or `replay_network_request`. Capture starts on first call.',
      inputSchema: z.object({
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
        urlPattern: z
          .string()
          .optional()
          .describe(
            "Optional URL pattern to filter requests (e.g., '/api/' to filter API calls, 'example.com' for domain).",
          ),
        kind: z
          .enum(['data', 'all', 'assets', 'tracking'])
          .optional()
          .describe(
            'Which class of requests to return. "data" (default) = Document + XHR + Fetch + WebSocket + EventSource — the requests that actually carry useful page data. "assets" = Stylesheet + Image + Font + Script + Media + Manifest. "tracking" = Ping + Other beacons / analytics. "all" = everything. Tracking-domain heuristics (analytics hosts, /beacon, /rum, etc.) are always filtered from "data" but included in "all".',
          ),
        clear: z.boolean().optional().describe('If true, clear network requests after reading. Default false.'),
      }),
      execute: async ({ tabId: requestedTabId, urlPattern, kind, clear }) => {
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        await ctx.cdp.enableNetworkTracking(tabId);
        const allRequests = ctx.cdp.getNetwork(tabId, { filterUrl: urlPattern });
        if (clear) ctx.cdp.clearNetwork(tabId);
        if (allRequests.length === 0) {
          const filter = urlPattern ? `requests matching "${urlPattern}"` : 'network requests';
          return {
            output: `No ${filter} found for this tab.\n\nNote: Network tracking starts when this tool is first called. If the page loaded before, refresh the page or trigger network requests.`,
          };
        }
        // CDP `Network.ResourceType` buckets — see
        // https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-ResourceType
        const DATA_TYPES = new Set(['Document', 'XHR', 'Fetch', 'WebSocket', 'EventSource', 'Preflight']);
        const ASSET_TYPES = new Set(['Stylesheet', 'Image', 'Font', 'Script', 'Media', 'Manifest', 'TextTrack']);
        const TRACKING_TYPES = new Set(['Ping', 'CSPViolationReport', 'SignedExchange', 'Other']);
        // Tracking-domain regexes catch the case where analytics endpoints
        // come through as `Fetch`/`XHR` — type alone isn't enough to filter
        // them out. List is conservative; misses are fine ("data" still
        // shrinks 100 → ~10) and false positives just hide a beacon the
        // model never needs anyway.
        const TRACKING_HOST_RE =
          /(google-analytics\.com|googletagmanager\.com|doubleclick\.net|facebook\.com\/tr|connect\.facebook\.net|hotjar\.com|segment\.(io|com)|amplitude\.com|mixpanel\.com|sentry\.io|datadoghq\.com|newrelic\.com|cloudflareinsights\.com|cdn-cgi\/rum|cdn-cgi\/beacon|fullstory\.com|optimizely\.com|cloudflare\.com\/cdn-cgi)/i;
        const TRACKING_PATH_RE = /\/(beacon|collect|pixel|tr\?|t\.gif|telemetry|analytics|metrics|rum)(\b|\/|\?)/i;
        const isTrackingUrl = (url: string) => TRACKING_HOST_RE.test(url) || TRACKING_PATH_RE.test(url);
        const resolvedKind = kind ?? 'data';
        const matchesKind = (req: { type?: string; url: string }): boolean => {
          const t = req.type ?? 'Other';
          if (resolvedKind === 'all') return true;
          if (resolvedKind === 'assets') return ASSET_TYPES.has(t);
          if (resolvedKind === 'tracking') return TRACKING_TYPES.has(t) || isTrackingUrl(req.url);
          // "data" — must be a data type AND not a tracking URL.
          return DATA_TYPES.has(t) && !isTrackingUrl(req.url);
        };
        const filtered = allRequests.filter(matchesKind);
        // Per-class counts for the header so the model knows what was hidden.
        const buckets: Record<'data' | 'assets' | 'tracking' | 'other', number> = {
          data: 0,
          assets: 0,
          tracking: 0,
          other: 0,
        };
        for (const req of allRequests) {
          const t = req.type ?? 'Other';
          if (DATA_TYPES.has(t) && !isTrackingUrl(req.url)) buckets.data++;
          else if (ASSET_TYPES.has(t)) buckets.assets++;
          else if (TRACKING_TYPES.has(t) || isTrackingUrl(req.url)) buckets.tracking++;
          else buckets.other++;
        }
        if (filtered.length === 0) {
          const summary =
            `No requests matched kind="${resolvedKind}"${urlPattern ? ` and pattern "${urlPattern}"` : ''}. ` +
            `Total captured: ${allRequests.length} ` +
            `(data:${buckets.data} assets:${buckets.assets} tracking:${buckets.tracking} other:${buckets.other}). ` +
            `Try kind="all" to see everything.`;
          return { output: summary };
        }
        const formatBytes = (n?: number) =>
          n === undefined || n === null
            ? '?'
            : n < 1024
              ? `${n}B`
              : n < 1024 * 1024
                ? `${(n / 1024).toFixed(1)}KB`
                : `${(n / (1024 * 1024)).toFixed(2)}MB`;
        const formatted = filtered
          .map((req, idx) => {
            const status = req.status ?? 'pending';
            const t = req.type ?? '-';
            const size = formatBytes(req.size);
            const bodyMark = req.bodyState === 'captured' ? ' body:captured' : '';
            return `${idx + 1}. id:${req.requestId} ${req.method} ${status} ${t} ${size}${bodyMark}\n   ${req.url}`;
          })
          .join('\n\n');
        const hidden = allRequests.length - filtered.length;
        const filterNote = urlPattern ? ` matching "${urlPattern}"` : '';
        const headerLines = [
          `${filtered.length} of ${allRequests.length} request${allRequests.length === 1 ? '' : 's'}${filterNote} (kind="${resolvedKind}").`,
        ];
        if (resolvedKind === 'data' && hidden > 0) {
          headerLines.push(
            `(Hidden by default: ${buckets.assets} assets, ${buckets.tracking} tracking/analytics, ${buckets.other} other. Pass kind="all" to see everything.)`,
          );
        }
        return {
          output: `${headerLines.join(' ')}\n\n${formatted}`,
        };
      },
    }),

    inspect_network_request: tool({
      description:
        'Inspects one captured request by `requestId`. Returns URL split (origin/path/query), meaningful headers, and request + response bodies bucketed with schema previews — drill via `memory_get`. Also emits a paste-ready `run_js fetch()` snippet replicating the call; sensitive headers (Authorization, Cookie, X-CSRF-Token, …) are redacted and replaced with placeholder tokens that the runtime substitutes at execution.',
      inputSchema: z.object({
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
        requestId: z.string().describe('The requestId from read_network_requests output.'),
        redactSensitiveHeaders: z
          .boolean()
          .optional()
          .describe(
            'Whether to redact Authorization/Cookie/auth-token headers (replace with secret-store placeholder). Default true.',
          ),
      }),
      execute: async ({ tabId: requestedTabId, requestId, redactSensitiveHeaders }) => {
        if (!requestId) return { error: 'requestId is required' };
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        const entry = ctx.cdp.getNetworkRequest(tabId, requestId);
        if (!entry) return { error: `Request ${requestId} not found. Re-run read_network_requests.` };

        const redact = redactSensitiveHeaders !== false;
        const SENSITIVE =
          /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|x-csrf-token|proxy-authorization|www-authenticate)$/i;

        // Pre-compute the sensitive-token map once, then share it between
        // the displayed headers AND the fetch snippet — that way the
        // snippet uses the same placeholder strings the model just saw,
        // copy-paste works without manual editing, and `registerSecret`'s
        // value-keyed dedup ensures one placeholder per unique value.
        const sensitiveTokens = new Map<string, string>();
        if (redact && entry.requestHeaders) {
          for (const [k, v] of Object.entries(entry.requestHeaders)) {
            if (SENSITIVE.test(k)) sensitiveTokens.set(k.toLowerCase(), registerSecret(v, k));
          }
        }
        const anySensitive = sensitiveTokens.size > 0;

        // Render request headers, dropping browser-controlled noise
        // (User-Agent, sec-ch-*, Cookie, accept-encoding, …) the agent
        // would never need to set manually in a fetch() call. Sensitive
        // values become the placeholder we registered above.
        const fmtRequestHeaders = (h: Record<string, string> | undefined): string => {
          if (!h) return '  (none)';
          const visible = Object.entries(h).filter(([k]) => !isBrowserControlledHeader(k));
          if (visible.length === 0) return '  (only browser-controlled headers — auto-applied by fetch)';
          return visible
            .map(([k, v]) => {
              if (redact && SENSITIVE.test(k)) {
                const token = sensitiveTokens.get(k.toLowerCase());
                if (token) return `  ${k}: ${token}`;
              }
              return `  ${k}: ${v}`;
            })
            .join('\n');
        };

        // URL summary — split path and query so the model can reason about
        // params individually. Most "replicate this in fetch()" calls only
        // mutate a single query value (e.g. page number); seeing them as a
        // flat object beats picking them out of a 200-char URL string.
        const urlInfo = summarizeUrl(entry.url);
        const queryLines = Object.keys(urlInfo.queryParams).length
          ? Object.entries(urlInfo.queryParams)
              .map(([k, v]) => `    ${k}=${v}`)
              .join('\n')
          : '    (none)';

        // Body handling: every non-empty / non-binary body lands in a
        // working-memory bucket. The output text shows the bucket name +
        // a one-line shape summary. The agent reads (or describes /
        // drills) via memory_get — the SINGLE inspection surface for any
        // JSON the agent encounters.
        const reqContentType = entry.requestHeaders?.['content-type'] ?? entry.requestHeaders?.['Content-Type'];
        const respContentType = entry.responseHeaders?.['content-type'] ?? entry.responseHeaders?.['Content-Type'];

        const renderBodyBlock = (
          label: string,
          handlePrefix: string,
          body: string | undefined,
          contentType: string | undefined,
          omitted: boolean,
        ): string[] => {
          if (omitted) return [`${label}:`, '  (had a body but >65KB; CDP did not capture inline)'];
          if (body === undefined) return [`${label}:`, '  (no body — typical for GET/HEAD)'];
          const cls = classifyBody(body, contentType);
          if (cls.kind === 'empty') return [`${label}:`, '  (empty)'];
          if (cls.kind === 'binary') {
            return [
              `${label} — binary:`,
              `  ${cls.originalBytes.toLocaleString()} bytes (content-type=${cls.contentType ?? 'unknown'})`,
            ];
          }
          // json | text — stash in a bucket
          const bucket = nextHandle(handlePrefix);
          const target = cls.kind === 'json' ? cls.parsed : cls.raw;
          memorySet(ctx.conversationId, bucket, [target]);
          const shape = describeShape(target);
          const totalLine =
            shape.total != null ? `, total: ${shape.total}` : '';
          const block: string[] = [
            `${label}: ${cls.originalBytes.toLocaleString()} bytes (${cls.kind}) → bucket "${bucket}"`,
            `  type: ${shape.type}${totalLine}`,
            `  schema: ${shape.schema}`,
          ];
          if (shape.homogeneous) block.push(`  homogeneous: ${shape.homogeneous}`);
          block.push(
            `  Read with: memory_get({ bucket: "${bucket}", describe?, path?, offset?, limit? })`,
          );
          return block;
        };

        const requestBodyBlock = renderBodyBlock(
          'Request payload',
          'inspect_request',
          entry.requestBody,
          reqContentType,
          entry.requestBodyOmitted === true,
        );
        const responseBodyBlock = renderBodyBlock(
          'Response body',
          'inspect_response',
          entry.body,
          respContentType,
          false,
        );

        // Ready-to-paste fetch() replicator. Includes the SAME placeholder
        // tokens used in the displayed headers. The snippet's last
        // expression is `[body]` — wrap it with `appendToBucket: "name"`
        // to push the parsed body into a fresh bucket on each call
        // (useful for paginated requests).
        const snippet = buildFetchSnippet({
          url: entry.url,
          method: entry.method,
          headers: entry.requestHeaders ?? {},
          body: entry.requestBody,
          sensitiveHeaderTokens: sensitiveTokens,
        });

        const lines: string[] = [
          `Request ${entry.requestId}`,
          `  ${entry.method} ${entry.url}`,
          `  status: ${entry.status ?? 'pending'}${entry.statusText ? ` ${entry.statusText}` : ''}`,
          `  responseSize: ${entry.size ?? '?'} bytes${respContentType ? ` · ${respContentType}` : ''}`,
          ``,
          `Request headers (browser-controlled headers like User-Agent, Cookie, sec-ch-* omitted — auto-applied by fetch):`,
          fmtRequestHeaders(entry.requestHeaders),
          ``,
          ...requestBodyBlock,
          ``,
          ...responseBodyBlock,
          ``,
          `Replicate via run_js — paste this AS-IS, set \`appendToBucket: "<name>"\` to capture the fresh body into a bucket:`,
          snippet,
        ];
        if (anySensitive) {
          lines.push(
            ``,
            `<system-reminder>`,
            `The snippet above already contains opaque placeholders ` +
              `(__doeverything_SECRET_…__) for sensitive headers. The runtime ` +
              `substitutes real values before the JS reaches the page — the ` +
              `actual secrets never enter the conversation. To paginate or ` +
              `tweak params, edit only the URL or the body of fetch's first ` +
              `argument; leave the placeholder strings untouched. Cookies are ` +
              `auto-included by \`credentials: 'include'\` so you don't need ` +
              `to copy a Cookie header.`,
            `</system-reminder>`,
          );
        }
        return {
          output: lines.join('\n'),
        };
      },
    }),

    replay_network_request: tool({
      description:
        'Re-executes a captured request by `requestId` with optional URL/query/method/header/body overrides (per-key `null` drops). Runs via `fetch()` in page context (cookies + auth carry). Mutating methods or risky paths (`/checkout`, `/delete`, `/payment`, …) require `confirmRiskyReplay: true`. Response body buckets with schema preview. For full extraction use `run_js` + `appendToBucket`.',
      inputSchema: z.object({
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
        requestId: z.string().describe('RequestId from read_network_requests output to use as a template.'),
        urlOverride: z.string().optional().describe('Replace the entire URL. Mutually exclusive with queryOverrides.'),
        queryOverrides: z
          .record(z.union([z.string(), z.null()]))
          .optional()
          .describe('Override or add query params. Pass null to remove a param.'),
        methodOverride: z.string().optional().describe('Override HTTP method (defaults to original).'),
        headerOverrides: z
          .record(z.union([z.string(), z.null()]))
          .optional()
          .describe('Headers to merge. Pass null to drop.'),
        bodyOverride: z.string().optional().describe('Replace the request body string.'),
        bodyIsJson: z
          .boolean()
          .optional()
          .describe('If true and bodyOverride set, auto-add Content-Type: application/json.'),
        confirmRiskyReplay: z
          .boolean()
          .optional()
          .describe('Required true when replaying non-GET/HEAD or risky URL paths.'),
      }),
      execute: async params => {
        const {
          tabId: requestedTabId,
          requestId,
          urlOverride,
          queryOverrides,
          methodOverride,
          headerOverrides,
          bodyOverride,
          bodyIsJson,
          confirmRiskyReplay,
        } = params;
        if (!requestId) return { error: 'requestId is required' };
        if (urlOverride && queryOverrides) return { error: 'Pass either urlOverride or queryOverrides, not both' };
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        const original = ctx.cdp.getNetworkRequest(tabId, requestId);
        if (!original) return { error: `Request ${requestId} not found. Re-run read_network_requests.` };

        let finalUrl = original.url;
        if (urlOverride) finalUrl = urlOverride;
        else if (queryOverrides && Object.keys(queryOverrides).length > 0) {
          try {
            const parsed = new URL(original.url);
            for (const [k, v] of Object.entries(queryOverrides)) {
              if (v === null) parsed.searchParams.delete(k);
              else parsed.searchParams.set(k, v);
            }
            finalUrl = parsed.toString();
          } catch {
            return { error: `Invalid URL for queryOverrides: ${original.url}` };
          }
        }
        const finalMethod = (methodOverride ?? original.method).toUpperCase();
        const isMutating = !['GET', 'HEAD', 'OPTIONS'].includes(finalMethod);
        const RISKY =
          /\/(delete|logout|sign[-_]?out|purchase|charge|checkout|transfer|cancel|orders?|payment|refund|withdraw|subscribe|unsubscribe)(?:\/|\?|$)/i;
        const riskyPath = (() => {
          try {
            return RISKY.test(new URL(finalUrl).pathname);
          } catch {
            return RISKY.test(finalUrl);
          }
        })();
        if ((isMutating || riskyPath) && !confirmRiskyReplay) {
          const reasons: string[] = [];
          if (isMutating) reasons.push(`method ${finalMethod}`);
          if (riskyPath) reasons.push('URL path matches risky pattern');
          return {
            error: `Refusing to replay: this request is potentially state-changing (${reasons.join(', ')}). If the user has explicitly authorized this action, retry with confirmRiskyReplay=true.\n\nResolved URL: ${finalUrl}`,
          };
        }
        const finalHeaders: Record<string, string> = {};
        if (original.requestHeaders) {
          for (const [k, v] of Object.entries(original.requestHeaders)) {
            const lower = k.toLowerCase();
            if (
              lower.startsWith(':') ||
              lower === 'cookie' ||
              lower === 'host' ||
              lower === 'content-length' ||
              lower === 'connection' ||
              lower === 'transfer-encoding'
            )
              continue;
            finalHeaders[k] = v;
          }
        }
        if (headerOverrides) {
          for (const [k, v] of Object.entries(headerOverrides)) {
            if (v === null) {
              for (const existing of Object.keys(finalHeaders)) {
                if (existing.toLowerCase() === k.toLowerCase()) delete finalHeaders[existing];
              }
            } else {
              finalHeaders[k] = v;
            }
          }
        }
        const finalBody = bodyOverride !== undefined ? bodyOverride : original.body;
        if (
          finalBody !== undefined &&
          bodyIsJson &&
          !Object.keys(finalHeaders).some(h => h.toLowerCase() === 'content-type')
        ) {
          finalHeaders['Content-Type'] = 'application/json';
        }
        const init: Record<string, unknown> = {
          method: finalMethod,
          headers: finalHeaders,
          credentials: 'include',
          mode: 'cors',
          redirect: 'follow',
        };
        if (finalBody !== undefined && finalMethod !== 'GET' && finalMethod !== 'HEAD') init.body = finalBody;
        // No internal body cap — universal result-compressor decides
        // whether to persist + envelope based on declared
        // maxResultSizeChars (replay_network_request: 100K).
        const expr = `(async () => {
          try {
            const r = await fetch(${JSON.stringify(finalUrl)}, ${JSON.stringify(init)});
            const text = await r.text();
            return JSON.stringify({
              ok: r.ok, status: r.status, statusText: r.statusText,
              headers: Object.fromEntries(r.headers.entries()),
              body: text,
              bodyLength: text.length, finalUrl: r.url,
            });
          } catch (e) { return JSON.stringify({ error: String((e && e.message) || e) }); }
        })()`;
        const evalRes = (await ctx.cdp.send(tabId, 'Runtime.evaluate', {
          expression: expr,
          returnByValue: true,
          awaitPromise: true,
          timeout: 30_000,
        })) as {
          result?: { value?: string };
          exceptionDetails?: { exception?: { description?: string }; text?: string };
        };
        if (evalRes.exceptionDetails) {
          return {
            error: `Replay failed in page context: ${evalRes.exceptionDetails.exception?.description ?? evalRes.exceptionDetails.text ?? 'Unknown error'}`,
          };
        }
        const raw = evalRes.result?.value;
        if (typeof raw !== 'string') return { error: 'Replay returned no value' };
        let parsed: {
          ok?: boolean;
          status?: number;
          statusText?: string;
          headers?: Record<string, string>;
          body?: string;
          bodyLength?: number;
          finalUrl?: string;
          error?: string;
        };
        try {
          parsed = JSON.parse(raw);
        } catch {
          return { error: `Replay returned non-JSON: ${raw.slice(0, 500)}` };
        }
        if (typeof parsed.error === 'string') return { error: `fetch() failed: ${parsed.error}` };
        const SENSITIVE =
          /^(authorization|cookie|set-cookie|x-api-key|x-auth-token|proxy-authorization|www-authenticate)$/i;
        const headersFmt = parsed.headers
          ? Object.entries(parsed.headers)
              .map(([k, v]) => `  ${k}: ${SENSITIVE.test(k) ? '[redacted]' : v}`)
              .join('\n')
          : '  (none)';

        // Body handling — identical pattern to `inspect_network_request`:
        // bucket the response body, advertise its shape inline, let the
        // agent drill / page through `memory_get`. One canonical
        // inspection surface for every JSON the agent encounters.
        const replayContentType = parsed.headers?.['content-type'] ?? parsed.headers?.['Content-Type'];
        const replayBodyBlock: string[] = (() => {
          const cls = classifyBody(parsed.body, replayContentType);
          if (cls.kind === 'empty') return ['Response body:', '  (empty)'];
          if (cls.kind === 'binary') {
            return [
              'Response body — binary:',
              `  ${cls.originalBytes.toLocaleString()} bytes (content-type=${cls.contentType ?? 'unknown'})`,
            ];
          }
          const bucket = nextHandle('replay_response');
          const target = cls.kind === 'json' ? cls.parsed : cls.raw;
          memorySet(ctx.conversationId, bucket, [target]);
          const shape = describeShape(target);
          const totalLine = shape.total != null ? `, total: ${shape.total}` : '';
          const block: string[] = [
            `Response body: ${cls.originalBytes.toLocaleString()} bytes (${cls.kind}) → bucket "${bucket}"`,
            `  type: ${shape.type}${totalLine}`,
            `  schema: ${shape.schema}`,
          ];
          if (shape.homogeneous) block.push(`  homogeneous: ${shape.homogeneous}`);
          block.push(
            `  Read with: memory_get({ bucket: "${bucket}", describe?, path?, offset?, limit? })`,
          );
          return block;
        })();

        const lines = [
          `Replayed ${finalMethod} ${finalUrl}`,
          `  status: ${parsed.status} ${parsed.statusText ?? ''}`,
          `  finalUrl: ${parsed.finalUrl ?? finalUrl}`,
          `  bodyLength: ${parsed.bodyLength ?? '?'} bytes`,
          ``,
          `Response headers:`,
          headersFmt,
          ``,
          ...replayBodyBlock,
        ];
        return {
          output: lines.join('\n'),
        };
      },
    }),
  };
}
