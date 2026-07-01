/**
 * Strongly-typed message contracts between doeverything components.
 *
 * Every message has a `type` discriminator. Senders use the helpers in
 * `client.ts`; the service worker dispatches via the router (`router.ts`).
 *
 * Phase 1 only defines the envelopes for messages we actually need now. The
 * `tool-call`, `permission-request`, `oauth-redirect`, and `mcp-*` families
 * will be filled in as later phases land.
 */

export type SidePanelInbound = { type: 'doe/sidepanel/ping' };

export type RunsInbound =
  | { type: 'doe/runs/list'; limit?: number }
  | { type: 'doe/runs/transcript'; conversationId: string };

export type MemoryInbound =
  | { type: 'doe/memory/list-domains' }
  | { type: 'doe/memory/list-buckets'; domain: string }
  | { type: 'doe/memory/read-bucket'; domain: string; bucket: string; offset?: number; limit?: number }
  | { type: 'doe/memory/delete-bucket'; domain: string; bucket: string }
  | { type: 'doe/memory/delete-item'; domain: string; bucket: string; index: number }
  | { type: 'doe/memory/replace-item'; domain: string; bucket: string; index: number; item: unknown }
  | { type: 'doe/memory/replace-bucket'; domain: string; bucket: string; items: unknown[] }
  | { type: 'doe/memory/delete-domain'; domain: string }
  | { type: 'doe/memory/export-all' }
  | { type: 'doe/memory/export-domain'; domain: string }
  | { type: 'doe/memory/import'; snapshot: unknown; strategy?: 'overwrite' | 'skip' | 'append' }
  | { type: 'doe/memory/wipe-all' };

export type SidePanelOutbound = { type: 'doe/sidepanel/ready' } | { type: 'doe/sidepanel/stop-agent' };

export type ContentInbound = { type: 'doe/content/show-indicator' } | { type: 'doe/content/hide-indicator' };

export type ContentOutbound = { type: 'doe/content/stop-clicked' };

export type ExtensionMessage =
  | SidePanelInbound
  | SidePanelOutbound
  | ContentInbound
  | ContentOutbound
  | RunsInbound
  | MemoryInbound;

export type MessageType = ExtensionMessage['type'];
