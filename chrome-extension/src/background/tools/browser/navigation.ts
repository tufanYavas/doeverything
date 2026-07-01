import { PermissionManager, PermissionDeniedError } from '../../permissions/manager.js';
import { isSkillAllowedTool } from '../../skills/runtime-overrides.js';
import { isBlockedUrl } from '../../tabs/blocked-url-checker.js';
import { TabEventHub } from '../../tabs/event-hub.js';
import { captureFrameIfRecording } from '../internal/gif-store.js';
import { buildTabContext } from '../internal/helpers.js';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';

export function navigationTools(ctx: AgentToolContext) {
  return {
    navigate: tool({
      description:
        'Navigates a tab to a URL, or `back` / `forward` for history. Auto-prepends `https://`. `force: true` discards a `beforeunload` "Leave site?" dialog.',
      inputSchema: z.object({
        url: z
          .string()
          .describe(
            'The URL to navigate to. Can be provided with or without protocol (defaults to https://). Use "forward" to go forward in history or "back" to go back in history.',
          ),
        tabId: z
          .number()
          .optional()
          .describe(
            "Tab ID to navigate. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
          ),
        force: z
          .boolean()
          .optional()
          .describe(
            'If the page shows a "Leave site?" dialog because of unsaved changes, discard those changes and navigate anyway. Defaults to false: navigation is blocked and an error is returned so you can decide first.',
          ),
      }),
      execute: async ({ url, tabId: requestedTabId, force }) => {
        if (!url) return { error: 'URL parameter is required' };
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        const tab = await chrome.tabs.get(tabId);
        if (!tab.id) return { error: 'Active tab has no ID' };

        // Set the dialog policy so a `beforeunload` prompt is auto-resolved
        // according to `force`. We attach the debugger lazily via `ctx.cdp.send`.
        try {
          ctx.cdp.setDialogPolicy(tabId, force ? 'accept' : 'dismiss');
        } catch {
          /* non-fatal */
        }

        // Back / forward branches
        const lower = url.toLowerCase();
        if (lower === 'back') {
          try {
            // Register the waiter BEFORE calling goBack to avoid missing the event.
            // waitForLoad handles both full-page reloads (status→'complete') and
            // SPA history pops (webNavigation.onHistoryStateUpdated + settle).
            const waiter = TabEventHub.waitForLoad(tabId, { timeoutMs: 10_000 });
            await chrome.tabs.goBack(tabId);
            const updated = await waiter;
            await captureFrameIfRecording(ctx, tabId, 'navigate');
            return {
              output: `Navigated back to ${updated.url}`,
              tabContext: await buildTabContext(ctx, updated.id ?? tabId),
            };
          } catch (err) {
            return { error: `Failed to go back: ${err instanceof Error ? err.message : String(err)}` };
          }
        }
        if (lower === 'forward') {
          try {
            const waiter = TabEventHub.waitForLoad(tabId, { timeoutMs: 10_000 });
            await chrome.tabs.goForward(tabId);
            const updated = await waiter;
            await captureFrameIfRecording(ctx, tabId, 'navigate');
            return {
              output: `Navigated forward to ${updated.url}`,
              tabContext: await buildTabContext(ctx, updated.id ?? tabId),
            };
          } catch (err) {
            return { error: `Failed to go forward: ${err instanceof Error ? err.message : String(err)}` };
          }
        }

        // URL navigation
        let target = url;
        if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
        try {
          new URL(target);
        } catch {
          return { error: `Invalid URL: ${url}` };
        }

        const blocked = await isBlockedUrl(target);
        if (blocked.blocked) return { error: `Blocked: ${blocked.reason}` };

        try {
          // MCP sessions have no permission UI — the user opted in to MCP
          // explicitly, so per-navigation prompts are skipped. For the
          // interactive agent, honour skill-granted bypasses and stored grants.
          if (!ctx.isMcpSession && !(await isSkillAllowedTool(ctx.conversationId, 'navigate'))) {
            const host = PermissionManager.hostFromUrl(target);
            await PermissionManager.ensure(host, 'navigate', { reason: 'Open a new URL', preview: target });
          }
        } catch (err) {
          if (err instanceof PermissionDeniedError) return { error: 'Denied by user' };
          throw err;
        }

        try {
          // Snapshot the current URL before asking Chrome to navigate.
          // Used in phase 1 to detect that navigation actually started.
          const beforeTab = await chrome.tabs.get(tabId);
          const urlBeforeNav = beforeTab.url ?? '';

          await chrome.tabs.update(tabId, { url: target });

          // Two-phase poll — each chrome.tabs.get is a pending Chrome API callback
          // that prevents the MV3 service worker from going dormant mid-wait.
          //
          // Phase 1 (≤3 s): wait for the tab to LEAVE the old page. Without this,
          // the immediately-following poll would see `status=complete` on the OLD
          // page and return prematurely (critical for both SPA pushState navigations
          // and slow-starting full-page navigations).
          //   • Full nav: Chrome sets status→'loading' within ~100 ms of update().
          //   • SPA:      status stays 'complete' but the URL changes immediately.
          const phase1Deadline = Date.now() + 3_000;
          while (Date.now() < phase1Deadline) {
            const cur = await chrome.tabs.get(tabId);
            const urlChanged = cur.url !== undefined && cur.url !== urlBeforeNav;
            if (cur.status === 'loading' || urlChanged) break;
            await new Promise<void>(r => setTimeout(r, 100));
          }

          // Phase 2 (≤15 s): wait for the new page to reach 'complete'.
          const deadline = Date.now() + 15_000;
          let loaded: chrome.tabs.Tab | null = null;
          while (Date.now() < deadline) {
            const current = await chrome.tabs.get(tabId);
            if (current.status === 'complete' && current.url?.startsWith('http')) {
              loaded = current;
              break;
            }
            if (Date.now() < deadline) {
              await new Promise<void>(r => setTimeout(r, 250));
            }
          }
          if (!loaded) throw new Error(`tab ${tabId} load timed out after 15 s`);
          const updated = loaded;

          ctx.setActiveTabId(updated.id ?? tabId);
          await captureFrameIfRecording(ctx, updated.id ?? tabId, 'navigate');
          return {
            output: `Navigated to ${updated.url ?? target}`,
            tabContext: await buildTabContext(ctx, updated.id ?? tabId),
          };
        } catch (err) {
          return { error: `Navigation failed: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    }),

    tabs_context: tool({
      description:
        'Force-refreshes the doeverything tab inventory (`currentTabId`, `availableTabs`, `tabCount`). The per-turn `<available_tabs>` block usually suffices — call only after popups, redirects, or rapid navigations.',
      inputSchema: z.object({}),
      execute: async () => {
        const tabs = await ctx.listGroupTabs();
        const current = tabs.find(t => t.active)?.id ?? tabs[0]?.id;
        return {
          currentTabId: current,
          availableTabs: tabs.map(t => ({ tabId: t.id, title: t.title, url: t.url })),
          tabCount: tabs.length,
        };
      },
    }),

    tabs_create: tool({
      description:
        'Opens a new blank tab in the doeverything group (background, not focused). Pair with `navigate` to load a URL.',
      inputSchema: z.object({}),
      execute: async () => {
        const newTab = await chrome.tabs.create({ url: 'chrome://newtab', active: false });
        if (!newTab.id) return { error: 'Failed to create tab — no tab ID returned' };
        ctx.setActiveTabId(newTab.id);
        await ctx.groups.adoptTab(newTab.id);
        return {
          output: `Created new tab. Tab ID: ${newTab.id}`,
          tabContext: await buildTabContext(ctx, newTab.id),
        };
      },
    }),

    resize_window: tool({
      description:
        'Resizes the browser window owning a tab to width × height pixels (max 7680 × 4320).',
      inputSchema: z.object({
        width: z.number().describe('Target window width in pixels'),
        height: z.number().describe('Target window height in pixels'),
        tabId: z
          .number()
          .optional()
          .describe(
            "Tab ID to get the window for. Must be a tab in the current group. Use tabs_context first if you don't have a valid tab ID.",
          ),
      }),
      execute: async ({ width, height, tabId: requestedTabId }) => {
        if (!width || !height) return { error: 'Both width and height parameters are required' };
        if (typeof width !== 'number' || typeof height !== 'number')
          return { error: 'Width and height must be numbers' };
        if (width <= 0 || height <= 0) return { error: 'Width and height must be positive numbers' };
        if (width > 7680 || height > 4320)
          return { error: 'Dimensions exceed 8K resolution limit. Maximum dimensions are 7680x4320' };
        const tabId = await ctx.getEffectiveTabId(requestedTabId);
        const tab = await chrome.tabs.get(tabId);
        if (!tab.windowId) return { error: 'Tab does not have an associated window' };
        await chrome.windows.update(tab.windowId, {
          width: Math.floor(width),
          height: Math.floor(height),
        });
        return {
          output: `Successfully resized window containing tab ${tabId} to ${Math.floor(width)}x${Math.floor(height)} pixels`,
        };
      },
    }),
  };
}
