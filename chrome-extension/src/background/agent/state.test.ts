import { CacheBreakpointTracker } from './state.js';
import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';

function anthropicMark(m: ModelMessage): unknown {
  const opts = (m as ModelMessage & { providerOptions?: Record<string, unknown> }).providerOptions;
  return opts?.anthropic;
}

/** Build an assistant message whose content size is roughly `chars`. */
function assistant(chars: number): ModelMessage {
  return { role: 'assistant', content: 'a'.repeat(chars) };
}
function user(chars: number): ModelMessage {
  return { role: 'user', content: 'u'.repeat(chars) };
}

describe('CacheBreakpointTracker', () => {
  it('stamps the last assistant message on the first apply', () => {
    const t = new CacheBreakpointTracker();
    const msgs = [user(10), assistant(10)];
    const out = t.apply(msgs);
    expect(anthropicMark(out[1])).toEqual({ cacheControl: { type: 'ephemeral' } });
  });

  it('is a no-op (no assistant) when there is nothing to stamp', () => {
    const t = new CacheBreakpointTracker();
    const msgs = [user(10)];
    expect(t.apply(msgs)).toBe(msgs);
  });

  it('keeps the breakpoint pinned when growth is below the threshold', () => {
    const t = new CacheBreakpointTracker();
    const first = [user(10), assistant(40)];
    t.apply(first);
    // Append a tiny new assistant turn — well under the 5K-token gate.
    const second = [user(10), assistant(40), user(10), assistant(40)];
    const out = t.apply(second);
    // Old position (index 1) still stamped; new tail (index 3) not.
    expect(anthropicMark(out[1])).toBeTruthy();
    expect(anthropicMark(out[3])).toBeFalsy();
  });

  it('rolls the breakpoint forward once growth clears the threshold', () => {
    const t = new CacheBreakpointTracker();
    t.apply([user(10), assistant(40)]);
    // > 5K tokens (~20K+ chars) of new content appended.
    const grown = [user(10), assistant(40), user(10), assistant(40_000)];
    const out = t.apply(grown);
    expect(anthropicMark(out[3])).toBeTruthy();
    expect(anthropicMark(out[1])).toBeFalsy();
  });

  it('reset() forgets the stamp so a rebuilt array re-stamps from scratch', () => {
    const t = new CacheBreakpointTracker();
    t.apply([user(10), assistant(40_000)]);
    t.reset();
    const rebuilt = [user(10), assistant(40)];
    const out = t.apply(rebuilt);
    // After reset the first eligible assistant gets stamped immediately.
    expect(anthropicMark(out[1])).toBeTruthy();
  });
});
