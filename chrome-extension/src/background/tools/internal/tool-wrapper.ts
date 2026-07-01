import { compressToolResult } from './result-compressor.js';
import { getMaxResultSizeChars } from './tool-result-limits.js';
import type { AgentToolContext } from '../context.js';

const DEFAULT_TIMEOUT_MS = 180_000;

/**
 * Per-tab execution queue. When the model emits multiple tool calls in a
 * single assistant turn (parallel tool-use), the SDK runs their `execute()`
 * functions concurrently. For tools that mutate a specific browser tab
 * (click, type, screenshot, read_page on `tabId=X`) concurrent execution is
 * a race — the screenshot might fire before the click lands. We serialise
 * per-tab by chaining each tool through a per-tab promise so same-tab
 * actions run in the order the model emitted them, while different-tab and
 * tab-less tools (memory_*, tabs_context, update_plan) stay fully parallel.
 *
 * Keying rule: serialise on the EXPLICIT `args.tabId` only. Calls that omit
 * tabId fall back to the active tab inside `getEffectiveTabId`, but we
 * can't see that resolution synchronously from here. The system prompt
 * tells the model to pass tabId explicitly whenever it batches.
 */
const tabQueues = new Map<number, Promise<unknown>>();

async function runOnTabQueue<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  const prev = tabQueues.get(tabId) ?? Promise.resolve();
  // Swallow upstream errors so one failed call doesn't poison the queue.
  const next = prev.then(fn, fn);
  tabQueues.set(tabId, next);
  try {
    return await next;
  } finally {
    // Clean up only if no follow-up call queued after us.
    if (tabQueues.get(tabId) === next) tabQueues.delete(tabId);
  }
}

// Per-tool watchdog timeouts. Keys MUST match registered tool names in
// `browser-tools.ts`; stale entries are silently ignored, so a typo here
// reverts the tool to `DEFAULT_TIMEOUT_MS`. Names verified 2026-05.
const TOOL_TIMEOUTS: Record<string, number> = {
  // Long-running by design — encoding / multi-frame capture
  gif_creator: 600_000,
  // Sequential dispatcher: cap matches the longest sub-tool (gif_creator);
  // each sub-action carries its own watchdog from this same map, so the
  // outer budget only fires if a whole batch wedges past every per-action
  // timeout combined.
  multi_action: 600_000,
  // Quick read-only / page-snapshot tools — keep tight so a hung injection bails fast
  read_page: 30_000,
  // `computer` covers click/type plus screenshot (CDP captureScreenshot
  // can take 1-2s on heavy pages); 30s is a generous ceiling for any single action.
  computer: 30_000,
  find: 60_000,
  find_elements: 30_000,
  read_console_messages: 15_000,
  read_network_requests: 15_000,
  inspect_network_request: 15_000,
  done: 5_000,
};

/**
 * Wraps every tool's `execute()` with three architectural concerns:
 *   1. Timeout watchdog (per-tool budget).
 *   2. Exception-to-result sandboxing (no thrown errors break the loop).
 *   3. UI lifecycle bracket (`onToolStart` + `finally{onToolEnd}`).
 *   4. Universal result compression — every tool result flows through
 *      `compressToolResult` with the tool's declared `maxResultSizeChars`
 *      (looked up in `tool-result-limits.ts`). Tools that opt out via
 *      `Infinity` (memory_get / skill / done) flow through untouched.
 *
 * Because start/end are bracketed on the same await chain, the SDK or
 * upstream caller cannot get an `onStart` without a matching `onEnd` —
 * orphan UI states are structurally impossible.
 */
export function wrapToolRoster(roster: Record<string, unknown>, ctx: AgentToolContext): void {
  for (const [toolName, t] of Object.entries(roster)) {
    const slot = t as {
      execute?: (args: unknown, opts: { toolCallId?: string } & Record<string, unknown>) => PromiseLike<unknown>;
    };
    const original = slot.execute;
    if (!original) continue;
    const timeoutMs = TOOL_TIMEOUTS[toolName] ?? DEFAULT_TIMEOUT_MS;
    const declaredMaxResultSizeChars = getMaxResultSizeChars(toolName);

    slot.execute = async (args, opts) => {
      const callId = opts?.toolCallId ?? `${toolName}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      // Sub-tools executed inside `multi_action` opt out of the lifecycle
      // bracket via this flag — the parent batch chip is the only UI
      // surface for the sequence. Timeout, queue, and compression still
      // apply.
      const suppressLifecycle = !!(opts as { __doeInBatch?: boolean } | undefined)?.__doeInBatch;
      if (!suppressLifecycle) ctx.lifecycle?.onToolStart({ id: callId, name: toolName, args });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let result: unknown;
      let isError = false;
      // Pick a per-tab serialisation key when the model explicitly targeted
      // a tab. Tab-less tools (memory_*, tabs_context, update_plan) keep
      // running fully parallel.
      const rawTabId = (args as { tabId?: unknown } | null | undefined)?.tabId;
      const queueTabId = typeof rawTabId === 'number' ? rawTabId : undefined;
      const runOnce = () =>
        Promise.race([
          original(args, opts),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () =>
                reject(new Error(`Tool "${toolName}" timed out after ${timeoutMs / 1000}s — likely hung; aborting.`)),
              timeoutMs,
            );
          }),
        ]);
      try {
        const raw = queueTabId === undefined ? await runOnce() : await runOnTabQueue(queueTabId, runOnce);
        // Universal compression. Oversized results get persisted into a
        // working-memory bucket and replaced with a plain-prose overflow
        // message (bucket name + 2 KB preview + read-more hint). The
        // model reads more via `memory_get({ bucket, offset, limit })`.
        result = compressToolResult(raw, {
          conversationId: ctx.conversationId,
          toolName,
          declaredMaxResultSizeChars,
        });
        if (result !== raw && typeof result === 'string') {
          console.info(`[doeverything] tool "${toolName}" → persisted (full output in bucket)`);
        }
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[doeverything] tool "${toolName}" execution failed`, message);
        isError = true;
        result = { ok: false, error: message };
        return result;
      } finally {
        if (timer) clearTimeout(timer);
        // Pair with onToolStart on every code path — success, error, timeout.
        if (!suppressLifecycle) ctx.lifecycle?.onToolEnd({ id: callId, name: toolName, result, isError });
      }
    };
  }
}
