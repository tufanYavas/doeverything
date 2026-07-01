/**
 * Translate the side panel's chat-store messages into the Vercel AI SDK
 * `ModelMessage[]` shape via the SDK's canonical pipeline.
 *
 * Why we go through `UIMessage` + `convertToModelMessages` instead of
 * hand-rolling a converter: the SDK's converter is the *one* place where
 * tool-call lifecycle states are turned into model messages with the
 * pairing rules each provider expects (Anthropic / OpenAI both reject an
 * orphan `tool_use`; Gemini quietly miscompiles a `functionCall` without a
 * `functionResponse`). Building our own diverged path made it our job to
 * keep that invariant; deferring to the SDK means we inherit its
 * guarantees for free — and `ignoreIncompleteToolCalls` lets us drop
 * in-flight tool calls cleanly when history is replayed mid-stream
 * (SW eviction, port disconnect, abort) rather than shipping orphans.
 *
 * The chat-store keeps a simpler representation (`MessagePartDTO`) so the
 * side panel never has to think about the SDK's tool-state enum. We map
 * it to `UIMessage` at the SW boundary:
 *   - text     → TextUIPart
 *   - image    → FileUIPart (carries the data URL — the SDK's per-provider
 *                adapter promotes this to `image` for vision-capable models)
 *   - tool_call status=running → DynamicToolUIPart state=input-available
 *     (filtered out by `ignoreIncompleteToolCalls`)
 *   - tool_call status=done    → DynamicToolUIPart state=output-available
 *     (paired into a `tool-result` model message by the SDK)
 *   - tool_call status=error   → DynamicToolUIPart state=output-error
 *
 * Tool output shaping (the `__doe_image` / `__doe_batch_images`
 * markers that route screenshots into vision-capable `image-data` parts)
 * runs through the SAME `tool.toModelOutput` hook the live turn uses —
 * the SDK calls it whenever the tool roster is passed in via the `tools`
 * option. That makes the live-turn and history-replay paths converge on
 * one source of truth (the tool definition itself) instead of two
 * lookalike strippers in different files.
 */

import { convertToModelMessages } from 'ai';
import type { DynamicToolUIPart, FileUIPart, ModelMessage, StepStartUIPart, TextUIPart, ToolSet, UIMessage } from 'ai';

interface MessagePartDTO {
  kind: 'text' | 'tool_call' | 'tool_result' | 'image';
  text?: string;
  callId?: string;
  toolName?: string;
  args?: unknown;
  result?: unknown;
  status?: 'running' | 'done' | 'error';
  isError?: boolean;
  /** Image attachments (`kind === 'image'`). */
  mediaType?: string;
  dataUrl?: string;
}

interface ChatMessageDTO {
  id: string;
  role: 'user' | 'assistant' | 'system';
  parts: MessagePartDTO[];
}

export type { ChatMessageDTO, MessagePartDTO };

/**
 * Map a chat-store transcript into the SDK's canonical `ModelMessage[]`.
 *
 * `tools` is optional but should be passed when available — the SDK uses
 * each tool's `toModelOutput` hook to shape tool results (e.g. lifting
 * `__doe_image` markers into proper `image-data` parts on rehydrated
 * screenshots). Without it, results fall back to JSON-serialised text,
 * which still works but means vision-capable models won't see persisted
 * screenshots after the first turn.
 */
export async function toModelMessages(messages: ChatMessageDTO[], tools?: ToolSet): Promise<ModelMessage[]> {
  const uiMessages = messages.map(toUIMessage);
  return convertToModelMessages(uiMessages, { ignoreIncompleteToolCalls: true, tools });
}

/**
 * Extract the most recent user message's plain text. Used for telemetry /
 * `TaskLogger.start` before conversion has run, so callers can log the
 * prompt without paying for an early UIMessage map.
 */
export function lastUserPromptText(messages: ChatMessageDTO[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const text = m.parts
      .filter((p): p is MessagePartDTO & { kind: 'text'; text: string } => p.kind === 'text' && typeof p.text === 'string')
      .map(p => p.text)
      .join('');
    return text || '(non-text prompt)';
  }
  return '(non-text prompt)';
}

function toUIMessage(m: ChatMessageDTO): UIMessage {
  const parts: UIMessage['parts'] = [];
  // Step-boundary inference. Anthropic (and the other providers) require
  // that an assistant message END with its `tool_use` blocks — anything
  // after them (text, image) makes those tool_uses orphans because the
  // model is now expected to send `tool_result`s for them in the NEXT
  // user message. Our chat-store flattens a multi-step agent run into a
  // SINGLE assistant message (one entry per user turn) with the model's
  // step output interleaved as `text → tool_call(s) → text → tool_call(s)
  // → text → tool_call(s) → …`. When we replay that flat record on a
  // follow-up turn, Anthropic sees text *after* tool_uses inside the same
  // assistant message and rejects with `tool_use ids were found without
  // tool_result blocks immediately after`.
  //
  // The SDK's `convertToModelMessages` already knows how to split an
  // assistant `UIMessage` into multiple per-step `ModelMessage`s — but
  // only when `step-start` parts mark the boundaries (the same parts
  // `toUIMessageStream` injects between steps during a live run, which
  // we don't consume because we drive the stream ourselves). We infer
  // those boundaries here from the structural cue the chat-store
  // already preserves: a non-tool part (text or image) right after a
  // `tool_call` always means a new step started. Inserting a
  // `step-start` at that transition makes the SDK emit one
  // assistant + tool message pair per step, with every tool_use
  // sitting at the tail of its step's assistant message — the only
  // shape every provider accepts on replay.
  let lastWasToolCall = false;
  for (const p of m.parts) {
    if (p.kind === 'text' && typeof p.text === 'string' && p.text.length > 0) {
      if (m.role === 'assistant' && lastWasToolCall) {
        const boundary: StepStartUIPart = { type: 'step-start' };
        parts.push(boundary);
      }
      const part: TextUIPart = { type: 'text', text: p.text };
      parts.push(part);
      lastWasToolCall = false;
    } else if (p.kind === 'image' && typeof p.dataUrl === 'string' && typeof p.mediaType === 'string') {
      if (m.role === 'assistant' && lastWasToolCall) {
        const boundary: StepStartUIPart = { type: 'step-start' };
        parts.push(boundary);
      }
      const part: FileUIPart = { type: 'file', mediaType: p.mediaType, url: p.dataUrl };
      parts.push(part);
      lastWasToolCall = false;
    } else if (p.kind === 'tool_call' && p.callId && p.toolName) {
      parts.push(toToolUIPart(p));
      lastWasToolCall = true;
    }
  }
  return { id: m.id, role: m.role, parts };
}

function toToolUIPart(p: MessagePartDTO): DynamicToolUIPart {
  const toolCallId = p.callId!;
  const toolName = p.toolName!;
  const input = p.args ?? {};

  if (p.status === 'error' || p.isError === true) {
    const errorText =
      typeof p.result === 'string'
        ? p.result
        : safeJson(p.result ?? 'tool failed');
    return {
      type: 'dynamic-tool',
      toolName,
      toolCallId,
      state: 'output-error',
      input,
      errorText,
    };
  }
  if (p.status === 'done') {
    return {
      type: 'dynamic-tool',
      toolName,
      toolCallId,
      state: 'output-available',
      input,
      output: p.result,
    };
  }
  // `running` — `ignoreIncompleteToolCalls` will filter this out at the
  // SDK boundary. We still emit it as `input-available` (rather than
  // `input-streaming`) so the part is well-formed if anything ever
  // converts without the option.
  return {
    type: 'dynamic-tool',
    toolName,
    toolCallId,
    state: 'input-available',
    input,
  };
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
