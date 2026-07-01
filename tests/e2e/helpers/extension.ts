/** doeverything e2e helpers. */

/** Navigate to an extension-relative page path (e.g. `options/index.html`). */
export const openExtensionPage = async (path: string): Promise<void> => {
  const base = await browser.getExtensionPath();
  await browser.url(`${base}/${path}`);
};
