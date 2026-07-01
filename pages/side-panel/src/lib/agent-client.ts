/**
 * Side-panel ↔ service worker bridge for agent runs.
 *
 * The service worker can't return streaming responses through
 * `chrome.runtime.sendMessage` reliably, so we use a long-lived `Port`.
 *
 * Inbound (side panel → SW):
 *   - de/agent/start  { conversationId, messages }
 *   - de/agent/abort  { conversationId }
 *
 * Outbound (SW → side panel):
 *   - de/agent/delta       { conversationId, text }
 *   - de/agent/tool-start  { conversationId, call: { id, name, args } }
 *   - de/agent/tool-end    { conversationId, call: { id, name, result, isError } }
 *   - de/agent/compaction  { conversationId, info: { stage, estimatedTokens, contextWindow, summary } }
 *   - de/agent/done        { conversationId, context?: { estimatedTokens, contextWindow } }
 *   - de/agent/error       { conversationId, message }
 *
 * All post-rollout fields are optional so an old SW and a new panel (or
 * vice versa, mid-update) interoperate.
 */

import type { ChatMessage } from '@src/stores/chat-store';

export const AGENT_PORT_NAME = 'doe:agent';

export type AgentInbound =
  | { type: 'doe/agent/start'; conversationId: string; messages: ChatMessage[] }
  | { type: 'doe/agent/abort'; conversationId: string };

export type AgentOutbound =
  | { type: 'doe/agent/delta'; conversationId: string; text: string }
  | {
      type: 'doe/agent/tool-start';
      conversationId: string;
      call: { id: string; name: string; args: unknown };
    }
  | {
      type: 'doe/agent/tool-end';
      conversationId: string;
      call: { id: string; name: string; result: unknown; isError: boolean };
    }
  | {
      type: 'doe/agent/compaction';
      conversationId: string;
      info: { stage: 'warn' | 'critical'; estimatedTokens: number; contextWindow?: number; summary: string };
    }
  | {
      type: 'doe/agent/done';
      conversationId: string;
      context?: { estimatedTokens: number; contextWindow: number };
    }
  | { type: 'doe/agent/error'; conversationId: string; message: string };

export function connectAgentPort() {
  return chrome.runtime.connect({ name: AGENT_PORT_NAME });
}
