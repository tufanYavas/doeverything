/**
 * Secrets store — placeholder-based redaction for sensitive header values.
 *
 * Why: when `inspect_network_request` shows the LLM a captured request, we
 * cannot just print `Authorization: Bearer eyJhbGc...`. That value would
 * land in the conversation transcript, the prompt cache on the provider's
 * side, and any telemetry pipeline. Equally, we cannot just `[REDACTED]`
 * it — then the model has no way to use the token when writing
 * `run_js fetch()` code.
 *
 * The compromise: register the real value here, hand the LLM an opaque
 * placeholder token (`__doeverything_SECRET_<id>__`), and substitute the
 * placeholder back to the real value INSIDE the runner — right before the
 * code reaches `chrome.scripting.executeScript`. The model's context only
 * ever holds the placeholder; the real value never round-trips through the
 * provider.
 *
 * Trade-offs the LLM needs to understand:
 *   • Use the placeholder VERBATIM as the entire header value. Do NOT
 *     prefix it with anything ("Bearer xxx"). The placeholder already
 *     resolves to the full header value (including any "Bearer " prefix
 *     that was on the original request).
 *   • If the model concatenates the token into a larger string, the
 *     concatenation still works — substitution is plain text replacement.
 *
 * Lifecycle: the module-level Map is shared across all tools. Browser-
 * extension service workers can be torn down and respawned by Chrome at
 * any time, which clears the map. That's fine — captured network requests
 * are also tab-scoped and short-lived; if the SW restarts, the model has
 * to call `inspect_network_request` again to get fresh placeholders.
 */

const TOKEN_PREFIX = '__doeverything_SECRET_';
const TOKEN_SUFFIX = '__';

const secrets = new Map<string, string>();
let counter = 0;

/**
 * Register a sensitive value and return an opaque placeholder token that
 * `replaceTokens` will swap back to the real value before code execution.
 *
 * Idempotent on `value`: registering the same value twice returns the same
 * token, so a repeated header (e.g. cookie reused across many captured
 * requests) doesn't multiply the placeholder map. The optional `label`
 * (typically the header name) becomes part of the token so it's a hint to
 * the model AND a debug aid in logs.
 */
export function registerSecret(value: string, label?: string): string {
  if (!value) return value;
  // Reuse: same value → same token. Saves clutter in the LLM's view when
  // the same cookie shows up on every request.
  for (const [existingToken, existingValue] of secrets) {
    if (existingValue === value) return existingToken;
  }
  counter += 1;
  const sanitisedLabel = label
    ? label
        .replace(/[^A-Za-z0-9]/g, '_')
        .toUpperCase()
        .slice(0, 24)
    : 'VALUE';
  const id = `${counter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const token = `${TOKEN_PREFIX}${sanitisedLabel}_${id}${TOKEN_SUFFIX}`;
  secrets.set(token, value);
  return token;
}

/**
 * Replace every registered placeholder in `text` with its real value.
 * Returns the rewritten string plus a count of substitutions made — the
 * runner logs that count to the SW console (NEVER to the LLM) so an
 * operator can see "12 secrets swapped into this js call" if debugging.
 *
 * Plain-text substitution, NOT regex, so a placeholder that the model
 * pasted as part of a larger expression (e.g. `'Bearer ' + TOKEN`) still
 * gets resolved correctly — the model's intent stays intact.
 */
export function replaceTokens(text: string): { text: string; replaced: number } {
  if (!text || secrets.size === 0) return { text, replaced: 0 };
  let result = text;
  let replaced = 0;
  for (const [token, value] of secrets) {
    if (!result.includes(token)) continue;
    const before = result;
    result = result.split(token).join(value);
    // split+join always produces (occurrences + 1) parts when replacing
    // a literal substring; we infer the count from the length delta.
    replaced += before.length - result.length + value.length * 1 > 0 ? before.split(token).length - 1 : 0;
  }
  return { text: result, replaced };
}

/**
 * Drop every registered placeholder. Safe to call between conversations
 * to bound memory, though the entries are tiny (a few KB at worst). The
 * runner doesn't currently clear automatically — placeholders persist as
 * long as the service worker process does.
 */
export function clearSecrets(): void {
  secrets.clear();
  counter = 0;
}

/** Diagnostic: how many secrets are currently registered. */
export function getSecretCount(): number {
  return secrets.size;
}

/** True iff the given string looks like an doeverything placeholder token. */
export function isSecretToken(s: string): boolean {
  return s.startsWith(TOKEN_PREFIX) && s.endsWith(TOKEN_SUFFIX);
}
