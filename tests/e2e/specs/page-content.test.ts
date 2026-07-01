/**
 * doeverything content scripts.
 * Tests that the MAIN-world DOM walker (`window.___oadp`) is injected on normal pages.
 */
describe('doeverything content scripts', () => {
  it('injects the MAIN-world DOM walker (window.___oadp) on a normal page', async () => {
    await browser.url('https://www.example.com');

    // The walker is defined at document_start in the MAIN world; give it a
    // moment, then read it from the page context.
    await browser.waitUntil(
      async () => (await browser.execute(() => typeof (window as { ___oadp?: unknown }).___oadp)) === 'object',
      { timeout: 5_000, timeoutMsg: 'window.___oadp DOM walker was not injected' },
    );

    const hasGetElement = await browser.execute(
      () => typeof (window as { ___oadp?: { getElement?: unknown } }).___oadp?.getElement === 'function',
    );
    expect(hasGetElement).toBe(true);
  });
});
