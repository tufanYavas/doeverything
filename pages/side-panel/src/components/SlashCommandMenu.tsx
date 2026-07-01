import { urlMatchesAny, useStorage } from '@doeverything/shared';
import { skillsStorage } from '@doeverything/storage';
import { cn } from '@doeverything/ui';
import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Skill } from '@doeverything/storage';

/**
 * Inline `/` palette above the composer. Filters saved skills by
 *
 *   - prefix match on the user's `/<query>` token,
 *   - `userInvocable !== false`,
 *   - `domains` glob matched against the active tab URL (or no `domains`).
 *
 * Ranks by recency-weighted usage score (`skillsStorage.getUsageScore`)
 * — popular/recent skills float to the top.
 */

interface Props {
  prompt: string;
  onSelect: (skill: Skill, args: string) => void;
}

export function SlashCommandMenu({ prompt, onSelect }: Props) {
  const skills = useStorage(skillsStorage);
  const [activeUrl, setActiveUrl] = useState<string | undefined>();
  const [scores, setScores] = useState<Record<string, number>>({});

  useEffect(() => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([t]) => setActiveUrl(t?.url));
  }, []);

  // Rank candidates by usage score whenever the skill set changes.
  useEffect(() => {
    let cancelled = false;
    void Promise.all(skills.map(s => skillsStorage.getUsageScore(s.name).then(score => [s.name, score] as const)))
      .then(entries => {
        if (cancelled) return;
        setScores(Object.fromEntries(entries));
      })
      .catch(() => {
        /* non-fatal — fall back to no ranking */
      });
    return () => {
      cancelled = true;
    };
  }, [skills]);

  const candidates = useMemo(() => {
    if (!prompt.startsWith('/')) return [] as Skill[];
    const tokens = prompt.slice(1).split(/\s+/);
    const queryRaw = tokens[0] ?? '';
    const query = queryRaw.toLowerCase();
    return skills
      .filter(s => s.userInvocable !== false)
      .filter(s => s.name.toLowerCase().startsWith(query) || s.name.toLowerCase().includes(query))
      .filter(s => !s.domains || s.domains.length === 0 || urlMatchesAny(activeUrl, s.domains))
      .sort((a, b) => (scores[b.name] ?? 0) - (scores[a.name] ?? 0))
      .slice(0, 6);
  }, [prompt, skills, activeUrl, scores]);

  if (!prompt.startsWith('/')) return null;
  if (candidates.length === 0) return null;

  const tokens = prompt.slice(1).split(/\s+/);
  const args = tokens.slice(1).join(' ');

  return (
    <div className="border-border/70 bg-popover text-popover-foreground shadow-lifted mx-auto mb-2 w-full max-w-2xl overflow-hidden rounded-lg border">
      <div className="border-border/60 text-muted-foreground flex items-center gap-2 border-b px-3 py-1.5 text-[11px] font-medium uppercase tracking-wider">
        <Sparkles className="text-primary h-3 w-3" /> Skills
      </div>
      <ul className="max-h-56 overflow-y-auto py-1">
        {candidates.map(skill => (
          <li key={skill.id}>
            <button
              type="button"
              onClick={() => onSelect(skill, args)}
              className={cn(
                'hover:bg-accent flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors duration-150',
              )}>
              <span className="flex flex-col">
                <span className="text-primary font-mono text-xs">/{skill.name}</span>
                {skill.description && <span className="text-muted-foreground text-xs">{skill.description}</span>}
              </span>
              {skill.argumentHint && (
                <span className="text-muted-foreground font-mono text-[10px]">{skill.argumentHint}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
