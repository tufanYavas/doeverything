import { permissionsStorage, preferencesStorage } from '@doeverything/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ManagerModule from './manager.js';
import type { ChromeState } from '../../../../tests/unit/setup/chrome-mock.js';
import type { PermissionKind } from '@doeverything/storage';

/**
 * PermissionManager gates tool execution. The "ask" path is a long-lived
 * promise keyed by a uuid: `ensure()` broadcasts an
 * `doe/permission/request` message and parks; the side panel later calls
 * `PermissionManager.resolve(id, decision)`.
 *
 * The module holds a global `pending` Map, so tests resetModules and
 * re-import. Storage (permissions + preferences) is the real createStorage
 * impl backed by the chrome-mock's storage.local.
 */

type Manager = typeof ManagerModule;

const chromeState = () => (globalThis as unknown as { __chromeState: ChromeState }).__chromeState;

/** Wait until ensure() has broadcast the permission request, then return its id. */
async function waitForRequestId(): Promise<string> {
  const sendMessage = chrome.runtime.sendMessage as unknown as { mock: { calls: unknown[][] } };
  for (let i = 0; i < 50; i++) {
    const last = sendMessage.mock.calls.at(-1)?.[0] as { type?: string; request?: { id: string } } | undefined;
    if (last?.type === 'doe/permission/request' && last.request) return last.request.id;
    await new Promise(r => setTimeout(r, 0));
  }
  throw new Error('permission request was never broadcast');
}

async function load(): Promise<Manager> {
  return import('./manager.js');
}

const HOST = 'example.com';
const KIND: PermissionKind = 'click';

describe('PermissionManager.hostFromUrl', () => {
  beforeEach(() => vi.resetModules());

  it('strips protocol and a leading www.', async () => {
    const { PermissionManager } = await load();
    expect(PermissionManager.hostFromUrl('https://www.example.com/a/b?x=1')).toBe('example.com');
    expect(PermissionManager.hostFromUrl('https://sub.example.com/')).toBe('sub.example.com');
  });

  it('returns the raw input verbatim when it is not a valid URL', async () => {
    const { PermissionManager } = await load();
    expect(PermissionManager.hostFromUrl('not a url')).toBe('not a url');
  });
});

describe('PermissionManager.ensure — fast-allow paths', () => {
  beforeEach(() => vi.resetModules());

  it('allows immediately in skip_all_permission_checks mode without touching storage or messaging', async () => {
    await preferencesStorage.setPermissionMode('skip_all_permission_checks');
    const { PermissionManager } = await load();
    await expect(PermissionManager.ensure(HOST, KIND)).resolves.toBeUndefined();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('allows immediately when an existing grant already covers the host+kind', async () => {
    await preferencesStorage.setPermissionMode('ask');
    await permissionsStorage.grant(HOST, KIND, 'always');
    const { PermissionManager } = await load();
    await expect(PermissionManager.ensure(HOST, KIND)).resolves.toBeUndefined();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('honours a session-scoped grant the same as an always grant', async () => {
    await preferencesStorage.setPermissionMode('ask');
    await permissionsStorage.grant(HOST, KIND, 'session');
    const { PermissionManager } = await load();
    await expect(PermissionManager.ensure(HOST, KIND)).resolves.toBeUndefined();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('honours a wildcard host grant for the matching kind', async () => {
    await preferencesStorage.setPermissionMode('ask');
    await permissionsStorage.grant('*', KIND, 'always');
    const { PermissionManager } = await load();
    await expect(PermissionManager.ensure(HOST, KIND)).resolves.toBeUndefined();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

describe('PermissionManager.ensure — ask path', () => {
  beforeEach(() => vi.resetModules());

  it('broadcasts a permission request and parks until resolve() is called', async () => {
    await preferencesStorage.setPermissionMode('ask');
    const { PermissionManager } = await load();

    const pending = PermissionManager.ensure(HOST, KIND, { reason: 'r', preview: 'p' });
    const id = await waitForRequestId();

    const sendMessage = chrome.runtime.sendMessage as unknown as { mock: { calls: unknown[][] } };
    const msg = sendMessage.mock.calls.at(-1)?.[0] as {
      type: string;
      request: { id: string; host: string; kind: string; reason?: string; preview?: string };
    };
    expect(msg.type).toBe('doe/permission/request');
    expect(msg.request).toMatchObject({ host: HOST, kind: KIND, reason: 'r', preview: 'p' });
    expect(typeof msg.request.id).toBe('string');

    const accepted = PermissionManager.resolve(id, { allow: true, scope: 'once' });
    expect(accepted).toBe(true);
    await expect(pending).resolves.toBeUndefined();
  });

  it('throws PermissionDeniedError (with host+kind) when the user denies', async () => {
    await preferencesStorage.setPermissionMode('ask');
    const { PermissionManager, PermissionDeniedError } = await load();

    const pending = PermissionManager.ensure(HOST, KIND);
    const id = await waitForRequestId();

    PermissionManager.resolve(id, { allow: false });
    const err = await pending.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PermissionDeniedError);
    expect(err).toMatchObject({ host: HOST, kind: KIND, name: 'PermissionDeniedError' });
  });

  it("persists an 'always' decision as a persistent grant", async () => {
    await preferencesStorage.setPermissionMode('ask');
    const { PermissionManager } = await load();

    const pending = PermissionManager.ensure(HOST, KIND);
    PermissionManager.resolve(await waitForRequestId(), { allow: true, scope: 'always' });
    await pending;

    const state = await permissionsStorage.get();
    expect(state.always).toContainEqual(expect.objectContaining({ host: HOST, kind: KIND, scope: 'always' }));
    expect(state.session).toHaveLength(0);
  });

  it("persists a 'session' decision into the session list", async () => {
    await preferencesStorage.setPermissionMode('ask');
    const { PermissionManager } = await load();

    const pending = PermissionManager.ensure(HOST, KIND);
    PermissionManager.resolve(await waitForRequestId(), { allow: true, scope: 'session' });
    await pending;

    const state = await permissionsStorage.get();
    expect(state.session).toContainEqual(expect.objectContaining({ host: HOST, kind: KIND, scope: 'session' }));
    expect(state.always).toHaveLength(0);
  });

  it("does NOT persist a 'once' decision (allowed but ephemeral)", async () => {
    await preferencesStorage.setPermissionMode('ask');
    const { PermissionManager } = await load();

    const pending = PermissionManager.ensure(HOST, KIND);
    PermissionManager.resolve(await waitForRequestId(), { allow: true, scope: 'once' });
    await pending;

    const state = await permissionsStorage.get();
    expect(state.always).toHaveLength(0);
    expect(state.session).toHaveLength(0);
  });

  it('allow_for_site mode still prompts on first touch (the redundant re-check is a no-op)', async () => {
    await preferencesStorage.setPermissionMode('allow_for_site');
    const { PermissionManager } = await load();

    const pending = PermissionManager.ensure(HOST, KIND);
    const id = await waitForRequestId();
    // Reaching here means it went down the ask path, not an early allow.
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    PermissionManager.resolve(id, { allow: true, scope: 'once' });
    await expect(pending).resolves.toBeUndefined();
  });

  it('follow_a_plan mode is treated like ask (first action prompts)', async () => {
    await preferencesStorage.setPermissionMode('follow_a_plan');
    const { PermissionManager } = await load();

    const pending = PermissionManager.ensure(HOST, KIND);
    const id = await waitForRequestId();
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    PermissionManager.resolve(id, { allow: true, scope: 'once' });
    await expect(pending).resolves.toBeUndefined();
  });
});

describe('PermissionManager.resolve — registry semantics', () => {
  beforeEach(() => vi.resetModules());

  it('returns false for an unknown request id', async () => {
    const { PermissionManager } = await load();
    expect(PermissionManager.resolve('does-not-exist', { allow: true, scope: 'once' })).toBe(false);
  });

  it('a second resolve for the same id returns false (resolver consumed once)', async () => {
    await preferencesStorage.setPermissionMode('ask');
    const { PermissionManager } = await load();
    const pending = PermissionManager.ensure(HOST, KIND);
    const id = await waitForRequestId();
    expect(PermissionManager.resolve(id, { allow: true, scope: 'once' })).toBe(true);
    await pending;
    expect(PermissionManager.resolve(id, { allow: true, scope: 'once' })).toBe(false);
  });
});
