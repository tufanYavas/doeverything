import { classifyContext, KEEP_TAIL_RATIO, pruneThreshold, resolveContextWindowSafe } from './context-budget.js';
import { CONTEXT_WINDOW_RATIOS, FALLBACK_CONTEXT_WINDOW } from '@doeverything/llm-providers';
import { describe, expect, it } from 'vitest';

describe('classifyContext', () => {
  const W = 200_000;
  it('returns ok below the warn ratio', () => {
    expect(classifyContext(W * 0.5, W)).toBe('ok');
    expect(classifyContext(0, W)).toBe('ok');
  });
  it('returns warn at/above the warn ratio but below critical', () => {
    expect(classifyContext(W * CONTEXT_WINDOW_RATIOS.warn, W)).toBe('warn');
    expect(classifyContext(W * 0.8, W)).toBe('warn');
  });
  it('returns critical at/above the critical ratio', () => {
    expect(classifyContext(W * CONTEXT_WINDOW_RATIOS.critical, W)).toBe('critical');
    expect(classifyContext(W * 2, W)).toBe('critical');
  });
  it('never divides by zero on a degenerate window', () => {
    expect(classifyContext(10, 0)).toBe('critical');
  });
});

describe('pruneThreshold', () => {
  it('is the prune ratio of the window', () => {
    expect(pruneThreshold(200_000)).toBe(Math.floor(200_000 * CONTEXT_WINDOW_RATIOS.prune));
    expect(pruneThreshold(8_192)).toBe(Math.floor(8_192 * CONTEXT_WINDOW_RATIOS.prune));
  });
});

describe('KEEP_TAIL_RATIO', () => {
  it('keeps a minority of the window so summary + schemas + output fit', () => {
    expect(KEEP_TAIL_RATIO).toBeGreaterThan(0);
    expect(KEEP_TAIL_RATIO).toBeLessThan(0.5);
  });
});

describe('resolveContextWindowSafe', () => {
  it('honors a positive dev override from storage.local', async () => {
    await chrome.storage.local.set({ 'doe:dev:context-window': 6000 });
    expect(await resolveContextWindowSafe('anthropic', 'claude-opus-4-7')).toBe(6000);
  });

  it('ignores a non-positive / non-number override', async () => {
    await chrome.storage.local.set({ 'doe:dev:context-window': 0 });
    // claude → 200K static, capped at 200K
    expect(await resolveContextWindowSafe('anthropic', 'claude-opus-4-7')).toBe(200_000);
  });

  it('caps a 1M model at the cost cap and falls back for unknown ids', async () => {
    expect(await resolveContextWindowSafe('google', 'gemini-2.5-pro')).toBe(200_000);
    expect(await resolveContextWindowSafe('openai-compatible', 'mystery-model')).toBe(FALLBACK_CONTEXT_WINDOW);
  });
});
