/**
 * Custom `StopCondition`s for the doeverything agent loop. They compose with
 * the SDK's built-ins (`stepCountIs`, `hasToolCall`) inside the
 * `ToolLoopAgent` `stopWhen` array.
 */

import type { StepResult, StopCondition, ToolSet } from 'ai';

/**
 * Order-stable fingerprint for a tool call's input. Object keys are sorted
 * so the model can't sneak past the repetition guard by re-ordering args,
 * and the serialised form is truncated so a giant string field (e.g. a
 * 50KB JS blob) doesn't dominate identity — the prefix is more than enough
 * to tell two calls apart in practice.
 */
export function fingerprintToolCall(name: string, input: unknown): string {
  let serialized = '';
  try {
    serialized = JSON.stringify(input, Object.keys((input ?? {}) as object).sort());
  } catch {
    serialized = String(input);
  }
  return `${name}:${serialized.slice(0, 256)}`;
}

/**
 * Composite fingerprint over an entire step's tool-call set, so a step
 * that batches `[X(a), Y(b)]` is treated as distinct from a step that
 * emits only `X(a)`.
 */
function fingerprintStep(step: StepResult<ToolSet>): string | null {
  const calls = (step.toolCalls ?? []) as Array<{ toolName: string; input?: unknown }>;
  if (calls.length === 0) return null;
  return calls.map(c => fingerprintToolCall(c.toolName, c.input)).join('|');
}

/**
 * StopCondition that fires when the most recent N steps all share the
 * same `(toolName, argsHash)` fingerprint. Steps without tool calls reset
 * the streak — only back-to-back identical calls count.
 *
 * The optional `onTrigger` lets the runner observe the stop without
 * polling the agent's step list afterwards (we use it to surface a clear
 * "stuck in a loop" error instead of a silent finish).
 */
export function repeatedToolCallStop(limit: number, onTrigger?: () => void): StopCondition<ToolSet> {
  return ({ steps }: { steps: Array<StepResult<ToolSet>> }) => {
    if (steps.length < limit) return false;
    const tail = steps.slice(-limit);
    const prints: string[] = [];
    for (const step of tail) {
      const fp = fingerprintStep(step);
      if (fp === null) return false;
      prints.push(fp);
    }
    const stop = prints.every(p => p === prints[0]);
    if (stop) onTrigger?.();
    return stop;
  };
}

/**
 * Detect whether the last two steps emitted identical tool-call sets.
 * Used by `prepareStep` to issue a one-shot "switch tactic" nudge BEFORE
 * the third identical call triggers `repeatedToolCallStop`.
 */
export function lastTwoStepsAreIdentical(steps: Array<StepResult<ToolSet>>): {
  identical: boolean;
  toolName?: string;
} {
  if (steps.length < 2) return { identical: false };
  const last = steps[steps.length - 1];
  const prev = steps[steps.length - 2];
  const lastCalls = (last.toolCalls ?? []) as Array<{ toolName: string; input?: unknown }>;
  const prevCalls = (prev.toolCalls ?? []) as Array<{ toolName: string; input?: unknown }>;
  if (lastCalls.length === 0 || lastCalls.length !== prevCalls.length) return { identical: false };
  const lastFp = lastCalls.map(c => fingerprintToolCall(c.toolName, c.input)).join('|');
  const prevFp = prevCalls.map(c => fingerprintToolCall(c.toolName, c.input)).join('|');
  return { identical: lastFp === prevFp, toolName: lastCalls[0].toolName };
}
