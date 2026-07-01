/**
 * Lifecycle handlers — fire on install/update/startup so doeverything always
 * boots with consistent state regardless of how the SW gets evicted.
 *
 * Responsibilities:
 *   - Side-panel auto-open on action click
 *   - Badge derived from LLM config (`needs-config` / `idle`)
 *   - Live LLM config watcher → keeps badge correct as the user types
 *   - chrome.notifications click → focus the originating tab
 *   - Set uninstall URL so we can collect feedback
 *   - Welcome the user on fresh install (notification + open options)
 */

import { refreshBadgeFromConfig, watchLlmConfig } from './badge.js';
import { seedBuiltInSkills } from '../skills/seed.js';
import { llmConfigStorage } from '@doeverything/storage';
import { isBuiltInProviderId } from '@doeverything/llm-providers';

const UNINSTALL_BASE = 'https://doeverythi.ng/uninstall';

async function updateUninstallURL() {
  const version = chrome.runtime.getManifest().version;
  const stored  = await chrome.storage.local.get('doe:install-date');
  const params  = new URLSearchParams({ v: version });
  if (stored['doe:install-date']) {
    const days = Math.floor((Date.now() - (stored['doe:install-date'] as number)) / 86_400_000);
    params.set('days', String(days));
  }
  try {
    chrome.runtime.setUninstallURL(`${UNINSTALL_BASE}?${params}`);
  } catch {
    // setUninstallURL is sync and rarely fails; ignore.
  }
}

async function migrateRemovedProviders() {
  const cfg = await llmConfigStorage.get();
  const isKnown = (id: string) => isBuiltInProviderId(id) || id.startsWith('custom:');
  if (!isKnown(cfg.provider)) {
    await llmConfigStorage.setProvider('anthropic');
  }
  if (cfg.fastModel && !isKnown(cfg.fastModel.provider)) {
    await llmConfigStorage.setFastModel(null);
  }
}

export function registerLifecycleHandlers() {
  chrome.runtime.onInstalled.addListener(async details => {
    // Explicitly OFF: we handle action clicks in handlers/action.ts so we can
    // adopt the active tab into the doeverything group and call setOptions before
    // opening, which keeps the panel scoped to group tabs only.
    await chrome.sidePanel
      .setPanelBehavior({ openPanelOnActionClick: false })
      .catch(err => console.error('[doeverything] setPanelBehavior failed', err));

    await migrateRemovedProviders().catch(err => console.warn('[doeverything] provider migration failed', err));

    if (details.reason === 'install') {
      await chrome.storage.local.set({ 'doe:install-date': Date.now() });
      await welcomeUser();
      // Seed bundled SKILL.md files so a fresh install has at least one
      // working example. `force: false` makes this a no-op if the user
      // already has a skill of the same name.
      await seedBuiltInSkills().catch(err => console.warn('[doeverything] skill seed failed', err));
    }
    if (details.reason === 'update') {
      await chrome.storage.local.set({ 'doe:last-version': details.previousVersion ?? '' });
      // Re-seed on update too. The seeder adds new built-ins and silently
      // replaces existing ones whose bundled `version` has been bumped
      // (so body fixes ship without users having to click "Restore
      // defaults"). Same-version seeds are no-ops.
      await seedBuiltInSkills().catch(err => console.warn('[doeverything] skill seed failed', err));
    }

    await updateUninstallURL().catch(() => {});
    await refreshBadgeFromConfig();
  });

  chrome.runtime.onStartup.addListener(async () => {
    await updateUninstallURL().catch(() => {});
    await refreshBadgeFromConfig();
  });

  // Click a notification → focus the tab that produced it.
  chrome.notifications.onClicked.addListener(async notificationId => {
    chrome.notifications.clear(notificationId);
    const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('side-panel/index.html') });
    if (tabs[0]?.id && tabs[0].windowId) {
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      await chrome.tabs.update(tabs[0].id, { active: true });
    } else {
      const win = await chrome.windows.getCurrent();
      if (win.id) await chrome.sidePanel.open({ windowId: win.id });
    }
  });

  // Update-available signal so the side panel can show a banner.
  chrome.runtime.onUpdateAvailable.addListener(details => {
    void chrome.storage.local.set({
      'doe:update-available': { version: details.version, detectedAt: Date.now() },
    });
  });

  // Badge follows the user's LLM config (warn if no key).
  watchLlmConfig();
}

async function welcomeUser() {
  try {
    await chrome.notifications.create('de-welcome', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icon-128.png'),
      title: 'doeverything installed',
      message: 'Open the Settings page to pick an LLM provider and add your API key.',
      priority: 1,
    });
  } catch {
    // notifications permission may be denied; never block install.
  }
  // Open the Options page so the user lands on the LLM tab.
  void chrome.runtime.openOptionsPage();
}
