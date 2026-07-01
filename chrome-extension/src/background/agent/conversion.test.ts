import { lastUserPromptText, toModelMessages } from './conversion.js';
import { describe, expect, it } from 'vitest';
import type { ChatMessageDTO } from './conversion.js';
import type { ModelMessage } from 'ai';

function collectToolIds(messages: ModelMessage[]) {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (typeof part === 'object' && part !== null && 'type' in part) {
        if (part.type === 'tool-call' && 'toolCallId' in part) calls.add(String(part.toolCallId));
        if (part.type === 'tool-result' && 'toolCallId' in part) results.add(String(part.toolCallId));
      }
    }
  }
  return { calls, results };
}

describe('toModelMessages', () => {
  it('converts a simple user/assistant exchange', async () => {
    const dto: ChatMessageDTO[] = [
      { id: 'u1', role: 'user', parts: [{ kind: 'text', text: 'hello' }] },
      { id: 'a1', role: 'assistant', parts: [{ kind: 'text', text: 'hi there' }] },
    ];
    const out = await toModelMessages(dto);
    expect(out[0].role).toBe('user');
    expect(out.some(m => m.role === 'assistant')).toBe(true);
  });

  it('pairs every tool_use with a tool_result (no orphans) for a completed call', async () => {
    const dto: ChatMessageDTO[] = [
      { id: 'u1', role: 'user', parts: [{ kind: 'text', text: 'read it' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { kind: 'text', text: 'reading' },
          { kind: 'tool_call', callId: 'c1', toolName: 'read_page', args: { tabId: 1 }, status: 'done', result: { ok: true } },
        ],
      },
    ];
    const { calls, results } = collectToolIds(await toModelMessages(dto));
    expect(calls.has('c1')).toBe(true);
    expect(results.has('c1')).toBe(true);
  });

  it('drops an incomplete (still-running) tool call rather than shipping an orphan', async () => {
    const dto: ChatMessageDTO[] = [
      { id: 'u1', role: 'user', parts: [{ kind: 'text', text: 'go' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ kind: 'tool_call', callId: 'c1', toolName: 'navigate', args: {}, status: 'running' }],
      },
    ];
    const { calls, results } = collectToolIds(await toModelMessages(dto));
    // ignoreIncompleteToolCalls strips the unfinished call → no orphan result.
    expect(calls.has('c1')).toBe(false);
    expect(results.has('c1')).toBe(false);
  });

  it('keeps tool_use blocks paired across a multi-step assistant turn (text after a tool call → new step)', async () => {
    const dto: ChatMessageDTO[] = [
      { id: 'u1', role: 'user', parts: [{ kind: 'text', text: 'do two things' }] },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { kind: 'text', text: 'step one' },
          { kind: 'tool_call', callId: 'c1', toolName: 'navigate', args: { url: 'x' }, status: 'done', result: 'ok' },
          { kind: 'text', text: 'step two' }, // marks a new step boundary
          { kind: 'tool_call', callId: 'c2', toolName: 'read_page', args: {}, status: 'done', result: { ok: true } },
        ],
      },
    ];
    const { calls, results } = collectToolIds(await toModelMessages(dto));
    expect(calls).toEqual(new Set(['c1', 'c2']));
    expect(results).toEqual(new Set(['c1', 'c2']));
  });
});

describe('lastUserPromptText', () => {
  it('returns the text of the most recent user message', () => {
    const dto: ChatMessageDTO[] = [
      { id: 'u1', role: 'user', parts: [{ kind: 'text', text: 'first' }] },
      { id: 'a1', role: 'assistant', parts: [{ kind: 'text', text: 'reply' }] },
      { id: 'u2', role: 'user', parts: [{ kind: 'text', text: 'second' }] },
    ];
    expect(lastUserPromptText(dto)).toBe('second');
  });

  it('returns the (non-text prompt) sentinel when there is no user message', () => {
    expect(lastUserPromptText([{ id: 'a', role: 'assistant', parts: [{ kind: 'text', text: 'x' }] }])).toBe(
      '(non-text prompt)',
    );
  });

  it('returns the sentinel for an image-only user message', () => {
    const dto: ChatMessageDTO[] = [
      { id: 'u', role: 'user', parts: [{ kind: 'image', mediaType: 'image/png', dataUrl: 'data:...' }] },
    ];
    expect(lastUserPromptText(dto)).toBe('(non-text prompt)');
  });
});
