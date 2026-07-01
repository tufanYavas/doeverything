import {
  CONTEXT_WINDOW_COST_CAP,
  CONTEXT_WINDOW_RATIOS,
  FALLBACK_CONTEXT_WINDOW,
  resolveStaticContextWindow,
} from './context-windows.js';
import { describe, expect, it } from 'vitest';

describe('resolveStaticContextWindow', () => {
  it('maps the Claude family to 200K', () => {
    expect(resolveStaticContextWindow('claude-opus-4-7')).toBe(200_000);
    expect(resolveStaticContextWindow('claude-haiku-4-5')).toBe(200_000);
  });

  it('uses longest-prefix-wins so bare gpt-4 stays at 8K while gpt-4o/4.1 win their larger windows', () => {
    expect(resolveStaticContextWindow('gpt-4')).toBe(8_192);
    expect(resolveStaticContextWindow('gpt-4o')).toBe(128_000);
    expect(resolveStaticContextWindow('gpt-4o-mini')).toBe(128_000);
    expect(resolveStaticContextWindow('gpt-4.1')).toBe(1_000_000);
    expect(resolveStaticContextWindow('gpt-4-turbo')).toBe(128_000);
  });

  it('matches the segment after the last slash (OpenRouter / Together id forms)', () => {
    expect(resolveStaticContextWindow('anthropic/claude-opus-4-7')).toBe(200_000);
    expect(resolveStaticContextWindow('meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo')).toBe(128_000);
    expect(resolveStaticContextWindow('openai/gpt-4o-mini')).toBe(128_000);
  });

  it('keeps Cerebras 8K llama idiom distinct from the 128K llama-3.1 family', () => {
    expect(resolveStaticContextWindow('llama3.1-70b')).toBe(8_192);
    expect(resolveStaticContextWindow('llama-3.1-8b-instant')).toBe(128_000);
  });

  it('maps Gemini tiers (exact small models still resolve high)', () => {
    expect(resolveStaticContextWindow('gemini-2.5-pro')).toBe(1_000_000);
    expect(resolveStaticContextWindow('gemini-2.5-flash')).toBe(1_000_000);
    expect(resolveStaticContextWindow('gemini-99-future')).toBe(128_000);
  });

  it('is case-insensitive', () => {
    expect(resolveStaticContextWindow('CLAUDE-OPUS-4-7')).toBe(200_000);
    expect(resolveStaticContextWindow('GPT-4O')).toBe(128_000);
  });

  it('returns undefined for unknown / empty ids so callers can apply the fallback', () => {
    expect(resolveStaticContextWindow('totally-made-up-model')).toBeUndefined();
    expect(resolveStaticContextWindow('')).toBeUndefined();
    expect(resolveStaticContextWindow('   ')).toBeUndefined();
  });
});

describe('constants', () => {
  it('keeps the cost cap at 200K and a conservative 120K fallback', () => {
    expect(CONTEXT_WINDOW_COST_CAP).toBe(200_000);
    expect(FALLBACK_CONTEXT_WINDOW).toBe(120_000);
  });

  it('orders the ratios warn < critical and keeps prune below warn', () => {
    expect(CONTEXT_WINDOW_RATIOS.prune).toBeLessThan(CONTEXT_WINDOW_RATIOS.warn);
    expect(CONTEXT_WINDOW_RATIOS.warn).toBeLessThan(CONTEXT_WINDOW_RATIOS.critical);
    expect(CONTEXT_WINDOW_RATIOS.critical).toBeLessThan(1);
  });
});
