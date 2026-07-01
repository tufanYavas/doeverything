/**
 * Toolbar badge state — shows tiny status next to the doeverything action icon.
 *
 *   "" (cleared)   → idle, signed in
 *   "•"            → agent running (pulsing rendered by the indicator script)
 *   "!"            → not signed in or LLM key missing
 *   "ERR"          → last run errored (cleared on next start)
 *
 * The SW updates the badge from a small set of well-known events:
 *   - on install / startup → reflect signed-in state
 *   - on agent run start  → set "•"
 *   - on agent done       → clear
 *   - on agent error      → set "ERR"
 *   - on llm config change → set "!" if no API key
 */

import { llmConfigStorage } from '@doeverything/storage';

type BadgeState = 'idle' | 'running' | 'error' | 'needs-config';

const COLORS: Record<BadgeState, string> = {
  idle: '#00000000',
  running: '#d97757',
  error: '#dc2626',
  'needs-config': '#f59e0b',
};

const TEXT: Record<BadgeState, string> = {
  idle: '',
  running: '•',
  error: 'ERR',
  'needs-config': '!',
};

export async function setBadge(state: BadgeState) {
  await chrome.action.setBadgeBackgroundColor({ color: COLORS[state] });
  await chrome.action.setBadgeText({ text: TEXT[state] });
  if (state === 'running') {
    await chrome.action.setTitle({ title: 'doeverything · running…' });
  } else if (state === 'needs-config') {
    await chrome.action.setTitle({ title: 'doeverything · add an LLM API key' });
  } else if (state === 'error') {
    await chrome.action.setTitle({ title: 'doeverything · last run errored' });
  } else {
    await chrome.action.setTitle({ title: 'Open doeverything' });
  }
}

export async function refreshBadgeFromConfig() {
  const cfg = await llmConfigStorage.get();
  const apiKey = cfg.apiKeys[cfg.provider] ?? '';
  if (!apiKey && cfg.provider !== 'openai-compatible') {
    await setBadge('needs-config');
  } else {
    await setBadge('idle');
  }
}

export function watchLlmConfig() {
  llmConfigStorage.subscribe(() => {
    void refreshBadgeFromConfig();
  });
}
