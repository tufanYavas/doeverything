/**
 * MCP method dispatcher — turns JSON-RPC frames from the relay into local
 * tool invocations against the doeverything browser-tool roster.
 *
 * Implements the MCP protocol methods MCP clients call:
 *
 *   - initialize          → handshake, advertise tools capability
 *   - tools/list          → enumerate browser tools with JSON Schema
 *   - tools/call          → run a tool and return its result
 *   - notifications/*     → no-op (ack)
 *
 * Tool schemas live as Zod on `createBrowserTools()`; we convert them once
 * per request via `zod-to-json-schema`. Tool execution validates args via
 * the tool's own schema and runs `execute()` with a synthetic
 * `AgentToolContext`.
 */

import { RpcErrorCode } from './types.js';
import { createBrowserTools } from '../tools/browser-tools.js';
import { createToolContext } from '../tools/context.js';
import { hasLlmConfigured } from '../tools/internal/helpers.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type {
  InitializeResult,
  JsonRpcRequest,
  JsonRpcResponse,
  ToolCallParams,
  ToolCallResult,
  ToolsListResult,
} from './types.js';

const SERVER_INFO = { name: 'Doe', version: '0.1.0' };
// Latest MCP revision (modelcontextprotocol.io/specification/2025-06-18).
// 2024-11-05 was the initial release; clients now expect 2025-06-18 or newer.
const PROTOCOL_VERSION = '2025-06-18';

export async function handleMcpRequest(req: JsonRpcRequest, connectionId?: string): Promise<JsonRpcResponse> {
  try {
    switch (req.method) {
      case 'initialize':
        return success(req.id, initializeResult());

      case 'tools/list':
        return success(req.id, await toolsListResult(connectionId));

      case 'tools/call':
        return success(req.id, await toolsCallResult(req.params as ToolCallParams, connectionId));

      case 'ping':
        return success(req.id, {});

      default:
        return rpcError(req.id, RpcErrorCode.MethodNotFound, `Unknown method: ${req.method}`);
    }
  } catch (err) {
    return rpcError(req.id, RpcErrorCode.InternalError, err instanceof Error ? err.message : String(err));
  }
}

function initializeResult(): InitializeResult {
  return {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: SERVER_INFO,
  };
}

// Tools that require a configured LLM API key to function. Excluded from the
// MCP tools/list when no key is present so clients don't call them blindly.
const LLM_REQUIRED_TOOLS = new Set(['find']);

/** Normalise an external session ID to an MCP-tagged key recognised by createToolContext. */
function mcpConnectionId(connectionId?: string): string {
  if (!connectionId) return `mcp_${Date.now()}`;
  return connectionId.startsWith('mcp_') ? connectionId : `mcp_${connectionId}`;
}

async function toolsListResult(connectionId?: string): Promise<ToolsListResult> {
  const ctx = createToolContext(mcpConnectionId(connectionId), new AbortController().signal);
  // Vercel AI SDK v6 renamed `parameters` → `inputSchema`. Each tool object
  // carries the Zod schema there. We try both keys for forward/back compat
  // in case the codebase moves between SDK versions.
  const tools = createBrowserTools(ctx) as unknown as Record<
    string,
    { description?: string; inputSchema?: unknown; parameters?: unknown }
  >;
  const llmAvailable = await hasLlmConfigured();
  const out: ToolsListResult['tools'] = [];
  for (const [name, def] of Object.entries(tools)) {
    if (LLM_REQUIRED_TOOLS.has(name) && !llmAvailable) continue;
    const schema = def?.inputSchema ?? def?.parameters;
    if (!schema) continue;
    let inputSchema: Record<string, unknown>;
    try {
      // zod-to-json-schema returns a draft-7 JSON Schema; MCP accepts that.
      inputSchema = zodToJsonSchema(schema as never, { target: 'jsonSchema7' }) as Record<string, unknown>;
      // Strip the `$schema` URL — MCP clients don't need it and some
      // strict validators reject extra top-level keys.
      delete (inputSchema as Record<string, unknown>)['$schema'];
    } catch {
      inputSchema = { type: 'object', properties: {}, additionalProperties: true };
    }
    out.push({
      name,
      description: def?.description ?? '',
      inputSchema,
    });
  }
  return { tools: out };
}

async function toolsCallResult(params: ToolCallParams | undefined, connectionId?: string): Promise<ToolCallResult> {
  if (!params || typeof params.name !== 'string') {
    throw new Error('tools/call requires { name, arguments }');
  }
  const args = params.arguments ?? {};
  const ctx = createToolContext(mcpConnectionId(connectionId), new AbortController().signal);
  const tools = createBrowserTools(ctx) as unknown as Record<
    string,
    {
      inputSchema?: { parse: (a: unknown) => unknown };
      parameters?: { parse: (a: unknown) => unknown };
      execute: (a: unknown, opts: { toolCallId: string; messages: [] }) => Promise<unknown>;
    }
  >;
  const tool = tools[params.name];
  if (!tool) throw new Error(`Unknown tool "${params.name}"`);

  const schema = tool.inputSchema ?? tool.parameters;
  if (!schema || typeof schema.parse !== 'function') {
    throw new Error(`Tool "${params.name}" has no parseable schema`);
  }

  let parsed: unknown;
  try {
    parsed = schema.parse(args);
  } catch (err) {
    throw new Error(`Bad arguments for ${params.name}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const raw = await tool.execute(parsed, { toolCallId: `mcp_call_${Date.now()}`, messages: [] });
  return wrapToolResult(raw);
}

function wrapToolResult(raw: unknown): ToolCallResult {
  // MCP expects content as text/image blocks. Tools currently return plain
  // JSON-able objects; serialize to a single text block for the client to parse. Image-returning tools (capture/gif_creator/upload_image) can be
  // upgraded later to emit { type: 'image', data, mimeType }.
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  return { content: [{ type: 'text', text }] };
}

function success<R>(id: JsonRpcRequest['id'], result: R): JsonRpcResponse<R> {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id: JsonRpcRequest['id'], code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Backwards-compat shim for the old custom envelope path. New code uses
 * `handleMcpRequest` directly.
 */
export async function dispatchMcpToolCall(toolName: string, args: unknown): Promise<unknown> {
  const ctx = createToolContext(`mcp_${Date.now()}`, new AbortController().signal);
  const tools = createBrowserTools(ctx) as unknown as Record<
    string,
    {
      parameters: { parse: (a: unknown) => unknown };
      execute: (a: unknown, opts: { toolCallId: string; messages: [] }) => Promise<unknown>;
    }
  >;
  const tool = tools[toolName];
  if (!tool) throw new Error(`Unknown tool "${toolName}"`);
  const parsed = tool.parameters.parse(args ?? {});
  return tool.execute(parsed, { toolCallId: `mcp_call_${Date.now()}`, messages: [] });
}
