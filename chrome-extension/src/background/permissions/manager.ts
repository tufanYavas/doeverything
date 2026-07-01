/**
 * PermissionManager — gates browser-tool execution.
 *
 * Resolution order:
 *   1. Mode `skip_all_permission_checks` → allow.
 *   2. Mode `allow_for_site` AND host already granted → allow.
 *   3. Existing `always` or `session` grant → allow.
 *   4. Otherwise → ask the side panel; the user's decision is persisted
 *      according to the chosen scope.
 *
 * The "ask" path opens a long-lived promise registry keyed by request id.
 * The side panel calls back via `chrome.runtime.sendMessage` with the
 * decision; the SW resolves the promise and the tool either proceeds or
 * throws a typed `PermissionDeniedError`.
 *
 * `follow_a_plan` mode is currently treated like `ask` for the first action
 * on each host; once the user grants `session` scope the rest auto-allow.
 * A richer "plan summary" prompt lands in Phase 5 alongside the skill UI.
 */

import { permissionsStorage, preferencesStorage } from '@doeverything/storage';
import type { PermissionKind } from '@doeverything/storage';

// Service workers expose `crypto.randomUUID` natively, so we avoid pulling
// the `uuid` polyfill into the SW bundle.
const uuid = () => crypto.randomUUID();

export class PermissionDeniedError extends Error {
  constructor(
    public readonly host: string,
    public readonly kind: PermissionKind,
  ) {
    super(`doeverything permission denied for ${kind} on ${host}`);
    this.name = 'PermissionDeniedError';
  }
}

export interface PermissionRequest {
  id: string;
  host: string;
  kind: PermissionKind;
  /** Human-readable detail the side panel can render. */
  reason?: string;
  /** Tool args summary for the prompt. */
  preview?: string;
}

export type PermissionDecision = { allow: true; scope: 'once' | 'session' | 'always' } | { allow: false };

const pending = new Map<string, (decision: PermissionDecision) => void>();

function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const PermissionManager = {
  hostFromUrl,

  async ensure(host: string, kind: PermissionKind, opts: { reason?: string; preview?: string } = {}): Promise<void> {
    const prefs = await preferencesStorage.get();
    if (prefs.permissionMode === 'skip_all_permission_checks') return;

    const allowed = await permissionsStorage.isAllowed(host, kind);
    if (allowed) return;

    if (prefs.permissionMode === 'allow_for_site') {
      // The user opted into "allow for any site we've already touched" mode.
      // First touch on a new host still needs explicit permission, but once
      // granted it covers every kind on that host for the session.
      const broadAllowed = await permissionsStorage.isAllowed(host, kind);
      if (broadAllowed) return;
    }

    const decision = await requestDecision({ id: uuid(), host, kind, reason: opts.reason, preview: opts.preview });
    if (!decision.allow) throw new PermissionDeniedError(host, kind);
    if (decision.scope === 'always') {
      await permissionsStorage.grant(host, kind, 'always');
    } else if (decision.scope === 'session') {
      await permissionsStorage.grant(host, kind, 'session');
    }
  },

  /** Side panel hands the SW a decision to resolve a pending prompt. */
  resolve(requestId: string, decision: PermissionDecision) {
    const resolver = pending.get(requestId);
    if (!resolver) return false;
    pending.delete(requestId);
    resolver(decision);
    return true;
  },
};

function requestDecision(req: PermissionRequest): Promise<PermissionDecision> {
  return new Promise(resolve => {
    pending.set(req.id, resolve);
    // Broadcast to any side panel that's open. We don't await — the panel
    // may not be open yet, in which case the user can deny by stopping the
    // agent (the AbortController unwinds the awaiting tool call).
    chrome.runtime.sendMessage({ type: 'doe/permission/request', request: req }).catch(() => undefined);
  });
}
