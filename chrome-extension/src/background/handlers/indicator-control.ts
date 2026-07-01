/**
 * Receives messages emitted by the visual-indicator content script.
 *
 * Right now we only care about the "Stop doeverything" pill — clicking it sends
 * `doe/indicator/stop`, and we abort the active agent run via the
 * shared `AgentRegistry`. The other indicator-emitted messages
 * (`switch-to-main-tab`, `dismiss-static`, `heartbeat`) are stubbed so the
 * content script doesn't see a `chrome.runtime.lastError` for missing
 * handlers; full implementations follow in Phase 7 (tab groups) and 9
 * (workflow recording).
 */

import { AgentRegistry } from '../agent/registry.js';

const INDICATOR_PREFIX = 'doe/indicator/';

export function registerIndicatorControlHandlers() {
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as { type?: string } | null;
    if (!msg?.type?.startsWith(INDICATOR_PREFIX)) return false;

    switch (msg.type) {
      case 'doe/indicator/stop': {
        const aborted = AgentRegistry.abortActive();
        sendResponse({ ok: aborted });
        return false;
      }
      case 'doe/indicator/heartbeat':
        // Static badge heartbeat — Phase 7 hooks tab-group ownership in here.
        sendResponse({ ok: false });
        return false;
      case 'doe/indicator/switch-to-main-tab':
      case 'doe/indicator/dismiss-static':
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });
}
