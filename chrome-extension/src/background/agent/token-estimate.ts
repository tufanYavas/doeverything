/**
 * Conversation token estimation — the ONE estimator the agent loop uses.
 *
 * The previous estimator counted only `text` parts, so tool calls, tool
 * results (the fattest items in a browser-agent history: read_page DOM
 * dumps, network logs) and images counted as ZERO. Real usage ran several
 * times past the estimate and every estimate-gated mechanism (compaction,
 * snapshot pruning, cache-breakpoint growth) fired far too late or never.
 *
 * Principles:
 *   - Every part shape contributes. Unknown/new SDK part types fall back to
 *     a JSON.stringify length so they never silently count as zero.
 *   - Images count as a flat IMAGE_PART_TOKENS. NEVER count base64 length
 *     as text — that overestimates ~10× and would trigger constant
 *     compaction.
 *   - Deliberately ~10-15% conservative (JSON at 3.5 chars/token, per-part
 *     overheads): the failure mode of overestimating is an early summary;
 *     the failure mode of underestimating is a provider 400.
 *   - Memoized per message object (WeakMap): the SDK rebuilds the messages
 *     ARRAY each step but reuses message OBJECTS, and every mutation in
 *     this codebase produces new objects, so reference identity is a safe
 *     cache key. The three per-step call sites amortize to O(new messages).
 *
 * Calibration hook (deferred): the SDK only reports cumulative run-end
 * `totalUsage`, not per-step prompt sizes, so a real-usage correction
 * factor would be noise. If per-step usage ever lands, persist an EMA
 * factor in the compaction cache record and multiply here.
 */

import type { ChatMessageDTO } from './conversion.js';
import type { ModelMessage } from 'ai';

export const CHARS_PER_TOKEN_TEXT = 4;
export const CHARS_PER_TOKEN_JSON = 3.5;
/** ~(1568×1568)/750 — Anthropic's max-size image cost; flat and provider-agnostic. */
export const IMAGE_PART_TOKENS = 1_600;
export const PER_MESSAGE_OVERHEAD_TOKENS = 6;

const messageMemo = new WeakMap<object, number>();
const dtoMemo = new WeakMap<object, number>();

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_TEXT);
}

function estimateJsonTokens(value: unknown): number {
  return Math.ceil(safeStringify(value).length / CHARS_PER_TOKEN_JSON);
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Count one item of a tool-result `content` array (or any nested content
 * list): text items by characters, media/image items at the flat image
 * cost. Items carrying a base64 `data` payload are ALWAYS treated as
 * media so the payload never gets counted as text.
 */
function estimateContentItemTokens(item: unknown): number {
  if (typeof item === 'string') return estimateTextTokens(item);
  if (!isRecord(item)) return 1;
  if (typeof item.text === 'string') return estimateTextTokens(item.text);
  const type = typeof item.type === 'string' ? item.type : '';
  if (type === 'media' || type === 'image-data' || type === 'image' || typeof item.data === 'string') {
    return IMAGE_PART_TOKENS;
  }
  return estimateJsonTokens(item);
}

/** Tool-result `output` in any of the SDK's shapes (text/json/content/error-*). */
function estimateToolOutputTokens(output: unknown): number {
  if (typeof output === 'string') return estimateTextTokens(output);
  if (!isRecord(output)) return estimateJsonTokens(output);
  const type = typeof output.type === 'string' ? output.type : '';
  if ((type === 'text' || type === 'error-text') && typeof output.value === 'string') {
    return estimateTextTokens(output.value);
  }
  if (type === 'json' || type === 'error-json') {
    return estimateJsonTokens(output.value);
  }
  if (type === 'content' && Array.isArray(output.value)) {
    let tokens = 0;
    for (const item of output.value) tokens += estimateContentItemTokens(item);
    return tokens;
  }
  return estimateJsonTokens(output);
}

function estimatePartTokens(part: unknown): number {
  if (typeof part === 'string') return estimateTextTokens(part);
  if (!isRecord(part)) return 1;
  const type = typeof part.type === 'string' ? part.type : '';

  if ((type === 'text' || type === 'reasoning') && typeof part.text === 'string') {
    return estimateTextTokens(part.text);
  }
  if (type === 'tool-call') {
    const name = typeof part.toolName === 'string' ? part.toolName : '';
    return estimateTextTokens(name) + estimateJsonTokens(part.input);
  }
  if (type === 'tool-result') {
    const name = typeof part.toolName === 'string' ? part.toolName : '';
    return estimateTextTokens(name) + estimateToolOutputTokens(part.output);
  }
  if (type === 'image' || type === 'file' || type === 'image-data' || type === 'media') {
    // Image at flat cost; non-image files also flat — their payload is
    // base64 and must not be counted as text either way.
    return IMAGE_PART_TOKENS;
  }
  // Unknown part shape (future SDK types): stringify so it never counts
  // as zero. Guard the base64 case via the data-field heuristic above.
  if (typeof part.data === 'string') return IMAGE_PART_TOKENS;
  return estimateJsonTokens(part);
}

export function estimateMessageTokens(message: ModelMessage): number {
  const cached = messageMemo.get(message);
  if (cached !== undefined) return cached;

  let tokens = PER_MESSAGE_OVERHEAD_TOKENS;
  if (typeof message.content === 'string') {
    tokens += estimateTextTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) tokens += estimatePartTokens(part);
  }
  messageMemo.set(message, tokens);
  return tokens;
}

export function estimateTokens(messages: ModelMessage[]): number {
  let tokens = 0;
  for (const m of messages) tokens += estimateMessageTokens(m);
  return tokens;
}

/**
 * DTO-space estimator — used by compaction boundary selection, which works
 * on the panel's ChatMessageDTO history (stable ids, tool results inline)
 * BEFORE conversion to ModelMessage.
 */
export function estimateDtoTokens(message: ChatMessageDTO): number {
  const cached = dtoMemo.get(message);
  if (cached !== undefined) return cached;

  let tokens = PER_MESSAGE_OVERHEAD_TOKENS;
  for (const p of message.parts) {
    if (p.kind === 'text' && typeof p.text === 'string') {
      tokens += estimateTextTokens(p.text);
    } else if (p.kind === 'image') {
      tokens += IMAGE_PART_TOKENS;
    } else if (p.kind === 'tool_call' || p.kind === 'tool_result') {
      tokens += estimateTextTokens(p.toolName ?? '');
      if (p.args !== undefined) tokens += estimateJsonTokens(p.args);
      tokens += estimateDtoResultTokens(p.result);
    }
  }
  dtoMemo.set(message, tokens);
  return tokens;
}

/** Tool results in DTO space may carry the `__doe_image` screenshot marker. */
function estimateDtoResultTokens(result: unknown): number {
  if (result === undefined || result === null) return 0;
  if (typeof result === 'string') return estimateTextTokens(result);
  if (isRecord(result) && '__doe_image' in result) {
    const { __doe_image: _image, ...rest } = result;
    return IMAGE_PART_TOKENS + estimateJsonTokens(rest);
  }
  return estimateJsonTokens(result);
}
