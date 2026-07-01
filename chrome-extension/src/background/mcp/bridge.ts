/**
 * MCP relay WebSocket bridge.
 *
 * Owns a single `WebSocket` to the doeverything relay server (a Cloudflare
 * Worker + Durable Object). The relay forwards the MCP client's HTTP calls
 * onto our WS as `RelayEnvelope<JsonRpcRequest>` frames; we dispatch them
 * via `handleMcpRequest`, then send the response back as
 * `RelayEnvelope<JsonRpcResponse>` carrying the same `rid`.
 *
 *   MCP client ─HTTPS─> relay ─WS─> Extension SW ─> tools
 *
 * The extension never holds the user's LLM credentials; the MCP client
 * runs the model and only calls our exposed tool list. Subscription
 * billing happens on the client's side.
 *
 * Reconnect strategy: exponential backoff capped at 60s; we re-attach as
 * soon as the user has a token AND a relay base URL configured. Per-install
 * token comes from `connectionStorage.ensureToken()`. The relay base URL
 * defaults to `process.env['DOE_RELAY_BASE_URL']` and can be
 * overridden per-user from Settings.
 */

import { handleMcpRequest } from './dispatch.js';
import { connectionStorage } from '@doeverything/storage';
import type { JsonRpcRequest, RelayEnvelope } from './types.js';

const DEFAULT_RELAY_BASE_URL = process.env['DOE_RELAY_BASE_URL'] || '';
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;

/** chrome.storage.session key for the stable per-session epoch UUID. */
const SESSION_EPOCH_KEY = 'doe_mcp_session_epoch';

interface BridgeState {
  socket: WebSocket | null;
  url: string | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  /** Set when the user explicitly disconnected; suppresses auto-reconnect. */
  manuallyClosed: boolean;
  /**
   * Single-flight guard for `connect()`. Multiple async callers (boot
   * auto-dial, alarm-driven keepalive, user-clicked Connect) can interleave
   * across the awaits inside connect() and each pass the readyState guard
   * because state.socket is null until openSocket runs. Sharing the same
   * in-flight promise ensures only ONE WebSocket is opened per connect cycle;
   * concurrent callers await the same result.
   */
  connectInFlight: Promise<ConnectionInfo> | null;
  /**
   * Stable identifier for the logical MCP session. Generated once per session
   * (or recovered from chrome.storage.session after SW restart), reused across
   * all reconnects until the user explicitly disconnects. Embedded as `?sid=`
   * in the WS URL so the relay stores it as a hibernatable tag and echoes it
   * back in every envelope — giving context.ts a stable key for tab registry.
   */
  sessionEpochId: string | null;
  /**
   * `mcp_conn_${sessionEpochId}` — the key used in createToolContext's tab
   * registry. Derived from sessionEpochId, reset together with it.
   */
  connectionId: string | null;
}

const G = globalThis as unknown as { __doe_mcp?: BridgeState };
if (!G.__doe_mcp) {
  G.__doe_mcp = {
    socket: null,
    url: null,
    reconnectAttempts: 0,
    reconnectTimer: null,
    manuallyClosed: false,
    connectInFlight: null,
    sessionEpochId: null,
    connectionId: null,
  };
}
const state = G.__doe_mcp;

export interface ConnectionInfo {
  /** Public URL the user pastes into their MCP client's connector settings. */
  connectorUrl: string | null;
  /** Random per-install identifier; embedded in `connectorUrl`. */
  token: string | null;
  /** Relay base URL in use (resolved env-default or user override). */
  relayBaseUrl: string | null;
  /** Live WebSocket status. */
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  lastError: string | null;
  lastConnectedAt: number | null;
}

export const McpBridge = {
  /**
   * Open (or refresh) the relay WebSocket. Resolves with the latest
   * connection info regardless of WS readyState — the panel polls
   * storage for live status updates. Single-flight: concurrent callers
   * (boot, alarm, user) share one in-flight promise so only one WS opens.
   */
  async connect(): Promise<ConnectionInfo> {
    if (state.connectInFlight) return state.connectInFlight;
    state.connectInFlight = (async () => {
      try {
        state.manuallyClosed = false;
        await connectionStorage.setUserEnabled(true);
        const token = await connectionStorage.ensureToken();
        const baseUrl = await resolveRelayBaseUrl();
        if (!baseUrl) {
          await connectionStorage.setStatus('error', 'No relay base URL configured');
          return describeWith(token, baseUrl);
        }
        const wsUrl = relayWsUrl(baseUrl, token);
        if (state.socket && state.url === wsUrl && state.socket.readyState <= WebSocket.OPEN) {
          return describeWith(token, baseUrl);
        }
        state.url = wsUrl;
        state.reconnectAttempts = 0;
        await connectionStorage.setStatus('connecting');
        await ensureSessionEpochId();
        openSocket();
        return describeWith(token, baseUrl);
      } finally {
        state.connectInFlight = null;
      }
    })();
    return state.connectInFlight;
  },

  async disconnect(): Promise<void> {
    state.manuallyClosed = true;
    await connectionStorage.setUserEnabled(false);
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    state.socket?.close(1000, 'User disconnected');
    state.socket = null;
    state.url = null;
    // Reset session epoch so the next connect() generates a fresh UUID and a
    // fresh tab group rather than reusing the old session's tab.
    state.sessionEpochId = null;
    state.connectionId = null;
    void chrome.storage.session.remove(SESSION_EPOCH_KEY).catch(() => {});
    await connectionStorage.setStatus('disconnected');
  },

  async describe(): Promise<ConnectionInfo> {
    const stored = await connectionStorage.get();
    const baseUrl = await resolveRelayBaseUrl();
    return describeWith(stored.token, baseUrl);
  },

  /**
   * Periodic keepalive — invoked from a chrome.alarms tick. If the user
   * has opted in and the WebSocket isn't OPEN, redial.
   * Safe to call when already connected; it short-circuits.
   *
   * Necessary because MV3 service workers go dormant after ~30 s idle and
   * the OS may also drop a long-lived WebSocket through aggressive NAT or
   * proxy timeouts; without this tick the relay would think we're offline
   * even though the badge cached `status: 'connected'`.
   */
  async keepalive(): Promise<void> {
    const stored = await connectionStorage.get();
    if (!stored.userEnabled) return;
    if (state.manuallyClosed) return;
    if (state.socket && state.socket.readyState === WebSocket.OPEN) return;
    await McpBridge.connect();
  },
};

/**
 * Ensure `state.sessionEpochId` and `state.connectionId` are populated.
 *
 * On the happy path the values are already in memory. After an SW eviction
 * (but same logical session) we recover from chrome.storage.session. If
 * nothing is stored we generate a fresh UUID — this represents a new session.
 */
async function ensureSessionEpochId(): Promise<void> {
  if (state.sessionEpochId) return;
  try {
    const stored = await chrome.storage.session.get(SESSION_EPOCH_KEY);
    const persisted = stored[SESSION_EPOCH_KEY];
    if (typeof persisted === 'string' && persisted.length > 0) {
      state.sessionEpochId = persisted;
      state.connectionId = `mcp_conn_${persisted}`;
      return;
    }
  } catch { /* storage unavailable — generate fresh */ }
  const fresh = crypto.randomUUID();
  state.sessionEpochId = fresh;
  state.connectionId = `mcp_conn_${fresh}`;
  void chrome.storage.session.set({ [SESSION_EPOCH_KEY]: fresh }).catch(() => {});
}

function openSocket() {
  if (!state.url) return;
  // Re-entry guard: don't open a parallel socket if one is already
  // CONNECTING or OPEN. Belt-and-braces — connect() also single-flights,
  // but a stray scheduleReconnect tick could otherwise race a manual call.
  if (state.socket && state.socket.readyState <= WebSocket.OPEN) {
    console.log('[doeverything][mcp] openSocket skipped — socket already', state.socket.readyState);
    return;
  }
  // Embed the stable session epoch as ?sid= so the relay stores it as a
  // hibernatable WS tag and echoes it back in every forwarded envelope.
  const sid = state.sessionEpochId ?? `fallback_${Date.now()}`;
  const wsUrlWithSid = `${state.url}?sid=${encodeURIComponent(sid)}`;
  console.log('[doeverything][mcp] dialing', wsUrlWithSid);
  try {
    const sock = new WebSocket(wsUrlWithSid);
    state.socket = sock;

    /**
     * Identity guard for async events. After a disconnect+connect cycle (e.g.
     * rotate-token), the OLD socket's close/error events fire AFTER the new
     * socket has been installed in `state.socket`. Without this check, the
     * old event would null out the new socket reference and (worse) trigger
     * scheduleReconnect → infinite WS-open/close loop. We only act if THIS
     * socket is still the current state.socket.
     */
    const isCurrent = () => state.socket === sock;

    sock.addEventListener('open', () => {
      if (!isCurrent()) return;
      console.log('[doeverything][mcp] WebSocket open');
      state.reconnectAttempts = 0;
      // connectionId was set by ensureSessionEpochId() before openSocket()
      // and is stable across reconnects — don't regenerate it here.
      void connectionStorage.markConnected();
    });
    sock.addEventListener('message', evt => {
      if (!isCurrent()) return;
      const data = String(evt.data);
      // Capture the socket reference NOW, before any async gap. If the socket
      // rotates while the tool is running (SW woke on alarm, reconnected), we
      // still send the response on the socket that received the request — or
      // fall back to the current one if that socket is already gone.
      const capturedSock = sock;
      // Acquire a Web Lock for the duration of this handler. MV3 service
      // workers go dormant after ~30 s of inactivity; a shared lock signals
      // to Chrome that the SW is still doing meaningful work and must not be
      // terminated. Each concurrent tool call holds the lock independently.
      const handle = async () => {
        await onMessage(data, capturedSock).catch((err: unknown) => {
          console.warn('[doeverything][mcp] message handling failed', err);
        });
      };
      // Hold a Web Lock for the duration of tool execution so Chrome does not
      // terminate the MV3 SW mid-await. Falls back in Node/jsdom test envs
      // where navigator or navigator.locks is not available.
      try {
        void navigator.locks.request('doe-mcp-inflight', { mode: 'shared' }, handle);
      } catch {
        void handle();
      }
    });
    sock.addEventListener('close', ev => {
      if (!isCurrent()) {
        // Stale close from a previously-replaced socket — ignore. Reconnects
        // are the responsibility of the current socket only.
        console.log('[doeverything][mcp] stale close ignored', { code: ev.code, reason: ev.reason });
        return;
      }
      console.log('[doeverything][mcp] WebSocket close', { code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
      state.socket = null;
      if (state.manuallyClosed) {
        void connectionStorage.setStatus('disconnected');
        return;
      }
      // Don't pile up reconnect attempts on top of an in-flight connect()
      // — single-flight already handles getting us back online.
      if (state.connectInFlight) {
        void connectionStorage.setStatus('connecting');
        return;
      }
      void connectionStorage.setStatus('disconnected', ev.reason || `code ${ev.code}`);
      void scheduleReconnect();
    });
    sock.addEventListener('error', () => {
      if (!isCurrent()) {
        console.log('[doeverything][mcp] stale error ignored');
        return;
      }
      console.warn('[doeverything][mcp] WebSocket error event');
      void connectionStorage.setStatus('error', 'WebSocket error');
      try {
        sock.close();
      } catch {
        // already closed
      }
    });
  } catch (err) {
    console.error('[doeverything][mcp] failed to open WebSocket', err);
    void connectionStorage.setStatus('error', err instanceof Error ? err.message : String(err));
    void scheduleReconnect();
  }
}

async function onMessage(raw: string, ws: WebSocket) {
  let envelope: RelayEnvelope<unknown>;
  try {
    envelope = JSON.parse(raw) as RelayEnvelope<unknown>;
  } catch {
    return;
  }
  const frame = envelope?.frame as JsonRpcRequest | undefined;
  if (!frame || frame.jsonrpc !== '2.0') return;

  // Prefer the per-session ID the relay echoes from the client's `Mcp-Session-Id`
  // header (assigned during `initialize`). This lets two concurrent MCP sessions
  // each get their own tab. Fall back to the per-WS connectionId when the relay is
  // an older version that doesn't forward sessionId.
  const connectionId = envelope.sessionId ?? state.connectionId ?? 'mcp_unknown';

  // Notifications (no `id`) need no response; just dispatch and drop the result.
  const isNotification = !('id' in frame);
  if (isNotification) {
    void handleMcpRequest(frame, connectionId).catch(() => {});
    return;
  }

  const response = await handleMcpRequest(frame, connectionId);
  send(ws, { rid: envelope.rid, frame: response });
}

function send(ws: WebSocket, envelope: RelayEnvelope<unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(envelope));
    return;
  }
  // The socket that received the request closed while the tool was executing
  // (e.g. SW went dormant and reconnected via the alarm). Fall back to the
  // current socket — the relay Durable Object keeps the session alive for 60 s
  // so the new socket should still be able to deliver the response.
  if (state.socket?.readyState === WebSocket.OPEN) {
    console.warn('[doeverything][mcp] original socket closed mid-tool; retrying on current socket');
    state.socket.send(JSON.stringify(envelope));
    return;
  }
  console.error('[doeverything][mcp] send failed — no open socket for rid', envelope.rid);
}

async function scheduleReconnect() {
  if (state.manuallyClosed || !state.url) return;
  if (state.reconnectTimer) return;
  // Guard: user must have opted in. Defends against reconnect loops that
  // survive an extension reload when manuallyClosed was not yet persisted.
  const stored = await connectionStorage.get();
  if (!stored.userEnabled) return;
  const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * Math.pow(2, state.reconnectAttempts));
  state.reconnectAttempts += 1;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    void ensureSessionEpochId().then(() => openSocket());
  }, delay);
}

async function resolveRelayBaseUrl(): Promise<string> {
  const stored = await connectionStorage.get();
  return (stored.relayBaseUrl ?? DEFAULT_RELAY_BASE_URL).replace(/\/+$/, '');
}

function relayWsUrl(baseUrl: string, token: string): string {
  // base may be https:// or http://; flip to ws:// / wss://
  const ws = baseUrl.replace(/^http/, 'ws');
  return `${ws}/connect/${token}`;
}

function relayConnectorUrl(baseUrl: string | null, token: string | null): string | null {
  if (!baseUrl || !token) return null;
  return `${baseUrl.replace(/\/+$/, '')}/mcp/${token}`;
}

function describeWith(token: string | null, baseUrl: string): ConnectionInfo {
  const live = state.socket?.readyState === WebSocket.OPEN;
  return {
    connectorUrl: relayConnectorUrl(baseUrl || null, token),
    token,
    relayBaseUrl: baseUrl || null,
    status: live ? 'connected' : 'disconnected',
    lastError: null,
    lastConnectedAt: null,
  };
}
