/**
 * At-rest obfuscation for API keys and other secrets.
 *
 * The master key is generated with `extractable: false` and stored in
 * IndexedDB via structured-clone — its raw bytes never appear in JS or in
 * `chrome.storage.local`. Browsers wrap IndexedDB-stored CryptoKeys with the
 * platform credential store (DPAPI on Windows, Keychain on macOS, libsecret
 * on Linux), so a disk-level attacker can't simply grep the LevelDB for AES
 * material — they have to defeat the OS credential layer first.
 *
 * Format on disk:
 *   `enc:v2:<iv_b64>:<ciphertext_b64>` — current, IndexedDB key
 *   `enc:v1:<iv_b64>:<ciphertext_b64>` — legacy, plaintext key in
 *      `chrome.storage.local`. Decrypted on read; rewritten as v2 the next
 *      time the surrounding object is saved.
 *   anything else — legacy plaintext, returned as-is (then re-saved as v2).
 *
 * Failure mode: any decrypt error returns an empty string instead of
 * throwing, so the UI shows "no key set" rather than crashing.
 */

const DB_NAME = 'de-secrets';
const STORE_NAME = 'keys';
const KEY_ID = 'master';

const LEGACY_KEY_STORAGE = 'doe:secret-master-key-v1';

const ENC_V1_PREFIX = 'enc:v1:';
const ENC_V2_PREFIX = 'enc:v2:';

let cachedV2Key: Promise<CryptoKey> | null = null;
let cachedV1Key: Promise<CryptoKey | null> | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T = unknown>(db: IDBDatabase, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Returns the v2 master key, generating it on first call. The CryptoKey is
 * `extractable: false`, so even after retrieval the raw bytes are unreachable
 * from JS — only `subtle.encrypt`/`decrypt` accept it.
 */
async function getOrCreateV2Key(): Promise<CryptoKey> {
  if (cachedV2Key) return cachedV2Key;
  cachedV2Key = (async () => {
    const db = await openDb();
    try {
      const existing = await idbGet<CryptoKey>(db, KEY_ID);
      if (existing) return existing;
      const fresh = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
      await idbPut(db, KEY_ID, fresh);
      return fresh;
    } finally {
      db.close();
    }
  })().catch(err => {
    // Reset cache so a transient IDB failure doesn't permanently brick crypto.
    cachedV2Key = null;
    throw err;
  });
  return cachedV2Key;
}

/**
 * Loads the legacy v1 key from `chrome.storage.local` if one exists. Returns
 * `null` when the user has never had v1 (fresh install on the v2 codebase).
 * The key is imported decrypt-only — we never write v1 again.
 */
async function getLegacyV1Key(): Promise<CryptoKey | null> {
  if (cachedV1Key) return cachedV1Key;
  cachedV1Key = (async () => {
    const stored = await chrome.storage.local.get(LEGACY_KEY_STORAGE);
    const existing = stored[LEGACY_KEY_STORAGE] as string | undefined;
    if (!existing) return null;
    return crypto.subtle.importKey(
      'raw',
      base64ToBuffer(existing),
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );
  })().catch(() => null);
  return cachedV1Key;
}

export async function encryptSecret(plain: string): Promise<string> {
  if (!plain) return plain;
  if (plain.startsWith(ENC_V2_PREFIX) || plain.startsWith(ENC_V1_PREFIX)) return plain;
  const key = await getOrCreateV2Key();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `${ENC_V2_PREFIX}${bufferToBase64(iv)}:${bufferToBase64(new Uint8Array(cipher))}`;
}

export async function decryptSecret(blob: string): Promise<string> {
  if (!blob) return '';
  try {
    if (blob.startsWith(ENC_V2_PREFIX)) {
      return await tryDecrypt(blob.slice(ENC_V2_PREFIX.length), await getOrCreateV2Key());
    }
    if (blob.startsWith(ENC_V1_PREFIX)) {
      const v1 = await getLegacyV1Key();
      if (!v1) return '';
      return await tryDecrypt(blob.slice(ENC_V1_PREFIX.length), v1);
    }
  } catch {
    return '';
  }
  // Legacy plaintext from before any encryption was wired up. Pass through;
  // the next storage `set` will re-encrypt it as v2.
  return blob;
}

async function tryDecrypt(payload: string, key: CryptoKey): Promise<string> {
  const colon = payload.indexOf(':');
  if (colon < 0) return '';
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBuffer(payload.slice(0, colon)) },
      key,
      base64ToBuffer(payload.slice(colon + 1)),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return '';
  }
}

function bufferToBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
