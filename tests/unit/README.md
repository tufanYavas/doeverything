# doeverything unit & component tests

Fast, hermetic tests run with **Vitest** (no browser, no built extension).
The slow full-extension specs under `tests/e2e` (WebdriverIO) are a separate
world and are not run by these.

## Running

```bash
pnpm test            # run everything once (both projects)
pnpm test:watch      # watch mode
pnpm vitest run --project node   # background / pure-logic only
pnpm vitest run --project dom    # React components, hooks, store only
pnpm vitest run path/to/file.test.ts
```

## Layout

Tests are **co-located** with the code they cover (`foo.ts` → `foo.test.ts`).
The runner config is the root [`vitest.config.ts`](../../vitest.config.ts),
which defines two projects split by the environment the code needs:

- **`node`** — pure logic and Chrome-API-backed background code
  (`chrome-extension/src`, `packages/{llm-providers,storage,shared}`).
  Runs in Node; `chrome.*` is the fake from
  [`setup/chrome-mock.ts`](setup/chrome-mock.ts).
- **`dom`** — React components, hooks, and the zustand store
  (`pages/**`, `packages/ui`). Runs in happy-dom with the same `chrome`
  fake plus jest-dom matchers ([`setup/dom.ts`](setup/dom.ts)).

## The `chrome` fake

`setup/chrome-mock.ts` installs an in-memory `chrome.*` before every test
and resets it via a `beforeEach`. It is rich enough to exercise the
tab-group session logic for real (tabs/tabGroups with
create/group/ungroup/query and Chrome's empty-group auto-removal) and has
working `storage.local`/`storage.session` with `onChanged` events.

Helpers exposed on `globalThis` for tests:

- `__seedTab(partial?)` — add a tab to the model, returns it.
- `__chromeState` — the in-memory model (tabs, groups, session store,
  `lastFocusedWindowId`) for seeding and assertions.
- `__resetChrome()` — rebuild all state (also runs automatically).

## Patterns worth reusing

- **Module-stateful code** (e.g. `group-manager`, `compaction-cache`):
  state lives in module/global scope, so re-import fresh per test with
  `vi.resetModules()` (and `delete globalThis.__doe_group` for the
  tab-group module, whose state is global-backed).
- **Storage-backed config without IndexedDB**: seed plaintext JSON straight
  into `chrome.storage.local` under the storage key. `decryptSecret`
  returns non-`enc:`-prefixed values verbatim, so the at-rest key
  encryption (which needs IndexedDB) is never touched.
- **Provider SDKs**: `vi.mock('@doeverything/llm-providers', …)` with
  `importActual` keeps the real registry/helpers while stubbing
  `createLanguageModel` — no real `@ai-sdk/*` model construction.
- **fetch**: `vi.stubGlobal('fetch', …)` for model-discovery parser tests.
- jest-dom matchers in `.tsx` tests: add `import
  '@testing-library/jest-dom/vitest';` at the top so `tsc` sees the matcher
  type augmentation (the runtime import is already in the dom setup).

## What is and isn't unit-tested

Unit tests are the right tool for **pure logic** and **single-module
behavior**; full-extension integration is left to `tests/e2e`. Current
coverage (543 tests):

- **Covered** — token estimation, compaction (DTO split/boundary/summary)
  + cache + the multi-turn fold **lifecycle** (cursor advance, merge,
  byte-stable summary, edit-invalidation), context-window resolution +
  budget, error mapping, cache breakpoints, model discovery parsers,
  tab-group session manager, resolveFastModel; storage (secret-crypto
  roundtrip, llm-config per-provider scoping, custom-providers,
  saved-prompts, scheduled-tasks, connection); skills (frontmatter,
  argument substitution, url-matcher, expander, listing budget,
  model-invocable filtering, **cross-turn listing-tracker delta**,
  **mid-turn `SkillListingRefresher`** surfacing destination-scoped skills
  on navigation); **memory roster** (origin-keyed re-emit trigger +
  domain-scoped bucket listing + subdomain collapse); conversion
  (tool_use/result pairing + step boundaries), working memory,
  stop-conditions, truncation, blocked-url policy, DNR rules; dom-processor
  visibility + DOM utils; chat-store, ModelCombobox, ContextStrip,
  useSpeechToText; tool-result shaping (result-compressor bucketing,
  json-introspect JSONPath/schema, network-summary body classifier +
  fetch-snippet, tool-result-limits caps), the **gif** pipeline (gif-store
  throttle/FIFO + GifViewer page), domain normalizer; message router,
  permission manager + decision handler, the task scheduler (alarm dispatch
  + retry backoff), skill invocation-tracker + runtime-overrides,
  memory-read-core paging/projection, conversation clear handler,
  llm-providers middleware, workflow-generator fallback, conversation-report
  HTML builder, new-tab widgets order; components/hooks — Composer,
  SlashCommandMenu, ModelSelector, LoginScreen, CommandPalette,
  useKeyboardShortcuts.
- **Deliberately left to e2e / manual** (a unit test would assert against a
  fake, not real behavior): `cdp/controller` (Chrome debugger), the
  agent `runner`/`factory` orchestration (driven by the SDK + a live
  model), `mcp/bridge` (WebSocket relay), `recorder` + `offscreen` GIF
  encoding (CDP capture + OffscreenCanvas), the `dom-processor` serializer /
  page-state-builder (needs real layout — happy-dom returns no geometry),
  `image-optimize` (OffscreenCanvas), the Radix UI primitives, and the thin
  remaining `handlers/*` / `index.ts` Chrome-event wiring.

## Keep tests current

When you change behavior, update or add the co-located `*.test.ts`. Run
`pnpm test` before considering a change done; it is part of the same gate
as `pnpm type-check` and `pnpm lint`.
