import {
  buildSummaryMessage,
  buildSummaryRequest,
  flattenDtoForSummary,
  selectCompactionBoundary,
  splitByCursor,
} from './compaction.js';
import { toModelMessages } from './conversion.js';
import { describe, expect, it } from 'vitest';
import type { CompactionCacheRecord } from './compaction-cache.js';
import type { ChatMessageDTO } from './conversion.js';

let nextId = 0;
const id = () => `m_${nextId++}`;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function userDto(text: string): ChatMessageDTO {
  return { id: id(), role: 'user', parts: [{ kind: 'text', text }] };
}

function assistantDto(rng: () => number): ChatMessageDTO {
  const parts: ChatMessageDTO['parts'] = [{ kind: 'text', text: 'Working.' }];
  const n = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const pick = rng();
    if (pick < 0.34) {
      parts.push({
        kind: 'tool_call',
        callId: `call_${id()}`,
        toolName: 'read_page',
        args: { tabId: 1 },
        status: 'done',
        result: { content: 'DOM '.repeat(3000) },
      });
    } else if (pick < 0.67) {
      parts.push({
        kind: 'tool_call',
        callId: `call_${id()}`,
        toolName: 'screenshot',
        args: { action: 'screenshot' },
        status: 'done',
        result: { __doe_image: { base64: 'x'.repeat(40_000), mediaType: 'image/jpeg' }, width: 1280 },
      });
    } else {
      parts.push({
        kind: 'tool_call',
        callId: `call_${id()}`,
        toolName: 'find',
        args: { query: 'price' },
        status: 'done',
        result: { matches: [{ text: 'item' }] },
      });
    }
  }
  return { id: id(), role: 'assistant', parts };
}

function makeHistory(turns: number, rng: () => number): ChatMessageDTO[] {
  const out: ChatMessageDTO[] = [];
  for (let t = 0; t < turns; t++) {
    out.push(userDto(`Task ${t}`));
    out.push(assistantDto(rng));
  }
  return out;
}

describe('splitByCursor', () => {
  it('returns the full history (cursorValid:false) when there is no record', () => {
    const h = makeHistory(3, makeRng(1));
    const r = splitByCursor(h, null);
    expect(r.cursorValid).toBe(false);
    expect(r.tail).toBe(h);
  });

  it('returns everything after the cursor when the id is found mid-history', () => {
    const h = makeHistory(4, makeRng(2));
    const record: CompactionCacheRecord = {
      conversationId: 'c',
      summary: 's',
      cursorMessageId: h[2].id,
      coveredCount: 3,
      summaryTokens: 1,
      generation: 1,
      updatedAt: 1,
    };
    const r = splitByCursor(h, record);
    expect(r.cursorValid).toBe(true);
    expect(r.tail[0].id).toBe(h[3].id);
    expect(r.tail.length).toBe(h.length - 3);
  });

  it('invalidates when the cursor id is gone (mid-history edit)', () => {
    const h = makeHistory(3, makeRng(3));
    const record: CompactionCacheRecord = {
      conversationId: 'c',
      summary: 's',
      cursorMessageId: 'vanished',
      coveredCount: 1,
      summaryTokens: 1,
      generation: 1,
      updatedAt: 1,
    };
    expect(splitByCursor(h, record).cursorValid).toBe(false);
  });

  it('invalidates a cursor sitting on the last message (no tail left)', () => {
    const h = makeHistory(3, makeRng(4));
    const record: CompactionCacheRecord = {
      conversationId: 'c',
      summary: 's',
      cursorMessageId: h[h.length - 1].id,
      coveredCount: h.length,
      summaryTokens: 1,
      generation: 1,
      updatedAt: 1,
    };
    expect(splitByCursor(h, record).cursorValid).toBe(false);
  });
});

describe('selectCompactionBoundary', () => {
  it('is a no-op on tiny / empty histories', () => {
    expect(selectCompactionBoundary([], 1000)).toBe(0);
    expect(selectCompactionBoundary([userDto('hi')], 1000)).toBe(0);
  });

  it('always lands on a user DTO and never folds the final user turn', () => {
    for (const seed of [1, 7, 1337, 90210]) {
      const h = makeHistory(12, makeRng(seed));
      const boundary = selectCompactionBoundary(h, 20_000);
      expect(boundary).toBeGreaterThan(0);
      expect(h[boundary].role).toBe('user');
      let lastUser = -1;
      for (let i = h.length - 1; i >= 0; i--) {
        if (h[i].role === 'user') {
          lastUser = i;
          break;
        }
      }
      expect(boundary).toBeLessThanOrEqual(lastUser);
    }
  });

  it('keeps the kept slice tool-paired after conversion (no orphan tool_use/result)', async () => {
    for (const seed of [2, 11, 808]) {
      const h = makeHistory(12, makeRng(seed));
      const boundary = selectCompactionBoundary(h, 20_000);
      const kept = await toModelMessages(h.slice(boundary));
      const calls = new Set<string>();
      const results = new Set<string>();
      for (const m of kept) {
        if (!Array.isArray(m.content)) continue;
        for (const part of m.content) {
          if (typeof part === 'object' && part !== null && 'type' in part) {
            if (part.type === 'tool-call' && 'toolCallId' in part) calls.add(String(part.toolCallId));
            if (part.type === 'tool-result' && 'toolCallId' in part) results.add(String(part.toolCallId));
          }
        }
      }
      for (const c of calls) expect(results.has(c)).toBe(true);
      for (const r of results) expect(calls.has(r)).toBe(true);
    }
  });
});

describe('flattenDtoForSummary', () => {
  it('renders tool calls with names and never leaks screenshot base64 or [multipart]', () => {
    const rng = makeRng(5);
    // Force a screenshot tool call.
    const dto: ChatMessageDTO = {
      id: id(),
      role: 'assistant',
      parts: [
        { kind: 'text', text: 'doing it' },
        {
          kind: 'tool_call',
          callId: 'c1',
          toolName: 'screenshot',
          args: { action: 'screenshot' },
          result: { __doe_image: { base64: 'x'.repeat(50_000), mediaType: 'image/jpeg' } },
        },
      ],
    };
    void rng;
    const flat = flattenDtoForSummary(dto);
    expect(flat).not.toContain('[multipart]');
    expect(flat).toContain('tool screenshot(');
    expect(flat).toContain('[screenshot]');
    expect(flat).not.toContain('x'.repeat(1000));
  });

  it('renders image DTO parts as [screenshot]', () => {
    const dto: ChatMessageDTO = {
      id: id(),
      role: 'user',
      parts: [{ kind: 'image', mediaType: 'image/webp', dataUrl: 'data:image/webp;base64,' + 'y'.repeat(40_000) }],
    };
    const flat = flattenDtoForSummary(dto);
    expect(flat).toContain('[screenshot]');
    expect(flat).not.toContain('y'.repeat(1000));
  });
});

describe('buildSummaryRequest', () => {
  it('fresh mode has no merge preamble', () => {
    const h = makeHistory(2, makeRng(6));
    const req = buildSummaryRequest({ previousSummary: null, toFold: h });
    expect(req.prompt).not.toContain('Existing summary');
    expect(req.system).toContain('summaris');
  });

  it('merge mode embeds the previous summary so older facts survive', () => {
    const h = makeHistory(2, makeRng(7));
    const req = buildSummaryRequest({ previousSummary: '- earlier fact', toFold: h });
    expect(req.prompt).toContain('- earlier fact');
    expect(req.prompt).toMatch(/update the existing summary/i);
  });
});

describe('buildSummaryMessage', () => {
  it('is a system message, byte-stable for the same summary string', () => {
    const a = buildSummaryMessage('- a\n- b');
    const b = buildSummaryMessage('- a\n- b');
    expect(a.role).toBe('system');
    expect(a.content).toBe(b.content);
    expect(a.content).toContain('Earlier conversation summary');
  });
});
