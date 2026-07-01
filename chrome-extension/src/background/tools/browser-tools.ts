/**
 * doeverything browser tool roster.
 *
 * Every tool is a Vercel AI SDK `tool()` instance with a Zod schema. Tools
 * close over an `AgentToolContext` so they can resolve the active tab,
 * abort signal, CDP controller, and tab-group manager.
 *
 * This file is a thin orchestrator: it merges the per-category modules
 * under `./browser/*` and applies the timeout / lifecycle / truncate
 * wrapper from `./internal/tool-wrapper`. To add or modify a tool, edit
 * the relevant category module — not this file.
 *
 * Categories:
 *   navigation:  ./browser/navigation   — navigate, tabs_context, tabs_create, resize_window
 *   pointer:     ./browser/pointer      — computer, scroll
 *   input:       ./browser/input        — input, select_dropdown, dropdown_options, file_upload
 *   discovery:   ./browser/discovery    — find, find_elements, read_page
 *   capture:     ./browser/capture      — gif_creator, upload_image
 *   runtime:     ./browser/runtime      — run_js, read_console_messages,
 *                                          read_network_requests, inspect_network_request,
 *                                          replay_network_request
 *   interaction: ./browser/interaction  — select_region, select_element
 *   memory:      ./browser/memory       — memory_set, memory_append, memory_get (the SINGLE
 *                                          inspection surface — describe / path / paging),
 *                                          memory_count, memory_clear
 *   meta:        ./browser/meta         — skill, done
 *   batch:       ./browser/batch        — multi_action (executes an ordered list of
 *                                          {name, input} sub-calls in one round-trip)
 */

import { multiActionTool } from './browser/batch.js';
import { captureTools } from './browser/capture.js';
import { discoveryTools } from './browser/discovery.js';
import { inputTools } from './browser/input.js';
import { interactionTools } from './browser/interaction.js';
import { memoryTools } from './browser/memory.js';
import { metaTools } from './browser/meta.js';
import { navigationTools } from './browser/navigation.js';
import { pointerTools } from './browser/pointer.js';
import { runtimeTools } from './browser/runtime.js';
import { wrapToolRoster } from './internal/tool-wrapper.js';
import type { AgentToolContext } from './context.js';

export function createBrowserTools(ctx: AgentToolContext) {
  // `multi_action` needs to dispatch to the OTHER tools' wrapped
  // executes, but those executes are mutated in place by
  // `wrapToolRoster` AFTER the roster is assembled. Resolve the
  // chicken-and-egg with a ref that the batch tool reads lazily on each
  // call — by the time the model invokes `multi_action`, the roster has
  // been wrapped and the ref points at the same object.
  const rosterRef: { current: Record<string, unknown> | null } = { current: null };

  const roster = {
    ...navigationTools(ctx),
    ...pointerTools(ctx),
    ...inputTools(ctx),
    ...discoveryTools(ctx),
    ...captureTools(ctx),
    ...runtimeTools(ctx),
    ...interactionTools(ctx),
    ...memoryTools(ctx),
    ...metaTools(ctx),
    ...multiActionTool(ctx, rosterRef),
  };

  wrapToolRoster(roster, ctx);
  rosterRef.current = roster;

  return roster;
}

export type DoeTool = keyof ReturnType<typeof createBrowserTools>;
