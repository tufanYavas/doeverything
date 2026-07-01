import { buildSummaryMessage, buildSummaryRequest, selectCompactionBoundary, splitByCursor } from './compaction.js';
import { toModelMessages } from './conversion.js';
import { describe, expect, it } from 'vitest';
import type { CompactionCacheRecord } from './compaction-cache.js';
import type { ChatMessageDTO } from './conversion.js';

/**
 * End-to-end compaction LIFECYCLE across several simulated turns — the
 * scenario unit tests of the individual functions can't catch: the cursor
 * advancing monotonically, the merge preserving older facts, the kept slice
 * staying tool-paired every fold, and the summary message staying byte-stable
 * in steady state (the prompt-cache prefix invariant). The actual summary text
 * comes from an LLM at runtime; here we stub it deterministically and exercise
 * everything around it.
 */
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
    parts.push({
      kind: 'tool_call',
      callId: `call_${id()}`,
      toolName: 'read_page',
      args: { tabId: 1 },
      status: 'done',
      result: { content: 'DOM '.repeat(3000) },
    });
  }
  return { id: id(), role: 'assistant', parts };
}

function appendTurns(history: ChatMessageDTO[], turns: number, rng: () => number): ChatMessageDTO[] {
  const out = [...history];
  for (let t = 0; t < turns; t++) {
    out.push(userDto(`Task ${out.length}`));
    out.push(assistantDto(rng));
  }
  return out;
}

function indexOfId(history: ChatMessageDTO[], cursorId: string): number {
  return history.findIndex(m => m.id === cursorId);
}

function isToolPaired(messages: Awaited<ReturnType<typeof toModelMessages>>): boolean {
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
  for (const c of calls) if (!results.has(c)) return false;
  for (const r of results) if (!calls.has(r)) return false;
  return true;
}

/**
 * Mirrors the runner's per-turn compaction decision (minus the live LLM
 * summary call): split at the cursor, pick a boundary against the keep budget,
 * and roll the cursor forward — merging the previous summary so older facts
 * survive. Returns the record unchanged when nothing needs folding.
 */
function foldStep(history: ChatMessageDTO[], record: CompactionCacheRecord | null, keepBudget: number): CompactionCacheRecord {
  const { tail, cursorValid } = splitByCursor(history, record);
  const effective = cursorValid ? tail : history;
  const boundary = selectCompactionBoundary(effective, keepBudget);
  if (boundary === 0) return record ?? emptyRecord();

  const previousSummary = cursorValid && record ? record.summary : null;
  const toFold = effective.slice(0, boundary);
  // Real runner hands this to the fast model; assert the request shape is sane.
  const req = buildSummaryRequest({ previousSummary, toFold });
  expect(req.system.length).toBeGreaterThan(0);
  const summary = `${previousSummary ? previousSummary + '\n' : ''}- folded ${toFold.length} dtos @gen${(record?.generation ?? 0) + 1}`;
  return {
    conversationId: 'c',
    summary,
    cursorMessageId: effective[boundary - 1].id,
    coveredCount: (record?.coveredCount ?? 0) + boundary,
    summaryTokens: 1,
    generation: (record?.generation ?? 0) + 1,
    updatedAt: 1,
  };
}

function emptyRecord(): CompactionCacheRecord {
  return { conversationId: 'c', summary: '', cursorMessageId: '', coveredCount: 0, summaryTokens: 0, generation: 0, updatedAt: 0 };
}

describe('compaction lifecycle across turns', () => {
  it('advances the cursor monotonically and merges summaries over 3 folds', () => {
    const rng = makeRng(42);
    const KEEP = 15_000;

    let history = appendTurns([], 6, rng);
    const r1 = foldStep(history, null, KEEP);
    expect(r1.generation).toBe(1);
    expect(indexOfId(history, r1.cursorMessageId)).toBeGreaterThanOrEqual(0);

    history = appendTurns(history, 5, rng);
    const r2 = foldStep(history, r1, KEEP);
    expect(r2.generation).toBe(2);
    // Cursor must roll FORWARD, never backward.
    expect(indexOfId(history, r2.cursorMessageId)).toBeGreaterThan(indexOfId(history, r1.cursorMessageId));
    // Merge keeps gen-1's facts.
    expect(r2.summary).toContain('@gen1');
    expect(r2.summary).toContain('@gen2');

    history = appendTurns(history, 5, rng);
    const r3 = foldStep(history, r2, KEEP);
    expect(r3.generation).toBe(3);
    expect(indexOfId(history, r3.cursorMessageId)).toBeGreaterThan(indexOfId(history, r2.cursorMessageId));
    expect(r3.summary).toContain('@gen1');
    expect(r3.summary).toContain('@gen3');
  });

  it('keeps the post-cursor slice tool-paired after every fold', async () => {
    const rng = makeRng(7);
    let history = appendTurns([], 8, rng);
    let record: CompactionCacheRecord | null = null;
    for (let turn = 0; turn < 3; turn++) {
      record = foldStep(history, record, 15_000);
      const { tail } = splitByCursor(history, record);
      const kept = await toModelMessages(tail);
      expect(isToolPaired(kept)).toBe(true);
      history = appendTurns(history, 4, rng);
    }
  });

  it('reuses the record (no new fold) and stays byte-stable in steady state', () => {
    const rng = makeRng(99);
    const history = appendTurns([], 10, rng);
    const folded = foldStep(history, null, 15_000);
    // Huge budget → nothing left to fold → record reused verbatim.
    const steady = foldStep(history, folded, 100_000_000);
    expect(steady).toBe(folded);
    // messages[0] must be byte-identical turn over turn so the cache prefix lives.
    expect(buildSummaryMessage(steady.summary).content).toBe(buildSummaryMessage(folded.summary).content);
  });

  it('falls back to full re-compaction when the cursor DTO was edited away', () => {
    const rng = makeRng(123);
    const history = appendTurns([], 8, rng);
    const r1 = foldStep(history, null, 15_000);
    // Simulate a mid-history edit that removes the cursor DTO.
    const edited = history.filter(m => m.id !== r1.cursorMessageId);
    const { cursorValid, tail } = splitByCursor(edited, r1);
    expect(cursorValid).toBe(false);
    expect(tail).toBe(edited); // whole history re-folds from scratch
  });
});
