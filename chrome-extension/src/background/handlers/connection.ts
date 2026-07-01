/**
 * Side panel ↔ SW connection bridge.
 *
 * Handles UI commands related to the MCP relay connection. The MCP bridge
 * (`../mcp/bridge.ts`) owns the actual WebSocket; this module just exposes a
 * tiny request/response surface for the panel:
 *
 *   - de/connection/connect      : open or refresh the relay WebSocket
 *   - de/connection/disconnect   : tear down the WebSocket
 *   - de/connection/rotate-token : mint a new token (revokes old URL)
 *   - de/connection/get-info     : { connectorUrl, status, ... }
 */

import { McpBridge } from '../mcp/bridge.js';
import { connectionStorage } from '@doeverything/storage';

export function registerConnectionHandlers() {
  chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
    const msg = raw as { type?: string } | null;
    if (!msg?.type?.startsWith('doe/connection/')) return false;

    (async () => {
      try {
        switch (msg.type) {
          case 'doe/connection/connect': {
            const info = await McpBridge.connect();
            sendResponse({ ok: true, info });
            break;
          }
          case 'doe/connection/disconnect': {
            await McpBridge.disconnect();
            sendResponse({ ok: true });
            break;
          }
          case 'doe/connection/rotate-token': {
            await McpBridge.disconnect();
            await connectionStorage.resetToken();
            const info = await McpBridge.connect();
            sendResponse({ ok: true, info });
            break;
          }
          case 'doe/connection/get-info': {
            const info = await McpBridge.describe();
            sendResponse({ ok: true, info });
            break;
          }
          default:
            sendResponse({ ok: false, error: 'Unknown connection message' });
        }
      } catch (err) {
        sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    })();
    return true;
  });
}
