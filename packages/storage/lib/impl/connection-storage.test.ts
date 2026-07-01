import { beforeEach, describe, expect, it, vi } from 'vitest';

// Fresh module (and fresh fake chrome.storage) per test — createStorage
// caches state in module scope.
beforeEach(() => vi.resetModules());
const load = async () => (await import('./connection-storage.js')).connectionStorage;

describe('connectionStorage', () => {
  it('ensureToken mints once and returns the same token thereafter', async () => {
    const s = await load();
    const t1 = await s.ensureToken();
    expect(t1).toBeTruthy();
    expect(await s.ensureToken()).toBe(t1);
  });

  it('resetToken changes the token and resets connection state', async () => {
    const s = await load();
    const t1 = await s.ensureToken();
    await s.markConnected();
    const t2 = await s.resetToken();
    expect(t2).not.toBe(t1);
    const state = await s.get();
    expect(state.token).toBe(t2);
    expect(state.status).toBe('disconnected');
    expect(state.lastConnectedAt).toBeNull();
  });

  it('setRelayBaseUrl strips trailing slashes and accepts null', async () => {
    const s = await load();
    await s.setRelayBaseUrl('https://relay.example.com///');
    expect((await s.get()).relayBaseUrl).toBe('https://relay.example.com');
    await s.setRelayBaseUrl(null);
    expect((await s.get()).relayBaseUrl).toBeNull();
  });

  it('setStatus records status and error; markConnected clears the error', async () => {
    const s = await load();
    await s.setStatus('error', 'boom');
    let state = await s.get();
    expect(state.status).toBe('error');
    expect(state.lastError).toBe('boom');

    await s.markConnected();
    state = await s.get();
    expect(state.status).toBe('connected');
    expect(state.lastError).toBeNull();
    expect(typeof state.lastConnectedAt).toBe('number');
  });

  it('userEnabled defaults to false and can be toggled', async () => {
    const s = await load();
    expect((await s.get()).userEnabled).toBe(false);
    await s.setUserEnabled(true);
    expect((await s.get()).userEnabled).toBe(true);
    await s.setUserEnabled(false);
    expect((await s.get()).userEnabled).toBe(false);
  });

  it('resetToken does not change userEnabled', async () => {
    const s = await load();
    await s.setUserEnabled(true);
    await s.resetToken();
    expect((await s.get()).userEnabled).toBe(true);
  });
});
