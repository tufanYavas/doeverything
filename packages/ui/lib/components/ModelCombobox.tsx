import { Input } from './Input';
import { cn } from '../utils';
import { Check } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * ModelCombobox — free-text model picker with filtered suggestions.
 *
 * Replaces the old `<Input list=…>` + `<datalist>` combo, which had two
 * problems: suggestions only appeared after a manual model refresh, and the
 * controlled value round-tripped through chrome.storage on every keystroke,
 * so the storage echo could revert typed characters and dismiss the native
 * popup. Here the draft lives in local state and is committed (`onCommit`)
 * only on Enter, blur, or suggestion click — never per keystroke.
 *
 * Matching is case-insensitive substring over the supplied options; free
 * text that matches nothing is still committable, so users can enter model
 * ids the provider's /models endpoint doesn't list. An empty commit means
 * "use the provider default" (same contract as before).
 */

interface ModelComboboxProps {
  /** Committed model id; '' = use provider default. */
  value: string;
  /** Suggested model ids (discovered list and/or bootstrap default). */
  options: ReadonlyArray<string>;
  /** Fired with the new model id on Enter, blur, or suggestion click. */
  onCommit: (model: string) => void;
  id?: string;
  placeholder?: string;
  className?: string;
}

export function ModelCombobox({ value, options, onCommit, id, placeholder, className }: ModelComboboxProps) {
  const [draft, setDraft] = useState(value);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  // Enter only picks the highlighted suggestion after the user navigated
  // with the arrow keys; otherwise it commits the exact typed text — typing
  // "gpt-4o" must not silently commit the substring match "gpt-4o-mini".
  const [navigated, setNavigated] = useState(false);
  const focusedRef = useRef(false);

  // Follow external value changes (another tab/page wrote storage), but
  // never clobber what the user is actively typing.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [...options];
    return options.filter(o => o.toLowerCase().includes(q));
  }, [draft, options]);

  useEffect(() => {
    setHighlight(h => Math.min(h, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  const commit = (next: string) => {
    setOpen(false);
    setDraft(next);
    if (next !== value) onCommit(next);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setNavigated(true);
      setHighlight(h => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setNavigated(true);
      setHighlight(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(open && navigated && filtered[highlight] !== undefined ? filtered[highlight] : draft.trim());
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        onChange={e => {
          setDraft(e.target.value);
          setOpen(true);
          setHighlight(0);
          setNavigated(false);
        }}
        onFocus={() => {
          focusedRef.current = true;
          setOpen(true);
          setNavigated(false);
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit(draft.trim());
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        // mousedown preventDefault: a click on the list's scrollbar must not
        // steal focus from the input — the resulting blur would commit a
        // half-typed draft.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div
          onMouseDown={e => e.preventDefault()}
          className="border-border/70 bg-popover text-popover-foreground shadow-lifted absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border">
          {filtered.length > 0 ? (
            filtered.map((option, i) => (
              <button
                key={option}
                type="button"
                // mousedown (not click) so the input's blur-commit doesn't
                // fire first with the un-selected draft.
                onMouseDown={e => {
                  e.preventDefault();
                  commit(option);
                }}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-xs',
                  i === highlight ? 'bg-accent text-accent-foreground' : '',
                )}>
                <Check className={cn('h-3 w-3 shrink-0', option === value ? 'opacity-100' : 'opacity-0')} />
                <span className="truncate">{option}</span>
              </button>
            ))
          ) : (
            <div className="text-muted-foreground px-2.5 py-1.5 text-xs">
              No matching models — press Enter to use “{draft.trim()}”.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
