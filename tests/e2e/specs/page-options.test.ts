import { openExtensionPage } from '../helpers/extension.js';

describe('doeverything Settings (Options) page', () => {
  it('loads the settings shell with the section navigation', async () => {
    await openExtensionPage('options/index.html');
    await expect(browser).toHaveTitle('doeverything — Settings');

    // Sidebar nav items (vertical settings shell).
    for (const label of ['Connection', 'LLM', 'Microphone']) {
      await expect(await $(`*=${label}`).getElement()).toBeExisting();
    }
  });

  it('shows the MCP connection card on the Connection tab', async () => {
    await openExtensionPage('options/index.html#account');
    await expect(await $('*=MCP connection').getElement()).toBeDisplayed();
  });

  it('switches to the LLM tab and shows the provider section', async () => {
    await openExtensionPage('options/index.html');
    const llmNav = await $('button*=LLM').getElement();
    await llmNav.click();
    const heading = await $('h2*=LLM Provider').getElement();
    await heading.waitForDisplayed({ timeoutMsg: 'LLM Provider heading not shown after tab switch' });
    await expect(heading).toBeDisplayed();
  });
});
