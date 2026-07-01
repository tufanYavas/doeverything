/**
 * Node-project-only setup.
 *
 * The at-rest secret encryption (packages/storage secret-crypto) needs
 * `indexedDB` for its non-extractable master key. Node has `crypto.subtle`
 * but no IndexedDB, so register the in-memory fake. happy-dom already
 * ships IndexedDB, which is why this is node-only.
 */
import 'fake-indexeddb/auto';
