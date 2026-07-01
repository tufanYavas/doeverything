import type { AgentToolContext } from '../context.js';

/**
 * Per-process GIF frame store. Populated automatically by `computer`,
 * `scroll`, and `navigate` while a recording is active for the doeverything
 * group; consumed by `gif_creator` on export. Mirrors the reference's
 * `gifFrameStore` (helpers.ts) — keyed by chrome tab-group id, FIFO-capped
 * at 50 frames per group so the SW heap stays bounded.
 */
export type GifFrame = { base64: string; action?: string; delay: number };
export type GifStore = {
  recording: Set<number>;
  frames: Map<number, GifFrame[]>;
  /**
   * Per-group timestamp of the last auto-captured frame. Used as a throttle
   * so a burst of fast actions (rapid clicks, scroll spam) doesn't fire a
   * fresh CDP screenshot per call — each `Page.captureScreenshot` round-trip
   * makes the target renderer pause briefly for compositor read-back, and
   * the global CdpController capture limit (40 / 60s) caps out fast if we
   * don't gate here. We never DROP the originating action's outcome — only
   * the GIF frame is skipped; a missing frame just means the recording is
   * slightly less smooth, which is invisible to the user at our default
   * ~800ms per-frame delay anyway.
   */
  lastCaptureAt: Map<number, number>;
};

const MIN_CAPTURE_INTERVAL_MS = 500;

export function getGifStore(): GifStore {
  const G = globalThis as unknown as { __doe_gif?: GifStore };
  if (!G.__doe_gif) {
    G.__doe_gif = { recording: new Set(), frames: new Map(), lastCaptureAt: new Map() };
  }
  // Service-worker eviction can replay the singleton with the older shape
  // (pre-throttle builds had no `lastCaptureAt`). Defensive backfill so a
  // restored session doesn't trip on `lastCaptureAt.get is not a function`.
  if (!G.__doe_gif.lastCaptureAt) G.__doe_gif.lastCaptureAt = new Map();
  return G.__doe_gif;
}

/** Per-action frame delay (ms) — mirrors reference `getFrameDelay`. */
export function frameDelayFor(actionType?: string): number {
  const map: Record<string, number> = {
    wait: 300,
    screenshot: 300,
    navigate: 800,
    scroll: 800,
    scroll_to: 800,
    type: 800,
    key: 800,
    hover: 800,
    left_click: 1500,
    right_click: 1500,
    double_click: 1500,
    triple_click: 1500,
    left_click_drag: 1500,
  };
  return map[actionType ?? ''] ?? 800;
}

/**
 * If the active doeverything group is currently recording, snap a screenshot of
 * the given tab and push it onto the GIF frame store. No-op otherwise.
 * Always best-effort: a capture failure must NOT propagate up and break the
 * originating action (click/type/scroll/navigate).
 */
export async function captureFrameIfRecording(
  ctx: AgentToolContext,
  tabId: number,
  actionType?: string,
  preCapturedBase64?: string,
): Promise<void> {
  const groupId = ctx.groups.getGroupId() ?? -1;
  const store = getGifStore();
  if (!store.recording.has(groupId)) return;
  if (!store.frames.has(groupId)) store.frames.set(groupId, []);
  const arr = store.frames.get(groupId)!;
  // Throttle gate: skip if a frame was captured within the last 500ms AND
  // the caller didn't already hand us bytes. `preCapturedBase64` (set by
  // `computer.screenshot`) costs nothing extra — that screenshot was going
  // to happen anyway, so always store it. Throttle only the synthesised
  // captures (click/scroll/type/etc.) that would otherwise burn an extra
  // CDP round-trip per action.
  if (!preCapturedBase64) {
    const now = Date.now();
    const last = store.lastCaptureAt.get(groupId) ?? 0;
    if (now - last < MIN_CAPTURE_INTERVAL_MS) return;
  }
  try {
    let base64 = preCapturedBase64;
    if (!base64) {
      const shot = await ctx.cdp.screenshot(tabId, { format: 'jpeg', quality: 70 });
      base64 = shot.base64;
    }
    arr.push({ base64, action: actionType, delay: frameDelayFor(actionType) });
    store.lastCaptureAt.set(groupId, Date.now());
    while (arr.length > 50) arr.shift();
  } catch {
    // best-effort; don't break the originating action
  }
}
