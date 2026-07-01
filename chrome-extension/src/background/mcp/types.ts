/**
 * Wire types for the relay <-> extension WebSocket.
 *
 * The relay forwards JSON-RPC 2.0 frames from the MCP client verbatim
 * into our WebSocket and vice-versa, with one extra envelope wrapping
 * each frame so the relay can correlate request/response pairs across
 * HTTP boundaries:
 *
 *   {
 *     "rid": "<relay-correlation-id>",
 *     "frame": { "jsonrpc": "2.0", "id": 1, "method": "initialize", ... }
 *   }
 *
 * `rid` is the relay's bookkeeping; we echo it back unchanged. `frame` is
 * the actual MCP JSON-RPC payload, which we route through the local
 * dispatcher.
 */

export interface RelayEnvelope<T = unknown> {
  rid: string;
  /** MCP 2025-03-26 session ID assigned by the relay on `initialize`.
   *  When present, used as the `conversationId` so each MCP session
   *  drives its own browser tab instead of sharing one. */
  sessionId?: string;
  frame: T;
}

// ─── MCP JSON-RPC 2.0 (subset we implement) ──────────────────────────────────

export interface JsonRpcRequest<P = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: P;
}

export interface JsonRpcNotification<P = unknown> {
  jsonrpc: '2.0';
  method: string;
  params?: P;
}

export interface JsonRpcSuccess<R = unknown> {
  jsonrpc: '2.0';
  id: number | string;
  result: R;
}

export interface JsonRpcError {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse<R = unknown> = JsonRpcSuccess<R> | JsonRpcError;
export type JsonRpcFrame = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

// MCP-specific shapes

export interface InitializeParams {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  clientInfo: { name: string; version: string };
}

export interface InitializeResult {
  protocolVersion: string;
  capabilities: { tools: { listChanged?: boolean } };
  serverInfo: { name: string; version: string };
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolsListResult {
  tools: ToolDescriptor[];
}

export interface ToolCallParams {
  name: string;
  arguments?: Record<string, unknown>;
}

export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

// JSON-RPC error codes (a subset; MCP uses standard ones).
export const RpcErrorCode = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
} as const;
