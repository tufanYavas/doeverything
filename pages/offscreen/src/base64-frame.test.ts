import { base64FromFrame } from './index.js';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the GIF "Failed to fetch" bug: frames arrive as RAW
 * base64 (Chrome's Page.captureScreenshot), and the encoder must decode the
 * bytes directly — never treat the string as a URL. `base64FromFrame` is the
 * normaliser the decoder feeds into `atob`.
 */
describe('base64FromFrame', () => {
  it('returns a raw base64 string unchanged (the screenshot case)', () => {
    expect(base64FromFrame('/9j/4AAQSkZJRgABAQAA')).toBe('/9j/4AAQSkZJRgABAQAA');
  });

  it('strips a data: URL prefix when one is present', () => {
    expect(base64FromFrame('data:image/jpeg;base64,/9j/4AAQ')).toBe('/9j/4AAQ');
    expect(base64FromFrame('data:image/png;base64,iVBORw0KGgo=')).toBe('iVBORw0KGgo=');
  });

  it('produces atob-decodable output for both forms', () => {
    const raw = btoa('hello');
    expect(() => atob(base64FromFrame(raw))).not.toThrow();
    expect(() => atob(base64FromFrame(`data:image/gif;base64,${raw}`))).not.toThrow();
    expect(atob(base64FromFrame(`data:image/gif;base64,${raw}`))).toBe('hello');
  });
});
