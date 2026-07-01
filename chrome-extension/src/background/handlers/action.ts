/**
 * Toolbar action click → adopt the clicked tab into the doeverything tab group
 * and open a per-tab side panel for it.
 *
 * Critical: Chrome enforces that `chrome.sidePanel.open()` runs *inside* the
 * user-gesture callstack. Even a single `await` between the click event and
 * `open()` makes Chrome reject the call with
 *   "sidePanel.open() may only be called in response to a user gesture."
 *
 * So we keep this listener non-async and fire setOptions + open
 * synchronously. The async work (group adoption) only happens *after*
 * open() has been dispatched.
 */

import { TabGroupManager } from '../tabs/group-manager.js';

const PANEL_PATH = 'side-panel/index.html';

export function registerActionHandler() {
  chrome.action.onClicked.addListener(tab => {
    const tabId = tab.id;
    if (!tabId) return;

    // Both calls below return promises but we DELIBERATELY do not await
    // them. setOptions is queued synchronously; open consumes the queued
    // path on the same turn of the message loop. Awaiting either one would
    // strip the user gesture and break Chrome's permission check.
    // Path is intentionally constant across every grouped tab — Chrome keeps
    // the panel open across tab switches only when the path matches. Per-tab
    // querystrings would force a webview teardown each switch, defeating the
    // whole "panel follows the doeverything group" behavior.
    try {
      void chrome.sidePanel.setOptions({
        tabId,
        path: PANEL_PATH,
        enabled: true,
      });
      void chrome.sidePanel.open({ tabId });
    } catch (err) {
      console.error('[doeverything] sidePanel open failed', err);
      return;
    }

    // Group adoption is independent of the gesture; it can run async after
    // open() has already been kicked off. This is a SEED gesture — start a
    // new session group (or re-activate this tab's existing one), never
    // join another session just because the title matches.
    void TabGroupManager.adoptSeedTab(tabId);
  });
}
