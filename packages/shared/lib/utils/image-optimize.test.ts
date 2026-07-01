/**
 * processScreenshotForLLM — single-pass WebP encoding tests.
 *
 * The function encodes once at the given quality (default 0.75) with no
 * size-based reduction loop. Quality is controlled by the caller.
 *
 * We mock the browser APIs (createImageBitmap, OffscreenCanvas, fetch, FileReader)
 * so the logic runs in the Node/Vitest environment without a real GPU pipeline.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  processScreenshotForLLM,
  AGENT_SCREENSHOT_RESIZE,
  DEFAULT_SCREENSHOT_RESIZE,
  calculateScreenshotResize,
} from './image-optimize.js';

// ---------------------------------------------------------------------------
// Blob payload registry — avoids property injection on Blob objects
// ---------------------------------------------------------------------------

const blobPayloads = new WeakMap<Blob, string>();

// ---------------------------------------------------------------------------
// Fake browser APIs
// ---------------------------------------------------------------------------

/** Build a base64 string of exactly `length` repeated 'A' characters. */
function fakeBase64(length: number) {
  return 'A'.repeat(length);
}

/**
 * Create a fake OffscreenCanvas whose `convertToBlob` returns a Blob
 * whose base64 length is `qualityToLength(quality)`.
 */
function makeCanvas(qualityToLength: (q: number) => number) {
  return {
    getContext: () => ({
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      drawImage: vi.fn(),
    }),
    convertToBlob: vi.fn(async ({ quality }: { quality: number }) => {
      const len = qualityToLength(quality);
      const blob = new Blob([], { type: 'image/webp' });
      blobPayloads.set(blob, fakeBase64(len));
      return blob;
    }),
    width: 800,
    height: 600,
  };
}

class FakeFileReader {
  result: string | null = null;
  onload: ((ev: { target: { result: string } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(blob: Blob) {
    const payload = blobPayloads.get(blob) ?? '';
    this.result = `data:image/webp;base64,${payload}`;
    Promise.resolve().then(() => {
      const result = this.result;
      if (typeof result === 'string') {
        this.onload?.({ target: { result } });
      }
    });
  }
}

beforeEach(() => {
  vi.restoreAllMocks();

  vi.stubGlobal('FileReader', FakeFileReader);

  vi.stubGlobal('createImageBitmap', async () => ({
    width: 1600,
    height: 1200,
    close: vi.fn(),
  }));

  vi.stubGlobal('fetch', async (_url: string) => {
    const blob = new Blob([], { type: 'image/png' });
    return { blob: async () => blob };
  });

  vi.stubGlobal(
    'OffscreenCanvas',
    vi.fn((_w: number, _h: number) => makeCanvas(() => 10_000)),
  );
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides?: Partial<Parameters<typeof processScreenshotForLLM>[0]>) {
  return {
    rawBase64: fakeBase64(100),
    rawMediaType: 'image/png',
    viewportWidth: 1280,
    viewportHeight: 800,
    devicePixelRatio: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('processScreenshotForLLM', () => {
  it('returns format=webp', async () => {
    const result = await processScreenshotForLLM(makeInput());
    expect(result.format).toBe('webp');
    expect(typeof result.base64).toBe('string');
  });

  it('encodes exactly once at the given quality', async () => {
    const canvasSpy = vi.fn(() => makeCanvas(() => 10_000));
    vi.stubGlobal('OffscreenCanvas', canvasSpy);

    const result = await processScreenshotForLLM(makeInput());

    const canvasInstance = canvasSpy.mock.results[0]?.value;
    expect(canvasInstance?.convertToBlob).toHaveBeenCalledTimes(1);
    expect(result.base64).toBe(fakeBase64(10_000));
  });

  it('uses default quality 0.75 when none specified', async () => {
    const canvasSpy = vi.fn(() => makeCanvas(() => 10_000));
    vi.stubGlobal('OffscreenCanvas', canvasSpy);

    await processScreenshotForLLM(makeInput());

    const canvasInstance = canvasSpy.mock.results[0]?.value;
    const call = canvasInstance?.convertToBlob.mock.calls[0];
    expect(call?.[0].quality).toBe(0.75);
  });

  it('uses the provided quality override', async () => {
    const canvasSpy = vi.fn(() => makeCanvas(() => 30_000));
    vi.stubGlobal('OffscreenCanvas', canvasSpy);

    await processScreenshotForLLM(makeInput({ quality: 0.1 }));

    const canvasInstance = canvasSpy.mock.results[0]?.value;
    const firstCall = canvasInstance?.convertToBlob.mock.calls[0];
    expect(firstCall?.[0].quality).toBe(0.1);
  });

  it('returns viewport dimensions from the input', async () => {
    const result = await processScreenshotForLLM(
      makeInput({ viewportWidth: 1440, viewportHeight: 900 }),
    );
    expect(result.viewportWidth).toBe(1440);
    expect(result.viewportHeight).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// AGENT_SCREENSHOT_RESIZE — 1080 px cap
// ---------------------------------------------------------------------------

describe('AGENT_SCREENSHOT_RESIZE', () => {
  it('caps the long edge at 1080 px for a wide viewport', () => {
    const [w, h] = calculateScreenshotResize(1718, 1214, AGENT_SCREENSHOT_RESIZE);
    expect(w).toBeLessThanOrEqual(1080);
    expect(h).toBeLessThanOrEqual(1080);
    const inputAspect = 1718 / 1214;
    const outputAspect = w / h;
    expect(Math.abs(outputAspect - inputAspect)).toBeLessThan(0.02);
  });

  it('does NOT upscale images already within the 1080 px cap', () => {
    const [w, h] = calculateScreenshotResize(640, 480, AGENT_SCREENSHOT_RESIZE);
    expect(w).toBe(640);
    expect(h).toBe(480);
  });

  it('produces a smaller image than DEFAULT_SCREENSHOT_RESIZE for a large viewport', () => {
    const [dw, dh] = calculateScreenshotResize(1718, 1214, DEFAULT_SCREENSHOT_RESIZE);
    const [aw, ah] = calculateScreenshotResize(1718, 1214, AGENT_SCREENSHOT_RESIZE);
    expect(aw * ah).toBeLessThan(dw * dh);
  });

  it('uses resizeParams when passed to processScreenshotForLLM', async () => {
    const canvasSpy = vi.fn((w: number, h: number) => ({
      getContext: () => ({
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        drawImage: vi.fn(),
      }),
      convertToBlob: vi.fn(async () => {
        const blob = new Blob([], { type: 'image/webp' });
        blobPayloads.set(blob, fakeBase64(10_000));
        return blob;
      }),
      width: w,
      height: h,
    }));
    vi.stubGlobal('OffscreenCanvas', canvasSpy);

    const result = await processScreenshotForLLM({
      rawBase64: fakeBase64(100),
      rawMediaType: 'image/png',
      viewportWidth: 1718,
      viewportHeight: 1214,
      devicePixelRatio: 1,
      resizeParams: AGENT_SCREENSHOT_RESIZE,
    });

    expect(result.width).toBeLessThanOrEqual(1080);
    expect(result.height).toBeLessThanOrEqual(1080);
    expect(result.viewportWidth).toBe(1718);
    expect(result.viewportHeight).toBe(1214);
  });
});
