import { useStorage } from '@doeverything/shared';
import {
  connectionStorage,
  customProvidersStorage,
  exampleThemeStorage,
  llmConfigStorage,
  preferencesStorage,
} from '@doeverything/storage';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { ConnectionState } from '@doeverything/storage';
import type { JSX, ReactNode } from 'react';

/**
 * doeverything side panel Provider tree.
 *
 *   <ThemeProvider>          // applies `dark` class on documentElement
 *     <PreferencesProvider>
 *       <FeatureFlagProvider>
 *         <QueryClientProvider>
 *           <App />
 *
 * The tree is intentionally light — we don't ship react-intl yet (chrome.i18n
 * already resolves locale automatically), and feature flags are read from
 * the SW-managed cache via `chrome.storage.local`.
 */

interface FeatureFlagState {
  flags: Record<string, boolean | string>;
  isEnabled: (flag: string) => boolean;
}

const FLAG_STORAGE_KEY = 'doe:feature-flags';

export function FeatureFlagProvider(props: {
  children?: ReactNode;
  render?: (state: FeatureFlagState) => ReactNode;
}): JSX.Element {
  const [flags, setFlags] = useState<Record<string, boolean | string>>({});
  useEffect(() => {
    chrome.storage.local.get(FLAG_STORAGE_KEY).then(record => {
      const value = record?.[FLAG_STORAGE_KEY] as Record<string, boolean | string> | undefined;
      if (value) setFlags(value);
    });
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: chrome.storage.AreaName) => {
      if (area === 'local' && changes[FLAG_STORAGE_KEY]?.newValue) {
        setFlags(changes[FLAG_STORAGE_KEY].newValue);
      }
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  const state = useMemo<FeatureFlagState>(
    () => ({
      flags,
      isEnabled: flag => {
        const v = flags[flag];
        return v === true || v === 'on' || v === 'true';
      },
    }),
    [flags],
  );
  if (props.render) return <>{props.render(state)}</>;
  return <>{props.children}</>;
}

export interface ConnectionProviderState {
  connection: ConnectionState;
  /** True when the WebSocket to the relay is live. */
  isConnected: boolean;
  /** True when at least one provider (built-in or custom) has a non-empty API key. */
  hasAnyApiKey: boolean;
  /**
   * True when the side panel's own agent loop can run: at least one API key
   * is configured. MCP connection alone does NOT satisfy this — MCP lets an
   * external client call browser tools, but the chat interface needs its own
   * key to drive the agent loop. The setup screen is gated on this.
   */
  hasModelAccess: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  rotateToken: () => Promise<void>;
}

export function useConnection(): ConnectionProviderState {
  const connection = useStorage(connectionStorage);
  const llm = useStorage(llmConfigStorage);
  const custom = useStorage(customProvidersStorage);

  return useMemo(() => {
    const isConnected = connection.status === 'connected';
    const hasBuiltInKey = Object.values(llm.apiKeys ?? {}).some(v => typeof v === 'string' && v.trim().length > 0);
    const hasCustomKey = (custom.providers ?? []).some(p => typeof p.apiKey === 'string' && p.apiKey.trim().length > 0);
    const hasAnyApiKey = hasBuiltInKey || hasCustomKey;
    return {
      connection,
      isConnected,
      hasAnyApiKey,
      hasModelAccess: hasAnyApiKey,
      async connect() {
        await chrome.runtime.sendMessage({ type: 'doe/connection/connect' });
      },
      async disconnect() {
        await chrome.runtime.sendMessage({ type: 'doe/connection/disconnect' });
      },
      async rotateToken() {
        await chrome.runtime.sendMessage({ type: 'doe/connection/rotate-token' });
      },
    };
  }, [connection, llm, custom]);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { theme } = useStorage(exampleThemeStorage);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);
  return <>{children}</>;
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  // Subscribe so child components reading preferencesStorage update reactively.
  useStorage(preferencesStorage);
  return <>{children}</>;
}

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } }), []);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <PreferencesProvider>
          <FeatureFlagProvider>{children}</FeatureFlagProvider>
        </PreferencesProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
