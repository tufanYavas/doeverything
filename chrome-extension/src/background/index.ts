import 'webextension-polyfill';

import { connectionStorage } from '@doeverything/storage';
import { registerAgentPortBridge } from './agent/port-bridge.js';
import { featureFlags } from './feature-flags.js';
import { registerActionHandler } from './handlers/action.js';
import { registerCommandHandler } from './handlers/commands.js';
import { registerConnectionHandlers } from './handlers/connection.js';
import { registerConversationHandlers } from './handlers/conversation.js';
import { registerConvertConversationHandlers } from './handlers/convert-conversation.js';
import { registerIndicatorControlHandlers } from './handlers/indicator-control.js';
import { registerLifecycleHandlers } from './handlers/lifecycle.js';
import { registerMemoryAdminHandlers } from './handlers/memory-admin.js';
import { registerPermissionDecisionHandler } from './handlers/permission-decision.js';
import { registerRecordingHandlers } from './handlers/recording.js';
import { registerRegionScreenshotHandler } from './handlers/region-screenshot.js';
import { registerRunsHandlers } from './handlers/runs.js';
import { registerSelectorHandler } from './handlers/selector.js';
import { registerSkillsHandlers } from './handlers/skills.js';
import { registerTabPanelHandler } from './handlers/tab-panel.js';
import { McpBridge } from './mcp/bridge.js';
import { registerInternalMessageRouter } from './messaging/router.js';
import { registerScheduler } from './scheduling/scheduler.js';

void featureFlags.bootstrap();
registerLifecycleHandlers();
registerActionHandler();
registerCommandHandler();
registerConnectionHandlers();
registerInternalMessageRouter();
registerIndicatorControlHandlers();
registerPermissionDecisionHandler();
registerRecordingHandlers();
registerRunsHandlers();
registerSelectorHandler();
registerRegionScreenshotHandler();
registerSkillsHandlers();
registerConversationHandlers();
registerConvertConversationHandlers();
registerTabPanelHandler();
registerMemoryAdminHandlers();
registerAgentPortBridge();
registerScheduler();

// On SW boot, restore the relay connection if the user previously opted in,
// or reset a stale error status so the UI doesn't show a phantom error.
void (async () => {
  try {
    const stored = await connectionStorage.get();
    if (!stored.userEnabled && (stored.status !== 'disconnected' || stored.lastError)) {
      await connectionStorage.setStatus('disconnected');
    }
    await McpBridge.keepalive();
  } catch (err) {
    console.warn('[doeverything] boot relay restore failed', err);
  }
})();

// Keepalive: MV3 service workers go dormant after ~30 s idle, which kills
// the WebSocket. Setting an alarm wakes the SW periodically; on each tick
// we re-open the relay socket if the user has opted in and it isn't OPEN.
// The alarm survives SW restarts (chrome.alarms is persisted), so we only
// need to (re)create it once per boot.
const KEEPALIVE_ALARM = 'doe/mcp/keepalive';
void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== KEEPALIVE_ALARM) return;
  void McpBridge.keepalive().catch(err => {
    console.warn('[doeverything] mcp keepalive failed', err);
  });
});
