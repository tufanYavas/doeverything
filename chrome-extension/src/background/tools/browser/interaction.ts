import { Selector } from '../../handlers/selector.js';
import { tool } from 'ai';
import { z } from 'zod';
import type { AgentToolContext } from '../context.js';

export function interactionTools(ctx: AgentToolContext) {
  return {
    select_region: tool({
      description:
        'Prompts the user to drag a rectangle on the active tab. Returns `region` in CSS pixels + `devicePixelRatio`. Use to clip extraction.',
      inputSchema: z.object({}),
      execute: async () => {
        const tabId = await ctx.getActiveTabId();
        try {
          const result = await Selector.requestRegion(tabId);
          if (result.cancelled) return { ok: false, error: 'Cancelled by user' };
          return { ok: true, region: result.rect, devicePixelRatio: result.devicePixelRatio ?? 1 };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),

    select_element: tool({
      description:
        'Prompts the user to click an element on the active tab. Returns `selector`, `text`, and bounding `rect`. Use only when the agent cannot identify the target from `read_page`.',
      inputSchema: z.object({}),
      execute: async () => {
        const tabId = await ctx.getActiveTabId();
        try {
          const result = await Selector.requestElement(tabId);
          if (result.cancelled) return { ok: false, error: 'Cancelled by user' };
          return { ok: true, selector: result.selector, rect: result.rect, text: result.text };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}
