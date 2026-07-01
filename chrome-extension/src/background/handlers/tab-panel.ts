/**
 * Per-tab side-panel visibility enforcer.
 *
 * Chrome's side panel API lets us toggle visibility per tab via
 * `chrome.sidePanel.setOptions({tabId, enabled})`. We use that to keep the
 * panel scoped to doeverything tab-group members only:
 *
 *   - Switching to a group tab → panel enabled (with our path).
 *   - Switching to a non-group tab → panel disabled (Chrome auto-hides it).
 *   - When a tab is added to / removed from the group, options are updated.
 *
 * This runs entirely in the background SW; the side panel UI itself does
 * not need to know whether the current tab is "owned" or not.
 */

import { TabGroupManager } from '../tabs/group-manager.js';

const PANEL_PATH = 'side-panel/index.html';

async function syncPanelForTab(tabId: number) {
  // Mid-adoption the tab's groupId is in flux and the adoption flow itself
  // enables the panel — don't fight it from here.
  if (TabGroupManager.isAdopting(tabId)) return;
  const owned = await TabGroupManager.owns(tabId);
  try {
    if (owned) {
      // Constant path across grouped tabs — see action.ts for rationale.
      await chrome.sidePanel.setOptions({
        tabId,
        path: PANEL_PATH,
        enabled: true,
      });
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    }
  } catch (err) {
    // Tab may have closed mid-flight.
    console.warn('[doeverything] panel sync failed for tab', tabId, err);
  }
}

export function registerTabPanelHandler() {
  // When the user switches tabs, re-evaluate panel visibility for the new
  // active tab. This is what makes the panel "follow" the group.
  chrome.tabs.onActivated.addListener(({ tabId }) => {
    void syncPanelForTab(tabId);
  });

  // When a tab moves between groups (e.g. the user manually drags it out of
  // the doeverything group), re-sync so the panel reflects new ownership.
  //
  // We compare the *new* groupId from changeInfo directly against our cached
  // group id rather than going through owns(), because owns() lazy-loads via
  // chrome.tabGroups.query({title}). During adoption the group exists but
  // its title hasn't been applied yet, so the lazy load would (incorrectly)
  // report no ownership and we'd setOptions(enabled:false) the panel the
  // action handler just opened. Using getGroupId() and bailing on null keeps
  // the panel open across the adoption window.
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.groupId === undefined) return;
    const ourGroupId = TabGroupManager.getGroupId();
    if (ourGroupId === null) return;
    if (changeInfo.groupId === ourGroupId) {
      void chrome.sidePanel
        .setOptions({ tabId, path: PANEL_PATH, enabled: true })
        .catch(err => console.warn('[doeverything] panel enable failed for tab', tabId, err));
      return;
    }
    // A tab moving BETWEEN groups (adoption stealing it from another
    // extension's tab group) fires a transitional `groupId: -1` update
    // before the final one. Disabling on that transient would close the
    // panel the adoption flow just opened — and setOptions(enabled: true)
    // afterwards does NOT reopen a closed panel. Skip while adoption is in
    // flight, and re-read the settled groupId before acting.
    if (TabGroupManager.isAdopting(tabId)) return;
    void chrome.tabs
      .get(tabId)
      .then(tab => {
        if (tab.groupId === TabGroupManager.getGroupId()) {
          return chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
        }
        // Genuine departure (user dragged it out, or another extension's
        // grouper reclaimed it) — drop our bookkeeping so owns() agrees.
        TabGroupManager._forget(tabId);
        return chrome.sidePanel.setOptions({ tabId, enabled: false });
      })
      .catch(() => {
        // Tab closed mid-flight.
      });
  });

  // Also handle programmatic group changes via tabGroups events. Some Chrome
  // versions only fire one of these, so we listen to both.
  if (chrome.tabGroups?.onUpdated) {
    chrome.tabGroups.onUpdated.addListener(async () => {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (active?.id) void syncPanelForTab(active.id);
    });
  }
}
