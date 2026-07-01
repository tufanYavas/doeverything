import { isBuiltInProviderId, listModels, PROVIDER_LIST, PROVIDER_REGISTRY } from '@doeverything/llm-providers';
import { useStorage } from '@doeverything/shared';
import {
  activeBaseUrl,
  activeModel,
  customIdFromProvider,
  customProvidersStorage,
  discoveredModelsStorage,
  isCustomProviderId,
  llmConfigStorage,
  providerKeyFromCustomId,
} from '@doeverything/storage';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  ModelCombobox,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  cn,
} from '@doeverything/ui';
import { AlertCircle, CheckCircle2, EyeOff, Eye, KeyRound, Plus, RefreshCw, Server, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LlmProviderId } from '@doeverything/llm-providers';
import type { CustomProvider, DiscoveredModelEntry, FastModelConfig, LlmConfigState } from '@doeverything/storage';

const EMPTY_DRAFT: CustomProvider = {
  id: '',
  label: '',
  kind: 'openai-compat',
  baseUrl: '',
  apiKey: '',
  defaultModel: '',
};

interface CommittedInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onCommit: (next: string) => void;
}

/**
 * Input whose keystrokes live in local state and persist once, on blur or
 * Enter. Storage-backed fields must not write per keystroke: every write
 * re-serializes the config (encrypting all keys) and the liveUpdate echo
 * can land out of order, reverting characters mid-typing — pasted values
 * survived, hand-typed ones (base URLs) lost their tail and looked like
 * they never saved. Same draft model as ModelCombobox.
 */
function CommittedInput({ value, onCommit, ...rest }: CommittedInputProps) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);

  // Follow external changes (another page wrote storage) unless the user is
  // actively typing here.
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) onCommit(draft);
  };

  return (
    <Input
      {...rest}
      value={draft}
      onChange={e => setDraft(e.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        commit();
      }}
      onKeyDown={e => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

export function LlmTab() {
  const config = useStorage(llmConfigStorage);
  const customState = useStorage(customProvidersStorage);
  const discovered = useStorage(discoveredModelsStorage);
  const isCustom = isCustomProviderId(config.provider);
  const customSlug = isCustom ? customIdFromProvider(config.provider) : '';
  const activeCustom = isCustom ? customState.providers.find(p => p.id === customSlug) : undefined;
  const builtInDescriptor = isBuiltInProviderId(config.provider) ? PROVIDER_REGISTRY[config.provider] : undefined;

  const [keyVisible, setKeyVisible] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [draft, setDraft] = useState<CustomProvider>(EMPTY_DRAFT);
  const [drafting, setDrafting] = useState(false);

  useEffect(() => {
    if (!savedFlash) return;
    const t = setTimeout(() => setSavedFlash(false), 1500);
    return () => clearTimeout(t);
  }, [savedFlash]);

  const flash = () => setSavedFlash(true);

  const onSelectProvider = (value: string) => {
    void llmConfigStorage.setProvider(value).then(flash);
  };

  const onSaveDraft = async () => {
    if (!draft.label.trim() || !draft.baseUrl.trim()) return;
    const next: CustomProvider = {
      ...draft,
      id: draft.id.trim() || draft.label.trim(),
    };
    await customProvidersStorage.upsert(next);
    setDraft(EMPTY_DRAFT);
    setDrafting(false);
    flash();
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">LLM Provider</h2>
        <p className="text-muted-foreground mt-1 text-sm">
          doeverything uses the Vercel AI SDK so you can switch between providers without changing anything else. Add your
          own OpenAI-compatible endpoint below — no code change needed.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provider & model</CardTitle>
          <CardDescription>Pick the model that powers doeverything's agent loop.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="provider">Provider</Label>
            <Select value={config.provider} onValueChange={onSelectProvider}>
              <SelectTrigger id="provider">
                <SelectValue placeholder="Select a provider" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Built-in</SelectLabel>
                  {PROVIDER_LIST.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {customState.providers.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Your custom providers</SelectLabel>
                      {customState.providers.map(p => (
                        <SelectItem key={p.id} value={providerKeyFromCustomId(p.id)}>
                          {p.label || p.id}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Model + capability hints */}
          {isCustom && activeCustom ? (
            <CustomProviderActiveSummary provider={activeCustom} />
          ) : builtInDescriptor ? (
            <BuiltInModelSection
              provider={config.provider}
              model={activeModel(config)}
              descriptor={builtInDescriptor}
              discoveredEntry={discovered.byProvider[config.provider]}
              apiKey={config.apiKeys[config.provider] ?? ''}
              baseUrl={activeBaseUrl(config)}
              onModel={m => llmConfigStorage.setModel(m).then(flash)}
            />
          ) : null}
        </CardContent>
      </Card>

      <FastModelCard
        config={config}
        customProviders={customState.providers}
        discovered={discovered.byProvider}
        onSavedFlash={flash}
      />

      {/* Built-in API key card — hidden when a custom provider is active */}
      {!isCustom && builtInDescriptor && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="text-primary h-4 w-4" /> API key
            </CardTitle>
            <CardDescription>
              Your key stays on this device and is only used to talk to the provider you picked.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="apiKey">{`${builtInDescriptor.label} API key`}</Label>
              <div className="relative">
                <CommittedInput
                  id="apiKey"
                  type={keyVisible ? 'text' : 'password'}
                  value={config.apiKeys[config.provider] ?? ''}
                  placeholder="sk-…"
                  onCommit={v => llmConfigStorage.setApiKey(config.provider, v).then(flash)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setKeyVisible(v => !v)}
                  aria-label={keyVisible ? 'Hide key' : 'Show key'}
                  className="text-muted-foreground hover:text-foreground absolute right-2 top-1/2 -translate-y-1/2 rounded p-1">
                  {keyVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="baseUrl">Base URL {builtInDescriptor.requiresBaseUrl ? '' : '(optional)'}</Label>
              <CommittedInput
                id="baseUrl"
                type="text"
                value={activeBaseUrl(config)}
                placeholder={
                  builtInDescriptor.requiresBaseUrl
                    ? 'https://your-openai-compatible-endpoint/v1'
                    : 'Leave blank unless using a proxy or self-hosted endpoint'
                }
                onCommit={v => llmConfigStorage.setBaseUrl(v.trim()).then(flash)}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Custom provider CRUD — list, edit, add */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="text-primary h-4 w-4" /> Custom providers
          </CardTitle>
          <CardDescription>
            Any OpenAI-compatible endpoint shows up in the picker as a first-class provider. Multiple Fireworks tenants,
            a local Ollama, vLLM, LM Studio, your own proxy — each with its own label, base URL, and key.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {customState.providers.length === 0 && !drafting && (
            <p className="text-muted-foreground text-sm">No custom providers yet.</p>
          )}

          {customState.providers.map(p => (
            <CustomProviderRow
              key={p.id}
              provider={p}
              isActive={isCustom && customSlug === p.id}
              onActivate={() => onSelectProvider(providerKeyFromCustomId(p.id))}
              onChange={async patch => {
                await customProvidersStorage.upsert({ ...p, ...patch });
                flash();
              }}
              onRemove={async () => {
                await customProvidersStorage.remove(p.id);
                if (isCustom && customSlug === p.id) {
                  await llmConfigStorage.setProvider('anthropic');
                }
                flash();
              }}
            />
          ))}

          {drafting ? (
            <CustomProviderForm
              draft={draft}
              onChange={setDraft}
              onCancel={() => {
                setDrafting(false);
                setDraft(EMPTY_DRAFT);
              }}
              onSave={onSaveDraft}
            />
          ) : (
            <Button variant="outline" size="sm" onClick={() => setDrafting(true)} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" /> Add custom provider
            </Button>
          )}
        </CardContent>
      </Card>

      <div
        className={cn(
          'text-success flex items-center gap-2 text-sm transition-opacity',
          savedFlash ? 'opacity-100' : 'opacity-0',
        )}>
        <CheckCircle2 className="h-4 w-4" /> Saved
      </div>
    </div>
  );
}

interface BuiltInModelSectionProps {
  provider: string;
  model: string;
  descriptor: (typeof PROVIDER_REGISTRY)[keyof typeof PROVIDER_REGISTRY];
  discoveredEntry: DiscoveredModelEntry | undefined;
  apiKey: string;
  baseUrl: string;
  onModel: (next: string) => void;
}

function BuiltInModelSection({
  provider,
  model,
  descriptor,
  discoveredEntry,
  apiKey,
  baseUrl,
  onModel,
}: BuiltInModelSectionProps) {
  const cachedModels = discoveredEntry?.models ?? [];
  // Always offer at least the bootstrap default so a fresh install (no
  // discovery cache yet) still shows a suggestion instead of an empty list.
  const suggestions =
    cachedModels.length > 0 ? cachedModels : descriptor.defaultModel ? [descriptor.defaultModel] : [];
  const canFetch = apiKey.trim().length > 0 || provider === 'openrouter' || provider === 'openai-compatible';

  return (
    <>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="model">Model</Label>
          <ModelRefreshButton
            providerId={provider}
            apiKey={apiKey}
            baseUrl={baseUrl || undefined}
            disabled={!canFetch}
            disabledReason={!canFetch ? 'Enter an API key first' : undefined}
          />
        </div>
        <ModelCombobox
          id="model"
          value={model}
          options={suggestions}
          placeholder={descriptor.defaultModel || 'e.g. claude-opus-4-7'}
          onCommit={onModel}
        />
        <ModelDiscoveryHint
          fallbackDefault={descriptor.defaultModel}
          entry={discoveredEntry}
          canFetch={canFetch}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
        <Capability label="Streaming" enabled={descriptor.capabilities.streaming} />
        <Capability label="Tools" enabled={descriptor.capabilities.tools} />
        <Capability label="Vision" enabled={descriptor.capabilities.vision} />
        <Capability label="Prompt cache" enabled={descriptor.capabilities.promptCache} />
      </div>
    </>
  );
}

interface ModelRefreshButtonProps {
  providerId: LlmProviderId;
  apiKey: string;
  baseUrl?: string;
  disabled?: boolean;
  disabledReason?: string;
}

/**
 * Calls `listModels(providerId)` against the live provider, writes the
 * result into `discoveredModelsStorage`, and surfaces transient
 * loading/error state. Times out after 15s so a stalled fetch doesn't
 * leave the spinner up forever.
 */
function ModelRefreshButton({ providerId, apiKey, baseUrl, disabled, disabledReason }: ModelRefreshButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onRefresh = async () => {
    setLoading(true);
    setError(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    try {
      const result = await listModels(providerId, { apiKey: apiKey.trim(), baseUrl, signal: ctrl.signal });
      if (result.models.length === 0) {
        setError('Provider returned no models');
        return;
      }
      await discoveredModelsStorage.setForProvider(providerId, {
        models: result.models,
        defaultModel: result.defaultModel,
        contextWindows: result.contextWindows,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(ctrl.signal.aborted ? 'Request timed out' : msg);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span className="text-destructive flex items-center gap-1 text-xs" title={error}>
          <AlertCircle className="h-3 w-3" />
          <span className="max-w-[12rem] truncate">{error}</span>
        </span>
      )}
      {disabled && disabledReason && !error && (
        <span className="text-muted-foreground flex items-center gap-1 text-xs">
          <AlertCircle className="h-3 w-3" />
          <span className="max-w-[14rem] truncate">{disabledReason}</span>
        </span>
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onRefresh}
        disabled={loading || disabled}
        title={disabledReason}
        className="h-7 gap-1.5 text-xs">
        <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
        {loading ? 'Fetching…' : 'Refresh models'}
      </Button>
    </div>
  );
}

function ModelDiscoveryHint({
  fallbackDefault,
  entry,
  canFetch,
}: {
  fallbackDefault: string;
  entry: DiscoveredModelEntry | undefined;
  canFetch: boolean;
}) {
  if (entry && entry.models.length > 0) {
    return (
      <p className="text-muted-foreground text-xs">
        Leave empty to use <code>{fallbackDefault || '—'}</code>. {entry.models.length} models available · last refreshed{' '}
        {formatRelative(entry.fetchedAt)}.
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-xs">
      Leave empty to use <code>{fallbackDefault || '—'}</code>.{' '}
      {canFetch ? 'Click "Refresh models" to fetch the live list.' : 'Add an API key, then click "Refresh models".'}
    </p>
  );
}

function formatRelative(epochMs: number): string {
  const diff = Date.now() - epochMs;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function CustomProviderActiveSummary({ provider }: { provider: CustomProvider }) {
  return (
    <div className="space-y-1.5">
      <Label>Active custom provider</Label>
      <div className="border-border/70 bg-muted/40 rounded-lg border px-3 py-2 text-sm">
        <div className="font-medium">{provider.label || provider.id}</div>
        <div className="text-muted-foreground font-mono text-xs">{provider.baseUrl}</div>
        <div className="text-muted-foreground mt-1 text-xs">
          Default model: <code>{provider.defaultModel || '—'}</code>
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        Edit the URL, key, and default model in the “Custom providers” section below.
      </p>
    </div>
  );
}

function CustomProviderRow({
  provider,
  isActive,
  onActivate,
  onChange,
  onRemove,
}: {
  provider: CustomProvider;
  isActive: boolean;
  onActivate: () => void;
  onChange: (patch: Partial<CustomProvider>) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [keyVisible, setKeyVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'border-border/70 rounded-lg border p-3 text-sm transition-colors duration-150',
        isActive ? 'border-primary/60 bg-primary/5' : 'bg-card',
      )}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex-1 text-left"
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}>
          <div className="font-medium">{provider.label || provider.id}</div>
          <div className="text-muted-foreground truncate font-mono text-xs">{provider.baseUrl}</div>
        </button>
        {!isActive ? (
          <Button size="sm" variant="outline" onClick={onActivate}>
            Use
          </Button>
        ) : (
          <span className="text-primary text-[11px] font-medium uppercase tracking-wider">Active</span>
        )}
        <Button size="icon" variant="ghost" onClick={onRemove} aria-label="Remove provider" className="h-8 w-8">
          <Trash2 className="text-destructive h-4 w-4" />
        </Button>
      </div>
      {expanded && (
        <>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <CommittedField
              label="Label"
              value={provider.label}
              onCommit={v => onChange({ label: v })}
              placeholder="e.g. Fireworks (DeepSeek)"
            />
            <CommittedField
              label="Base URL"
              value={provider.baseUrl}
              onCommit={v => onChange({ baseUrl: v.trim() })}
              placeholder="https://api.example.com/v1"
            />
            <CommittedField
              label="Default model"
              value={provider.defaultModel}
              onCommit={v => onChange({ defaultModel: v.trim() })}
              placeholder="accounts/fireworks/models/llama-v3p1-70b"
            />
            <div className="space-y-1">
              <Label className="text-xs">API key</Label>
              <div className="relative">
                <CommittedInput
                  type={keyVisible ? 'text' : 'password'}
                  value={provider.apiKey}
                  placeholder="sk-…"
                  className="h-8 pr-8 text-xs"
                  onCommit={v => onChange({ apiKey: v })}
                />
                <button
                  type="button"
                  onClick={() => setKeyVisible(v => !v)}
                  aria-label={keyVisible ? 'Hide key' : 'Show key'}
                  className="text-muted-foreground hover:text-foreground absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1">
                  {keyVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-end">
            <ModelRefreshButton
              providerId={providerKeyFromCustomId(provider.id)}
              apiKey={provider.apiKey}
              baseUrl={provider.baseUrl || undefined}
              disabled={!provider.baseUrl}
              disabledReason={!provider.baseUrl ? 'Set a base URL first' : undefined}
            />
          </div>
        </>
      )}
    </div>
  );
}

function CustomProviderForm({
  draft,
  onChange,
  onCancel,
  onSave,
}: {
  draft: CustomProvider;
  onChange: (next: CustomProvider) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const canSave = draft.label.trim().length > 0 && draft.baseUrl.trim().length > 0;
  return (
    <div className="border-border/70 space-y-2 rounded-lg border border-dashed p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Field
          label="Label"
          value={draft.label}
          onChange={v => onChange({ ...draft, label: v })}
          placeholder="Fireworks (DeepSeek)"
        />
        <Field
          label="Base URL"
          value={draft.baseUrl}
          onChange={v => onChange({ ...draft, baseUrl: v })}
          placeholder="https://api.fireworks.ai/inference/v1"
        />
        <Field
          label="Default model"
          value={draft.defaultModel}
          onChange={v => onChange({ ...draft, defaultModel: v })}
          placeholder="accounts/fireworks/models/llama-v3p1-70b"
        />
        <Field
          label="API key"
          value={draft.apiKey}
          onChange={v => onChange({ ...draft, apiKey: v })}
          placeholder="sk-…"
        />
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={onSave} disabled={!canSave}>
          Save provider
        </Button>
      </div>
    </div>
  );
}

/**
 * Plain per-keystroke field — only for the new-provider draft form, where
 * state is parent-local React state (no storage roundtrip) and the Save
 * button's enablement depends on live values.
 */
function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input className="h-8 text-xs" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

/** Storage-backed variant of `Field` — persists once, on blur or Enter. */
function CommittedField({
  label,
  value,
  onCommit,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <CommittedInput className="h-8 text-xs" value={value} placeholder={placeholder} onCommit={onCommit} />
    </div>
  );
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className={cn('flex items-center gap-1.5', enabled ? 'text-foreground' : 'text-muted-foreground')}>
      <span
        className={cn('inline-block h-1.5 w-1.5 rounded-full', enabled ? 'bg-success' : 'bg-muted-foreground/40')}
      />
      {label}
    </div>
  );
}

/**
 * "Fast model (optional)" card — secondary model used by helper tools that
 * don't need the main agent's reasoning power (currently `find`'s DOM
 * scanner). Provider can differ from the main one; the API key reuses
 * whatever the user already entered for that provider, so picking e.g.
 * Anthropic-main + Google-fast just works as long as both keys exist.
 *
 * Selecting "Off" clears `fastModel` to null and helpers fall back to
 * `resolveActiveModel()`.
 */
function FastModelCard({
  config,
  customProviders,
  discovered,
  onSavedFlash,
}: {
  config: LlmConfigState;
  customProviders: CustomProvider[];
  discovered: Record<string, DiscoveredModelEntry>;
  onSavedFlash: () => void;
}) {
  const OFF_VALUE = '__off__';
  const fast = config.fastModel;
  const selectValue = fast?.provider ?? OFF_VALUE;

  const onSelectProvider = async (value: string) => {
    if (value === OFF_VALUE) {
      await llmConfigStorage.setFastModel(null);
    } else {
      // When the user changes provider, drop the previous model id —
      // it almost certainly doesn't exist on the new provider.
      const sameProvider = fast?.provider === value;
      const next: FastModelConfig = {
        provider: value,
        model: sameProvider ? fast!.model : '',
      };
      await llmConfigStorage.setFastModel(next);
    }
    onSavedFlash();
  };

  const onSetModel = async (model: string) => {
    if (!fast) return;
    await llmConfigStorage.setFastModel({ provider: fast.provider, model });
    onSavedFlash();
  };

  const isFastCustom = fast ? isCustomProviderId(fast.provider) : false;
  const customSlug = fast && isFastCustom ? customIdFromProvider(fast.provider) : '';
  const fastCustom = isFastCustom ? customProviders.find(p => p.id === customSlug) : undefined;
  const fastBuiltIn = fast && !isFastCustom && isBuiltInProviderId(fast.provider) ? PROVIDER_REGISTRY[fast.provider] : undefined;

  // What actually happens when no fast model is configured — mirrors
  // `resolveFastModel`'s fallback chain: active provider's registry
  // default (same key) when available, otherwise the main model.
  const activeBuiltIn = isBuiltInProviderId(config.provider) ? PROVIDER_REGISTRY[config.provider] : undefined;
  const activeDefaultFast = activeBuiltIn?.defaultFastModel ?? '';
  const activeKeySet = (config.apiKeys[config.provider] ?? '').trim().length > 0;
  const autoFastAvailable = activeDefaultFast.length > 0 && activeKeySet;
  const offLabel = autoFastAvailable ? `Auto — ${activeDefaultFast} (provider default)` : 'Off — use main model';

  // API key sourced exactly the way `resolveFastModel` reads it.
  const fastApiKey = fast
    ? isFastCustom
      ? fastCustom?.apiKey ?? ''
      : config.apiKeys[fast.provider] ?? ''
    : '';
  const missingKey = fast !== null && fastApiKey.trim().length === 0;
  const fastDiscovered = fast ? discovered[fast.provider] : undefined;
  const fastModels = fastDiscovered?.models ?? [];
  const fastDefault = isFastCustom ? fastCustom?.defaultModel : fastBuiltIn?.defaultModel;
  const fastSuggestions = fastModels.length > 0 ? fastModels : fastDefault ? [fastDefault] : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fast model (optional)</CardTitle>
        <CardDescription>
          Lighter, cheaper model used for background work — the <code>find</code> tool's page scanner and long-chat
          summaries. Reuses the API key already saved for the chosen provider. On Auto, each provider's default fast
          model is used automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fast-provider">Provider</Label>
          <Select value={selectValue} onValueChange={onSelectProvider}>
            <SelectTrigger id="fast-provider">
              <SelectValue placeholder={offLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={OFF_VALUE}>{offLabel}</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectLabel>Built-in</SelectLabel>
                {PROVIDER_LIST.map(p => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectGroup>
              {customProviders.length > 0 && (
                <>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Your custom providers</SelectLabel>
                    {customProviders.map(p => (
                      <SelectItem key={p.id} value={providerKeyFromCustomId(p.id)}>
                        {p.label || p.id}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
            </SelectContent>
          </Select>
        </div>

        {!fast &&
          (autoFastAvailable ? (
            <p className="text-muted-foreground text-xs">
              Background helpers run on <code className="font-mono">{activeDefaultFast}</code> automatically with your{' '}
              {activeBuiltIn?.label} key. Pick a provider above to override.
            </p>
          ) : (
            <div className="border-warning/25 bg-warning/10 text-warning flex items-start gap-2 rounded-lg border p-2.5 text-xs">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                No fast model available
                {activeDefaultFast.length > 0 && !activeKeySet
                  ? ` — add your ${activeBuiltIn?.label} API key to enable the provider default`
                  : ' for this provider'}
                . Background helpers (page search, long-chat summaries) will run on your main model, which is slower
                and more expensive. Pick a lighter model above to fix this.
              </span>
            </div>
          ))}

        {fast && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="fast-model">Model</Label>
              <ModelCombobox
                id="fast-model"
                value={fast.model}
                options={fastSuggestions}
                placeholder={
                  isFastCustom
                    ? fastCustom?.defaultModel || 'e.g. accounts/.../llama-v3p1-8b-instruct'
                    : fastBuiltIn?.defaultFastModel || fastBuiltIn?.defaultModel || 'e.g. claude-haiku-4-5'
                }
                onCommit={onSetModel}
              />
              <p className="text-muted-foreground text-xs">
                Leave empty to use{' '}
                <code className="font-mono">
                  {(isFastCustom ? fastCustom?.defaultModel : fastBuiltIn?.defaultFastModel) || 'the provider default'}
                </code>
                .{' '}
                {fastModels.length > 0
                  ? `${fastModels.length} models cached for this provider.`
                  : 'Refresh models in the section above for suggestions.'}
              </p>
            </div>

            {missingKey && (
              <div className="border-destructive/25 bg-destructive/10 text-destructive flex items-start gap-2 rounded-lg border p-2.5 text-xs">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  No API key configured for <strong>{isFastCustom ? fastCustom?.label || customSlug : fastBuiltIn?.label}</strong>.
                  Helper calls will fall back to the main model until you add one — pick this provider as the main provider
                  temporarily to enter its key, or add it inside the relevant custom-provider row below.
                </span>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
