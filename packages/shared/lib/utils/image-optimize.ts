/**
 * LLM-bound image optimisation — single implementation shared between the
 * side panel and the chrome-extension service worker.
 *
 * Why ONE module: vision-model token economics are identical regardless
 * of which surface produced the image (paperclip upload, region cropper,
 * agent screenshot). Two divergent implementations would silently drift
 * apart. `OffscreenCanvas` + `createImageBitmap` are available in BOTH
 * window and service-worker contexts, so the same DOM-free pipeline
 * works everywhere.
 *
 * Coordinate-aware callers (e.g. agent `computer.screenshot`) rely on
 * the resize being lossless w.r.t. aspect ratio — the caller records
 * the inverse-scale factor (viewport / output dims) at capture time
 * and multiplies model-returned click coordinates by it before
 * dispatching, so the resize doesn't break coordinate-based clicks.
 *
 * Three deliberate choices:
 *   1. **WebP q0.75** — ~25-35 % smaller than JPEG at the same perceived
 *      quality; all major vision providers (Anthropic, OpenAI, Google)
 *      accept WebP natively, so there's no compatibility cost.
 *   2. **`imageSmoothingQuality = 'high'`** — Lanczos-equivalent kernel.
 *      Text and UI edges survive the downscale visibly better than the
 *      default bilinear path.
 *   3. **White flatten before encode** — protects against transparent
 *      PNG inputs (canvas's default composite is black, looks broken
 *      for screenshots).
 *
 * Long-edge cap is 1568 px — a well-established optimum point. Higher
 * caps cost tokens for pixels every modern vision model downsamples
 * before reading. Lower starts losing readable detail. Cross-provider
 * safe.
 *
 * Crop integration: pass `srcRect` to do crop + resize + encode in a
 * SINGLE GPU-accelerated `drawImage` pass (used by the region-cropper
 * SW handler — captures full viewport, crops to user's rectangle, all
 * in one canvas operation).
 */

const MAX_LONG_EDGE = 1568;
const WEBP_QUALITY = 0.75;

/**
 * Screenshot resize parameters:
 *
 *   - `pxPerToken = 28`: approximately 28 px per token in each dimension
 *     for common vision models.
 *   - `maxTargetTokens = 1568`: above this most models down-sample
 *     internally anyway.
 *   - `maxTargetPx = 1568`: a per-dimension cap so a very wide / very
 *     tall image (e.g. infinite scroll pages) doesn't blow past the
 *     token budget just because one side is short.
 *
 * Used by the agent screenshot path (`pointer.ts`) to produce an image
 * the model can read cleanly and that we can map clicks back from with
 * the recorded viewport→screenshot scale.
 */
export interface ScreenshotResizeParams {
  pxPerToken: number;
  maxTargetPx: number;
  maxTargetTokens: number;
}

export const DEFAULT_SCREENSHOT_RESIZE: ScreenshotResizeParams = {
  pxPerToken: 28,
  maxTargetPx: 1568,
  maxTargetTokens: 1568,
};

export const AGENT_SCREENSHOT_RESIZE: ScreenshotResizeParams = {
  pxPerToken: 28,
  maxTargetPx: 1568,
  maxTargetTokens: 1568,
};

function ceilDivide(value: number, divisor: number): number {
  return Math.floor((value - 1) / divisor) + 1;
}

function calculateTokenCount(width: number, height: number, pxPerToken: number): number {
  return ceilDivide(width, pxPerToken) * ceilDivide(height, pxPerToken);
}

/**
 * Binary-search the largest `(width, height)` whose token cost fits
 * `maxTargetTokens` AND whose long edge fits `maxTargetPx`.
 */
export function calculateScreenshotResize(
  width: number,
  height: number,
  params: ScreenshotResizeParams = DEFAULT_SCREENSHOT_RESIZE,
): [number, number] {
  const { pxPerToken, maxTargetPx, maxTargetTokens } = params;
  if (
    width <= maxTargetPx &&
    height <= maxTargetPx &&
    calculateTokenCount(width, height, pxPerToken) <= maxTargetTokens
  ) {
    return [width, height];
  }
  if (height > width) {
    const [resultHeight, resultWidth] = calculateScreenshotResize(height, width, params);
    return [resultWidth, resultHeight];
  }
  const aspectRatio = width / height;
  let upperBound = width;
  let lowerBound = 1;
  while (true) {
    if (lowerBound + 1 === upperBound) {
      return [lowerBound, Math.max(Math.round(lowerBound / aspectRatio), 1)];
    }
    const mid = Math.floor((lowerBound + upperBound) / 2);
    const midHeight = Math.max(Math.round(mid / aspectRatio), 1);
    if (mid <= maxTargetPx && calculateTokenCount(mid, midHeight, pxPerToken) <= maxTargetTokens) {
      lowerBound = mid;
    } else {
      upperBound = mid;
    }
  }
}

export interface ProcessScreenshotInput {
  rawBase64: string;
  rawMediaType: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  /** WebP quality (0–1). Default 0.75. */
  quality?: number;
  resizeParams?: ScreenshotResizeParams;
}

export interface ProcessedScreenshot {
  base64: string;
  width: number;
  height: number;
  format: 'webp';
  viewportWidth: number;
  viewportHeight: number;
}

export async function processScreenshotForLLM(
  input: ProcessScreenshotInput,
): Promise<ProcessedScreenshot> {
  const { rawBase64, rawMediaType, viewportWidth, viewportHeight } = input;
  const dpr = input.devicePixelRatio > 0 ? input.devicePixelRatio : 1;
  const quality = input.quality ?? 0.75;
  const resizeParams = input.resizeParams ?? DEFAULT_SCREENSHOT_RESIZE;

  const blob = await fetch(`data:${rawMediaType};base64,${rawBase64}`).then(r => r.blob());
  const bitmap = await createImageBitmap(blob);
  try {
    let cssWidth = bitmap.width;
    let cssHeight = bitmap.height;
    if (dpr > 1) {
      cssWidth = Math.round(bitmap.width / dpr);
      cssHeight = Math.round(bitmap.height / dpr);
    }

    const [targetWidth, targetHeight] = calculateScreenshotResize(cssWidth, cssHeight, resizeParams);
    const canvas = new OffscreenCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, targetWidth, targetHeight);

    const base64 = await fetchBlobToBase64(await canvas.convertToBlob({ type: 'image/webp', quality }));
    return {
      base64,
      width: targetWidth,
      height: targetHeight,
      format: 'webp',
      viewportWidth: viewportWidth > 0 ? viewportWidth : cssWidth,
      viewportHeight: viewportHeight > 0 ? viewportHeight : cssHeight,
    };
  } finally {
    bitmap.close();
  }
}

async function fetchBlobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export interface OptimizedImage {
  /** Just the base64 payload (no `data:…;base64,` prefix). */
  base64: string;
  /** `data:image/webp;base64,<base64>` — convenience for `<img src>`. */
  dataUrl: string;
  mediaType: 'image/webp';
  width: number;
  height: number;
  bytes: number;
}

export interface OptimizeOptions {
  /**
   * Source rectangle in the input image's pixel space. When set, the
   * optimiser crops to this rect before applying the long-edge cap. The
   * crop and resize happen in a single `drawImage` call — one GPU pass,
   * no intermediate canvas.
   */
  srcRect?: { x: number; y: number; width: number; height: number };
  /**
   * Upper bound for the encoded payload, in bytes. When the default-quality
   * encode is larger, quality walks down in 0.15 steps (floor 0.40) until
   * the blob fits; the lowest-quality attempt is returned even if it is
   * still over the bound.
   */
  maxBytes?: number;
}

/**
 * Resize + WebP-encode a `Blob`. Use this entry point when you already
 * have a `Blob` (file upload, fetch response, captureVisibleTab + crop).
 */
export async function optimizeBlobForLLM(blob: Blob, opts: OptimizeOptions = {}): Promise<OptimizedImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    const rect = opts.srcRect;
    const srcX = rect?.x ?? 0;
    const srcY = rect?.y ?? 0;
    const srcW = rect?.width ?? bitmap.width;
    const srcH = rect?.height ?? bitmap.height;
    if (srcW <= 0 || srcH <= 0) throw new Error('source rectangle has zero area');

    const longEdge = Math.max(srcW, srcH);
    const scale = longEdge > MAX_LONG_EDGE ? MAX_LONG_EDGE / longEdge : 1;
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));

    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    // drawImage(src, sx,sy,sw,sh, dx,dy,dw,dh) — crop + resize in one pass.
    ctx.drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, w, h);

    let quality = WEBP_QUALITY;
    let out = await canvas.convertToBlob({ type: 'image/webp', quality });
    while (opts.maxBytes && out.size > opts.maxBytes && quality > 0.4) {
      quality = Math.max(0.4, quality - 0.15);
      out = await canvas.convertToBlob({ type: 'image/webp', quality });
    }
    const base64 = await blobToBase64(out);
    return {
      base64,
      dataUrl: `data:image/webp;base64,${base64}`,
      mediaType: 'image/webp',
      width: w,
      height: h,
      bytes: out.size,
    };
  } finally {
    bitmap.close();
  }
}

/**
 * Resize + WebP-encode a base64 image. Convenience wrapper for callers
 * that get base64 from CDP / chrome.tabs APIs and don't already have a
 * `Blob`.
 */
export async function optimizeBase64ForLLM(
  base64: string,
  sourceMediaType: string,
  opts: OptimizeOptions = {},
): Promise<OptimizedImage> {
  const blob = await fetch(`data:${sourceMediaType};base64,${base64}`).then(r => r.blob());
  return optimizeBlobForLLM(blob, opts);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // `data:<mime>;base64,<payload>` → strip the prefix.
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
