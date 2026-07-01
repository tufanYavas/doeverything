import { Badge, Button, BrandLogo, cn } from '@doeverything/ui';
import { useConnection } from '@src/providers/Providers';
import { ArrowRight, Check, CheckCircle2, Copy, Eye, EyeOff, KeyRound, Loader2, Settings, Sparkles, Zap } from 'lucide-react';
import { useState } from 'react';

/**
 * ModelSetupScreen — shown when no API key is configured.
 *
 * Two modes:
 *
 *   mcpConnected=false — full first-run onboarding. Explains both paths:
 *     MCP connection (external client drives the model) or API key (chat here).
 *
 *   mcpConnected=true — MCP relay is live so browser tools are already
 *     available to the external client, but the chat interface still needs
 *     its own API key to run the agent loop. Shows a status banner and
 *     focuses on the API key option.
 */
export function ModelSetupScreen({ onDismiss, mcpConnected = false }: { onDismiss: () => void; mcpConnected?: boolean }) {
  const openSettings = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') + '#llm' });
    onDismiss();
  };

  return (
    <div className="bg-background text-foreground de-glow relative flex h-full min-h-0 flex-col overflow-y-auto">
      <div className="de-grain pointer-events-none absolute inset-0" />
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-6 py-8">

        {mcpConnected ? (
          <>
            <div className="de-fade-up flex flex-col gap-3 pb-6 pt-2">
              <div className="border-success/30 bg-success/10 text-success flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="space-y-0.5">
                  <p className="font-medium leading-none">MCP client connected</p>
                  <p className="text-success/80 text-xs leading-relaxed">
                    Your external MCP client can already call browser tools. The chat interface here runs a separate agent loop that needs its own API key.
                  </p>
                </div>
              </div>
            </div>

            <div className="de-fade-up" style={{ animationDelay: '60ms' }}>
              <ApiKeyOption onOpenSettings={openSettings} />
            </div>

            <div className="de-fade-up mt-4" style={{ animationDelay: '120ms' }}>
              <McpConnectionOption />
            </div>
          </>
        ) : (
          <>
            <div className="de-fade-up flex flex-col items-center gap-3 pb-6 pt-2 text-center">
              <BrandLogo size="lg" pulsing />
              <h1 className="text-2xl font-semibold tracking-tight">Welcome to doeverything</h1>
              <p className="text-muted-foreground max-w-sm text-sm leading-relaxed">
                Pick how doeverything reaches a model. You can change this anytime in Settings.
              </p>
            </div>

            <div className="flex flex-col gap-3">
              <div className="de-fade-up" style={{ animationDelay: '60ms' }}>
                <McpConnectionOption />
              </div>

              <div className="de-fade-up" style={{ animationDelay: '120ms' }}>
                <ApiKeyOption onOpenSettings={openSettings} />
              </div>
            </div>
          </>
        )}

        <div className="de-fade-up mt-6 flex items-center justify-center gap-2 text-xs" style={{ animationDelay: '180ms' }}>
          <button
            type="button"
            onClick={onDismiss}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors">
            Skip for now
            <ArrowRight className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}

function McpConnectionOption() {
  const { connection, isConnected, connect } = useConnection();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const onConnect = async () => {
    setBusy(true);
    try {
      await connect();
    } finally {
      setBusy(false);
    }
  };

  // The connector URL only exists once `connect()` has minted the token and
  // resolved the relay base URL. Show the call-to-action button until then.
  const connectorUrl = connection.token && connection.relayBaseUrl
    ? `${connection.relayBaseUrl}/mcp/${connection.token}`
    : null;

  const onCopy = () => {
    if (!connectorUrl) return;
    void navigator.clipboard.writeText(connectorUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card
      icon={Sparkles}
      title="MCP connection"
      badge="Uses your subscription"
      description="Pair the extension with any MCP client using the connector URL. The client runs the model and calls doeverything's browser tools over MCP; your subscription quota is what's billed.">
      {!connectorUrl ? (
        <Button onClick={onConnect} disabled={busy} className="justify-center gap-2">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Generating link…' : 'Generate MCP server URL'}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="border-border/60 bg-muted/40 flex items-center gap-2 rounded-lg border px-2.5 py-2">
            <code
              className={cn(
                'text-foreground/90 flex-1 truncate text-[11px] font-mono transition-all',
                !revealed && 'blur-sm select-none',
              )}>
              {connectorUrl}
            </code>
            <button
              type="button"
              onClick={() => setRevealed(r => !r)}
              aria-label={revealed ? 'Hide URL' : 'Reveal URL'}
              className="text-muted-foreground hover:text-foreground rounded p-1">
              {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              onClick={onCopy}
              aria-label="Copy MCP server URL"
              className="text-muted-foreground hover:text-foreground rounded p-1">
              {copied ? <Check className="text-success h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <p className="text-muted-foreground text-[11px] leading-relaxed">
            Paste this URL into your MCP client's connector settings.{' '}
            <span className={cn('whitespace-nowrap', isConnected ? 'text-success' : 'text-muted-foreground')}>
              {isConnected ? '● Online — extension is reachable.' : '○ Waiting for the MCP client to connect.'}
            </span>{' '}
            <button
              type="button"
              onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') + '#account' })}
              className="text-primary hover:underline">
              Open Connection settings →
            </button>
          </p>
        </div>
      )}
    </Card>
  );
}

function ApiKeyOption({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <Card
      icon={KeyRound}
      title="Use an API key"
      badge="Pay-per-use"
      description="Add your API key in Settings. Supports Anthropic, OpenAI, Google, Groq, OpenRouter and any OpenAI-compatible provider. doeverything runs its own agent loop and bills your provider directly.">
      <Button onClick={onOpenSettings} className="justify-center gap-2">
        <Settings className="h-4 w-4" />
        Open Settings → LLM
      </Button>
    </Card>
  );
}

interface CardProps {
  icon: typeof KeyRound;
  title: string;
  badge?: string;
  description: string;
  children: React.ReactNode;
}

function Card({ icon: Icon, title, badge, description, children }: CardProps) {
  return (
    <div
      className={cn(
        'group border-border/60 bg-card/80 text-card-foreground shadow-soft rounded-2xl border p-4 backdrop-blur transition-all duration-150',
        'hover:border-primary/40 hover:shadow-lifted',
      )}>
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
          <Icon className="h-4 w-4" />
        </div>
        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold leading-none">{title}</h2>
            {badge && (
              <Badge variant="secondary" className="gap-1">
                <Zap className="h-2.5 w-2.5" />
                {badge}
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="mt-3 pl-12">{children}</div>
    </div>
  );
}
