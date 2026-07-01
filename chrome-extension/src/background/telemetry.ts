/**
 * Telemetry.
 *
 * In-memory ring buffer + opt-in network senders. The Options page surfaces
 * the buffer for debugging; senders fire only when their flag is enabled
 * AND their write key is configured.
 *
 *   - Segment   `https://api.segment.io/v1/track`
 *   - Sentry    `<dsn host>/api/<projectId>/store/`
 *
 * Both senders are best-effort: failure never throws into the agent path.
 */

import { featureFlags } from './feature-flags.js';

interface TelemetryEvent {
  name: string;
  ts: number;
  props?: Record<string, unknown>;
}

const buffer: TelemetryEvent[] = [];
const MAX_EVENTS = 500;

function isAnalyticsDisabled(): boolean {
  return process.env['DOE_DISABLE_ANALYTICS'] === 'true';
}

let cachedAnonymousId = '';

async function ensureAnonymousId(): Promise<string> {
  if (cachedAnonymousId) return cachedAnonymousId;
  const KEY = 'doe:anonymous-id';
  try {
    const record = await chrome.storage.local.get(KEY);
    let id = record?.[KEY] as string | undefined;
    if (!id) {
      id = `anon_${crypto.randomUUID()}`;
      await chrome.storage.local.set({ [KEY]: id });
    }
    cachedAnonymousId = id;
    return id;
  } catch {
    cachedAnonymousId = `anon_volatile_${Math.random().toString(36).slice(2, 8)}`;
    return cachedAnonymousId;
  }
}

async function sendToSegment(event: TelemetryEvent) {
  const writeKey = process.env['DOE_SEGMENT_WRITE_KEY'];
  if (!writeKey) return;
  const id = await ensureAnonymousId();
  try {
    await fetch('https://api.segment.io/v1/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${btoa(`${writeKey}:`)}`,
      },
      body: JSON.stringify({
        anonymousId: id,
        event: event.name,
        properties: event.props ?? {},
        timestamp: new Date(event.ts).toISOString(),
        context: { app: { name: 'doeverything', version: chrome.runtime.getManifest().version } },
      }),
    });
  } catch {
    // best-effort
  }
}

async function sendToSentry(error: Error, context: Record<string, unknown> = {}) {
  const dsn = process.env['DOE_SENTRY_DSN'];
  if (!dsn) return;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, '');
    const key = url.username;
    const endpoint = `${url.protocol}//${url.host}/api/${projectId}/store/`;
    await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${key}, sentry_client=de/1.0`,
      },
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        platform: 'javascript',
        level: 'error',
        message: error.message,
        exception: { values: [{ type: error.name, value: error.message, stacktrace: { frames: [] } }] },
        extra: context,
        release: chrome.runtime.getManifest().version,
      }),
    });
  } catch {
    // best-effort
  }
}

export const telemetry = {
  track(name: string, props?: Record<string, unknown>) {
    if (isAnalyticsDisabled()) return;
    const event: TelemetryEvent = { name, ts: Date.now(), props };
    buffer.push(event);
    if (buffer.length > MAX_EVENTS) buffer.shift();
    if (featureFlags.isEnabled('telemetry_segment')) void sendToSegment(event);
  },
  reportError(error: Error, context?: Record<string, unknown>) {
    if (isAnalyticsDisabled()) return;
    void sendToSentry(error, context);
  },
  drain(): TelemetryEvent[] {
    const copy = [...buffer];
    buffer.length = 0;
    return copy;
  },
  recent(): readonly TelemetryEvent[] {
    return buffer;
  },
};

void ensureAnonymousId();
