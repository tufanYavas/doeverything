/**
 * Internal message router for chrome.runtime.onMessage.
 *
 * Phase 1 wires up only the trivial `ping` round-trip and a TODO for the
 * agent loop. Each future tool call, permission prompt, or storage mutation
 * will register itself here via `register(handler)`.
 */

import type { ExtensionMessage } from './types.js';

type AsyncResponder = (message: ExtensionMessage, sender: chrome.runtime.MessageSender) => Promise<unknown> | unknown;

const handlers = new Map<string, AsyncResponder>();

export function register<T extends ExtensionMessage['type']>(
  type: T,
  handler: (
    message: Extract<ExtensionMessage, { type: T }>,
    sender: chrome.runtime.MessageSender,
  ) => Promise<unknown> | unknown,
) {
  handlers.set(type, handler as AsyncResponder);
}

export function registerInternalMessageRouter() {
  register('doe/sidepanel/ping', () => ({ pong: true, name: 'doeverything' }));

  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (!isExtensionMessage(message)) return false;

    const handler = handlers.get(message.type);
    if (!handler) {
      console.warn('[doeverything] no handler for', message.type);
      return false;
    }

    Promise.resolve(handler(message, sender))
      .then(result => sendResponse({ ok: true, result }))
      .catch(err => sendResponse({ ok: false, error: serializeError(err) }));

    return true; // keep the channel open for the async response
  });
}

/**
 * Strict type guard — the router only owns the `doe/sidepanel/*` and
 * `doe/runs/*` namespaces (defined in `types.ts`). Every other handler
 * (`auth`, `selector`, `skills`, `region-screenshot`, …) wires its own
 * `chrome.runtime.onMessage.addListener` and is intentionally invisible to
 * the router. Without this filter, the router would log
 * "no handler for de/region-screenshot/start" for every legitimately
 * out-of-namespace message that other handlers do consume — pure noise.
 *
 * Keep this in sync with `ExtensionMessage` in `types.ts`. A typo in a
 * router-owned type still warns (good — that's a real bug); a message in
 * a foreign namespace falls through silently (also good).
 */
function isExtensionMessage(value: unknown): value is ExtensionMessage {
  if (typeof value !== 'object' || value === null) return false;
  const t = (value as { type?: unknown }).type;
  if (typeof t !== 'string') return false;
  return (
    t.startsWith('doe/sidepanel/') ||
    t.startsWith('doe/runs/') ||
    t.startsWith('doe/memory/')
  );
}

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return { name: 'UnknownError', message: String(err) };
}
