/**
 * Lightweight router over chrome.tabs.onUpdated, chrome.tabs.onRemoved,
 * and chrome.webNavigation.onHistoryStateUpdated.
 *
 * Browser tools wait for navigation completion, content scripts notify when
 * a tab is closed, etc. Adding a fresh chrome.tabs listener for each tool
 * call would leak; this hub aggregates listeners and tears the master
 * subscription down when nothing is listening.
 */

type StatusListener = (tabId: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void;
type RemovedListener = (tabId: number) => void;
type HistoryStateListener = (tabId: number, url: string) => void;

type Listeners = {
  onUpdated: Set<StatusListener>;
  onRemoved: Set<RemovedListener>;
  onHistoryState: Set<HistoryStateListener>;
};

const G = globalThis as unknown as { __doe_tab_hub?: Listeners };
if (!G.__doe_tab_hub) {
  G.__doe_tab_hub = { onUpdated: new Set(), onRemoved: new Set(), onHistoryState: new Set() };
} else if (!G.__doe_tab_hub.onHistoryState) {
  G.__doe_tab_hub.onHistoryState = new Set();
}
const lst = G.__doe_tab_hub;

let attached = false;

function ensureMaster() {
  if (attached) return;
  attached = true;
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    for (const cb of lst.onUpdated) {
      try {
        cb(tabId, info, tab);
      } catch (err) {
        console.error('[doeverything] tab onUpdated listener threw', err);
      }
    }
  });
  chrome.tabs.onRemoved.addListener(tabId => {
    for (const cb of lst.onRemoved) {
      try {
        cb(tabId);
      } catch (err) {
        console.error('[doeverything] tab onRemoved listener threw', err);
      }
    }
  });
  // SPA frameworks (React Router, Next.js, Vue Router, etc.) rewrite the URL
  // via history.pushState() without triggering a real page load, so
  // chrome.tabs.onUpdated never fires 'loading' → 'complete' for them.
  // webNavigation.onHistoryStateUpdated is the only reliable signal for these.
  chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
    if (details.frameId !== 0) return; // main frame only, ignore iframes
    for (const cb of lst.onHistoryState) {
      try {
        cb(details.tabId, details.url);
      } catch (err) {
        console.error('[doeverything] webNavigation onHistoryStateUpdated listener threw', err);
      }
    }
  });
}

// After historyStateUpdated fires, the framework still needs to flush its
// render cycle. 500 ms covers React, Vue, and Angular's default batch sizes
// and matches Playwright's built-in SPA settle heuristic.
const SPA_SETTLE_MS = 500;

export const TabEventHub = {
  onUpdated(callback: StatusListener): () => void {
    ensureMaster();
    lst.onUpdated.add(callback);
    return () => lst.onUpdated.delete(callback);
  },
  onRemoved(callback: RemovedListener): () => void {
    ensureMaster();
    lst.onRemoved.add(callback);
    return () => lst.onRemoved.delete(callback);
  },
  onHistoryState(callback: HistoryStateListener): () => void {
    ensureMaster();
    lst.onHistoryState.add(callback);
    return () => lst.onHistoryState.delete(callback);
  },

  /**
   * Wait for the given tab to finish navigating — handles both:
   *   • Full-page navigations: tab.status transitions to 'complete'
   *   • SPA pushState navigations: webNavigation.onHistoryStateUpdated fires,
   *     then SPA_SETTLE_MS is allowed for the framework to flush its render.
   *
   * Resolves with the final tab snapshot, or rejects on timeout / tab removal.
   */
  waitForLoad(tabId: number, options: { timeoutMs?: number; expectUrl?: string } = {}): Promise<chrome.tabs.Tab> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    return new Promise((resolve, reject) => {
      let done = false;
      let spaTimer: ReturnType<typeof setTimeout> | null = null;

      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error(`doeverything: tab ${tabId} load timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const offUpdated = TabEventHub.onUpdated((id, info, tab) => {
        if (id !== tabId || done) return;
        if (info.status !== 'complete') return;
        if (options.expectUrl && tab.url && !tab.url.startsWith(options.expectUrl)) return;
        // Full-page load takes priority; cancel any pending SPA settle timer.
        if (spaTimer) { clearTimeout(spaTimer); spaTimer = null; }
        done = true;
        cleanup();
        resolve(tab);
      });

      const offHistoryState = TabEventHub.onHistoryState((id, url) => {
        if (id !== tabId || done) return;
        if (options.expectUrl && !url.startsWith(options.expectUrl)) return;
        // Restart settle timer on each pushState call (rapid SPA redirects
        // can fire multiple times before the final route is committed).
        if (spaTimer) clearTimeout(spaTimer);
        spaTimer = setTimeout(async () => {
          if (done) return;
          done = true;
          cleanup();
          try {
            resolve(await chrome.tabs.get(tabId));
          } catch {
            reject(new Error(`doeverything: tab ${tabId} closed after SPA navigation`));
          }
        }, SPA_SETTLE_MS);
      });

      const offRemoved = TabEventHub.onRemoved(id => {
        if (id !== tabId || done) return;
        done = true;
        cleanup();
        reject(new Error(`doeverything: tab ${tabId} closed before load completed`));
      });

      const cleanup = () => {
        clearTimeout(timer);
        if (spaTimer) { clearTimeout(spaTimer); spaTimer = null; }
        offUpdated();
        offHistoryState();
        offRemoved();
      };
    });
  },
} as const;
