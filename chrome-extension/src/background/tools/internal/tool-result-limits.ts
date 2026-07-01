/**
 * Per-tool `maxResultSizeChars` declarations. Vercel AI SDK's `tool({...})`
 * doesn't expose a metadata slot for this, so we keep the declarations in a
 * sibling map looked up by tool name.
 *
 * Cap mapping (doeverything tool → analogous pattern):
 *   memory_get               ↔ FileReadTool.ts:342  (Infinity, opt-out)
 *   skill                    ↔ (no analogue)        (Infinity, body is the prompt)
 *   done                     ↔ (no analogue)        (Infinity, runner reads isDone)
 *   run_js                   ↔ BashTool.tsx:424     (30K)
 *   read_page                ↔ (no analogue)        (30K — DOM dump like Bash output)
 *   find_elements            ↔ GrepTool.ts:164      (20K)
 *   find                     ↔ GrepTool.ts:164      (20K)
 *   read_console_messages    ↔ BashTool.tsx:424     (30K — log dump)
 *   read_network_requests    ↔ GrepTool.ts:164      (20K — list)
 *   inspect_network_request  ↔ WebFetchTool.ts:70   (100K — single response body)
 *   replay_network_request   ↔ WebFetchTool.ts:70   (100K)
 *   tabs_context             ↔ (default, 50K — falls through to DEFAULT)
 *   dropdown_options         ↔ GrepTool.ts:164      (20K — list)
 *   gif_creator              ↔ (default, small confirmations)
 *   upload_image             ↔ (default)
 *   computer / scroll / input / file_upload / select_dropdown / select_element / select_region / navigate / tabs_create / resize_window
 *                            ↔ (default, all small confirmations)
 *   memory_set / memory_append / memory_count / memory_clear
 *                            ↔ (default — they always return small payloads anyway)
 *
 * The default for unlisted tools is `DEFAULT_MAX_RESULT_SIZE_CHARS`
 * (50_000) inherited from the compressor.
 */

import { DEFAULT_MAX_RESULT_SIZE_CHARS } from './result-compressor.js';

const PER_TOOL_MAX: Record<string, number> = {
  // Opt-outs — must NEVER be wrapped:
  //   memory_get → reading from a bucket should not produce a new bucket
  //                handle (recursive); must use `Infinity` to opt out.
  //   skill      → tool result IS the prompt for the next step; wrapping
  //                breaks invocation.
  //   done       → runner inspects `isDone`/`doneText` on the result;
  //                wrapping replaces the structure with a string envelope.
  memory_get: Infinity,
  skill: Infinity,
  done: Infinity,

  // Bash-style (~30K head+tail style outputs)
  run_js: 30_000,
  read_page: 30_000,
  read_console_messages: 30_000,

  // Grep-style (lists / structured matches)
  find: 20_000,
  find_elements: 20_000,
  read_network_requests: 20_000,
  dropdown_options: 20_000,

  // WebFetch-style (single big payload, body-of-an-API-response-shaped)
  inspect_network_request: 50_000,
  replay_network_request: 50_000,

};

export function getMaxResultSizeChars(toolName: string): number {
  if (toolName in PER_TOOL_MAX) return PER_TOOL_MAX[toolName]!;
  return DEFAULT_MAX_RESULT_SIZE_CHARS;
}
