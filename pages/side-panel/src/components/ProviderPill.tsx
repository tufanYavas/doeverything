import { isBuiltInProviderId, PROVIDER_REGISTRY } from '@doeverything/llm-providers';
import { useStorage } from '@doeverything/shared';
import { activeModel, llmConfigStorage } from '@doeverything/storage';
import { Badge } from '@doeverything/ui';

/**
 * Tiny pill in the header that shows which LLM is currently driving
 * doeverything. Click → opens the Options page so the user can switch.
 */
export function ProviderPill() {
  const config = useStorage(llmConfigStorage);
  const descriptor = isBuiltInProviderId(config.provider) ? PROVIDER_REGISTRY[config.provider] : undefined;
  const label = descriptor?.label.split(' (')[0] ?? config.provider;
  const model = activeModel(config) || descriptor?.defaultModel || '—';

  const openLlmSettings = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html') + '#llm' });
  };

  return (
    <button
      type="button"
      onClick={openLlmSettings}
      className="group inline-flex max-w-full overflow-hidden"
      aria-label={`Active LLM: ${label} · ${model}. Click to change.`}>
      <Badge
        variant="secondary"
        className="group-hover:bg-accent flex h-7 min-w-0 max-w-full items-center rounded-md border-transparent bg-transparent px-2 text-[11px] font-medium transition-colors duration-150">
        <span className="bg-primary mr-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full" />
        <span className="max-w-[4rem] truncate">{label}</span>
        <span className="ml-1 shrink-0 opacity-60">·</span>
        <span className="ml-1 max-w-[8rem] truncate font-mono opacity-80">{model}</span>
      </Badge>
    </button>
  );
}
