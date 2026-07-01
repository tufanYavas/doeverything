import '@src/SidePanel.css';
import { useStorage, withErrorBoundary, withSuspense, optimizeBlobForLLM  } from '@doeverything/shared';
import { exampleThemeStorage, savedPromptsStorage } from '@doeverything/storage';
import { ErrorDisplay, LoadingSpinner, cn, SaveActionDialog  } from '@doeverything/ui';
import { Composer } from '@src/components/Composer';
import { ContextStrip } from '@src/components/ContextStrip';
import { FileDropZone } from '@src/components/FileDropZone';
import { Header } from '@src/components/Header';
import { ModelSetupScreen } from '@src/components/ModelSetupScreen';
import { MessageList } from '@src/components/MessageList';
import { ConfirmationDialog } from '@src/components/modals/ConfirmationDialog';
import { FeedbackDialog } from '@src/components/modals/FeedbackDialog';
import { NotificationBanner } from '@src/components/modals/NotificationBanner';
import { PermissionPrompt } from '@src/components/PermissionPrompt';
import { ProviderBanner } from '@src/components/ProviderBanner';
import { SlashCommandMenu } from '@src/components/SlashCommandMenu';
import { VersionBlockScreen } from '@src/components/VersionBlockScreen';
import { useAgentRunner } from '@src/hooks/useAgentRunner';
import { useClearConversationSignal, useSidePanelPresence } from '@src/hooks/useCommandSignals';
import { useKeyboardShortcuts } from '@src/hooks/useKeyboardShortcuts';
import { useQueuedPrompt } from '@src/hooks/useQueuedPrompt';
import { Providers, useConnection } from '@src/providers/Providers';
import { useChatStore } from '@src/stores/chat-store';
import { useCallback, useState } from 'react';
import type { Skill } from '@doeverything/storage';
import type { SaveActionPrefill } from '@doeverything/ui';
import type { Attachment } from '@src/components/AttachmentStrip';

const SidePanelInner = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const messages = useChatStore(s => s.messages);
  const status = useChatStore(s => s.status);
  const error = useChatStore(s => s.error);
  const clear = useChatStore(s => s.clear);
  const { sendPrompt, abort } = useAgentRunner();
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [noKeyWarning, setNoKeyWarning] = useState(false);
  const [saveAction, setSaveAction] = useState<{
    open: boolean;
    prefill: SaveActionPrefill;
    source: 'message' | 'chat';
    loading: boolean;
  }>({
    open: false,
    prefill: { prompt: '' },
    source: 'message',
    loading: false,
  });
  // Header spinner state — separate from `saveAction.loading` because the
  // dialog opens *with* the loading flag set, then flips it off when the
  // LLM result lands. The button stays in its disabled/spinning state from
  // the click until the dialog appears.
  const [convertingChat, setConvertingChat] = useState(false);
  const { hasModelAccess, isConnected } = useConnection();

  useQueuedPrompt(sendPrompt);

  // Global-shortcut bridges: Ctrl+Shift+E's clear signal and the presence
  // port that lets Ctrl+E close an already-open panel.
  useClearConversationSignal(clear);
  useSidePanelPresence();

  useKeyboardShortcuts({
    onClearConversation: () => setConfirmClear(true),
    onOpenOptions: () => chrome.runtime.openOptionsPage(),
    onToggleTheme: () => exampleThemeStorage.toggle(),
    onFocusComposer: () => {
      document.querySelector<HTMLElement>('[contenteditable="true"]')?.focus();
    },
  });

  const onSubmit = async () => {
    if (!draft.trim() && attachments.length === 0) return;
    // Guard: no API key means the agent loop will immediately fail and set the
    // ERR badge. Show an inline warning and bail.
    if (!hasModelAccess) {
      setNoKeyWarning(true);
      setTimeout(() => setNoKeyWarning(false), 3000);
      return;
    }
    // Convert side-panel `Attachment` (UI-shaped) into the wire-shape the
    // chat-store + conversion layer understand. Only image attachments
    // with a usable preview survive — non-image attachments aren't yet
    // wired through to the LLM.
    const userImages = attachments
      .filter(a => a.preview && a.type.startsWith('image/'))
      .map(a => ({ mediaType: a.type, dataUrl: a.preview!, name: a.name }));

    // Slash-command shortcut expansion. If the draft is exactly `/<command>`
    // (with optional trailing whitespace) and matches a saved action, swap
    // in the stored prompt body before sending. The agent never sees the
    // literal `/foo`; it sees the action's prompt as if the user typed it.
    // Skills go through `onSkillSelect` (driven by the slash-menu pick) so
    // they don't intersect with this path.
    let textToSend = draft;
    const trimmed = draft.trim();
    const slashMatch = trimmed.match(/^\/([a-z0-9-_]+)\s*$/i);
    if (slashMatch) {
      const action = await savedPromptsStorage.findByCommand(slashMatch[1]);
      if (action) {
        // If the action has a starting URL, hint the agent to land there
        // first. We pass it as a leading directive instead of forcing a
        // navigate ourselves so the agent can skip it when the user is
        // already on the right tab.
        textToSend = action.url
          ? `Open ${action.url} in this tab first if you're not already there. Then:\n\n${action.prompt}`
          : action.prompt;
        void savedPromptsStorage.recordUsage(action.id);
      }
    }

    sendPrompt(textToSend, userImages.length > 0 ? userImages : undefined);
    setDraft('');
    setAttachments([]);
  };

  const onSkillSelect = async (skill: Skill, args: string) => {
    setDraft('');
    // The background SW resolves the skill — applies session-scoped runtime
    // overrides (allowed-tools, model), records the invocation for compaction
    // survival, bumps the usage counter — and returns the expanded body so we
    // can submit it as a normal user prompt.
    try {
      const conversationId = useChatStore.getState().conversationId;
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const result = (await chrome.runtime.sendMessage({
        type: 'doe/skills/invoke',
        skillId: skill.id,
        args,
        conversationId,
        tabId: activeTab?.id,
      })) as { ok?: boolean; expanded?: string; error?: string } | undefined;
      if (result?.ok && typeof result.expanded === 'string') {
        sendPrompt(result.expanded);
      } else {
        // Fall back to sending the raw skill body — the model can still match
        // the slash command via the `skill` tool listing.
        sendPrompt(skill.body);
      }
    } catch (err) {
      console.warn('[doeverything] skill invoke failed', err);
      sendPrompt(skill.body);
    }
  };

  const onAttachFiles = async (files: File[]) => {
    const loaded = await Promise.all(
      files.map(async (file): Promise<Attachment> => {
        const id = `att_${Math.random().toString(36).slice(2, 8)}`;
        // Images: resize to 1568px long-edge + WebP q0.85 BEFORE storing.
        // Vision models bill per pixel; a 4K wallpaper costs 5-10× the
        // tokens of the same content at 1568px with no perceived loss.
        // `maxBytes` keeps the encoded payload under the per-image cap
        // by walking q=0.85 → 0.40 only when needed.
        if (file.type.startsWith('image/')) {
          try {
            const opt = await optimizeBlobForLLM(file, { maxBytes: 700_000 });
            return { id, name: file.name, type: opt.mediaType, size: opt.bytes, preview: opt.dataUrl };
          } catch (err) {
            console.warn('[doeverything] image optimize failed, falling back to raw:', err);
            // Fall through to the raw-FileReader path below.
          }
        }
        return new Promise(resolve => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve({
              id,
              name: file.name,
              type: file.type || 'application/octet-stream',
              size: file.size,
              preview: file.type.startsWith('image/') ? (reader.result as string) : undefined,
            });
          if (file.type.startsWith('image/')) reader.readAsDataURL(file);
          else
            resolve({
              id,
              name: file.name,
              type: file.type || 'application/octet-stream',
              size: file.size,
            });
        });
      }),
    );
    setAttachments(prev => [...prev, ...loaded]);
  };

  const [regionCapturing, setRegionCapturing] = useState(false);
  const onCaptureRegion = async () => {
    if (regionCapturing) return;
    setRegionCapturing(true);
    try {
      const result = (await chrome.runtime.sendMessage({ type: 'doe/region-screenshot/start' })) as {
        ok?: boolean;
        dataUrl?: string;
        width?: number;
        height?: number;
        bytes?: number;
        error?: string;
      } | undefined;
      if (result?.ok && result.dataUrl) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19);
        setAttachments(prev => [
          ...prev,
          {
            id: `att_${Math.random().toString(36).slice(2, 8)}`,
            name: `region-${result.width}x${result.height}-${stamp}.webp`,
            type: 'image/webp',
            size: result.bytes ?? 0,
            preview: result.dataUrl,
          },
        ]);
      } else if (result?.error && result.error !== 'Cancelled by user') {
        console.warn('[doeverything] region screenshot failed:', result.error);
      }
    } catch (err) {
      console.warn('[doeverything] region screenshot error:', err);
    } finally {
      setRegionCapturing(false);
    }
  };

  const agentBusy = status === 'streaming' || status === 'submitting' || status === 'awaiting-tool';

  // Stable identity — MessageRow is memoized, and a fresh callback per
  // render would force every row to re-render on each streaming delta.
  const openSaveMessageAsAction = useCallback(
    (prompt: string) =>
      setSaveAction({
        open: true,
        prefill: { prompt },
        source: 'message',
        loading: false,
      }),
    [],
  );

  /**
   * Asks the SW's fast-model to distill the entire conversation into a
   * replayable action. We open the modal *immediately* in loading state so
   * the user gets feedback that something's happening; when the LLM result
   * lands we swap in the real prefill. On failure we fall back to a
   * simple join of user messages so the user is never blocked.
   */
  const openSaveChatAsAction = async () => {
    if (convertingChat) return;
    const flatMessages = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => ({
        role: m.role as 'user' | 'assistant',
        text: m.parts
          .filter((p): p is { kind: 'text'; text: string } => p.kind === 'text')
          .map(p => p.text)
          .join('\n')
          .trim(),
      }))
      .filter(m => m.text.length > 0);

    if (flatMessages.length === 0) return;

    setConvertingChat(true);
    setSaveAction({
      open: true,
      prefill: { prompt: '' },
      source: 'chat',
      loading: true,
    });

    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'doe/conversation/convert-to-action',
        messages: flatMessages,
      })) as
        | {
            ok: true;
            action: {
              name: string;
              command?: string;
              prompt: string;
              url?: string;
              schedule: {
                repeat: 'once' | 'daily' | 'weekly' | 'monthly' | 'custom_minutes';
                datetimeISO?: string;
                customMinutes?: number;
              } | null;
            };
          }
        | { ok: false; error: string }
        | undefined;

      if (res && 'ok' in res && res.ok) {
        const a = res.action;
        const nextRunAt = a.schedule?.datetimeISO
          ? new Date(a.schedule.datetimeISO).getTime()
          : undefined;
        setSaveAction({
          open: true,
          prefill: {
            name: a.name,
            command: a.command,
            prompt: a.prompt,
            url: a.url,
            schedule: a.schedule
              ? {
                  repeat: a.schedule.repeat,
                  nextRunAt: nextRunAt && !Number.isNaN(nextRunAt) ? nextRunAt : undefined,
                  customMinutes: a.schedule.customMinutes,
                }
              : undefined,
          },
          source: 'chat',
          loading: false,
        });
      } else {
        // Distillation failed — fall back to the joined-user-messages
        // baseline so the user can still save *something*.
        const joined = flatMessages
          .filter(m => m.role === 'user')
          .map(m => m.text)
          .join('\n\n');
        setSaveAction({
          open: true,
          prefill: { prompt: joined },
          source: 'chat',
          loading: false,
        });
      }
    } catch (err) {
      console.warn('[doeverything] convert-to-action failed:', err);
      const joined = flatMessages
        .filter(m => m.role === 'user')
        .map(m => m.text)
        .join('\n\n');
      setSaveAction({
        open: true,
        prefill: { prompt: joined },
        source: 'chat',
        loading: false,
      });
    } finally {
      setConvertingChat(false);
    }
  };

  if (!hasModelAccess && !setupDismissed) {
    return <ModelSetupScreen onDismiss={() => setSetupDismissed(true)} mcpConnected={isConnected} />;
  }

  return (
    <FileDropZone onDrop={onAttachFiles} className="bg-background text-foreground flex h-full min-h-0 flex-col">
      <Header
        isLight={isLight}
        onToggleTheme={exampleThemeStorage.toggle}
        onClear={() => setConfirmClear(true)}
        agentBusy={agentBusy}
        onSaveChatAsAction={openSaveChatAsAction}
        convertingChat={convertingChat}
        hasMessages={messages.length > 0}
      />
      <NotificationBanner />
      <ProviderBanner />
      {error && (
        <div className={cn('border-destructive/40 bg-destructive/10 text-destructive border-b px-3 py-2 text-xs')}>
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <MessageList messages={messages} busy={agentBusy} onSaveMessageAsAction={openSaveMessageAsAction} />
      </div>
      <ContextStrip />
      <SlashCommandMenu prompt={draft} onSelect={onSkillSelect} />
      {noKeyWarning && (
        <div className="border-warning/20 bg-warning/10 text-warning border-t px-3 py-2 text-center text-xs">
          API key required to send messages.{' '}
          <button
            className="underline"
            onClick={() =>
              void chrome.tabs.create({ url: chrome.runtime.getURL('options/index.html#llm') })
            }>
            Add API Key
          </button>
        </div>
      )}
      <Composer
        value={draft}
        onChange={setDraft}
        onSubmit={onSubmit}
        onAbort={abort}
        status={status}
        placeholder="Ask Doe to do something on the web…  /skill-name to use a skill"
        attachments={attachments}
        onAttachFiles={onAttachFiles}
        onRemoveAttachment={id => setAttachments(prev => prev.filter(a => a.id !== id))}
        onCaptureRegion={onCaptureRegion}
        regionCapturing={regionCapturing}
      />
      <PermissionPrompt />
      <VersionBlockScreen />
      <ConfirmationDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Start a new conversation?"
        description="Clears the chat history in this side panel. Saved skills, scheduled tasks, and settings stay."
        confirmLabel="Clear"
        destructive
        onConfirm={clear}
      />
      <FeedbackDialog open={showFeedback} onOpenChange={setShowFeedback} />
      <SaveActionDialog
        open={saveAction.open}
        onOpenChange={open => setSaveAction(prev => ({ ...prev, open }))}
        prefill={saveAction.prefill}
        source={saveAction.source}
        loading={saveAction.loading}
        onSaved={info => {
          // Drop the saved action's slash command into the composer so the
          // user can submit it immediately. The submit-time expander below
          // will resolve `/<command>` to the stored prompt body.
          if (info.command) setDraft(`/${info.command} `);
        }}
      />
    </FileDropZone>
  );
};

const SidePanel = () => (
  <Providers>
    <SidePanelInner />
  </Providers>
);

export default withErrorBoundary(withSuspense(SidePanel, <LoadingSpinner />), ErrorDisplay);
