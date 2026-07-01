/**
 * Active agent run registry.
 *
 * The port-bridge owns the actual handle, but other parts of the SW need to
 * abort it from the outside (e.g. the visual indicator's "Stop" button or a
 * future scheduled-task supervisor). They register/unregister here.
 */

import type { AgentRunHandle } from './runner.js';

let active: AgentRunHandle | null = null;

export const AgentRegistry = {
  setActive(handle: AgentRunHandle | null) {
    active = handle;
  },
  abortActive(): boolean {
    if (!active) return false;
    active.abort();
    active = null;
    return true;
  },
  hasActive(): boolean {
    return active !== null;
  },
};
