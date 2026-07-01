import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentToolContext } from '../context.js';

type GlobalWithStore = { __doe_gif?: unknown };

/** Minimal tool context exercising only what gif-store touches. */
function makeCtx(gid: number, shotBase64 = 'SHOT') {
  const screenshot = vi.fn(async () => ({ base64: shotBase64 }));
  const ctx = { groups: { getGroupId: () => gid }, cdp: { screenshot } } as unknown as AgentToolContext;
  return { ctx, screenshot };
}

describe('frameDelayFor', () => {
  it('maps action types to per-frame delays with an 800ms default', async () => {
    const { frameDelayFor } = await import('./gif-store.js');
    expect(frameDelayFor('left_click')).toBe(1500);
    expect(frameDelayFor('navigate')).toBe(800);
    expect(frameDelayFor('wait')).toBe(300);
    expect(frameDelayFor('not-a-real-action')).toBe(800);
    expect(frameDelayFor(undefined)).toBe(800);
  });
});

describe('getGifStore', () => {
  beforeEach(() => {
    delete (globalThis as GlobalWithStore).__doe_gif;
  });

  it('returns a stable singleton', async () => {
    const { getGifStore } = await import('./gif-store.js');
    expect(getGifStore()).toBe(getGifStore());
  });

  it('backfills lastCaptureAt on a legacy (pre-throttle) restored shape', async () => {
    const { getGifStore } = await import('./gif-store.js');
    (globalThis as GlobalWithStore).__doe_gif = { recording: new Set(), frames: new Map() };
    expect(getGifStore().lastCaptureAt).toBeInstanceOf(Map);
  });
});

// Start the fake clock well past the throttle window so the FIRST synthesised
// capture (whose `lastCaptureAt` defaults to 0) isn't itself throttled.
const T0 = 100_000;

describe('captureFrameIfRecording', () => {
  beforeEach(() => {
    delete (globalThis as GlobalWithStore).__doe_gif;
    vi.useFakeTimers();
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  it('is a no-op when the active group is not recording', async () => {
    const { captureFrameIfRecording, getGifStore } = await import('./gif-store.js');
    const { ctx, screenshot } = makeCtx(7);
    await captureFrameIfRecording(ctx, 1, 'left_click');
    expect(screenshot).not.toHaveBeenCalled();
    expect(getGifStore().frames.get(7)).toBeUndefined();
  });

  it('captures a screenshot frame (with action + delay) when recording', async () => {
    const { captureFrameIfRecording, getGifStore } = await import('./gif-store.js');
    getGifStore().recording.add(7);
    const { ctx, screenshot } = makeCtx(7, 'JPEGBYTES');
    await captureFrameIfRecording(ctx, 1, 'navigate');
    expect(screenshot).toHaveBeenCalledOnce();
    expect(getGifStore().frames.get(7)).toEqual([{ base64: 'JPEGBYTES', action: 'navigate', delay: 800 }]);
  });

  it('throttles synthesised captures within 500ms but always stores pre-captured bytes', async () => {
    const { captureFrameIfRecording, getGifStore } = await import('./gif-store.js');
    getGifStore().recording.add(7);
    const { ctx, screenshot } = makeCtx(7);
    await captureFrameIfRecording(ctx, 1, 'scroll'); // captures
    vi.setSystemTime(T0 + 200);
    await captureFrameIfRecording(ctx, 1, 'scroll'); // +200ms → throttled
    expect(getGifStore().frames.get(7)).toHaveLength(1);
    expect(screenshot).toHaveBeenCalledOnce();

    // Pre-captured bytes (e.g. from computer.screenshot) bypass the throttle
    // and cost no extra CDP round-trip.
    await captureFrameIfRecording(ctx, 1, 'screenshot', 'PRE');
    const frames = getGifStore().frames.get(7)!;
    expect(frames).toHaveLength(2);
    expect(frames[1].base64).toBe('PRE');
    expect(screenshot).toHaveBeenCalledOnce();
  });

  it('captures again once the 500ms window passes', async () => {
    const { captureFrameIfRecording, getGifStore } = await import('./gif-store.js');
    getGifStore().recording.add(7);
    const { ctx } = makeCtx(7);
    await captureFrameIfRecording(ctx, 1, 'scroll'); // captures
    vi.setSystemTime(T0 + 600);
    await captureFrameIfRecording(ctx, 1, 'scroll'); // +600ms → captures again
    expect(getGifStore().frames.get(7)).toHaveLength(2);
  });

  it('caps the frame buffer at 50 (FIFO — oldest dropped)', async () => {
    const { captureFrameIfRecording, getGifStore } = await import('./gif-store.js');
    getGifStore().recording.add(7);
    const { ctx } = makeCtx(7);
    for (let i = 0; i < 60; i++) {
      // Pre-captured bytes bypass the throttle, so all 60 attempts land.
      await captureFrameIfRecording(ctx, 1, 'screenshot', `f${i}`);
    }
    const frames = getGifStore().frames.get(7)!;
    expect(frames).toHaveLength(50);
    expect(frames[0].base64).toBe('f10'); // first 10 evicted
    expect(frames[49].base64).toBe('f59');
  });

  it('never throws when the screenshot fails (best-effort, must not break the action)', async () => {
    const { captureFrameIfRecording, getGifStore } = await import('./gif-store.js');
    getGifStore().recording.add(7);
    const screenshot = vi.fn(async () => {
      throw new Error('CDP down');
    });
    const ctx = { groups: { getGroupId: () => 7 }, cdp: { screenshot } } as unknown as AgentToolContext;
    await expect(captureFrameIfRecording(ctx, 1, 'scroll')).resolves.toBeUndefined();
    expect(getGifStore().frames.get(7) ?? []).toHaveLength(0);
  });
});
