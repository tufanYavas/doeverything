/**
 * McpBridge unit tests.
 *
 * Covers the key behavioural contracts:
 *   - keepalive() gates on `userEnabled` â€” no socket opened for fresh installs
 *   - connect() sets userEnabled=true, opens a WebSocket, is single-flight
 *   - disconnect() sets userEnabled=false, closes the socket, stops reconnects
 *   - scheduleReconnect() is blocked when userEnabled=false
 *   - connect() returns an error ConnectionInfo when no relay URL is set
 *
 * WebSocket is replaced with a controllable fake; connectionStorage is mocked
 * so tests stay pure without touching Chrome storage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Fake WebSocket
// ---------------------------------------------------------------------------

class FakeWS {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWS.CONNECTING;
  url: string;
  private listeners: Map<string, Array<(ev?: unknown) => void>> = new Map();

  static instances: FakeWS[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWS.instances.push(this);
  }

  addEventListener(type: string, fn: (ev?: unknown) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  send(_data: string) {}

  close(code = 1000, reason = '') {
    this.readyState = FakeWS.CLOSED;
    this._emit('close', { code, reason, wasClean: code === 1000 });
  }

  _emit(type: string, ev?: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  // Test helpers
  simulateOpen() {
    this.readyState = FakeWS.OPEN;
    this._emit('open');
  }

  simulateError() {
    this._emit('error');
  }

  simulateClose(code = 1006, reason = '') {
    this.readyState = FakeWS.CLOSED;
    this._emit('close', { code, reason, wasClean: false });
  }

  static reset() {
    FakeWS.instances = [];
  }

  static last(): FakeWS | undefined {
    return FakeWS.instances[FakeWS.instances.length - 1];
  }
}

// Install the fake globally BEFORE the bridge module is imported.
globalThis.WebSocket = FakeWS as unknown as typeof WebSocket;

// ---------------------------------------------------------------------------
// Storage mock (vi.hoisted so it is available inside vi.mock factories)
// ---------------------------------------------------------------------------

const { storageMock, resetStorage } = vi.hoisted(() => {
  type Status = 'disconnected' | 'connecting' | 'connected' | 'error';

  const defaults = (): {
    userEnabled: boolean;
    relayBaseUrl: string | null;
    token: string | null;
    status: Status;
    lastError: string | null;
    lastConnectedAt: number | null;
  } => ({
    userEnabled: false,
    relayBaseUrl: 'https://relay.example.com',
    token: 'test-token',
    status: 'disconnected',
    lastError: null,
    lastConnectedAt: null,
  });

  const storageMock = defaults();

  const resetStorage = () => Object.assign(storageMock, defaults());

  return { storageMock, resetStorage };
});

vi.mock('@doeverything/storage', () => ({
  connectionStorage: {
    get: vi.fn(async () => ({ ...storageMock })),
    ensureToken: vi.fn(async () => storageMock.token ?? 'generated-token'),
    setStatus: vi.fn(async (s, e?: string | null) => {
      storageMock.status = s;
      storageMock.lastError = e ?? null;
    }),
    markConnected: vi.fn(async () => {
      storageMock.status = 'connected';
      storageMock.lastError = null;
    }),
    setUserEnabled: vi.fn(async (v: boolean) => {
      storageMock.userEnabled = v;
    }),
  },
}));

vi.mock('./dispatch.js', () => ({
  handleMcpRequest: vi.fn(async () => ({ jsonrpc: '2.0', id: null, result: {} })),
}));

// ---------------------------------------------------------------------------
// Import bridge after mocks are registered
// ---------------------------------------------------------------------------

import { McpBridge } from './bridge.js';
import { connectionStorage } from '@doeverything/storage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the in-memory bridge state via the globalThis cache the module uses. */
function resetBridgeState() {
  const g = globalThis as Record<string, unknown>;
  const s = g.__doe_mcp as Record<string, unknown> | undefined;
  if (!s) return;
  if (s.reconnectTimer) clearTimeout(s.reconnectTimer as ReturnType<typeof setTimeout>);
  s.socket = null;
  s.url = null;
  s.reconnectAttempts = 0;
  s.reconnectTimer = null;
  s.manuallyClosed = false;
  s.connectInFlight = null;
  s.connectionId = null;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetBridgeState();
  resetStorage();
  FakeWS.reset();
  vi.clearAllMocks();
  // Re-bind get() so each test starts with a clean storage snapshot.
  vi.mocked(connectionStorage.get).mockImplementation(async () => ({ ...storageMock }));
  vi.mocked(connectionStorage.setUserEnabled).mockImplementation(async (v: boolean) => {
    storageMock.userEnabled = v;
  });
  vi.mocked(connectionStorage.setStatus).mockImplementation(async (s, e) => {
    storageMock.status = s;
    storageMock.lastError = e ?? null;
  });
});

afterEach(() => {
  vi.useRealTimers();
  // Close any sockets the test left open so close events don't bleed through.
  for (const ws of FakeWS.instances) {
    if (ws.readyState < FakeWS.CLOSED) ws.readyState = FakeWS.CLOSED;
  }
});

// ---------------------------------------------------------------------------
// keepalive()
// ---------------------------------------------------------------------------

describe('keepalive()', () => {
  it('returns without opening a socket when userEnabled is false', async () => {
    storageMock.userEnabled = false;
    await McpBridge.keepalive();
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('returns without opening a socket when manuallyClosed is true even if userEnabled', async () => {
    storageMock.userEnabled = true;
    // Simulate a manual disconnect this session.
    await McpBridge.disconnect();
    FakeWS.reset();
    vi.clearAllMocks();
    vi.mocked(connectionStorage.get).mockResolvedValue({ ...storageMock });

    await McpBridge.keepalive();
    expect(FakeWS.instances).toHaveLength(0);
  });

  it('opens a socket when userEnabled is true and no socket is open', async () => {
    storageMock.userEnabled = true;
    storageMock.token = 'tok';
    await McpBridge.keepalive();
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.last()?.url).toContain('/connect/tok');
  });

  it('skips when socket is already OPEN', async () => {
    storageMock.userEnabled = true;
    await McpBridge.keepalive();
    FakeWS.last()?.simulateOpen();

    await McpBridge.keepalive();
    // Only one socket should ever have been created.
    expect(FakeWS.instances).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// connect()
// ---------------------------------------------------------------------------

describe('connect()', () => {
  it('sets userEnabled to true in storage', async () => {
    await McpBridge.connect();
    expect(connectionStorage.setUserEnabled).toHaveBeenCalledWith(true);
  });

  it('opens a WebSocket to the relay', async () => {
    storageMock.token = 'abc123';
    await McpBridge.connect();
    expect(FakeWS.instances).toHaveLength(1);
    expect(FakeWS.last()?.url).toBe('wss://relay.example.com/connect/abc123');
  });

  it('returns error ConnectionInfo when no relay URL is configured', async () => {
    storageMock.relayBaseUrl = null;
    vi.mocked(connectionStorage.get).mockResolvedValue({ ...storageMock, relayBaseUrl: null });

    const info = await McpBridge.connect();
    expect(info.connectorUrl).toBeNull();
    expect(FakeWS.instances).toHaveLength(0);
    expect(connectionStorage.setStatus).toHaveBeenCalledWith('error', expect.stringContaining('relay'));
  });

  it('is single-flight â€” concurrent calls share one WebSocket', async () => {
    const [a, b, c] = await Promise.all([McpBridge.connect(), McpBridge.connect(), McpBridge.connect()]);
    expect(FakeWS.instances).toHaveLength(1);
    // All callers should get equivalent info.
    expect(a.relayBaseUrl).toBe(b.relayBaseUrl);
    expect(b.relayBaseUrl).toBe(c.relayBaseUrl);
  });

  it('sets status to connecting while dialing', async () => {
    const connectPromise = McpBridge.connect();
    // At this point connect() called setStatus('connecting') before returning.
    await connectPromise;
    expect(connectionStorage.setStatus).toHaveBeenCalledWith('connecting');
  });

  it('marks connected when the socket opens', async () => {
    await McpBridge.connect();
    FakeWS.last()?.simulateOpen();
    // Let the microtask queue drain.
    await Promise.resolve();
    expect(connectionStorage.markConnected).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// disconnect()
// ---------------------------------------------------------------------------

describe('disconnect()', () => {
  it('sets userEnabled to false in storage', async () => {
    storageMock.userEnabled = true;
    await McpBridge.connect();
    vi.clearAllMocks();
    vi.mocked(connectionStorage.setUserEnabled).mockImplementation(async (v: boolean) => {
      storageMock.userEnabled = v;
    });

    await McpBridge.disconnect();
    expect(connectionStorage.setUserEnabled).toHaveBeenCalledWith(false);
  });

  it('closes the open socket', async () => {
    await McpBridge.connect();
    const ws = FakeWS.last()!;
    ws.simulateOpen();

    await McpBridge.disconnect();
    expect(ws.readyState).toBe(FakeWS.CLOSED);
  });

  it('suppresses reconnect after explicit disconnect', async () => {
    storageMock.userEnabled = true;
    await McpBridge.connect();
    await McpBridge.disconnect();
    FakeWS.reset();

    // Simulate a socket error â€” scheduleReconnect should not fire because
    // manuallyClosed is true.
    await vi.runAllTimersAsync();
    expect(FakeWS.instances).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// scheduleReconnect() â€” tested via socket close event
// ---------------------------------------------------------------------------

describe('scheduleReconnect (via socket close)', () => {
  it('does not reconnect when userEnabled is false', async () => {
    // Connect first to get a socket and set state.url.
    storageMock.userEnabled = true;
    await McpBridge.connect();
    // Now pretend userEnabled was revoked mid-session.
    storageMock.userEnabled = false;
    vi.mocked(connectionStorage.get).mockResolvedValue({ ...storageMock });

    // Simulate an unexpected close (code 1006 = abnormal, no manual disconnect).
    FakeWS.last()?.simulateClose(1006);
    // Advance timers to the scheduled reconnect delay.
    await vi.runAllTimersAsync();

    // No new socket should have been opened.
    expect(FakeWS.instances).toHaveLength(1);
  });

  it('reconnects with backoff when userEnabled stays true', async () => {
    storageMock.userEnabled = true;
    await McpBridge.connect();
    const firstWs = FakeWS.last()!;

    // Simulate unexpected close.
    firstWs.simulateClose(1006);
    // scheduleReconnect queued: advance past first backoff delay (2 s base).
    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.resolve(); // flush microtasks

    expect(FakeWS.instances.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// connectionId â€” per-session tab isolation
// ---------------------------------------------------------------------------

import { handleMcpRequest } from './dispatch.js';

describe('connectionId per WebSocket connection', () => {
  it('is null before the socket opens', async () => {
    storageMock.userEnabled = true;
    await McpBridge.connect();
    const bridgeState = (globalThis as Record<string, unknown>).__doe_mcp as Record<string, unknown>;
    // Socket created but open event not fired yet.
    expect(bridgeState.connectionId).toBeNull();
  });

  it('is assigned a non-null string after the socket opens', async () => {
    storageMock.userEnabled = true;
    await McpBridge.connect();
    FakeWS.last()?.simulateOpen();
    await Promise.resolve();

    const bridgeState = (globalThis as Record<string, unknown>).__doe_mcp as Record<string, unknown>;
    expect(typeof bridgeState.connectionId).toBe('string');
    expect((bridgeState.connectionId as string).startsWith('mcp_conn_')).toBe(true);
  });

  it('generates a NEW connectionId after a reconnect', async () => {
    storageMock.userEnabled = true;
    await McpBridge.connect();
    FakeWS.last()?.simulateOpen();
    await Promise.resolve();

    const bridgeState = (globalThis as Record<string, unknown>).__doe_mcp as Record<string, unknown>;
    const first = bridgeState.connectionId as string;

    // Simulate disconnect + reconnect.
    FakeWS.last()?.simulateClose(1006);
    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.resolve();
    FakeWS.last()?.simulateOpen();
    await Promise.resolve();

    const second = bridgeState.connectionId as string;
    expect(second).not.toBe(first);
    expect(second.startsWith('mcp_conn_')).toBe(true);
  });

  it('passes the connectionId to handleMcpRequest when a message arrives', async () => {
    storageMock.userEnabled = true;
    await McpBridge.connect();
    const ws = FakeWS.last()!;
    ws.simulateOpen();
    await Promise.resolve();

    const bridgeState = (globalThis as Record<string, unknown>).__doe_mcp as Record<string, unknown>;
    const connId = bridgeState.connectionId as string;

    const req = JSON.stringify({
      rid: 'r1',
      frame: { jsonrpc: '2.0', id: 1, method: 'ping', params: {} },
    });
    ws._emit('message', { data: req });
    // Let async message handler run.
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(handleMcpRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'ping' }),
      connId,
    );
  });

  it('uses envelope.sessionId over connectionId when present', async () => {
    storageMock.userEnabled = true;
    await McpBridge.connect();
    const ws = FakeWS.last()!;
    ws.simulateOpen();
    await Promise.resolve();

    const req = JSON.stringify({
      rid: 'r2',
      sessionId: 'mcp_session_abc',
      frame: { jsonrpc: '2.0', id: 2, method: 'ping', params: {} },
    });
    ws._emit('message', { data: req });
    await Promise.resolve();
    await Promise.resolve();

    expect(vi.mocked(handleMcpRequest)).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'ping' }),
      'mcp_session_abc',
    );
  });
});

// ---------------------------------------------------------------------------
// describe()
// ---------------------------------------------------------------------------

describe('describe()', () => {
  it('returns connectorUrl derived from stored token and relay URL', async () => {
    storageMock.token = 'my-token';
    storageMock.relayBaseUrl = 'https://relay.example.com';
    const info = await McpBridge.describe();
    expect(info.connectorUrl).toBe('https://relay.example.com/mcp/my-token');
  });

  it('returns null connectorUrl when token or relay is missing', async () => {
    storageMock.token = null;
    storageMock.relayBaseUrl = 'https://relay.example.com';
    const info = await McpBridge.describe();
    expect(info.connectorUrl).toBeNull();
  });
});
