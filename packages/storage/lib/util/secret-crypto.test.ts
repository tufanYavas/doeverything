import { decryptSecret, encryptSecret } from './secret-crypto.js';
import { describe, expect, it } from 'vitest';

describe('secret-crypto', () => {
  it('round-trips a secret through encrypt → decrypt', async () => {
    const plain = 'sk-ant-secret-value-123';
    const enc = await encryptSecret(plain);
    expect(enc).not.toBe(plain);
    expect(enc.startsWith('enc:')).toBe(true);
    expect(await decryptSecret(enc)).toBe(plain);
  });

  it('produces different ciphertext each time (random IV) but both decrypt back', async () => {
    const a = await encryptSecret('same');
    const b = await encryptSecret('same');
    expect(a).not.toBe(b);
    expect(await decryptSecret(a)).toBe('same');
    expect(await decryptSecret(b)).toBe('same');
  });

  it('encrypts/decrypts an empty string without throwing', async () => {
    const enc = await encryptSecret('');
    expect(await decryptSecret(enc)).toBe('');
  });

  it('returns legacy plaintext (no enc: prefix) verbatim', async () => {
    expect(await decryptSecret('sk-plaintext-legacy')).toBe('sk-plaintext-legacy');
    expect(await decryptSecret('')).toBe('');
  });

  it('returns empty string for a corrupt enc: payload instead of throwing', async () => {
    expect(await decryptSecret('enc:v2:not-valid-base64:also-bad')).toBe('');
  });
});
