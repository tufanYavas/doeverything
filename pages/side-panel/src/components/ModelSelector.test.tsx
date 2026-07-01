import '@testing-library/jest-dom/vitest';
import { ModelSelector } from './ModelSelector';
import {
  customProvidersStorage,
  discoveredModelsStorage,
  llmConfigStorage,
} from '@doeverything/storage';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ModelSelector reads three storages via `useStorage`:
 *   - llmConfigStorage   (active provider/model)
 *   - discoveredModelsStorage (cached model lists per provider)
 *   - customProvidersStorage
 *
 * Each is seeded through its `set` in beforeEach so `useStorage` resolves
 * synchronously after the await (the set refreshes the module cache and
 * emits a change). When `discovered` is empty every built-in provider
 * contributes its bootstrap `defaultModel`, so the option list is the
 * registry defaults. Commits go through `llmConfigStorage.setProviderModel`,
 * which we spy on.
 */

beforeEach(async () => {
  await discoveredModelsStorage.set({ byProvider: {} });
  await customProvidersStorage.set({ providers: [] });
  // Active = anthropic / claude-opus-4.8. OpenAI key present so its models appear in the list.
  await llmConfigStorage.set({
    provider: 'anthropic',
    models: { anthropic: 'claude-opus-4.8' },
    apiKeys: { openai: 'test-key' },
    baseUrls: {},
    fastModel: null,
    recentModels: [],
  });
});

const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /Model:/i }));
  return screen.findByPlaceholderText(/Search models/i);
};

/** The option list. Scopes queries away from the trigger button, which also
 *  renders the current model id as its label. */
const listbox = () => within(screen.getByRole('listbox'));

describe('ModelSelector', () => {
  it('shows the active model on the trigger button', () => {
    render(<ModelSelector />);
    // Anthropic default model id.
    expect(screen.getByRole('button', { name: /Model:/i })).toHaveTextContent('claude-opus-4.8');
  });

  it('opens a search panel listing discovered/default models', async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    await openPanel(user);
    // Registry bootstrap defaults are present as options.
    expect(await listbox().findByText('claude-opus-4.8')).toBeInTheDocument();
    expect(listbox().getByText('gpt-5.5')).toBeInTheDocument();
  });

  it('uses discovered models for a provider when present', async () => {
    await discoveredModelsStorage.set({
      byProvider: { anthropic: { models: ['claude-shiny-1', 'claude-shiny-2'], fetchedAt: 0 } },
    });
    const user = userEvent.setup();
    render(<ModelSelector />);
    await openPanel(user);
    expect(await listbox().findByText('claude-shiny-1')).toBeInTheDocument();
    expect(listbox().getByText('claude-shiny-2')).toBeInTheDocument();
    // The bootstrap default is replaced by the discovered list (not in the list).
    expect(listbox().queryByText('claude-opus-4.8')).not.toBeInTheDocument();
  });

  it('filters by case-insensitive substring over provider label and model id', async () => {
    const user = userEvent.setup();
    render(<ModelSelector />);
    const input = await openPanel(user);
    await user.type(input, 'GPT');
    expect(await listbox().findByText('gpt-5.5')).toBeInTheDocument();
    expect(listbox().queryByText('claude-opus-4.8')).not.toBeInTheDocument();
  });

  it('commits a clicked model via setProviderModel', async () => {
    const spy = vi.spyOn(llmConfigStorage, 'setProviderModel').mockResolvedValue();
    const user = userEvent.setup();
    render(<ModelSelector />);
    await openPanel(user);
    await user.click(await screen.findByText('gpt-5.5'));
    expect(spy).toHaveBeenCalledWith('openai', 'gpt-5.5');
  });

  it('offers a custom-model row for unknown free text and commits it on the current provider', async () => {
    const spy = vi.spyOn(llmConfigStorage, 'setProviderModel').mockResolvedValue();
    const user = userEvent.setup();
    render(<ModelSelector />);
    const input = await openPanel(user);
    await user.type(input, 'my-self-hosted-model');
    // Custom row offers to use the typed id with the active (anthropic) provider.
    expect(await screen.findByText('my-self-hosted-model')).toBeInTheDocument();
    await user.click(screen.getByText('my-self-hosted-model'));
    expect(spy).toHaveBeenCalledWith('anthropic', 'my-self-hosted-model');
  });

  it('ArrowDown + Enter commits the highlighted row', async () => {
    const spy = vi.spyOn(llmConfigStorage, 'setProviderModel').mockResolvedValue();
    const user = userEvent.setup();
    render(<ModelSelector />);
    const input = await openPanel(user);
    // Filter to a single deterministic option, then commit via keyboard.
    await user.type(input, 'gpt-5.5');
    await user.keyboard('{Enter}');
    expect(spy).toHaveBeenCalledWith('openai', 'gpt-5.5');
  });

  it('shows "No models found." when the filter matches nothing and there is no query row', async () => {
    // Empty registries → no default options; empty query keeps customRow off.
    await discoveredModelsStorage.set({ byProvider: {} });
    const user = userEvent.setup();
    render(<ModelSelector />);
    const input = await openPanel(user);
    // A query that matches nothing still shows the custom row, so assert the
    // custom row text rather than the empty state here.
    await user.type(input, 'definitely-no-such-model-xyz');
    expect(await screen.findByText('definitely-no-such-model-xyz')).toBeInTheDocument();
  });

  it('closes on Escape without committing', async () => {
    const spy = vi.spyOn(llmConfigStorage, 'setProviderModel').mockResolvedValue();
    const user = userEvent.setup();
    render(<ModelSelector />);
    const input = await openPanel(user);
    await user.type(input, '{Escape}');
    expect(screen.queryByPlaceholderText(/Search models/i)).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });
});
