import { fingerprintToolCall, lastTwoStepsAreIdentical } from './stop-conditions.js';
import { describe, expect, it } from 'vitest';
import type { StepResult, ToolSet } from 'ai';

/** Minimal StepResult stub carrying just the toolCalls the logic reads. */
function step(calls: Array<{ toolName: string; input?: unknown }>): StepResult<ToolSet> {
  return { toolCalls: calls } as unknown as StepResult<ToolSet>;
}

describe('fingerprintToolCall', () => {
  it('is stable regardless of key order in the input', () => {
    expect(fingerprintToolCall('navigate', { a: 1, b: 2 })).toBe(fingerprintToolCall('navigate', { b: 2, a: 1 }));
  });
  it('differs by tool name and by argument value', () => {
    expect(fingerprintToolCall('a', { x: 1 })).not.toBe(fingerprintToolCall('b', { x: 1 }));
    expect(fingerprintToolCall('a', { x: 1 })).not.toBe(fingerprintToolCall('a', { x: 2 }));
  });
});

describe('lastTwoStepsAreIdentical', () => {
  it('returns false with fewer than two steps', () => {
    expect(lastTwoStepsAreIdentical([]).identical).toBe(false);
    expect(lastTwoStepsAreIdentical([step([{ toolName: 'x' }])]).identical).toBe(false);
  });

  it('flags two consecutive identical single-call steps', () => {
    const r = lastTwoStepsAreIdentical([
      step([{ toolName: 'read_page', input: { tabId: 1 } }]),
      step([{ toolName: 'read_page', input: { tabId: 1 } }]),
    ]);
    expect(r.identical).toBe(true);
    expect(r.toolName).toBe('read_page');
  });

  it('does not flag steps with different args', () => {
    const r = lastTwoStepsAreIdentical([
      step([{ toolName: 'navigate', input: { url: 'a' } }]),
      step([{ toolName: 'navigate', input: { url: 'b' } }]),
    ]);
    expect(r.identical).toBe(false);
  });

  it('does not flag when the last step has no tool calls', () => {
    expect(lastTwoStepsAreIdentical([step([{ toolName: 'x' }]), step([])]).identical).toBe(false);
  });

  it('compares the whole batched call set (order-sensitive composite)', () => {
    const a = step([{ toolName: 'x', input: { n: 1 } }, { toolName: 'y', input: { n: 2 } }]);
    const b = step([{ toolName: 'x', input: { n: 1 } }, { toolName: 'y', input: { n: 2 } }]);
    expect(lastTwoStepsAreIdentical([a, b]).identical).toBe(true);

    const c = step([{ toolName: 'x', input: { n: 1 } }]);
    expect(lastTwoStepsAreIdentical([a, c]).identical).toBe(false); // different call count
  });
});
