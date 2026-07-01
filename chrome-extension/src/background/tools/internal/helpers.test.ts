/**
 * Unit tests for the parts of helpers.ts changed this sprint:
 *
 *   - screenshotContextStore â€” in-memory + chrome.storage.session persistence
 *   - applyCoordScale       â€” coordinate mapping using stored context
 *
 * Uses the shared chrome-mock.ts fake (globalThis.chrome / __chromeState),
 * which mirrors real Chrome storage APIs with an in-memory backing store.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock all heavy module-level imports that helpers.ts pulls in at load time.
// None of these are exercised by the tests below.
// ---------------------------------------------------------------------------

vi.mock('../../permissions/manager.js', () => ({
  PermissionManager: { ensure: vi.fn(), hostFromUrl: vi.fn(() => '*') },
  PermissionDeniedError: class PermissionDeniedError extends Error {},
}));

vi.mock('../../skills/runtime-overrides.js', () => ({
  isSkillAllowedTool: vi.fn(async () => false),
}));

vi.mock('@doeverything/llm-providers', () => ({
  createLanguageModel: vi.fn(),
  isBuiltInProviderId: vi.fn(() => false),
  PROVIDER_REGISTRY: {},
}));

vi.mock('@doeverything/storage', () => ({
  activeBaseUrl: vi.fn(() => ''),
  activeModel: vi.fn(() => 'claude-opus-4-5'),
  customIdFromProvider: vi.fn(() => ''),
  customProvidersStorage: { byId: vi.fn(async () => null) },
  isCustomProviderId: vi.fn(() => false),
  // detectCoordSystem reads llmConfigStorage. anthropic provider â†’ 'pixel' coord system.
  llmConfigStorage: {
    get: vi.fn(async () => ({
      provider: 'anthropic',
      apiKeys: { anthropic: 'key' },
      model: '',
      fastModel: null,
    })),
  },
}));

// ---------------------------------------------------------------------------
// Access the shared chrome-mock state (set up by tests/unit/setup/chrome-mock.ts)
// ---------------------------------------------------------------------------

type ChromeGlobal = {
  __chromeState: { session: Record<string, unknown> };
  __doe_screenshot_ctx?: Map<number, unknown>;
  __doe_coord_system_cache?: unknown;
};

const g = globalThis as unknown as ChromeGlobal;

// ---------------------------------------------------------------------------
// Import subject under test AFTER mocks are registered
// ---------------------------------------------------------------------------

import { screenshotContextStore, applyCoordScale } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset the in-memory screenshot context map between tests. */
function resetInMemoryStores() {
  g.__doe_screenshot_ctx = new Map();
  delete g.__doe_coord_system_cache;
}

function validCtx(overrides?: Partial<{
  viewportWidth: number;
  viewportHeight: number;
  screenshotWidth: number;
  screenshotHeight: number;
}>) {
  return {
    viewportWidth: 1280,
    viewportHeight: 720,
    screenshotWidth: 640,
    screenshotHeight: 360,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// screenshotContextStore â€” setContext
// ---------------------------------------------------------------------------

describe('screenshotContextStore.setContext', () => {
  beforeEach(() => {
    resetInMemoryStores();
  });

  it('stores valid context so getContext returns it immediately', async () => {
    const c = validCtx();
    screenshotContextStore.setContext(1, c);
    const result = await screenshotContextStore.getContext(1);
    expect(result).toEqual(c);
  });

  it('writes valid context to chrome.storage.session (key: doe_sctx_<tabId>)', () => {
    const c = validCtx();
    screenshotContextStore.setContext(2, c);
    // The chrome-mock set() body is synchronous, so the write is immediate.
    expect(g.__chromeState.session['doe_sctx_2']).toEqual(c);
  });

  it('does NOT write when viewportWidth is zero', () => {
    screenshotContextStore.setContext(3, validCtx({ viewportWidth: 0 }));
    expect('doe_sctx_3' in g.__chromeState.session).toBe(false);
  });

  it('does NOT write when screenshotHeight is zero', () => {
    screenshotContextStore.setContext(4, validCtx({ screenshotHeight: 0 }));
    expect('doe_sctx_4' in g.__chromeState.session).toBe(false);
  });

  it('does NOT write when viewportHeight is zero', () => {
    screenshotContextStore.setContext(5, validCtx({ viewportHeight: 0 }));
    expect('doe_sctx_5' in g.__chromeState.session).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// screenshotContextStore â€” getContext
// ---------------------------------------------------------------------------

describe('screenshotContextStore.getContext', () => {
  beforeEach(() => {
    resetInMemoryStores();
  });

  it('returns from memory without touching session storage', async () => {
    const c = validCtx();
    screenshotContextStore.setContext(10, c);
    // Clear the chrome.storage.session spy call counters (the set from above).
    vi.clearAllMocks();

    const result = await screenshotContextStore.getContext(10);
    expect(result).toEqual(c);
    // session.get should NOT have been called (cache hit).
    const getCallsForKey = (chrome.storage.session.get as ReturnType<typeof vi.fn>).mock.calls
      .filter((args: unknown[]) => args[0] === 'doe_sctx_10');
    expect(getCallsForKey).toHaveLength(0);
  });

  it('falls back to chrome.storage.session when not in memory (SW-restart simulation)', async () => {
    const c = validCtx({ viewportWidth: 1920, viewportHeight: 1080 });
    // Simulate previous SW persisting the context before eviction.
    g.__chromeState.session['doe_sctx_11'] = c;

    const result = await screenshotContextStore.getContext(11);
    expect(result).toEqual(c);
  });

  it('warms the memory cache after a session-storage hit so second call skips storage', async () => {
    const c = validCtx();
    g.__chromeState.session['doe_sctx_12'] = c;

    await screenshotContextStore.getContext(12); // populates cache
    vi.clearAllMocks();

    const second = await screenshotContextStore.getContext(12);
    expect(second).toEqual(c);
    // No new get() calls for this key.
    const getCallsForKey = (chrome.storage.session.get as ReturnType<typeof vi.fn>).mock.calls
      .filter((args: unknown[]) => args[0] === 'doe_sctx_12');
    expect(getCallsForKey).toHaveLength(0);
  });

  it('returns undefined when neither memory nor session storage has the key', async () => {
    expect(await screenshotContextStore.getContext(99)).toBeUndefined();
  });

  it('returns undefined when session storage contains a non-ScreenshotContext shape', async () => {
    g.__chromeState.session['doe_sctx_13'] = { unexpected: 'object' };
    expect(await screenshotContextStore.getContext(13)).toBeUndefined();
  });

  it('returns undefined when session storage has partial shape (missing screenshotHeight)', async () => {
    g.__chromeState.session['doe_sctx_14'] = { viewportWidth: 1280, viewportHeight: 720, screenshotWidth: 640 };
    expect(await screenshotContextStore.getContext(14)).toBeUndefined();
  });

  it('returns undefined (does not throw) when chrome.storage.session.get rejects', async () => {
    vi.mocked(chrome.storage.session.get).mockRejectedValueOnce(new Error('quota exceeded'));
    expect(await screenshotContextStore.getContext(15)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// screenshotContextStore â€” clearContext
// ---------------------------------------------------------------------------

describe('screenshotContextStore.clearContext', () => {
  beforeEach(() => {
    resetInMemoryStores();
  });

  it('removes the entry from memory so getContext returns undefined', async () => {
    screenshotContextStore.setContext(20, validCtx());
    screenshotContextStore.clearContext(20);
    // session also cleared â†’ fallback also returns undefined
    expect(await screenshotContextStore.getContext(20)).toBeUndefined();
  });

  it('removes the entry from chrome.storage.session', () => {
    g.__chromeState.session['doe_sctx_21'] = validCtx();
    screenshotContextStore.clearContext(21);
    expect('doe_sctx_21' in g.__chromeState.session).toBe(false);
  });

  it('is a no-op (no throw) when the key was never stored', () => {
    expect(() => screenshotContextStore.clearContext(999)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// applyCoordScale â€” coordinate mapping
// ---------------------------------------------------------------------------

describe('applyCoordScale', () => {
  beforeEach(() => {
    resetInMemoryStores();
  });

  it('passes coordinates through (rounded) when no context is stored', async () => {
    const result = await applyCoordScale(30, { x: 100.6, y: 200.4 });
    expect(result).toEqual({ x: 101, y: 200 });
  });

  it('maps screenshot-space coordinates to viewport space using stored context', async () => {
    // 640Ã—360 screenshot from a 1280Ã—720 viewport â†’ scale factor 2 in both axes.
    screenshotContextStore.setContext(31, validCtx());
    const result = await applyCoordScale(31, { x: 320, y: 180 });
    // 320 * (1280/640) = 640; 180 * (720/360) = 360.
    expect(result).toEqual({ x: 640, y: 360 });
  });

  it('recovers context from session storage when memory is empty (SW-restart scenario)', async () => {
    // Context in session storage only â€” simulates SW eviction mid-session.
    g.__chromeState.session['doe_sctx_32'] = validCtx({
      viewportWidth: 1920,
      viewportHeight: 1080,
      screenshotWidth: 960,
      screenshotHeight: 540,
    });
    const result = await applyCoordScale(32, { x: 480, y: 270 });
    // 480 * (1920/960) = 960; 270 * (1080/540) = 540.
    expect(result).toEqual({ x: 960, y: 540 });
  });

  it('rounds coordinates to integers', async () => {
    screenshotContextStore.setContext(33, validCtx({
      viewportWidth: 1920,
      viewportHeight: 1080,
      screenshotWidth: 1280,
      screenshotHeight: 720,
    }));
    // scaleX = 1920/1280 = 1.5; scaleY = 1080/720 = 1.5
    const result = await applyCoordScale(33, { x: 101, y: 101 });
    // 101 * 1.5 = 151.5 â†’ 152; 101 * 1.5 = 151.5 â†’ 152
    expect(result).toEqual({ x: Math.round(101 * 1.5), y: Math.round(101 * 1.5) });
  });
});
