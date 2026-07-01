interface PuppeteerLikeTarget {
  type: () => string;
  url: () => string;
}
interface PuppeteerLikePage {
  goto: (url: string, opts?: { waitUntil?: string }) => Promise<unknown>;
  evaluate: <T>(fn: () => T) => Promise<T>;
  close: () => Promise<void>;
}
interface PuppeteerLikeBrowser {
  targets: () => PuppeteerLikeTarget[];
  waitForTarget: (predicate: (t: PuppeteerLikeTarget) => boolean, opts?: { timeout?: number }) => Promise<PuppeteerLikeTarget>;
  newPage: () => Promise<PuppeteerLikePage>;
}

/**
 * Returns the Chrome extension origin (`chrome-extension://<id>`).
 *
 * The extension id is random per load (no fixed manifest `key`), so it must
 * be discovered at runtime. Primary path: read it from the MV3 background
 * service-worker target via the puppeteer bridge. Fallback: open
 * `chrome://extensions` and walk its nested shadow roots for the
 * `<extensions-item>` (its tag id IS the extension id) — more robust than
 * WebDriver's `shadow$`, which silently fails.
 */
export const getChromeExtensionPath = async (browser: WebdriverIO.Browser) => {
  const getPuppeteer = (browser as unknown as { getPuppeteer?: () => Promise<PuppeteerLikeBrowser> }).getPuppeteer;
  if (typeof getPuppeteer !== 'function') {
    throw new Error('getPuppeteer() unavailable — cannot resolve the extension id');
  }
  const pptr = await getPuppeteer.call(browser);

  const isExtWorker = (t: PuppeteerLikeTarget) =>
    (t.type() === 'service_worker' || t.type() === 'background_page') && t.url().startsWith('chrome-extension://');

  // 1) Service-worker target (fast, no page).
  let worker: PuppeteerLikeTarget | undefined;
  try {
    worker = pptr.targets().find(isExtWorker) ?? (await pptr.waitForTarget(isExtWorker, { timeout: 8_000 }));
  } catch {
    worker = undefined;
  }
  if (worker) return `chrome-extension://${new URL(worker.url()).hostname}`;

  // 2) Fallback: chrome://extensions shadow-DOM walk.
  const page = await pptr.newPage();
  try {
    await page.goto('chrome://extensions/', { waitUntil: 'domcontentloaded' });
    const findId = () =>
      page.evaluate<string | null>(() => {
        const walk = (root: Document | ShadowRoot): string | null => {
          const direct = root.querySelector('extensions-item');
          if (direct?.id) return direct.id;
          for (const el of Array.from(root.querySelectorAll('*'))) {
            const sr = (el as Element & { shadowRoot?: ShadowRoot | null }).shadowRoot;
            if (sr) {
              const found = walk(sr);
              if (found) return found;
            }
          }
          return null;
        };
        return walk(document);
      });

    const deadline = Date.now() + 10_000;
    let id: string | null = null;
    while (Date.now() < deadline) {
      id = await findId();
      if (id) break;
      await new Promise(r => setTimeout(r, 250));
    }
    if (!id) {
      throw new Error(
        'Extension not loaded. Chrome 137+ removed --load-extension; e2e needs Chrome-for-Testing 136 (run `pnpm e2e:setup`).',
      );
    }
    return `chrome-extension://${id}`;
  } finally {
    await page.close();
  }
};

