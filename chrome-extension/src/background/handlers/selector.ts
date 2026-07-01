/**
 * Element-selector overlay coordinator.
 *
 *   - `Selector.requestRegion(tabId)`  → opens the overlay in `region` mode,
 *     returns a Promise that resolves with `{ rect, devicePixelRatio }`.
 *   - `Selector.requestElement(tabId)` → opens the overlay in `element`
 *     mode, returns a Promise resolving with `{ selector, rect, text }`.
 *
 * Tools call these to ask the user "draw a box" / "click an element" before
 * actions like `screenshot { region }` or `click_at_coord`.
 */

interface PendingRequest {
  resolve: (result: SelectorResult) => void;
  reject: (err: Error) => void;
}

export interface SelectorResult {
  cancelled?: boolean;
  mode?: 'region' | 'element';
  rect?: { x: number; y: number; width: number; height: number };
  devicePixelRatio?: number;
  selector?: string;
  text?: string;
}

const pending = new Map<string, PendingRequest>();

async function open(tabId: number, mode: 'region' | 'element'): Promise<SelectorResult> {
  const requestId = `sel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  await chrome.tabs.sendMessage(tabId, { type: 'doe/selector/start', requestId, mode }).catch(() => undefined);
  return new Promise<SelectorResult>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        reject(new Error('Selector overlay timed out after 60s'));
      }
    }, 60_000);
  });
}

export const Selector = {
  requestRegion: (tabId: number) => open(tabId, 'region'),
  requestElement: (tabId: number) => open(tabId, 'element'),
};

export function registerSelectorHandler() {
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as ({ type?: string; requestId?: string } & SelectorResult) | null;
    if (msg?.type !== 'doe/selector/result' || !msg.requestId) return false;
    const handle = pending.get(msg.requestId);
    if (!handle) {
      sendResponse({ ok: false });
      return false;
    }
    pending.delete(msg.requestId);
    handle.resolve(msg);
    sendResponse({ ok: true });
    return false;
  });
}
