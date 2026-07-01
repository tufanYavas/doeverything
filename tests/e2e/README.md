# doeverything E2E (WebdriverIO + Mocha)

End-to-end tests that load the **real built extension** into a browser and
drive its pages (side panel, options, new tab, blocked, popup, devtools panel)
plus the injected content-script DOM walker.

## ⚠️ Chrome version requirement

Chrome **137+ removed the `--load-extension` flag**, so a stock modern Chrome
(or its matching ChromeDriver) can no longer side-load an unpacked MV3 build
for testing. These tests therefore run against **Chrome-for-Testing 136** and a
**matching ChromeDriver 136**, both cached under the repo:

```
chrome/…/chrome-win64/chrome.exe
chromedriver/…/chromedriver-win64/chromedriver.exe
```

ChromeDriver launches that Chrome **directly** with `--load-extension` pointed
at `dist/`. (An earlier attempt that launched Chrome via puppeteer and attached
WebdriverIO over `debuggerAddress` failed with "unable to discover open window
in chrome"; a direct ChromeDriver launch gives the driver a window it owns.)

## One-time setup

Install the pinned Chrome + ChromeDriver 136 into the repo:

```bash
pnpm e2e:setup
```

Both directories (`chrome/`, `chromedriver/`) are gitignored.

### Overrides

| Env var            | Effect                                              |
| ------------------ | --------------------------------------------------- |
| `CHROME_BIN`       | Use a specific Chrome binary (must be ≤ 136)        |
| `CHROMEDRIVER_BIN` | Use a specific ChromeDriver (must match the Chrome) |

The config also falls back to a stock system Chrome if it's ≤ 136.

## Running

```bash
pnpm e2e            # build + zip, then run the whole suite
```

Or, with a build already in `dist/`, run a single spec from this package:

```bash
cd tests/e2e
DOE_CI=true CI=true pnpm exec wdio run config/wdio.browser.conf.ts \
  --spec specs/page-side-panel.test.ts
```

`DOE_CI=true CI=true` runs Chrome headless (`--headless=new`, which keeps
extension support). Without them Chrome opens a visible window — handy for
debugging.

## How the extension id is resolved

The id is random per load (no fixed manifest `key`). `utils/extension-path.ts`
discovers it at runtime via `browser.getPuppeteer()`: it reads the MV3
background **service-worker** target's origin, falling back to walking the
`chrome://extensions` shadow DOM for the `<extensions-item>` (its tag id IS the
extension id). `helpers/extension.ts#openExtensionPage` then navigates to
`chrome-extension://<id>/<page>`.

## Specs

| Spec                      | Covers                                                       |
| ------------------------- | ----------------------------------------------------------- |
| `smoke.test.ts`           | Plain web page loads (no extension needed)                  |
| `page-side-panel.test.ts` | Chat shell mounts, first-run onboarding tour, composer      |
| `page-options.test.ts`    | Settings shell, section nav, MCP connection + LLM tabs      |
| `page-new-tab.test.ts`    | New-tab hero + launch composer                              |
| `page-blocked.test.ts`    | Managed-policy block notice                                 |
| `page-content.test.ts`    | MAIN-world DOM walker (`window.___oadp`) injection          |

## Notes

- `maxInstances: 1` — ChromeDriver owns a single browser; specs run serially.
- Each spec file gets a **fresh temp profile**, so first-run state (the
  onboarding tour, default model config) is reproducible per file. The
  side-panel spec relies on this: the tour only persists `spotlight-seen` when
  dismissed, so it reappears until the last test closes it.
- The side panel rendered as a normal tab shows an "doeverything can't run here"
  system-page notice; the chat shell still mounts behind it, which is what the
  specs assert.
