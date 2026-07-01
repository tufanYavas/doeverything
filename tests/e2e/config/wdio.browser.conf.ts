import { config as baseConfig } from './wdio.conf.js';
import { getChromeExtensionPath } from '../utils/extension-path.js';
import { IS_CI } from '@doeverything/env';
import { access, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '../../..');
const distPath = join(repoRoot, 'dist');

const exists = async (p: string) => {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
};

/** Recursively find the first file named like a Chrome binary under `dir`.
 *  Depth 6 because macOS nests the executable deeply — inside
 *  `chrome-mac-<arch>` → `Google Chrome for Testing.app` → `Contents` →
 *  `MacOS` → the executable. (Windows/Linux are far shallower.) */
const findChromeBinary = async (dir: string, depth = 6): Promise<string | null> => {
  if (depth < 0) return null;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (/^(chrome\.exe|chrome|Google Chrome for Testing)$/.test(name)) {
      const s = await stat(full).catch(() => null);
      if (s?.isFile()) return full;
    }
  }
  for (const name of entries) {
    const full = join(dir, name);
    const s = await stat(full).catch(() => null);
    if (s?.isDirectory()) {
      const found = await findChromeBinary(full, depth - 1);
      if (found) return found;
    }
  }
  return null;
};

/** Recursively find a `chromedriver` binary under `dir`. */
const findChromedriverBinary = async (dir: string, depth = 4): Promise<string | null> => {
  if (depth < 0) return null;
  let entries: string[] = [];
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  for (const name of entries) {
    const full = join(dir, name);
    if (/^chromedriver(\.exe)?$/.test(name)) {
      const s = await stat(full).catch(() => null);
      if (s?.isFile()) return full;
    }
  }
  for (const name of entries) {
    const full = join(dir, name);
    const s = await stat(full).catch(() => null);
    if (s?.isDirectory()) {
      const found = await findChromedriverBinary(full, depth - 1);
      if (found) return found;
    }
  }
  return null;
};

/**
 * Locate the Chrome binary puppeteer should launch.
 *
 * IMPORTANT: Chrome 137+ removed the `--load-extension` flag, so a stock
 * modern Chrome CANNOT load the unpacked build. We therefore prefer a
 * Chrome-for-Testing 136 cached under `<repo>/chrome` (install it with
 * `pnpm e2e:setup`). `CHROME_BIN` overrides everything for custom setups;
 * stock system Chrome is the last resort (works only if ≤ 136).
 */
const findChrome = async (): Promise<string> => {
  const fromEnv = process.env.CHROME_BIN || process.env.CHROME_PATH;
  if (fromEnv && (await exists(fromEnv))) return fromEnv;

  const cached = await findChromeBinary(join(repoRoot, 'chrome'));
  if (cached) return cached;

  const fallbacks = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of fallbacks) if (await exists(c)) return c;
  throw new Error('Chrome binary not found — run `pnpm e2e:setup` or set CHROME_BIN.');
};

/**
 * MV3 extension loading needs a Chrome that still honors `--load-extension`:
 * Chrome 137+ removed the flag, so e2e runs against Chrome-for-Testing 136
 * (and a matching ChromeDriver 136) installed by `pnpm e2e:setup`. ChromeDriver
 * launches that Chrome DIRECTLY with `--load-extension` pointed at the unpacked
 * `dist/` — unlike a puppeteer-launch + `debuggerAddress` attach, this gives
 * ChromeDriver a window it actually owns (the attach path failed with
 * "unable to discover open window in chrome"). We pin the driver because
 * wdio's auto-pick would otherwise grab the system Chrome 149 driver, which
 * can't drive a 136 browser.
 */
const chromeBinary = await findChrome();

if (!(await exists(distPath))) {
  throw new Error(`Unpacked extension not found at ${distPath} — run \`pnpm build\` (or \`pnpm zip\`) first.`);
}

/** Find a ChromeDriver under <repo>/chromedriver (installed by `pnpm e2e:setup`). */
const findChromedriver = async (): Promise<string | undefined> => {
  const fromEnv = process.env.CHROMEDRIVER_BIN;
  if (fromEnv && (await exists(fromEnv))) return fromEnv;
  const found = await findChromedriverBinary(join(repoRoot, 'chromedriver'));
  return found ?? undefined;
};

const chromeCapabilities = {
  browserName: 'chrome',
  acceptInsecureCerts: true,
  'goog:chromeOptions': {
    binary: chromeBinary,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-web-security',
      `--load-extension=${distPath}`,
      `--disable-extensions-except=${distPath}`,
      // `--headless=new` keeps extension support; classic headless drops it.
      ...(IS_CI ? ['--headless=new'] : []),
    ],
  },
  // Pin the matching ChromeDriver (wdio's auto-pick uses the system Chrome
  // 149 driver otherwise, which refuses to drive our 136 browser).
  'wdio:chromedriverOptions': { binary: await findChromedriver() },
};

export const config: WebdriverIO.Config = {
  ...baseConfig,
  capabilities: [chromeCapabilities],

  // ChromeDriver owns one browser instance — run specs serially.
  maxInstances: 1,
  logLevel: 'error',
  execArgv: IS_CI ? [] : ['--inspect'],
  before: async (_caps: WebdriverIO.Capabilities, _specs, browser: WebdriverIO.Browser) => {
    browser.addCommand('getExtensionPath', async () => getChromeExtensionPath(browser));
  },
  afterTest: async () => {
    if (!IS_CI) {
      await browser.pause(500);
    }
  },
};
