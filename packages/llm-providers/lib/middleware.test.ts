import { describe, expect, it, vi } from 'vitest';

/**
 * The middleware module is almost entirely declarative: it exports two tuned
 * constants and wraps them in the SDK's `defaultSettingsMiddleware`. There is
 * no branching logic of our own to exercise, so the meaningful assertions are:
 *
 *   1. The constants carry the exact production-tuned values (a regression
 *      here silently changes every model call's budget).
 *   2. The middleware is built by handing those values to
 *      `defaultSettingsMiddleware` in the documented shape — including the
 *      Gemini-only `providerOptions.google.thinkingConfig` block.
 *
 * We mock `ai` so we can inspect the settings object the module passes to
 * `defaultSettingsMiddleware` without depending on the SDK's internal
 * middleware representation.
 */

const settingsSpy = vi.fn((arg: unknown) => ({ __mwTag: 'defaults', arg }));

vi.mock('ai', () => ({
  defaultSettingsMiddleware: (arg: unknown) => settingsSpy(arg),
}));

describe('doe middleware constants', () => {
  it('pins the hard output-token cap at 8192', async () => {
    const { doeverything_MAX_OUTPUT_TOKENS } = await import('./middleware.js');
    expect(doeverything_MAX_OUTPUT_TOKENS).toBe(8_192);
  });

  it('pins the Gemini thinking budget at 2048', async () => {
    const { GEMINI_THINKING_BUDGET } = await import('./middleware.js');
    expect(GEMINI_THINKING_BUDGET).toBe(2_048);
  });
});

describe('doeDefaultsMiddleware construction', () => {
  it('is built from defaultSettingsMiddleware with the tuned settings', async () => {
    const mod = await import('./middleware.js');

    // The exported middleware is exactly what our mocked factory returned.
    expect(mod.doeDefaultsMiddleware).toEqual({
      __mwTag: 'defaults',
      arg: {
        settings: {
          maxOutputTokens: 8_192,
          providerOptions: {
            google: {
              thinkingConfig: { thinkingBudget: 2_048, includeThoughts: false },
            },
          },
        },
      },
    });

    // And it was constructed via the SDK helper, not hand-rolled.
    expect(settingsSpy).toHaveBeenCalledTimes(1);
  });

  it('feeds the exported constants (not duplicated literals) into the settings', async () => {
    const { doeverything_MAX_OUTPUT_TOKENS, GEMINI_THINKING_BUDGET } = await import('./middleware.js');
    const arg = settingsSpy.mock.calls[0]?.[0] as {
      settings: {
        maxOutputTokens: number;
        providerOptions: { google: { thinkingConfig: { thinkingBudget: number; includeThoughts: boolean } } };
      };
    };
    expect(arg.settings.maxOutputTokens).toBe(doeverything_MAX_OUTPUT_TOKENS);
    expect(arg.settings.providerOptions.google.thinkingConfig.thinkingBudget).toBe(GEMINI_THINKING_BUDGET);
    // includeThoughts is hard-coded false to keep the cache prefix small.
    expect(arg.settings.providerOptions.google.thinkingConfig.includeThoughts).toBe(false);
  });
});
