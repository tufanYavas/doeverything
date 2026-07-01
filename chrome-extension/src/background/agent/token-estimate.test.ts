import {
  CHARS_PER_TOKEN_TEXT,
  estimateDtoTokens,
  estimateMessageTokens,
  estimateTextTokens,
  estimateTokens,
  IMAGE_PART_TOKENS,
  PER_MESSAGE_OVERHEAD_TOKENS,
} from './token-estimate.js';
import { describe, expect, it } from 'vitest';
import type { ChatMessageDTO } from './conversion.js';
import type { ModelMessage } from 'ai';

describe('estimateTextTokens', () => {
  it('divides character length by the text ratio (ceil)', () => {
    expect(estimateTextTokens('')).toBe(0);
    expect(estimateTextTokens('a'.repeat(CHARS_PER_TOKEN_TEXT * 10))).toBe(10);
    expect(estimateTextTokens('abc')).toBe(1);
  });
});

describe('estimateMessageTokens (ModelMessage)', () => {
  it('counts plain string content plus per-message overhead', () => {
    const m: ModelMessage = { role: 'user', content: 'a'.repeat(40) };
    expect(estimateMessageTokens(m)).toBe(PER_MESSAGE_OVERHEAD_TOKENS + 10);
  });

  it('counts tool-call arguments — the old estimator scored these as zero', () => {
    const m: ModelMessage = {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read_page', input: { tabId: 1, big: 'x'.repeat(400) } }],
    };
    // toolName + JSON(input) both contribute; far above the bare overhead.
    expect(estimateMessageTokens(m)).toBeGreaterThan(100);
  });

  it('counts a tool-result text payload by characters', () => {
    const m: ModelMessage = {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'c1', toolName: 'read_page', output: { type: 'text', value: 'z'.repeat(4000) } },
      ],
    };
    expect(estimateMessageTokens(m)).toBeGreaterThan(900);
  });

  it('counts an image part at the flat image cost, NOT its base64 length', () => {
    const huge = 'data:image/png;base64,' + 'A'.repeat(200_000);
    const m: ModelMessage = {
      role: 'user',
      content: [{ type: 'file', mediaType: 'image/png', data: huge }],
    };
    const tokens = estimateMessageTokens(m);
    expect(tokens).toBeGreaterThanOrEqual(IMAGE_PART_TOKENS);
    // Must be nowhere near 200K/4 ≈ 50K — that was the old over-count bug.
    expect(tokens).toBeLessThan(IMAGE_PART_TOKENS + PER_MESSAGE_OVERHEAD_TOKENS + 10);
  });

  it('counts an image inside a tool-result content array at the flat cost', () => {
    const m: ModelMessage = {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: 'c1',
          toolName: 'screenshot',
          output: { type: 'content', value: [{ type: 'media', data: 'B'.repeat(120_000), mediaType: 'image/jpeg' }] },
        },
      ],
    };
    const tokens = estimateMessageTokens(m);
    expect(tokens).toBeGreaterThanOrEqual(IMAGE_PART_TOKENS);
    expect(tokens).toBeLessThan(IMAGE_PART_TOKENS + 100);
  });

  it('falls back to a JSON estimate for unknown part shapes (never silently zero)', () => {
    const m: ModelMessage = {
      role: 'assistant',
      // A shape the switch doesn't know — must still contribute.
      content: [{ type: 'future-part-kind', payload: 'y'.repeat(400) } as unknown as never],
    };
    expect(estimateMessageTokens(m)).toBeGreaterThan(50);
  });

  it('memoizes per message object (same reference → cached)', () => {
    const m: ModelMessage = { role: 'user', content: 'hello world' };
    const first = estimateMessageTokens(m);
    expect(estimateMessageTokens(m)).toBe(first);
  });
});

describe('estimateTokens (array sum)', () => {
  it('sums member messages', () => {
    const a: ModelMessage = { role: 'user', content: 'a'.repeat(40) };
    const b: ModelMessage = { role: 'assistant', content: 'b'.repeat(40) };
    expect(estimateTokens([a, b])).toBe(estimateMessageTokens(a) + estimateMessageTokens(b));
  });
});

describe('estimateDtoTokens (panel ChatMessageDTO)', () => {
  it('counts text parts', () => {
    const dto: ChatMessageDTO = { id: 'm1', role: 'user', parts: [{ kind: 'text', text: 'a'.repeat(40) }] };
    expect(estimateDtoTokens(dto)).toBe(PER_MESSAGE_OVERHEAD_TOKENS + 10);
  });

  it('counts image parts flat and the __doe_image screenshot marker flat', () => {
    const imageDto: ChatMessageDTO = {
      id: 'm2',
      role: 'user',
      parts: [{ kind: 'image', mediaType: 'image/webp', dataUrl: 'data:image/webp;base64,' + 'C'.repeat(80_000) }],
    };
    expect(estimateDtoTokens(imageDto)).toBeGreaterThanOrEqual(IMAGE_PART_TOKENS);
    expect(estimateDtoTokens(imageDto)).toBeLessThan(IMAGE_PART_TOKENS + 50);

    const shotDto: ChatMessageDTO = {
      id: 'm3',
      role: 'assistant',
      parts: [
        {
          kind: 'tool_call',
          callId: 'c1',
          toolName: 'screenshot',
          args: { action: 'screenshot' },
          result: { __doe_image: { base64: 'D'.repeat(80_000), mediaType: 'image/jpeg' }, width: 1280 },
        },
      ],
    };
    const shot = estimateDtoTokens(shotDto);
    expect(shot).toBeGreaterThanOrEqual(IMAGE_PART_TOKENS);
    // The 80K base64 must not be counted as text.
    expect(shot).toBeLessThan(IMAGE_PART_TOKENS + 500);
  });

  it('a tool-heavy assistant DTO dwarfs a text-only one', () => {
    const textDto: ChatMessageDTO = { id: 't', role: 'user', parts: [{ kind: 'text', text: 'short' }] };
    const toolDto: ChatMessageDTO = {
      id: 'a',
      role: 'assistant',
      parts: [{ kind: 'tool_call', callId: 'c', toolName: 'read_page', args: {}, result: { content: 'DOM '.repeat(5000) } }],
    };
    expect(estimateDtoTokens(toolDto)).toBeGreaterThan(estimateDtoTokens(textDto) * 20);
  });
});
