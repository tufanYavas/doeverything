import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionDecision } from '../permissions/manager.js';

/**
 * permission-decision.ts is a thin `chrome.runtime.onMessage` bridge, but it
 * has real, asserted behavior worth pinning:
 *
 *   - It ignores any message whose `type` isn't the permission-decision type
 *     by returning `false` (so other listeners get a turn) WITHOUT calling
 *     sendResponse or PermissionManager.
 *   - It rejects messages missing `requestId` or `decision` with an error
 *     response and returns `false`.
 *   - On a valid message it forwards (requestId, decision) to
 *     `PermissionManager.resolve` and echoes back `{ ok }` reflecting whether
 *     a pending prompt was actually matched. It returns `false` because the
 *     response is sent synchronously (no async work).
 *
 * PermissionManager is mocked so `resolve` is a spy whose return value we
 * control — letting us prove both the forwarding and the `ok` echo without a
 * live pending-prompt registry.
 */

interface ResolveCall {
  requestId: string;
  decision: PermissionDecision;
}
const resolveCalls: ResolveCall[] = [];
let resolveReturn = true;

vi.mock('../permissions/manager.js', () => ({
  PermissionManager: {
    resolve: vi.fn((requestId: string, decision: PermissionDecision) => {
      resolveCalls.push({ requestId, decision });
      return resolveReturn;
    }),
  },
}));

type MessageListener = (msg: unknown, sender: unknown, sendResponse: (r?: unknown) => void) => boolean | void;
interface GlobalShape {
  __chromeState: { messageListeners: MessageListener[] };
}
const g = globalThis as unknown as GlobalShape;

/** Register the handler and return the single listener it installed. */
async function registerAndGetListener(): Promise<MessageListener> {
  const { registerPermissionDecisionHandler } = await import('./permission-decision.js');
  registerPermissionDecisionHandler();
  const listeners = g.__chromeState.messageListeners;
  return listeners[listeners.length - 1];
}

/** Drive a message through the listener and capture its return + response. */
function dispatch(listener: MessageListener, msg: unknown) {
  let response: unknown;
  let responded = false;
  const ret = listener(msg, {}, (r?: unknown) => {
    responded = true;
    response = r;
  });
  return { ret, response, responded };
}

beforeEach(() => {
  resolveCalls.length = 0;
  resolveReturn = true;
  vi.resetModules();
});

describe('registerPermissionDecisionHandler', () => {
  it('ignores unrelated message types (returns false, no resolve, no response)', async () => {
    const listener = await registerAndGetListener();
    const { ret, responded } = dispatch(listener, { type: 'something/else', requestId: 'r1', decision: { allow: false } });
    expect(ret).toBe(false);
    expect(responded).toBe(false);
    expect(resolveCalls).toHaveLength(0);
  });

  it('ignores a null/non-object message', async () => {
    const listener = await registerAndGetListener();
    expect(dispatch(listener, null).ret).toBe(false);
    expect(resolveCalls).toHaveLength(0);
  });

  it('rejects a message missing requestId', async () => {
    const listener = await registerAndGetListener();
    const { ret, response } = dispatch(listener, {
      type: 'doe/permission/decision',
      decision: { allow: true, scope: 'once' },
    });
    expect(ret).toBe(false);
    expect(response).toEqual({ ok: false, error: 'Missing requestId or decision' });
    expect(resolveCalls).toHaveLength(0);
  });

  it('rejects a message missing decision', async () => {
    const listener = await registerAndGetListener();
    const { ret, response } = dispatch(listener, {
      type: 'doe/permission/decision',
      requestId: 'r1',
    });
    expect(ret).toBe(false);
    expect(response).toEqual({ ok: false, error: 'Missing requestId or decision' });
    expect(resolveCalls).toHaveLength(0);
  });

  it('forwards a valid allow-decision to PermissionManager.resolve and echoes ok:true', async () => {
    const listener = await registerAndGetListener();
    const decision: PermissionDecision = { allow: true, scope: 'session' };
    const { ret, response } = dispatch(listener, {
      type: 'doe/permission/decision',
      requestId: 'req-42',
      decision,
    });
    expect(resolveCalls).toEqual([{ requestId: 'req-42', decision }]);
    expect(response).toEqual({ ok: true });
    // Response is synchronous, so the listener returns false.
    expect(ret).toBe(false);
  });

  it('echoes ok:false when resolve finds no matching pending prompt', async () => {
    resolveReturn = false;
    const listener = await registerAndGetListener();
    const { response } = dispatch(listener, {
      type: 'doe/permission/decision',
      requestId: 'stale-req',
      decision: { allow: false },
    });
    expect(resolveCalls).toEqual([{ requestId: 'stale-req', decision: { allow: false } }]);
    expect(response).toEqual({ ok: false });
  });
});
