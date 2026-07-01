import '@testing-library/jest-dom/vitest';
import { SlashCommandMenu } from './SlashCommandMenu';
import { skillsStorage } from '@doeverything/storage';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Skill } from '@doeverything/storage';

/**
 * SlashCommandMenu is driven by `useStorage(skillsStorage)` (backed by
 * `chrome.storage.local["skills"]`) plus per-skill usage scores read from
 * `chrome.storage.local["skillUsage"]`. We seed both through the storage API
 * in beforeEach: `skillsStorage.set` writes the data, refreshes the module
 * cache, and emits the change so `useStorage` renders synchronously after the
 * await — no Suspense boundary needed.
 */

const baseSkill = (over: Partial<Skill>): Skill => ({
  id: over.id ?? `id-${over.name}`,
  name: over.name ?? 'skill',
  description: over.description ?? '',
  body: '',
  source: 'user',
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const seedSkills = async (skills: Skill[]) => {
  await skillsStorage.set(skills);
};

const seedScores = async (scores: Record<string, { usageCount: number; lastUsedAt: number }>) => {
  await skillsStorage.usage.set(scores);
};

beforeEach(async () => {
  await seedSkills([]);
  await seedScores({});
  // Active tab URL lookup resolves to a no-URL tab by default.
  vi.spyOn(chrome.tabs, 'query').mockResolvedValue([]);
});

describe('SlashCommandMenu', () => {
  it('renders nothing when the prompt does not start with a slash', async () => {
    await seedSkills([baseSkill({ name: 'search' })]);
    const { container } = render(<SlashCommandMenu prompt="hello" onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when no skill matches the query', async () => {
    await seedSkills([baseSkill({ name: 'search' })]);
    const { container } = render(<SlashCommandMenu prompt="/zzz" onSelect={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('lists skills whose name matches the /<query> token', async () => {
    await seedSkills([
      baseSkill({ name: 'search', description: 'Find things' }),
      baseSkill({ name: 'segment', description: 'Split text' }),
      baseSkill({ name: 'translate', description: 'Other language' }),
    ]);
    render(<SlashCommandMenu prompt="/se" onSelect={() => {}} />);
    // 'se' matches search + segment by prefix; translate has no 'se'.
    expect(await screen.findByText('/search')).toBeInTheDocument();
    expect(screen.getByText('/segment')).toBeInTheDocument();
    expect(screen.queryByText('/translate')).not.toBeInTheDocument();
  });

  it('matches by substring, not only prefix', async () => {
    await seedSkills([baseSkill({ name: 'translate' })]);
    // 'lat' is an interior substring of 'translate' (trans-LAT-e).
    render(<SlashCommandMenu prompt="/lat" onSelect={() => {}} />);
    expect(await screen.findByText('/translate')).toBeInTheDocument();
  });

  it('excludes skills with userInvocable === false', async () => {
    await seedSkills([
      baseSkill({ name: 'search' }),
      baseSkill({ name: 'secret', userInvocable: false }),
    ]);
    render(<SlashCommandMenu prompt="/se" onSelect={() => {}} />);
    expect(await screen.findByText('/search')).toBeInTheDocument();
    expect(screen.queryByText('/secret')).not.toBeInTheDocument();
  });

  it('shows the description and argument hint when present', async () => {
    await seedSkills([
      baseSkill({ name: 'search', description: 'Find things', argumentHint: '<query>' }),
    ]);
    render(<SlashCommandMenu prompt="/sea" onSelect={() => {}} />);
    expect(await screen.findByText('/search')).toBeInTheDocument();
    expect(screen.getByText('Find things')).toBeInTheDocument();
    expect(screen.getByText('<query>')).toBeInTheDocument();
  });

  it('passes the post-token text as args to onSelect when a skill is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const skill = baseSkill({ name: 'search' });
    await seedSkills([skill]);
    render(<SlashCommandMenu prompt="/search hello world" onSelect={onSelect} />);
    await user.click(await screen.findByText('/search'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ name: 'search' }), 'hello world');
  });

  it('ranks higher-usage skills first', async () => {
    await seedSkills([
      baseSkill({ name: 'sa' }),
      baseSkill({ name: 'sb' }),
    ]);
    // sb used recently many times → should outrank sa.
    await seedScores({ sb: { usageCount: 50, lastUsedAt: Date.now() } });
    render(<SlashCommandMenu prompt="/s" onSelect={() => {}} />);
    // Usage scores load asynchronously, then re-sort the list — wait for it.
    await waitFor(() => {
      const items = screen.getAllByText(/^\/s[ab]$/);
      expect(items.map(el => el.textContent)).toEqual(['/sb', '/sa']);
    });
  });

  it('filters out skills whose domains do not match the active tab', async () => {
    vi.spyOn(chrome.tabs, 'query').mockResolvedValue([
      { url: 'https://github.com/foo' },
    ] as unknown as chrome.tabs.Tab[]);
    await seedSkills([
      baseSkill({ name: 'site-global' }),
      baseSkill({ name: 'site-bound', domains: ['example.com'] }),
    ]);
    render(<SlashCommandMenu prompt="/site" onSelect={() => {}} />);
    // 'site-global' has no domains → always shown; 'site-bound' requires example.com.
    expect(await screen.findByText('/site-global')).toBeInTheDocument();
    expect(screen.queryByText('/site-bound')).not.toBeInTheDocument();
  });
});
