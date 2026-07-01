import { useEffect } from 'react';

/**
 * Bridges the service worker's `chrome.commands` handlers to the side panel.
 *
 * Two channels:
 *
 *   1. `doe:clear-conversation` (chrome.storage.local) — written by the
 *      SW when the user presses the global "new conversation" shortcut
 *      (Ctrl+Shift+E). Drained here: the key is removed before acting so a
 *      re-mount can't replay it, and entries older than the freshness
 *      window are discarded (a stale value may be sitting in storage from
 *      before this reader existed). Signals carry the originating
 *      `windowId`; panels in other windows leave the key for the target
 *      panel to consume.
 *
 *   2. A long-lived `doe/side-panel/<windowId>` port — its existence
 *      tells the SW the panel is open in this window, which is what lets
 *      the global toggle shortcut (Ctrl+E) close an open panel. The SW
 *      answers the toggle with a close message and we `window.close()`.
 *      MV3 recycles idle service workers and severs their ports, so the
 *      port reconnects on disconnect — that wakes the SW and re-registers
 *      this panel in its (in-memory) open-panel map.
 */

const CLEAR_KEY = 'doe:clear-conversation';
/** Signals older than this are considered stale leftovers, not commands. */
const CLEAR_SIGNAL_FRESH_MS = 10_000;
/** Backoff before re-announcing presence after the SW drops the port. */
const RECONNECT_DELAY_MS = 500;

export function useClearConversationSignal(onClear: () => void) {
  useEffect(() => {
    let active = true;

    const drain = async () => {
      try {
        const record = await chrome.storage.local.get(CLEAR_KEY);
        const entry: unknown = record?.[CLEAR_KEY];
        if (!entry || !active) return;
        const targetWindowId = typeof entry === 'object' && 'windowId' in entry ? entry.windowId : undefined;
        if (typeof targetWindowId === 'number') {
          const win = await chrome.windows.getCurrent();
          // Another window's signal — leave it for that panel to consume.
          if (!active || win.id !== targetWindowId) return;
        }
        await chrome.storage.local.remove(CLEAR_KEY);
        const ts = typeof entry === 'object' && 'ts' in entry ? entry.ts : undefined;
        if (typeof ts === 'number' && Date.now() - ts < CLEAR_SIGNAL_FRESH_MS) onClear();
      } catch (err) {
        console.warn('[doeverything] could not drain clear-conversation signal', err);
      }
    };

    drain();

    const onChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: chrome.storage.AreaName) => {
      if (areaName !== 'local') return;
      if (!changes[CLEAR_KEY]?.newValue) return;
      drain();
    };

    chrome.storage.onChanged.addListener(onChange);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(onChange);
    };
  }, [onClear]);
}

export function useSidePanelPresence() {
  useEffect(() => {
    let port: chrome.runtime.Port | null = null;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = (windowId: number) => {
      if (cancelled) return;
      try {
        port = chrome.runtime.connect({ name: `doe/side-panel/${windowId}` });
      } catch {
        // Extension context invalidated (update/reload) — nothing to do.
        return;
      }
      port.onMessage.addListener((msg: unknown) => {
        if (typeof msg === 'object' && msg !== null && 'type' in msg && msg.type === 'doe/panel/close') {
          window.close();
        }
      });
      // SW recycling drops the port; reconnect so the fresh SW instance
      // learns this panel is still open. Self-initiated disconnect() in
      // the cleanup below does not fire this listener locally.
      port.onDisconnect.addListener(() => {
        port = null;
        if (!cancelled) retry = setTimeout(() => connect(windowId), RECONNECT_DELAY_MS);
      });
    };

    void chrome.windows.getCurrent().then(win => {
      if (cancelled || typeof win.id !== 'number') return;
      connect(win.id);
    });

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      port?.disconnect();
    };
  }, []);
}
