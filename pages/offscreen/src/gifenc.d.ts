/**
 * Minimal ambient types for `gifenc` (it ships no `.d.ts`). Only the surface
 * doeverything uses is declared.
 */
declare module 'gifenc' {
  type RGB = [number, number, number];
  type RGBA = [number, number, number, number];
  type Palette = Array<RGB | RGBA>;

  interface WriteFrameOptions {
    palette?: Palette;
    /** Frame delay in milliseconds. */
    delay?: number;
    /** 0 = loop forever, -1 = no loop. */
    repeat?: number;
    transparent?: boolean;
    dispose?: number;
    first?: boolean;
  }

  interface GifEncoderInstance {
    writeFrame(index: Uint8Array, width: number, height: number, opts?: WriteFrameOptions): void;
    finish(): void;
    bytes(): Uint8Array<ArrayBuffer>;
    bytesView(): Uint8Array<ArrayBuffer>;
    reset(): void;
    readonly buffer: ArrayBuffer;
  }

  export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: string; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): Palette;

  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette, format?: string): Uint8Array;
}
