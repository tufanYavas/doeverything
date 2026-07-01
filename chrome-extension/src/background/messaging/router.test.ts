import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChromeState } from '../../../../tests/unit/setup/chrome-mock.js';

/**
 * The router owns a module-scoped `handlers` Map plus a single
 * chrome.runtime.onMessage listener. Each test re-imports the module so the
 * Map starts empty, and drives the registered listener directly through the
 * chrome-mock's captured `messageListeners`.
 *
 * Behavioural contract pinned here:
 *   - the listener only consumes the de/{sidepanel,runs,memory}/* namespaces
 *     (every other message is invisible — returns false, no warning logic owns it);
 *   - matched async handlers resolve to `{ ok: true, result }` and reject to
 *     `{ ok: false, error }` with a serialized error;
 *   - an unknown in-namespace type warns and returns false (channel not held).
 */

const chromeState = () => (globalThis as unknown as { __chromeState: ChromeState }).__chromeState;

/** The router registers exactly one onMessage listener; grab it. */
function getListener() {
  const listeners = chromeState().messageListeners;
  return listeners[listeners.length - 1];
}

type RouterResult = { ok: true; result: unknown } | { ok: false; error: { name: string; message: string } };

/** Dispatch a message through the router listener; resolve with the sendResponse payload. */
function dispatch(message: unknown): { keptOpen: boolean; response: Promise<RouterResult | undefined> } {
  const listener = getListener();
  let resolveResp: (r: RouterResult | undefined) => void;
  const response = new Promise<RouterResult | undefined>(res => (resolveResp = res));
  let responded = false;
  const sendResponse = (r?: unknown) => {
    responded = true;
    resolveResp(r as RouterResult | undefined);
  };
  const keptOpen = listener(message, {}, sendResponse) === true;
  // For sync (no-handler / non-message) paths sendResponse is never called.
  if (!keptOpen && !responded) resolveResp!(undefined);
  return { keptOpen, response };
}

describe('internal message router', () => {
  beforeEach(() => vi.resetModules());

  it('answers the built-in ping round-trip with ok:true and the pong payload', async () => {
    const { registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();

    const { keptOpen, response } = dispatch({ type: 'doe/sidepanel/ping' });
    expect(keptOpen).toBe(true); // channel held open for the async response
    await expect(response).resolves.toEqual({ ok: true, result: { pong: true, name: 'doeverything' } });
  });

  it('routes a registered async handler and wraps its resolved value', async () => {
    const { register, registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();
    register('doe/runs/list', async () => [{ id: 'r1' }]);

    const { response } = dispatch({ type: 'doe/runs/list', limit: 5 });
    await expect(response).resolves.toEqual({ ok: true, result: [{ id: 'r1' }] });
  });

  it('passes the message and sender through to the handler', async () => {
    const { register, registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();
    const handler = vi.fn(() => 'done');
    register('doe/memory/list-domains', handler);

    const listener = getListener();
    const sender = { id: 'sender-x' };
    listener({ type: 'doe/memory/list-domains' }, sender, () => undefined);
    expect(handler).toHaveBeenCalledWith({ type: 'doe/memory/list-domains' }, sender);
  });

  it('serializes a thrown Error into ok:false with name/message/stack', async () => {
    const { register, registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();
    register('doe/runs/transcript', async () => {
      throw new TypeError('boom');
    });

    const { response } = dispatch({ type: 'doe/runs/transcript', conversationId: 'c1' });
    const result = await response;
    expect(result).toMatchObject({ ok: false, error: { name: 'TypeError', message: 'boom' } });
    expect((result as { error: { stack?: string } }).error).toHaveProperty('stack');
  });

  it('serializes a non-Error rejection as UnknownError with String(err)', async () => {
    const { register, registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();
    register('doe/runs/list', async () => Promise.reject('nope'));

    const { response } = dispatch({ type: 'doe/runs/list' });
    await expect(response).resolves.toEqual({ ok: false, error: { name: 'UnknownError', message: 'nope' } });
  });

  it('a sync (non-promise) handler return value is still wrapped via Promise.resolve', async () => {
    const { register, registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();
    register('doe/memory/wipe-all', () => 42);

    const { keptOpen, response } = dispatch({ type: 'doe/memory/wipe-all' });
    expect(keptOpen).toBe(true);
    await expect(response).resolves.toEqual({ ok: true, result: 42 });
  });

  it('an in-namespace type with no handler warns and returns false (channel not held)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();

    // de/runs/* is router-owned, but nothing registered this exact type.
    const { keptOpen } = dispatch({ type: 'doe/runs/unregistered' });
    expect(keptOpen).toBe(false);
    expect(warn).toHaveBeenCalledWith('[doeverything] no handler for', 'doe/runs/unregistered');
    warn.mockRestore();
  });

  it('ignores a foreign-namespace message silently (no warning, returns false)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();

    const { keptOpen } = dispatch({ type: 'doe/region-screenshot/start' });
    expect(keptOpen).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects non-object / typeless values via the guard (returns false)', async () => {
    const { registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();
    const listener = getListener();

    expect(listener(null, {}, () => undefined)).toBe(false);
    expect(listener('doe/sidepanel/ping', {}, () => undefined)).toBe(false);
    expect(listener({ type: 42 }, {}, () => undefined)).toBe(false);
    expect(listener({ noType: true }, {}, () => undefined)).toBe(false);
  });

  it('register overwrites a prior handler for the same type (Map semantics)', async () => {
    const { register, registerInternalMessageRouter } = await import('./router.js');
    registerInternalMessageRouter();
    register('doe/runs/list', () => 'first');
    register('doe/runs/list', () => 'second');

    const { response } = dispatch({ type: 'doe/runs/list' });
    await expect(response).resolves.toEqual({ ok: true, result: 'second' });
  });

  it('handlers persist across module-scope (a handler registered before register*Router still fires)', async () => {
    const { register, registerInternalMessageRouter } = await import('./router.js');
    // register can run before the router wiring — the Map is module-global.
    register('doe/memory/list-buckets', () => ['b1']);
    registerInternalMessageRouter();

    const { response } = dispatch({ type: 'doe/memory/list-buckets', domain: 'd' });
    await expect(response).resolves.toEqual({ ok: true, result: ['b1'] });
  });
});
