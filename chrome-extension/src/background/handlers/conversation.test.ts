import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * conversation.ts is a `chrome.runtime.onMessage` bridge that, on a
 * `doe/conversation/cleared` message, drops every per-conversation cache.
 * The asserted behavior:
 *
 *   - Non-matching message types return `false` and touch nothing.
 *   - A matching message returns `true` (the listener does async work and
 *     responds later) and forwards the SAME conversationId to all five
 *     clear functions: clearWorkingMemory (sync) plus the four awaited
 *     async clears (invocations, listing, overrides, compaction).
 *   - A matching message with an empty/missing conversationId still responds
 *     ok:true but performs NO clears (the `if (id)` guard).
 *   - If a clear rejects, the catch sends `{ ok:false, error }`.
 *
 * All five clear modules are mocked to spies so we can assert the dispatch
 * without depending on their session-state/storage side effects.
 */

const calls = {
  workingMemory: [] as string[],
  invocations: [] as string[],
  listing: [] as string[],
  overrides: [] as string[],
  compaction: [] as string[],
};
let invocationsRejects = false;

vi.mock('../agent/working-memory.js', () => ({
  clearWorkingMemory: vi.fn((id: string) => {
    calls.workingMemory.push(id);
  }),
}));
vi.mock('../skills/invocation-tracker.js', () => ({
  clearInvocationsForSession: vi.fn(async (id: string) => {
    calls.invocations.push(id);
    if (invocationsRejects) throw new Error('boom');
  }),
}));
vi.mock('../skills/listing-tracker.js', () => ({
  clearListingForSession: vi.fn(async (id: string) => {
    calls.listing.push(id);
  }),
}));
vi.mock('../skills/runtime-overrides.js', () => ({
  clearOverridesForSession: vi.fn(async (id: string) => {
    calls.overrides.push(id);
  }),
}));
vi.mock('../agent/compaction-cache.js', () => ({
  clearCompactionRecord: vi.fn(async (id: string) => {
    calls.compaction.push(id);
  }),
}));

type MessageListener = (msg: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => boolean | void;
interface GlobalShape {
  __chromeState: { messageListeners: MessageListener[] };
}
const g = globalThis as unknown as GlobalShape;

async function registerAndGetListener(): Promise<MessageListener> {
  const { registerConversationHandlers } = await import('./conversation.js');
  registerConversationHandlers();
  const listeners = g.__chromeState.messageListeners;
  return listeners[listeners.length - 1];
}

/** Dispatch a message and resolve once sendResponse fires (or after a tick). */
async function dispatch(listener: MessageListener, msg: unknown): Promise<{ ret: boolean | void; response: unknown }> {
  let response: unknown;
  let responded = false;
  const ret = listener(msg, {}, (r?: unknown) => {
    responded = true;
    response = r;
  });
  // The async IIFE responds on a microtask; the unmatched-type path never
  // responds at all. Drain microtasks so an async response lands.
  await Promise.resolve();
  await Promise.resolve();
  return { ret, response: responded ? response : undefined };
}

beforeEach(() => {
  for (const k of Object.keys(calls) as (keyof typeof calls)[]) calls[k].length = 0;
  invocationsRejects = false;
  vi.resetModules();
});

describe('registerConversationHandlers', () => {
  it('ignores unrelated message types and clears nothing', async () => {
    const listener = await registerAndGetListener();
    const { ret, response } = await dispatch(listener, { type: 'doe/other', conversationId: 'c1' });
    expect(ret).toBe(false);
    expect(response).toBeUndefined();
    expect(calls.workingMemory).toEqual([]);
    expect(calls.compaction).toEqual([]);
  });

  it('clears all five per-conversation caches with the same id and acks ok:true', async () => {
    const listener = await registerAndGetListener();
    const { ret, response } = await dispatch(listener, {
      type: 'doe/conversation/cleared',
      conversationId: 'conv-7',
    });
    // Async listener: returns true so Chrome keeps the response channel open.
    expect(ret).toBe(true);
    expect(response).toEqual({ ok: true });
    expect(calls.workingMemory).toEqual(['conv-7']);
    expect(calls.invocations).toEqual(['conv-7']);
    expect(calls.listing).toEqual(['conv-7']);
    expect(calls.overrides).toEqual(['conv-7']);
    expect(calls.compaction).toEqual(['conv-7']);
  });

  it('acks ok:true but skips all clears when conversationId is missing', async () => {
    const listener = await registerAndGetListener();
    const { ret, response } = await dispatch(listener, { type: 'doe/conversation/cleared' });
    expect(ret).toBe(true);
    expect(response).toEqual({ ok: true });
    expect(calls.workingMemory).toEqual([]);
    expect(calls.invocations).toEqual([]);
    expect(calls.compaction).toEqual([]);
  });

  it('acks ok:true but skips all clears when conversationId is empty string', async () => {
    const listener = await registerAndGetListener();
    const { response } = await dispatch(listener, { type: 'doe/conversation/cleared', conversationId: '' });
    expect(response).toEqual({ ok: true });
    expect(calls.workingMemory).toEqual([]);
  });

  it('reports ok:false with the error message when a clear rejects', async () => {
    invocationsRejects = true;
    const listener = await registerAndGetListener();
    const { response } = await dispatch(listener, {
      type: 'doe/conversation/cleared',
      conversationId: 'conv-err',
    });
    expect(response).toEqual({ ok: false, error: 'boom' });
    // The synchronous clearWorkingMemory still ran before the rejection.
    expect(calls.workingMemory).toEqual(['conv-err']);
  });
});
