/**
 * Local bridge server — a lightweight relay that runs on the user's machine.
 *
 * The Chrome extension connects here via WebSocket (same as it would connect
 * to the Cloudflare relay). The MCP client talks to the bridge via stdio.
 * No internet, no Cloudflare account required.
 */
import * as http from 'node:http';
import * as net from 'node:net';
import * as crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';

const TIMEOUT_MS = 120_000;
const MAX_PENDING = 20;
// How long to wait for the extension to connect before failing the first tool call.
// Handles the race where Claude Code fetches tools immediately on startup before
// the extension has dialled in.
const EXT_CONNECT_WAIT_MS = 15_000;

type Frame = Record<string, unknown>;

interface Pending {
  resolve: (v: Frame) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Original JSON-RPC request id — echoed in timeout/cancel errors. */
  id: unknown;
}

export class LocalBridgeServer {
  private httpServer: http.Server;
  private wss: WebSocketServer;
  private ext: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private extWaiters: Array<() => void> = [];
  /** Stable session ID assigned once per bridge process. Sent to the extension
   *  as `sessionId` so it can scope each MCP session to its own browser tab. */
  private readonly sessionId = crypto.randomUUID();

  constructor() {
    this.httpServer = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('doeverything local bridge — alive\n');
    });
    this.wss = new WebSocketServer({ noServer: true });
    this.httpServer.on('upgrade', (req, socket, head) => {
      // Extension connects to /connect/<token> — same path as the cloud relay.
      if (!req.url?.startsWith('/connect/')) {
        (socket as net.Socket).destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket as net.Socket, head, ws => this.attachExtension(ws));
    });
  }

  listen(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.httpServer.listen(port, '127.0.0.1', resolve as () => void);
      this.httpServer.once('error', reject);
    });
  }

  get port(): number {
    const addr = this.httpServer.address();
    return addr && typeof addr === 'object' ? addr.port : 0;
  }

  get extensionConnected(): boolean {
    return this.ext !== null;
  }

  // ── Extension WebSocket ─────────────────────────────────────────────────────

  /** Resolves once the extension WebSocket is open, or rejects after `ms`. */
  private waitForExtension(ms: number): Promise<void> {
    if (this.ext) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.extWaiters.indexOf(resolve);
        if (idx !== -1) this.extWaiters.splice(idx, 1);
        reject(new Error('Timed out waiting for extension'));
      }, ms);
      this.extWaiters.push(() => { clearTimeout(timer); resolve(); });
    });
  }

  private attachExtension(ws: WebSocket): void {
    if (this.ext) {
      try { this.ext.close(1000, 'Replaced by newer connection'); } catch { /* ignore */ }
    }
    this.ext = ws;

    // Notify any callers waiting in waitForExtension().
    const waiters = this.extWaiters.splice(0);
    waiters.forEach(fn => fn());

    ws.on('message', (data) => {
      const raw = typeof data === 'string' ? data : data.toString('utf8');
      let env: { rid?: string; frame?: Frame };
      try { env = JSON.parse(raw) as typeof env; } catch { return; }
      if (!env.rid || !env.frame) return;

      const p = this.pending.get(env.rid);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(env.rid);
      p.resolve(env.frame);
    });

    ws.on('close', () => { this.ext = null; this.rejectAll('Extension disconnected'); });
    ws.on('error', () => { this.ext = null; this.rejectAll('Extension WebSocket error'); });
  }

  /** Resolve all pending requests with an error (e.g. on extension disconnect). */
  private rejectAll(message: string): void {
    const entries = [...this.pending.entries()];
    this.pending.clear();
    for (const [, p] of entries) {
      clearTimeout(p.timer);
      p.resolve({ jsonrpc: '2.0', id: p.id ?? null, error: { code: -32001, message } });
    }
  }

  /** Send a fire-and-forget frame to the extension (best-effort). */
  private sendToExt(frame: Frame): void {
    if (!this.ext) return;
    try {
      this.ext.send(JSON.stringify({ rid: crypto.randomUUID(), sessionId: this.sessionId, frame }));
    } catch { /* ignore — extension may have just disconnected */ }
  }

  // ── MCP forwarding ──────────────────────────────────────────────────────────

  /**
   * Forward a JSON-RPC frame from the MCP client to the extension.
   * Returns null for notifications (fire-and-forget, no response needed).
   */
  async forward(frame: Frame): Promise<Frame | null> {
    const method = frame['method'] as string | undefined;

    // ── Lifecycle: handle locally ─────────────────────────────────────────────

    if (method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: frame['id'] ?? null,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'doeverything', version: '1.0.0' },
        },
      };
    }

    if (method === 'ping') {
      return { jsonrpc: '2.0', id: frame['id'] ?? null, result: {} };
    }

    // ── Notifications (no id, no response expected) ───────────────────────────

    if (method?.startsWith('notifications/')) {
      // notifications/cancelled: also cancel the matching pending request.
      if (method === 'notifications/cancelled') {
        const cancelledId = (frame['params'] as Record<string, unknown> | undefined)?.['requestId'];
        if (cancelledId !== undefined) {
          for (const [rid, p] of this.pending.entries()) {
            if (p.id === cancelledId) {
              clearTimeout(p.timer);
              this.pending.delete(rid);
              p.resolve({ jsonrpc: '2.0', id: p.id ?? null, error: { code: -32800, message: 'Request cancelled by client.' } });
              break;
            }
          }
        }
      }
      // Forward all notifications to the extension best-effort.
      this.sendToExt(frame);
      return null;
    }

    // Frames without an id are notifications by JSON-RPC convention.
    const hasId = frame['id'] !== undefined && frame['id'] !== null;
    if (!hasId) {
      this.sendToExt(frame);
      return null;
    }

    // ── Requests (have id, need response) ────────────────────────────────────

    // Wait for the extension to connect — handles the startup race where the
    // MCP client fetches tools before the extension has dialled in.
    if (!this.ext) {
      try {
        await this.waitForExtension(EXT_CONNECT_WAIT_MS);
      } catch {
        return {
          jsonrpc: '2.0',
          id: frame['id'],
          error: {
            code: -32001,
            message:
              `doeverything extension did not connect within ${EXT_CONNECT_WAIT_MS / 1000} s. ` +
              'Open Chrome with the extension installed and make sure ' +
              'Options → MCP connection → Relay base URL is set to this bridge.',
          },
        };
      }
    }

    if (this.pending.size >= MAX_PENDING) {
      return { jsonrpc: '2.0', id: frame['id'], error: { code: -32029, message: 'Too many concurrent requests — retry in a moment.' } };
    }

    // Capture ext before the async gap so TypeScript knows it's non-null.
    const ext = this.ext;
    if (!ext) {
      return { jsonrpc: '2.0', id: frame['id'], error: { code: -32001, message: 'Extension disconnected.' } };
    }

    const rid = crypto.randomUUID();
    try {
      ext.send(JSON.stringify({ rid, sessionId: this.sessionId, frame }));
    } catch {
      return { jsonrpc: '2.0', id: frame['id'], error: { code: -32003, message: 'Failed to forward to extension.' } };
    }

    return new Promise<Frame>(resolve => {
      const timer = setTimeout(() => {
        this.pending.delete(rid);
        // Tell the extension to stop processing — per MCP spec, implementations
        // SHOULD send notifications/cancelled when a request times out.
        this.sendToExt({
          jsonrpc: '2.0',
          method: 'notifications/cancelled',
          params: { requestId: frame['id'], reason: `Timed out after ${TIMEOUT_MS / 1000}s` },
        });
        resolve({ jsonrpc: '2.0', id: frame['id'] ?? null, error: { code: -32002, message: `Tool call timed out after ${TIMEOUT_MS / 1000}s` } });
      }, TIMEOUT_MS);
      this.pending.set(rid, { resolve, timer, id: frame['id'] });
    });
  }
}
