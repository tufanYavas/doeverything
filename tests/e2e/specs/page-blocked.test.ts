import { openExtensionPage } from '../helpers/extension.js';

describe('doeverything Blocked page', () => {
  it('renders the managed-policy block notice', async () => {
    await openExtensionPage('blocked/index.html');
    await expect(browser).toHaveTitle('doeverything — Blocked');
    // The badge text is CSS-uppercased, so WebdriverIO's visible-text match
    // sees "NAVIGATION BLOCKED"; the card title is not transformed.
    await expect(await $('*=NAVIGATION BLOCKED').getElement()).toBeExisting();
    await expect(await $('*=This site is blocked').getElement()).toBeDisplayed();
  });
});
