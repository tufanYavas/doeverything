/**
 * Receives `doe/permission/decision` messages emitted by the side
 * panel's PermissionPrompt UI and forwards them to the PermissionManager.
 */

import { PermissionManager } from '../permissions/manager.js';
import type { PermissionDecision } from '../permissions/manager.js';

export function registerPermissionDecisionHandler() {
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as { type?: string; requestId?: string; decision?: PermissionDecision } | null;
    if (msg?.type !== 'doe/permission/decision') return false;
    if (!msg.requestId || !msg.decision) {
      sendResponse({ ok: false, error: 'Missing requestId or decision' });
      return false;
    }
    const ok = PermissionManager.resolve(msg.requestId, msg.decision);
    sendResponse({ ok });
    return false;
  });
}
