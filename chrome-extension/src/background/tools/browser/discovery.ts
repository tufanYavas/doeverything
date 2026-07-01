import { resolveFastModel } from '../internal/helpers.js';
import { generateText, tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';

export function discoveryTools(ctx: AgentToolContext) {
  return {
    find: tool({
      description:
        "Locates elements by natural-language description (e.g. `'login button'`, `'price next to organic milk'`, `'language picker in footer'`). Reads the latest `read_page` snapshot via a secondary LLM and returns up to 20 ranked `[N]` refs. USE when the element is identified by meaning/relation rather than tag/class, or the snapshot is too large to scan. SKIP when it's already obvious in `read_page` or you have a stable CSS selector — `find_elements` is faster.",
      inputSchema: z.object({
        query: z
          .string()
          .describe(
            'Natural language description of what to find (e.g., "search bar", "add to cart button", "product title containing organic")',
          ),
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
      }),
      execute: async ({ query, tabId: requestedTabId }) => {
        if (!query) return { error: 'Query parameter is required' };
        const tabId = await ctx.getEffectiveTabId(requestedTabId);

        // Pull the rich browserState so the LLM has [N]-indexed context.
        const [{ result } = { result: undefined }] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: () => {
            const win = window as Window & {
              ___oadp?: {
                getDOMState: (prev: unknown, opts: { viewportExpansion: number | null }) => { browserState: string };
              };
            };
            if (typeof win.___oadp?.getDOMState !== 'function') {
              return { error: 'DOM walker not present. Please refresh the page.' };
            }
            const r = win.___oadp.getDOMState(null, { viewportExpansion: null });
            return { pageContent: r.browserState };
          },
        });
        if (!result) return { error: 'No result from page script' };
        const r = result as { pageContent?: string; error?: string };
        if (r.error) return { error: r.error };
        if (!r.pageContent) return { error: 'Empty page content' };

        // Ask the configured LLM to pick matching [N] indices.
        let model;
        try {
          model = await resolveFastModel();
        } catch (err) {
          return { error: `LLM not configured: ${err instanceof Error ? err.message : String(err)}` };
        }
        let llmText: string;
        try {
          const out = await generateText({
            model,
            messages: [
              {
                role: 'user',
                content: `You are helping find elements on a web page. The user wants to find: "${query}"\n\nHere is the DOM state of the page. Interactive elements are marked with [N] indices:\n${r.pageContent}\n\nFind ALL elements that match the user's query. Return up to 20 most relevant matches, ordered by relevance.\n\nReturn your findings in this exact format (one line per matching element):\n\nFOUND: <total_number_of_matching_elements>\nSHOWING: <number_shown_up_to_20>\n---\n[N] | tag | description | reason why this matches\n[N] | tag | description | reason why this matches\n...\n\nWhere [N] is the element's index number from the DOM state.\n\nIf there are more than 20 matches, add this line at the end:\nMORE: Use a more specific query to see additional results\n\nIf no matching elements are found, return only:\nFOUND: 0\nERROR: explanation of why no elements were found`,
              },
            ],
          });
          llmText = out.text;
        } catch (err) {
          return { error: `Find LLM call failed: ${err instanceof Error ? err.message : String(err)}` };
        }

        const lines = llmText
          .trim()
          .split('\n')
          .map(l => l.trim())
          .filter(l => l);
        let totalFound = 0;
        let errorMsg: string | undefined;
        let hasMore = false;
        const matches: Array<{ index: string; tag: string; description: string; reason?: string }> = [];
        for (const line of lines) {
          if (line.startsWith('FOUND:')) totalFound = parseInt(line.split(':')[1].trim()) || 0;
          else if (line.startsWith('SHOWING:')) {
            /* skip */
          } else if (line.startsWith('ERROR:')) errorMsg = line.substring(6).trim();
          else if (line.startsWith('MORE:')) hasMore = true;
          else if (line.includes('|') && /^\[?\d+\]?\s*\|/.test(line)) {
            const parts = line.split('|').map(p => p.trim());
            if (parts.length >= 3) {
              matches.push({
                index: parts[0].replace(/[[\]]/g, '').trim(),
                tag: parts[1],
                description: parts[2],
                reason: parts[3] || undefined,
              });
            }
          }
        }
        if (totalFound === 0 || matches.length === 0) {
          return { error: errorMsg ?? 'No matching elements found' };
        }
        let summary = `Found ${totalFound} matching element${totalFound === 1 ? '' : 's'}`;
        if (hasMore) summary += ` (showing first ${matches.length}, use a more specific query to narrow results)`;
        const matchList = matches
          .map(
            m =>
              `- [${m.index}] <${m.tag}>${m.description ? ` "${m.description}"` : ''}${m.reason ? ` - ${m.reason}` : ''}`,
          )
          .join('\n');
        return {
          output: `${summary}\n\n${matchList}`,
        };
      },
    }),

    find_elements: tool({
      description:
        'Queries elements by CSS selector. Returns each match\'s `tag`, `text` (when `include_text` is on), the requested `attrs`, and `children_count`. Oversized lists auto-bucket — read back with `memory_get`.',
      inputSchema: z.object({
        selector: z
          .string()
          .describe('CSS selector to query elements (e.g. "table tr", "a.link", "div.product", "select option").'),
        attributes: z
          .array(z.string())
          .optional()
          .describe('Specific attributes to extract (e.g. ["href", "src", "class"]).'),
        include_text: z.boolean().optional().describe('Include text content of each element. Default: true.'),
        tabId: z.number().optional().describe('Tab in the doeverything group. Defaults to the active tab.'),
      }),
      execute: async ({ selector, attributes, include_text, tabId: requestedTabId }) => {
        if (!selector) return { error: 'selector parameter is required' };
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        const inclText = include_text !== false;
        const attrs = Array.isArray(attributes) ? attributes : null;
        const args: [string, string[] | null, boolean] = [selector, attrs, inclText];
        const [{ result } = { result: undefined }] = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          args,
          func: (sel: string, attrList: string[] | null, inc: boolean) => {
            try {
              let elements: NodeListOf<Element>;
              try {
                elements = document.querySelectorAll(sel);
              } catch (e) {
                return {
                  error: `Invalid CSS selector: ${e instanceof Error ? e.message : String(e)}`,
                  elements: [],
                  total: 0,
                };
              }
              const total = elements.length;
              const items: Array<{
                index: number;
                tag: string;
                text?: string;
                attrs?: Record<string, string>;
                children_count: number;
              }> = [];
              for (let i = 0; i < total; i++) {
                const el = elements[i] as HTMLElement;
                const item: (typeof items)[number] = {
                  index: i,
                  tag: el.tagName.toLowerCase(),
                  children_count: el.children.length,
                };
                if (inc) {
                  item.text = (el.textContent ?? '').trim();
                }
                if (attrList && attrList.length > 0) {
                  const attrObj: Record<string, string> = {};
                  for (const a of attrList) {
                    let val: string | null;
                    if (
                      (a === 'src' || a === 'href') &&
                      typeof (el as unknown as Record<string, unknown>)[a] === 'string'
                    ) {
                      val = (el as unknown as Record<string, string>)[a] || null;
                    } else {
                      val = el.getAttribute(a);
                    }
                    if (val !== null) attrObj[a] = val;
                  }
                  if (Object.keys(attrObj).length > 0) item.attrs = attrObj;
                }
                items.push(item);
              }
              return { elements: items, total };
            } catch (err) {
              return {
                error: `find_elements error: ${err instanceof Error ? err.message : String(err)}`,
                elements: [],
                total: 0,
              };
            }
          },
        });
        if (!result) return { error: 'Failed to execute find_elements' };
        return { ...result };
      },
    }),

    read_page: tool({
      description:
        'Snapshots the page DOM as `[N]`-indexed interactive elements + structure — the input every browser tool uses for refs. `viewport_expansion`: `1000` (default px), `0` = visible only, `-1` = full page. Re-call after navigation. Refuses on `chrome://` / `chrome-extension://` / `about:blank`. Oversized snapshots auto-bucket. Use `only_text: true` to get page content as clean Markdown instead (no element refs, useful for reading articles/docs).',
      inputSchema: z.object({
        tabId: z
          .number()
          .optional()
          .describe("Tab id to read. Must be a member of the doeverything group. Defaults to the agent's active tab."),
        viewport_expansion: z
          .number()
          .optional()
          .describe(
            'Pixels beyond the visible viewport to include elements from (default 1000). 0 = visible only, -1 = full page.',
          ),
        only_text: z
          .boolean()
          .optional()
          .describe(
            'Return the full page as clean Markdown (headings, lists, links, bold, code blocks) instead of the interactive `[N]` element snapshot. Ignores `viewport_expansion`. Best for reading articles, documentation, or any content-heavy page.',
          ),
      }),
      execute: async ({ tabId, viewport_expansion, only_text }) => {
        const effectiveTabId = await ctx.getEffectiveTabId(tabId);
        const tab = await chrome.tabs.get(effectiveTabId);
        if (!tab.url) return { error: 'Active tab has no URL' };
        if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url === 'about:blank') {
          return {
            error: `Cannot read DOM on restricted URL "${tab.url}". Navigate to an http(s) page first.`,
          };
        }

        if (only_text) {
          // Convert the page DOM to Markdown entirely inside the MAIN world so that
          // `document` and DOM APIs are available. The MV3 Service Worker context has
          // neither `document` nor `window`, making any SW-side HTML parser fail.
          const [{ result: markdown } = { result: undefined }] = await chrome.scripting.executeScript({
            target: { tabId: effectiveTabId },
            world: 'MAIN',
            func: (): string | null => {
              // ── Noise removal ──────────────────────────────────────────────
              const NOISE = new Set(['script', 'style', 'noscript', 'iframe', 'template', 'svg', 'canvas', 'head']);
              const clone = document.body.cloneNode(true) as HTMLElement;
              NOISE.forEach(tag => clone.querySelectorAll(tag).forEach(el => el.remove()));
              // Strip elements hidden via inline style
              clone.querySelectorAll<HTMLElement>('[style]').forEach(el => {
                const s = el.style;
                if (s.display === 'none' || s.visibility === 'hidden') el.remove();
              });

              // ── Helpers ────────────────────────────────────────────────────
              function normText(t: string): string {
                return t.replace(/[\t\r\n]+/g, ' ');
              }

              // ── Core walker ────────────────────────────────────────────────
              // listDepth: tracks nesting for indentation; inPre: suppress whitespace normalisation
              function walk(node: ChildNode, listDepth = 0, inPre = false): string {
                // TEXT_NODE = 3
                if (node.nodeType === 3) {
                  const t = node.textContent ?? '';
                  return inPre ? t : normText(t);
                }
                // Skip non-element nodes (comments, CDATA …)
                if (node.nodeType !== 1) return '';

                const el = node as HTMLElement;
                const tag = el.tagName.toLowerCase();
                if (NOISE.has(tag)) return '';

                // aria-hidden or hidden attribute → skip entirely
                if (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('hidden')) return '';

                const kids = (d = listDepth, pre = inPre) =>
                  Array.from(el.childNodes).map(n => walk(n, d, pre)).join('');

                // ── Headings ───────────────────────────────────────────────
                const hm = tag.match(/^h([1-6])$/);
                if (hm) {
                  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
                  return text ? `\n${'#'.repeat(Number(hm[1]))} ${text}\n\n` : '';
                }

                switch (tag) {
                  // ── Inline formatting ────────────────────────────────────
                  case 'br':   return '\n';
                  case 'hr':   return '\n\n---\n\n';

                  case 'strong': case 'b': {
                    const t = kids().trim();
                    return t ? `**${t}**` : '';
                  }
                  case 'em': case 'i': {
                    const t = kids().trim();
                    return t ? `*${t}*` : '';
                  }
                  case 's': case 'del': case 'strike': {
                    const t = kids().trim();
                    return t ? `~~${t}~~` : '';
                  }

                  // ── Code ────────────────────────────────────────────────
                  case 'code': {
                    const raw = el.textContent ?? '';
                    if (!raw) return '';
                    // Inside a <pre> the pre-handler uses textContent directly;
                    // this branch is only reached for inline <code>.
                    const fence = raw.includes('`') ? '`` ' : '`';
                    const tail  = raw.includes('`') ? ' ``' : '`';
                    return `${fence}${raw}${tail}`;
                  }
                  case 'pre': {
                    // Use textContent so nested markup doesn't pollute the block.
                    const codeEl = el.querySelector('code');
                    const lang   = (codeEl?.className.match(/language-(\S+)/) ?? [])[1] ?? '';
                    const raw    = (codeEl ?? el).textContent ?? '';
                    return `\n\`\`\`${lang}\n${raw.replace(/\n$/, '')}\n\`\`\`\n\n`;
                  }

                  // ── Block elements ───────────────────────────────────────
                  case 'p': {
                    const t = kids().trim();
                    return t ? `${t}\n\n` : '';
                  }
                  case 'blockquote': {
                    const inner = kids().trim();
                    if (!inner) return '';
                    return '\n' + inner.split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
                  }

                  // ── Links & media ────────────────────────────────────────
                  case 'a': {
                    const href = (el as HTMLAnchorElement).href ?? '';
                    const text = kids().trim();
                    if (!text) return '';
                    if (!href || href.startsWith('javascript') || href === text) return text;
                    return `[${text}](${href})`;
                  }
                  case 'img': {
                    const img = el as HTMLImageElement;
                    if (!img.src || img.src.startsWith('data:')) return (img.alt || '').trim() ? `(${img.alt.trim()})` : '';
                    const alt = (img.alt || img.getAttribute('aria-label') || '').trim();
                    return `![${alt}](${img.src})`;
                  }

                  // ── Lists ────────────────────────────────────────────────
                  case 'ul': case 'ol': {
                    const ordered = tag === 'ol';
                    const indent  = '  '.repeat(listDepth);
                    let   counter = ordered ? (parseInt(el.getAttribute('start') ?? '1') || 1) : 0;
                    const items: string[] = [];

                    for (const child of Array.from(el.children)) {
                      if (child.tagName.toLowerCase() !== 'li') continue;
                      const bullet = ordered ? `${counter++}.` : '-';

                      // Separate direct text / inline nodes from nested lists
                      let inlineParts = '';
                      const nestedParts: string[] = [];
                      for (const n of Array.from(child.childNodes)) {
                        const nt = (n as Element).tagName?.toLowerCase();
                        if (nt === 'ul' || nt === 'ol') {
                          nestedParts.push(walk(n, listDepth + 1));
                        } else {
                          inlineParts += walk(n, listDepth + 1);
                        }
                      }
                      const inlineText  = inlineParts.replace(/\n+/g, ' ').trim();
                      const nestedBlock = nestedParts.join('').trimEnd();

                      items.push(nestedBlock
                        ? `${indent}${bullet} ${inlineText}\n${nestedBlock}`
                        : `${indent}${bullet} ${inlineText}`);
                    }
                    return items.length ? '\n' + items.join('\n') + '\n\n' : '';
                  }
                  // li is handled inside ul/ol; bare li (malformed HTML) → recurse
                  case 'li': return kids();

                  // ── Definition lists ─────────────────────────────────────
                  case 'dl': return '\n' + kids() + '\n';
                  case 'dt': return `\n**${(el.textContent ?? '').trim()}**\n`;
                  case 'dd': return `:   ${kids().trim()}\n`;

                  // ── Tables ───────────────────────────────────────────────
                  case 'table': {
                    const rows = Array.from(el.querySelectorAll('tr'));
                    if (!rows.length) return '';

                    const getCells = (row: Element): string[] =>
                      Array.from(row.querySelectorAll(':scope > th, :scope > td'))
                        .map(c => (c.textContent?.trim() ?? '').replace(/\|/g, '\\|'));

                    const widths = Math.max(...rows.map(r => getCells(r).length), 1);
                    const padRow = (cs: string[]) => {
                      const p = [...cs];
                      while (p.length < widths) p.push('');
                      return '| ' + p.join(' | ') + ' |';
                    };
                    const sep = '| ' + Array.from({ length: widths }, () => '---').join(' | ') + ' |';
                    const lines = [padRow(getCells(rows[0])), sep, ...rows.slice(1).map(r => padRow(getCells(r)))];
                    return '\n' + lines.join('\n') + '\n\n';
                  }

                  // ── Semantic / figure ────────────────────────────────────
                  case 'figure':      return kids() + '\n';
                  case 'figcaption': {
                    const t = kids().trim();
                    return t ? `*${t}*\n` : '';
                  }
                  case 'details': return kids() + '\n';
                  case 'summary': {
                    const t = kids().trim();
                    return t ? `**${t}**\n` : '';
                  }

                  // ── Abbreviations / time ─────────────────────────────────
                  case 'abbr': {
                    const title = el.getAttribute('title');
                    const t = kids().trim();
                    return title ? `${t} (${title})` : t;
                  }
                  case 'time': {
                    const dt = el.getAttribute('datetime');
                    const t  = kids().trim();
                    return dt && dt !== t ? `${t} [${dt}]` : t;
                  }

                  // ── Block containers: recurse, ensure text isn't lost ────
                  case 'div': case 'section': case 'article': case 'main':
                  case 'header': case 'footer': case 'nav': case 'aside':
                  case 'form': case 'fieldset': case 'address': {
                    return kids();
                  }

                  // ── Pure inline containers ───────────────────────────────
                  default: return kids();
                }
              }

              const md = Array.from(clone.childNodes).map(n => walk(n)).join('');
              // Collapse 3+ newlines → 2, strip trailing whitespace on each line, trim
              return md
                .replace(/[ \t]+\n/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            },
          });

          if (typeof markdown !== 'string') {
            return { error: 'Text extraction failed (no result from page script — page may still be loading).' };
          }

          return `URL: ${tab.url}\nTitle: ${tab.title ?? ''}\n\n${markdown}`;
        }

        const vExpansion = viewport_expansion ?? 1000;

        const [{ result } = { result: undefined }] = await chrome.scripting.executeScript({
          target: { tabId: effectiveTabId },
          world: 'MAIN',
          args: [vExpansion],
          func: (vExp: number) => {
            const win = window as Window & {
              ___oadp?: {
                getDOMState: (
                  prev: unknown,
                  opts: { viewportExpansion: number | null },
                ) => {
                  browserState: string;
                };
              };
            };
            if (!win.___oadp || typeof win.___oadp.getDOMState !== 'function') {
              return {
                __injection_error:
                  'doeverything DOM walker not present. Reload the page (or wait for it to finish loading) and try again.',
              };
            }
            try {
              const opts = { viewportExpansion: vExp === -1 ? null : vExp };
              const fullResult = win.___oadp.getDOMState(null, opts);
              const fullContent = fullResult.browserState ?? '';
              // Compute scroll/page geometry the same way packages/dom-processor's
              // getCurrentPageInfo does — copied inline because the helper is not
              // injected into the page (content script only has the DOM walker).
              const docEl = document.documentElement;
              const body = document.body;
              const pageHeight = Math.max(
                body?.scrollHeight ?? 0,
                body?.offsetHeight ?? 0,
                docEl.clientHeight,
                docEl.scrollHeight,
                docEl.offsetHeight,
              );
              const pageWidth = Math.max(
                body?.scrollWidth ?? 0,
                body?.offsetWidth ?? 0,
                docEl.clientWidth,
                docEl.scrollWidth,
                docEl.offsetWidth,
              );
              const pixelsAbove = window.scrollY;
              const pixelsBelow = Math.max(0, pageHeight - window.scrollY - window.innerHeight);
              const pixelsLeft = window.scrollX;
              const pixelsRight = Math.max(0, pageWidth - window.innerWidth - window.scrollX);
              return {
                pageContent: fullContent,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                page: { width: pageWidth, height: pageHeight },
                pixelsAbove,
                pixelsBelow,
                pixelsLeft,
                pixelsRight,
                url: location.href,
                title: document.title,
              };
            } catch (err) {
              return {
                __injection_error: `DOM walker crashed: ${err instanceof Error ? err.message : String(err)}`,
              };
            }
          },
        });

        if (!result) {
          return { error: 'No result returned from page script (Chrome blocked execution).' };
        }
        const r = result as {
          __injection_error?: string;
          pageContent?: string;
          viewport?: { width: number; height: number };
          page?: { width: number; height: number };
          pixelsAbove?: number;
          pixelsBelow?: number;
          pixelsLeft?: number;
          pixelsRight?: number;
          url?: string;
          title?: string;
        };
        if (r.__injection_error) return { error: r.__injection_error };

        // Normalise scroll position to "pages" (viewport-heights) — much
        // easier for the model to reason about than raw pixel counts.
        const vh = r.viewport?.height ?? 0;
        const pagesAbove = vh > 0 ? (r.pixelsAbove ?? 0) / vh : 0;
        const pagesBelow = vh > 0 ? (r.pixelsBelow ?? 0) / vh : 0;
        const scrollLine = vh > 0 ? `${pagesAbove.toFixed(1)} pages above, ${pagesBelow.toFixed(1)} pages below` : '';

        // Scope line: stays compact. Tail hint only fires when there is
        // actually meaningful content out of frame (>0.2 viewport-heights
        // either way) AND we're in a clipped mode. Full-page (`-1`) walks
        // everything, so the hint would be misleading there.
        const significantOutside = vExpansion !== -1 && (pagesAbove > 0.2 || pagesBelow > 0.2);
        const tailHint = significantOutside
          ? ' — scroll & re-call `read_page` for the other pages'
          : '';
        const scopeLine =
          vExpansion === -1
            ? 'Snapshot scope: full page'
            : vExpansion === 0
              ? `Snapshot scope: visible viewport only${tailHint}`
              : `Snapshot scope: viewport + ${vExpansion} px${tailHint}`;

        const footer = [scopeLine, scrollLine, `Viewport: ${r.viewport?.width ?? 0}x${vh}`]
          .filter(Boolean)
          .join('\n');

        const header = [`URL: ${r.url ?? ''}`, `Title: ${r.title ?? ''}`].join('\n');
        return `${header}\n\n${r.pageContent ?? ''}\n\n${footer}`;
      },
    }),
  };
}
