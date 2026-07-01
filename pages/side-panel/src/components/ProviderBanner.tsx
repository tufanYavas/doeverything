import { connectionStorage, llmConfigStorage } from '@doeverything/storage';
import { Button, cn } from '@doeverything/ui';
import { AlertTriangle, KeyRound, Plug } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * "No API key configured" banner — shown after the user dismisses the
 * ModelSetupScreen but still has no API key set.
 *
 * MCP connection alone is not enough for the chat: the agent loop always
 * needs its own key. We therefore show this banner regardless of connection
 * status, but tailor the message to the two situations:
 *
 *   mcpConnected=true  → MCP works for external clients; chat just needs a key.
 *   mcpConnected=false → Neither path is set up yet; offer both options.
 */
export function ProviderBanner() {
  const [missingKey, setMissingKey] = useState<boolean>(false);
  const [mcpConnected, setMcpConnected] = useState<boolean>(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      const [cfg, conn] = await Promise.all([llmConfigStorage.get(), connectionStorage.get()]);
      if (!active) return;
      const key = cfg.apiKeys?.[cfg.provider] ?? '';
      // openai-compatible stores its key on the provider row, not in apiKeys.
      setMissingKey(!key && cfg.provider !== 'openai-compatible');
      setMcpConnected(conn.status === 'connected');
    };
    check();
    const unsubscribeLlm = llmConfigStorage.subscribe(() => check());
    const unsubscribeConn = connectionStorage.subscribe(() => check());
    return () => {
      active = false;
      unsubscribeLlm();
      unsubscribeConn();
    };
  }, []);

  if (!missingKey) return null;

  const openSettings = (hash: string) =>
    void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') + hash });

  return (
    <div className={cn('border-warning/25 bg-warning/10 border-b px-3 py-3 text-xs')}>
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="text-warning mt-0.5 h-4 w-4 shrink-0" />
        <div className="flex-1 space-y-2">
          {mcpConnected ? (
            <p className="text-foreground/80 leading-relaxed">
              MCP client is connected — your external client can use browser tools. The chat here runs its own agent loop and needs an API key to work.
            </p>
          ) : (
            <p className="text-foreground/80 leading-relaxed">
              doeverything needs a model to run. Connect an MCP client (uses your own subscription) or add an API key from a provider like Anthropic, OpenAI, or Google.
            </p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {!mcpConnected && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2.5 text-xs"
                onClick={() => openSettings('#account')}>
                <Plug className="h-3 w-3" />
                MCP Connection
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={() => openSettings('#llm')}>
              <KeyRound className="h-3 w-3" />
              Add API Key
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
