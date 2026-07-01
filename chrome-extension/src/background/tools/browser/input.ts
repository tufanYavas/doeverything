import { PermissionDeniedError } from '../../permissions/manager.js';
import { blobToBase64, gateOnHost } from '../internal/helpers.js';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';

export function inputTools(ctx: AgentToolContext) {
  return {
    input: tool({
      description:
        'Sets the value of a form field at `[N]` (`<input>`, `<textarea>`, contenteditable) via the React/Vue/Angular native setter, with `input` + `change` events. `clear: false` appends. For `<select>` use `select_dropdown`; for checkbox/radio use `computer.left_click`.',
      inputSchema: z.object({
        ref: z.string().describe('Element `[N]` index from `read_page` (e.g. "42").'),
        text: z.string().describe('The text to type into the element.'),
        clear: z
          .boolean()
          .optional()
          .describe('Clear existing text before typing. Default: true. Set false to append.'),
        tabId: z
          .number()
          .optional()
          .describe("Tab id to type into. Must be in the doeverything group. Defaults to the agent's active tab."),
      }),
      execute: async ({ ref, text, clear, tabId: requestedTabId }) => {
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        try {
          await gateOnHost(ctx, tabId, 'type', {
            reason: 'Set field value',
            preview: `[${ref}] = ${text.slice(0, 40)}`,
            toolName: 'input',
          });
        } catch (err) {
          if (err instanceof PermissionDeniedError) return { ok: false, error: 'Denied by user' };
          throw err;
        }
        const shouldClear = clear !== false;
        const inputArgs: [string, string, boolean] = [ref, text, shouldClear];
        const [{ result } = { result: undefined }] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          args: inputArgs,
          func: (refId: string, value: string, doClear: boolean) => {
            const win = window as Window & { ___oadp?: { getElement: (id: number) => HTMLElement | null } };
            if (!win.___oadp?.getElement) {
              return { ok: false as const, error: 'DOM walker not present. Call `read_page` first.' };
            }
            const id = parseInt(refId, 10);
            if (Number.isNaN(id)) return { ok: false as const, error: `Invalid ref "${refId}".` };
            const el = win.___oadp.getElement(id);
            if (!el) {
              return {
                ok: false as const,
                error: `No element for ref [${id}]. The DOM may have changed; call \`read_page\` again.`,
              };
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (el instanceof HTMLSelectElement) {
              return { ok: false as const, error: `Element [${id}] is a <select>. Use select_dropdown instead.` };
            }
            if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
              return {
                ok: false as const,
                error: `Element [${id}] is a ${el.type}. Use computer left_click to toggle it.`,
              };
            }
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              const previous = el.value;
              const expected = doClear ? value : previous + value;
              const ariaAc = el.getAttribute('aria-autocomplete') || '';
              const role = el.getAttribute('role') || '';
              const list = el.getAttribute('list') || '';
              const haspopup = el.getAttribute('aria-haspopup') || '';
              const ariaControls = el.getAttribute('aria-controls') || '';
              const ariaOwns = el.getAttribute('aria-owns') || '';
              const isAutocomplete =
                role === 'combobox' ||
                (ariaAc !== '' && ariaAc !== 'none') ||
                list !== '' ||
                (haspopup !== '' && haspopup !== 'false' && (ariaControls !== '' || ariaOwns !== ''));
              el.focus();
              el.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));
              if (doClear && previous.length > 0) {
                el.dispatchEvent(
                  new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'deleteContentBackward',
                    data: null,
                  }),
                );
                el.value = '';
                el.dispatchEvent(
                  new InputEvent('input', {
                    bubbles: true,
                    cancelable: false,
                    inputType: 'deleteContentBackward',
                    data: null,
                  }),
                );
              }
              const proto =
                el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
              el.dispatchEvent(
                new InputEvent('beforeinput', {
                  bubbles: true,
                  cancelable: true,
                  inputType: 'insertText',
                  data: value,
                }),
              );
              if (setter) setter.call(el, expected);
              else el.value = expected;
              if (
                el instanceof HTMLTextAreaElement ||
                (el instanceof HTMLInputElement &&
                  ['text', 'search', 'url', 'tel', 'password', 'email'].includes(el.type))
              ) {
                try {
                  el.setSelectionRange(el.value.length, el.value.length);
                } catch {
                  /* some input types reject this */
                }
              }
              el.dispatchEvent(
                new InputEvent('input', {
                  bubbles: true,
                  cancelable: false,
                  inputType: 'insertText',
                  data: value,
                }),
              );
              el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
              const elementType = el instanceof HTMLTextAreaElement ? 'textarea' : el.type || 'text';
              let msg = `Typed into ${elementType} [${id}] (previous: "${previous.slice(0, 60)}")`;
              if (el.value !== expected) {
                msg += `\n⚠ Field value "${el.value}" differs from typed text "${expected}" — page reformatted/autocompleted.`;
              }
              if (isAutocomplete) {
                msg += `\n💡 Autocomplete field detected. Wait for suggestions, then click the right one instead of pressing Enter.`;
              }
              return { ok: true as const, output: msg, isAutocomplete, finalValue: el.value };
            }
            if ((el as HTMLElement).isContentEditable) {
              const target = el as HTMLElement;
              const previous = target.innerText ?? target.textContent ?? '';
              const next = doClear ? value : previous + value;
              target.focus();
              target.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));
              // Select existing content so beforeinput/input represent a replace, not an append.
              // Lexical/ProseMirror/Slate listen to beforeinput and update their internal model from it.
              const sel = window.getSelection();
              if (sel && doClear && previous.length > 0) {
                const range = document.createRange();
                range.selectNodeContents(target);
                sel.removeAllRanges();
                sel.addRange(range);
                target.dispatchEvent(
                  new InputEvent('beforeinput', {
                    bubbles: true,
                    cancelable: true,
                    inputType: 'deleteContentBackward',
                    data: null,
                  }),
                );
              }
              target.dispatchEvent(
                new InputEvent('beforeinput', {
                  bubbles: true,
                  cancelable: true,
                  inputType: 'insertText',
                  data: value,
                }),
              );
              // innerText preserves \n as line breaks in the DOM (unlike textContent which collapses them).
              // Editors that consumed beforeinput already updated themselves; this is a fallback for plain contenteditable.
              target.innerText = next;
              // Place caret at end so subsequent typing/sends behave naturally.
              if (sel) {
                const range = document.createRange();
                range.selectNodeContents(target);
                range.collapse(false);
                sel.removeAllRanges();
                sel.addRange(range);
              }
              target.dispatchEvent(
                new InputEvent('input', {
                  bubbles: true,
                  cancelable: false,
                  inputType: 'insertText',
                  data: value,
                }),
              );
              target.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
              const finalValue = target.innerText ?? target.textContent ?? '';
              let msg = `Typed into contenteditable [${id}] (previous: "${previous.slice(0, 60)}")`;
              if (finalValue.replace(/\s+/g, '').length < next.replace(/\s+/g, '').length * 0.8) {
                msg += `\n⚠ Final value shorter than typed text — editor may have rejected or filtered the content.`;
              }
              return {
                ok: true as const,
                output: msg,
                finalValue,
              };
            }
            return {
              ok: false as const,
              error: `Element [${id}] is a <${el.tagName.toLowerCase()}> — not a text input/textarea/contenteditable. Use computer left_click + type as fallback.`,
            };
          },
        });
        if (!result) return { ok: false, error: 'No result from page script' };
        // Autocomplete settle delay: wait for dropdown to populate.
        if (result.ok && (result as { isAutocomplete?: boolean }).isAutocomplete) {
          await new Promise(r => setTimeout(r, 400));
        }
        return { ...result };
      },
    }),

    select_dropdown: tool({
      description:
        'Picks an option in the dropdown at `[N]` by `text` (label or value, case-insensitive). Handles native `<select>`, ARIA `menu`/`listbox`/`combobox`, and Semantic-UI custom dropdowns. Call `dropdown_options` first when the choices are unknown.',
      inputSchema: z.object({
        ref: z.string().describe('Element `[N]` index from `read_page` (e.g. "42").'),
        text: z.string().describe('Exact text or value of the option to select.'),
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
      }),
      execute: async ({ ref, text, tabId: requestedTabId }) => {
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        try {
          await gateOnHost(ctx, tabId, 'type', {
            reason: 'Pick a dropdown option',
            preview: `[${ref}] = ${text}`,
            toolName: 'select_dropdown',
          });
        } catch (err) {
          if (err instanceof PermissionDeniedError) return { ok: false, error: 'Denied by user' };
          throw err;
        }
        const runSelect = async () =>
          chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            args: [ref, text],
            func: (refId: string, target: string) => {
              const win = window as Window & { ___oadp?: { getElement: (id: number) => HTMLElement | null } };
              if (!win.___oadp?.getElement)
                return { ok: false as const, error: 'DOM walker not present. Call `read_page` first.' };
              const id = parseInt(refId, 10);
              if (Number.isNaN(id)) return { ok: false as const, error: `Invalid ref "${refId}".` };
              const start = win.___oadp.getElement(id);
              if (!start) return { ok: false as const, error: `No element for ref [${id}].` };

              type Result =
                | { ok: true; output: string; value?: string }
                | {
                    ok: false;
                    error: string;
                    reverted?: boolean;
                    targetIndex?: number;
                    available?: Array<{ text: string; value: string }>;
                  };

              function tryOn(el: Element): Result | null {
                if (el instanceof HTMLSelectElement) {
                  const tl = target.toLowerCase();
                  for (const opt of Array.from(el.options)) {
                    if (opt.text.trim().toLowerCase() === tl || opt.value.toLowerCase() === tl) {
                      el.focus();
                      el.value = opt.value;
                      opt.selected = true;
                      el.selectedIndex = opt.index;
                      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
                      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
                      el.blur();
                      if (el.value !== opt.value) {
                        return {
                          ok: false,
                          error: 'Selection reverted by framework — retrying via click.',
                          reverted: true,
                          targetIndex: opt.index,
                          available: Array.from(el.options).map(o => ({ text: o.text.trim(), value: o.value })),
                        };
                      }
                      return {
                        ok: true,
                        output: `Selected "${opt.text.trim()}" (value=${opt.value})`,
                        value: opt.value,
                      };
                    }
                  }
                  return {
                    ok: false,
                    error: `Option "${target}" not in <select>`,
                    available: Array.from(el.options).map(o => ({ text: o.text.trim(), value: o.value })),
                  };
                }
                const role = el.getAttribute('role');
                if (role === 'menu' || role === 'listbox' || role === 'combobox') {
                  const items = el.querySelectorAll('[role="menuitem"], [role="option"]');
                  const tl = target.toLowerCase();
                  for (const item of Array.from(items)) {
                    const textL = (item.textContent ?? '').trim().toLowerCase();
                    const dv = (item.getAttribute('data-value') ?? '').toLowerCase();
                    if (textL === tl || dv === tl) {
                      items.forEach(it => {
                        it.setAttribute('aria-selected', 'false');
                        it.classList.remove('selected');
                      });
                      item.setAttribute('aria-selected', 'true');
                      item.classList.add('selected');
                      (item as HTMLElement).click();
                      return { ok: true, output: `Selected ARIA item: ${(item.textContent ?? '').trim()}` };
                    }
                  }
                  return {
                    ok: false,
                    error: `ARIA item "${target}" not found`,
                    available: Array.from(items).map(it => ({
                      text: (it.textContent ?? '').trim(),
                      value: it.getAttribute('data-value') ?? '',
                    })),
                  };
                }
                if (el.classList.contains('dropdown') || el.classList.contains('ui')) {
                  const items = el.querySelectorAll('.item, .option, [data-value]');
                  const tl = target.toLowerCase();
                  for (const item of Array.from(items)) {
                    const textL = (item.textContent ?? '').trim().toLowerCase();
                    const dv = (item.getAttribute('data-value') ?? '').toLowerCase();
                    if (textL === tl || dv === tl) {
                      items.forEach(it => it.classList.remove('selected', 'active'));
                      item.classList.add('selected', 'active');
                      const textEl = el.querySelector('.text');
                      if (textEl) textEl.textContent = (item.textContent ?? '').trim();
                      (item as HTMLElement).click();
                      el.dispatchEvent(new Event('change', { bubbles: true }));
                      return { ok: true, output: `Selected custom item: ${(item.textContent ?? '').trim()}` };
                    }
                  }
                  return {
                    ok: false,
                    error: `Custom dropdown item "${target}" not found`,
                    available: Array.from(items).map(it => ({
                      text: (it.textContent ?? '').trim(),
                      value: it.getAttribute('data-value') ?? '',
                    })),
                  };
                }
                return null;
              }

              const direct = tryOn(start);
              if (direct) return direct;

              function descend(el: Element, depth: number, max: number): Result | null {
                if (depth >= max) return null;
                for (const child of Array.from(el.children)) {
                  const r = tryOn(child);
                  if (r && r.ok) return r;
                  const dd = descend(child, depth + 1, max);
                  if (dd && dd.ok) return dd;
                }
                return null;
              }
              const found = descend(start, 0, 4);
              if (found) return found;

              return {
                ok: false as const,
                error: `Element [${id}] (and 4 levels of children) is not a recognised dropdown (tag=${start.tagName.toLowerCase()}, role=${start.getAttribute('role') ?? 'none'}).`,
              };
            },
          });

        const first = await runSelect();
        let result = first[0]?.result as
          | { ok: true; output: string; value?: string }
          | {
              ok: false;
              error: string;
              reverted?: boolean;
              targetIndex?: number;
              available?: Array<{ text: string; value: string }>;
            }
          | undefined;
        if (!result) return { ok: false, error: 'No result from page script' };

        // Click-fallback when the framework reverts the selection.
        if (!result.ok && result.reverted && typeof result.targetIndex === 'number') {
          const fallback = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            args: [ref, result.targetIndex],
            func: (refId: string, idx: number) => {
              const win = window as Window & { ___oadp?: { getElement: (id: number) => HTMLElement | null } };
              const el = win.___oadp?.getElement(parseInt(refId, 10)) as HTMLSelectElement | null;
              if (!el || el.tagName.toLowerCase() !== 'select')
                return { ok: false as const, error: 'Click fallback: not a <select>.' };
              const opt = el.options[idx];
              if (!opt) return { ok: false as const, error: `Click fallback: no option at ${idx}` };
              el.focus();
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              el.selectedIndex = idx;
              opt.selected = true;
              opt.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
              el.blur();
              if (el.value === opt.value || el.selectedIndex === idx) {
                return {
                  ok: true as const,
                  output: `Selected via click fallback: ${opt.text.trim()}`,
                  value: opt.value,
                };
              }
              return { ok: false as const, error: 'Click fallback: selection reverted again.' };
            },
          });
          const f = fallback[0]?.result as
            | { ok: true; output: string; value?: string }
            | { ok: false; error: string }
            | undefined;
          if (f) result = f;
        }
        return { ...result };
      },
    }),

    dropdown_options: tool({
      description:
        'Lists the options of the dropdown at `[N]`: `text`, `value`, `index`, `selected`. Handles native `<select>`, ARIA `menu`/`listbox`, ARIA `combobox` (auto-expanded via `aria-controls`), and Semantic-UI custom dropdowns. Call before `select_dropdown` when option labels aren\'t visible in the snapshot.',
      inputSchema: z.object({
        ref: z.string().describe('Element `[N]` index from `read_page`.'),
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
      }),
      execute: async ({ ref, tabId: requestedTabId }) => {
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        const [{ result } = { result: undefined }] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          args: [ref],
          func: (refId: string) => {
            const win = window as Window & { ___oadp?: { getElement: (id: number) => HTMLElement | null } };
            if (!win.___oadp?.getElement)
              return { ok: false as const, error: 'DOM walker not present. Call `read_page` first.' };
            const id = parseInt(refId, 10);
            if (Number.isNaN(id)) return { ok: false as const, error: `Invalid ref "${refId}".` };
            const start = win.___oadp.getElement(id);
            if (!start) return { ok: false as const, error: `No element for ref [${id}].` };

            type Opt = { text: string; value: string; index: number; selected: boolean };

            // ARIA combobox with aria-controls — has to be expanded first.
            const role = start.getAttribute('role');
            const ariaControls = start.getAttribute('aria-controls');
            if (role === 'combobox' && ariaControls) {
              const wasExpanded = start.getAttribute('aria-expanded') === 'true';
              if (!wasExpanded) {
                start.focus();
                start.dispatchEvent(new FocusEvent('focus', { bubbles: true, cancelable: true }));
                start.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));
                start.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              }
              const listbox = document.getElementById(ariaControls);
              if (!listbox) {
                if (!wasExpanded) {
                  start.blur();
                  start.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
                }
                return { ok: false as const, error: `Listbox "${ariaControls}" not found.` };
              }
              let elements = listbox.querySelectorAll('[role="option"]');
              if (elements.length === 0) elements = listbox.querySelectorAll('li');
              const opts: Opt[] = [];
              elements.forEach((it, idx) => {
                const t = (it as HTMLElement).textContent?.trim() ?? '';
                if (t)
                  opts.push({
                    text: t,
                    value: it.getAttribute('data-value') ?? it.getAttribute('value') ?? t,
                    index: idx,
                    selected: it.getAttribute('aria-selected') === 'true' || it.classList.contains('selected'),
                  });
              });
              if (!wasExpanded) {
                start.blur();
                start.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
              }
              return { ok: true as const, type: 'aria-combobox', source: 'aria-controls', options: opts };
            }

            function check(el: Element): { type: string; source: string; options: Opt[] } | null {
              if (el instanceof HTMLSelectElement) {
                return {
                  type: 'select',
                  source: 'target',
                  options: Array.from(el.options).map((o, i) => ({
                    text: o.text.trim(),
                    value: o.value,
                    index: i,
                    selected: o.selected,
                  })),
                };
              }
              const r = el.getAttribute('role');
              if (r === 'menu' || r === 'listbox') {
                const items = el.querySelectorAll('[role="menuitem"], [role="option"]');
                const opts: Opt[] = [];
                items.forEach((it, i) => {
                  const t = (it as HTMLElement).textContent?.trim() ?? '';
                  if (t)
                    opts.push({
                      text: t,
                      value: it.getAttribute('data-value') ?? t,
                      index: i,
                      selected: it.getAttribute('aria-selected') === 'true' || it.classList.contains('selected'),
                    });
                });
                return { type: 'aria', source: 'target', options: opts };
              }
              if (el.classList.contains('dropdown') || el.classList.contains('ui')) {
                const items = el.querySelectorAll('.item, .option, [data-value]');
                const opts: Opt[] = [];
                items.forEach((it, i) => {
                  const t = (it as HTMLElement).textContent?.trim() ?? '';
                  if (t)
                    opts.push({
                      text: t,
                      value: it.getAttribute('data-value') ?? t,
                      index: i,
                      selected: it.classList.contains('selected') || it.classList.contains('active'),
                    });
                });
                if (opts.length > 0) return { type: 'custom', source: 'target', options: opts };
              }
              return null;
            }

            const direct = check(start);
            if (direct) return { ok: true as const, ...direct };

            function descend(
              el: Element,
              depth: number,
              max: number,
            ): { type: string; source: string; options: Opt[] } | null {
              if (depth >= max) return null;
              for (const child of Array.from(el.children)) {
                const r = check(child);
                if (r) return { ...r, source: `child-depth-${depth + 1}` };
                const dd = descend(child, depth + 1, max);
                if (dd) return dd;
              }
              return null;
            }
            const deep = descend(start, 0, 4);
            if (deep) return { ok: true as const, ...deep };

            return {
              ok: false as const,
              error: `Element [${id}] (and 4 levels deep) does not look like a dropdown.`,
            };
          },
        });
        if (!result) return { ok: false, error: 'No result from page script' };
        return { ...result };
      },
    }),

    file_upload: tool({
      description:
        'Attaches files to an `<input type=file>` at `[N]`. Provide one of: `paths` (absolute local, preferred via CDP), `files` (inline `{name,type,base64}`), or `file_url` (SW fetches + uploads). Never click the input — the picker is invisible to the agent.',
      inputSchema: z
        .object({
          ref: z.string().describe('Element `[N]` index of the file input from `read_page`.'),
          paths: z
            .array(z.string())
            .optional()
            .describe('Absolute local paths (CDP-attached uploads). Preferred when available.'),
          files: z
            .array(
              z.object({
                name: z.string(),
                type: z.string(),
                base64: z.string(),
              }),
            )
            .optional()
            .describe('Inline file payloads (base64) for environments without local file access.'),
          file_url: z
            .string()
            .optional()
            .describe('Fetch this URL in the SW and upload the result as a single inline file.'),
          tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
        })
        .refine(v => !!v.paths?.length || !!v.files?.length || !!v.file_url, {
          message: 'Provide one of: paths, files, or file_url.',
        }),
      execute: async ({ ref, paths, files, file_url, tabId: requestedTabId }) => {
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        try {
          await gateOnHost(ctx, tabId, 'type', {
            reason: 'Upload a file',
            preview: paths?.[0] ?? files?.[0]?.name ?? file_url ?? '(inline)',
            toolName: 'file_upload',
          });
        } catch (err) {
          if (err instanceof PermissionDeniedError) return { ok: false, error: 'Denied by user' };
          throw err;
        }

        // ---- Path A: CDP DOM.setFileInputFiles (true filesystem upload) ----
        if (paths && paths.length > 0) {
          await ctx.cdp.attach(tabId);
          const marker = `data-de-upload-${Date.now()}`;
          const findArgs: [string, string] = [ref, marker];
          const [find] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            args: findArgs,
            func: (refId: string, m: string) => {
              const win = window as Window & { ___oadp?: { getElement: (id: number) => HTMLElement | null } };
              if (!win.___oadp?.getElement)
                return { ok: false as const, error: 'DOM walker not present. Call `read_page` first.' };
              const id = parseInt(refId, 10);
              const el = win.___oadp.getElement(id) as HTMLInputElement | null;
              if (!el) return { ok: false as const, error: `No element for ref [${id}].` };
              if (el.tagName !== 'INPUT' || el.type !== 'file') {
                return {
                  ok: false as const,
                  error: `Element [${id}] is <${el.tagName.toLowerCase()}${el.type ? ` type="${el.type}"` : ''}>, not a file input.`,
                };
              }
              el.setAttribute(m, '1');
              return { ok: true as const };
            },
          });
          const found = find?.result;
          if (!found?.ok) return { ok: false, error: found?.error ?? 'Failed to mark file input' };
          let objectId: string | undefined;
          try {
            const evalRes = (await ctx.cdp.send(tabId, 'Runtime.evaluate', {
              expression: `document.querySelector('[${marker}="1"]')`,
              returnByValue: false,
            })) as { result?: { objectId?: string }; exceptionDetails?: { text?: string } };
            if (evalRes.exceptionDetails)
              return { ok: false, error: evalRes.exceptionDetails.text ?? 'CDP resolve failed' };
            objectId = evalRes.result?.objectId;
            if (!objectId) return { ok: false, error: 'Failed to resolve element via CDP' };
            await ctx.cdp.send(tabId, 'DOM.enable');
            await ctx.cdp.send(tabId, 'DOM.setFileInputFiles', { files: paths, objectId });
            await ctx.cdp.send(tabId, 'DOM.disable').catch(() => undefined);
          } finally {
            // Best-effort cleanup of the marker.
            await chrome.scripting
              .executeScript({
                target: { tabId },
                world: 'MAIN',
                args: findArgs,
                func: (refId: string, m: string) => {
                  const win = window as Window & {
                    ___oadp?: { getElement: (id: number) => HTMLElement | null };
                  };
                  const el = win.___oadp?.getElement(parseInt(refId, 10));
                  if (el) el.removeAttribute(m);
                },
              })
              .catch(() => undefined);
          }
          const fileNames = paths.map(p => p.split(/[\\/]/).pop() || p);
          return {
            ok: true,
            output: `Uploaded ${paths.length} file(s) via CDP: ${fileNames.join(', ')}`,
          };
        }

        // ---- Path B: inline payload via DataTransfer ----
        let payloads: Array<{ name: string; type: string; base64: string }> = [];
        if (files && files.length > 0) {
          payloads = files;
        } else if (file_url) {
          const resp = await fetch(file_url);
          if (!resp.ok) return { ok: false, error: `Fetch failed: ${resp.status}` };
          const blob = await resp.blob();
          const base64 = await blobToBase64(blob);
          const name = file_url.split('/').pop()?.split('?')[0] || 'upload';
          payloads = [{ name, type: blob.type || 'application/octet-stream', base64 }];
        }
        if (payloads.length === 0) return { ok: false, error: 'No file payload to upload' };

        const inlineArgs: [string, Array<{ name: string; type: string; base64: string }>] = [ref, payloads];
        const [{ result } = { result: undefined }] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          args: inlineArgs,
          func: (refId: string, items: Array<{ name: string; type: string; base64: string }>) => {
            const win = window as Window & { ___oadp?: { getElement: (id: number) => HTMLElement | null } };
            if (!win.___oadp?.getElement)
              return { ok: false as const, error: 'DOM walker not present. Call `read_page` first.' };
            const id = parseInt(refId, 10);
            const el = win.___oadp.getElement(id) as HTMLInputElement | null;
            if (!el) return { ok: false as const, error: `No element for ref [${id}].` };
            if (el.tagName !== 'INPUT' || el.type !== 'file') {
              return {
                ok: false as const,
                error: `Element [${id}] is <${el.tagName.toLowerCase()}${el.type ? ` type="${el.type}"` : ''}>, not a file input.`,
              };
            }
            const dt = new DataTransfer();
            for (const p of items) {
              const bytes = atob(p.base64);
              const buf = new Uint8Array(bytes.length);
              for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
              const blob = new Blob([buf], { type: p.type });
              dt.items.add(new File([blob], p.name, { type: p.type }));
            }
            el.files = dt.files;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return {
              ok: true as const,
              output: `Uploaded ${items.length} inline file(s): ${items.map(i => i.name).join(', ')}`,
            };
          },
        });
        if (!result) return { ok: false, error: 'No result from page script' };
        return { ...result };
      },
    }),
  };
}
