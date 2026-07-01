import '@src/Options.css';
import { useStorage, withErrorBoundary, withSuspense } from '@doeverything/shared';
import { exampleThemeStorage } from '@doeverything/storage';
import {
  ErrorDisplay,
  LoadingSpinner,
  BrandLogo,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  cn,
} from '@doeverything/ui';
import { AccountTab } from '@src/tabs/AccountTab';
import { ActionsTab } from '@src/tabs/ActionsTab';
import { LlmTab } from '@src/tabs/LlmTab';
import { MemoryTab } from '@src/tabs/MemoryTab';
import { MicrophoneTab } from '@src/tabs/MicrophoneTab';
import { RunsTab } from '@src/tabs/RunsTab';
import { ShortcutsTab } from '@src/tabs/ShortcutsTab';
import { SkillsTab } from '@src/tabs/SkillsTab';
import { Activity, Brain, Globe, KeyRound, Mic, Plug, Sparkles, Wand2 } from 'lucide-react';
import { useEffect, useState } from 'react';

const TABS = [
  { id: 'account', label: 'Connection', icon: Plug },
  { id: 'llm', label: 'LLM', icon: KeyRound },
  { id: 'runs', label: 'Runs', icon: Activity },
  { id: 'memory', label: 'Memory', icon: Brain },
  { id: 'shortcuts', label: 'Shortcuts', icon: Globe },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'actions', label: 'Actions', icon: Wand2 },
  { id: 'microphone', label: 'Microphone', icon: Mic },
] as const;

function readTabFromHash(): (typeof TABS)[number]['id'] {
  const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : '';
  return (TABS.find(t => t.id === hash)?.id ?? 'account') as (typeof TABS)[number]['id'];
}

const Options = () => {
  const { theme } = useStorage(exampleThemeStorage);
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]['id']>(() => readTabFromHash());

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Deep-link support: side-panel "Memory" pill writes `#memory` to the
  // URL when navigating here. Listen for hash changes so a second click
  // from a still-open Options window also switches tabs.
  useEffect(() => {
    const onHash = () => setActiveTab(readTabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <div className={cn('bg-background text-foreground min-h-screen')}>
      <div className="mx-auto max-w-5xl px-8 py-10">
        <header className="mb-10 flex flex-col gap-2">
          <BrandLogo size="lg" />
          <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">Settings</p>
        </header>

        <Tabs
          orientation="vertical"
          value={activeTab}
          onValueChange={v => {
            setActiveTab(v as (typeof TABS)[number]['id']);
            window.history.replaceState(null, '', `#${v}`);
          }}
          className="flex w-full items-start gap-10">
          <TabsList className="sticky top-10 flex h-auto w-56 shrink-0 flex-col items-stretch justify-start gap-0.5 rounded-none bg-transparent p-0">
            {TABS.map(tab => {
              const Icon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  className="group relative justify-start gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-accent/50 hover:text-foreground data-[state=active]:bg-accent data-[state=active]:text-foreground data-[state=active]:shadow-none">
                  <span className="bg-primary absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full opacity-0 transition-opacity duration-150 group-data-[state=active]:opacity-100" />
                  <Icon className="h-4 w-4 shrink-0 group-data-[state=active]:text-primary" />
                  {tab.label}
                </TabsTrigger>
              );
            })}
          </TabsList>

          <div className="min-w-0 max-w-2xl flex-1">
            <TabsContent value="account" className="mt-0">
              <AccountTab />
            </TabsContent>
            <TabsContent value="llm" className="mt-0">
              <LlmTab />
            </TabsContent>
            <TabsContent value="runs" className="mt-0">
              <RunsTab />
            </TabsContent>
            <TabsContent value="memory" className="mt-0">
              <MemoryTab />
            </TabsContent>
            <TabsContent value="shortcuts" className="mt-0">
              <ShortcutsTab />
            </TabsContent>
            <TabsContent value="skills" className="mt-0">
              <SkillsTab />
            </TabsContent>
            <TabsContent value="actions" className="mt-0">
              <ActionsTab />
            </TabsContent>
            <TabsContent value="microphone" className="mt-0">
              <MicrophoneTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <LoadingSpinner />), ErrorDisplay);
