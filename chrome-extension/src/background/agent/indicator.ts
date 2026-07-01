/**
 * Broadcast doeverything visual-indicator messages to every tab the agent owns.
 *
 * The vanilla content script (pages/content/src/matches/all/index.ts) is the
 * receiver. We swallow `chrome.tabs.sendMessage` errors because not every
 * tab has the content script (chrome:// pages, web store, …).
 */

import { TabGroupManager } from '../tabs/group-manager.js';

const MSG = {
  show: 'doe/indicator/show',
  hide: 'doe/indicator/hide',
  hideForTool: 'doe/indicator/hide-for-tool',
  showAfterTool: 'doe/indicator/show-after-tool',
} as const;

async function broadcast(type: string) {
  const targets = new Set<number>();

  // Anything in the doeverything tab group counts as agent-driven.
  const groupTabs = await TabGroupManager.listMembers();
  groupTabs.forEach(t => t.id && targets.add(t.id));

  // Plus the currently focused tab — that's where the user is watching.
  try {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (active?.id) targets.add(active.id);
  } catch {
    // ignore
  }

  await Promise.all(
    [...targets].map(async tabId => {
      try {
        await chrome.tabs.sendMessage(tabId, { type });
      } catch {
        // No content script on this tab — fine.
      }
    }),
  );
}

export const Indicator = {
  show: () => broadcast(MSG.show),
  hide: () => broadcast(MSG.hide),
  hideForTool: () => broadcast(MSG.hideForTool),
  showAfterTool: () => broadcast(MSG.showAfterTool),
};
