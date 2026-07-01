import { openExtensionPage } from '../helpers/extension.js';

/**
 * A fresh profile already has a default Anthropic model pre-selected, so the
 * panel opens straight into the chat shell (not the LoginScreen) with the
 * first-run onboarding tour (`SpotlightModal`) layered on top. The tour only
 * persists `doe:spotlight-seen` when dismissed, so it reliably reappears
 * on reload until the final test closes it.
 */
describe('doeverything Side Panel', () => {
  it('loads and mounts the chat shell', async () => {
    await openExtensionPage('side-panel/index.html');
    await expect(browser).toHaveTitle('doeverything');
    // The empty-state prompt confirms the chat shell mounted behind the tour.
    await expect(await $('*=How can I help you today').getElement()).toBeExisting();
  });

  it('shows the first-run onboarding tour', async () => {
    await openExtensionPage('side-panel/index.html');
    await expect(await $('*=Welcome to doeverything').getElement()).toBeDisplayed();
    await expect(await $('*=Step 1 / 4').getElement()).toBeExisting();
  });

  it('can dismiss the onboarding tour and reach the composer', async () => {
    await openExtensionPage('side-panel/index.html');
    // The Radix dialog closes on Escape → persists `spotlight-seen`.
    await browser.keys('Escape');
    // The composer placeholder confirms the chat shell is interactive.
    const editor = await $('[contenteditable="true"]').getElement();
    await editor.waitForExist({ timeoutMsg: 'composer editor did not mount after dismissing the tour' });
    await expect(editor).toBeExisting();
  });
});
