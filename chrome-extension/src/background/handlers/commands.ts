/**
 * Keyboard command handlers.
 *
 *   - toggle-side-panel  → opens the doeverything side panel for the active
 *                          window, or closes it when already open
 *                          (Ctrl+E / ⌘+E by default).
 *   - new-conversation   → opens the side panel and pushes a "clear" signal
 *                          (drained by useClearConversationSignal in the panel).
 *   - stop-agent         → aborts any in-flight agent run via the registry.
 *   - open-options       → opens the Options page.
 *
 * Just like the action click, `chrome.sidePanel.open()` requires that the
 * call stack still carry a user gesture. Chrome's gesture token for extension
 * service workers is only valid during the synchronous call stack rooted in
 * the event handler — even Promise microtasks (.then()) exit that scope and
 * cause Chrome to reject the open() call. The shortcut handler receives the
 * originating `tab` directly, so both setOptions and open can be dispatched
 * synchronously without any I/O.
 *
 * Open-panel tracking: there is no `chrome.sidePanel.isOpen()`/`close()`,
 * so each panel page holds a long-lived `doe/side-panel/<windowId>`
 * port while mounted. Toggle consults the port map synchronously — if the
 * window already has a panel we message it to `window.close()` itself.
 */

import { AgentRegistry } from '../agent/registry.js';
import { TabGroupManager } from '../tabs/group-manager.js';

const PANEL_PATH = 'side-panel/index.html';
const PANEL_PORT_PREFIX = 'doe/side-panel/';

/** windowId → live port of the side panel open in that window. */
const openPanelPorts = new Map<number, chrome.runtime.Port>();

function openPanelSync(tab?: chrome.tabs.Tab): boolean {
  const tabId = tab?.id;
  if (!tabId) {
    console.warn('[doeverything] command without tab id — cannot open panel synchronously');
    return false;
  }
  // Both calls must be dispatched synchronously within the onCommand callback.
  // Chrome's user-gesture token for sidePanel.open() is only valid during the
  // synchronous call stack rooted in onCommand — Promises (even microtasks via
  // .then()) exit that scope and Chrome rejects the open() call.
  // Chrome processes IPC messages from the same extension in FIFO order, so
  // setOptions is guaranteed to complete before open is processed.
  chrome.sidePanel
    .setOptions({ tabId, path: PANEL_PATH, enabled: true })
    .catch(err => console.error('[doeverything] setOptions failed', err));
  chrome.sidePanel
    .open({ tabId })
    .catch(err => console.error('[doeverything] sidePanel.open failed', err));
  void TabGroupManager.adoptSeedTab(tabId);
  return true;
}

export function registerCommandHandler() {
  chrome.runtime.onConnect.addListener(port => {
    if (!port.name.startsWith(PANEL_PORT_PREFIX)) return;
    const windowId = Number(port.name.slice(PANEL_PORT_PREFIX.length));
    if (!Number.isInteger(windowId)) return;
    openPanelPorts.set(windowId, port);
    port.onDisconnect.addListener(() => {
      if (openPanelPorts.get(windowId) === port) openPanelPorts.delete(windowId);
    });
  });

  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'toggle-side-panel') {
      const openPort = typeof tab?.windowId === 'number' ? openPanelPorts.get(tab.windowId) : undefined;
      if (openPort) {
        openPort.postMessage({ type: 'doe/panel/close' });
        return;
      }
      openPanelSync(tab);
      return;
    }

    if (command === 'new-conversation') {
      openPanelSync(tab);
      // The side panel listens for this signal in chrome.storage. Async
      // write is fine — the user gesture has already been consumed by
      // sidePanel.open above. windowId scopes the clear to the window the
      // command targeted; panels in other windows ignore the signal.
      void chrome.storage.local.set({
        'doe:clear-conversation': { ts: Date.now(), windowId: tab?.windowId },
      });
      return;
    }

    if (command === 'stop-agent') {
      AgentRegistry.abortActive();
      return;
    }

    if (command === 'open-options') {
      chrome.runtime.openOptionsPage();
      return;
    }
  });
}
