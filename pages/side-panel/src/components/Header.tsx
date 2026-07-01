import { ProviderPill } from './ProviderPill';
import { Button, BrandLogo, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@doeverything/ui';
import { Loader2, Settings, Sparkles, Sun, Moon, RotateCcw } from 'lucide-react';

interface HeaderProps {
  isLight: boolean;
  onToggleTheme: () => void;
  onClear: () => void;
  agentBusy: boolean;
  /**
   * Open the save-chat-as-action flow. The side panel asks the fast model
   * to distill the conversation into a replayable action and then opens
   * the modal prefilled. Hidden when the chat is empty.
   */
  onSaveChatAsAction?: () => void;
  /** True while the LLM conversion is in flight — drives the spinner. */
  convertingChat?: boolean;
  hasMessages?: boolean;
}

export function Header({
  isLight,
  onToggleTheme,
  onClear,
  agentBusy,
  onSaveChatAsAction,
  convertingChat = false,
  hasMessages,
}: HeaderProps) {
  const openOptions = () => chrome.runtime.openOptionsPage();

  return (
    <TooltipProvider delayDuration={300}>
      <header className="border-border/60 bg-background/80 flex items-center justify-between gap-2 border-b px-3 py-2.5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <BrandLogo size="md" pulsing={agentBusy} />
          <div className="hidden min-[401px]:block min-w-0 overflow-hidden">
            <ProviderPill />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {onSaveChatAsAction && hasMessages && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={onSaveChatAsAction}
                  disabled={convertingChat}
                  className="h-8 w-8"
                  aria-label="Save chat as action">
                  {convertingChat ? (
                    <Loader2 className="text-primary h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{convertingChat ? 'Distilling…' : 'Save chat as action'}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={onClear} className="h-8 w-8" aria-label="New conversation">
                <RotateCcw className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>New conversation</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={onToggleTheme} className="h-8 w-8" aria-label="Toggle theme">
                {isLight ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>Toggle theme</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon" variant="ghost" onClick={openOptions} className="h-8 w-8" aria-label="Settings">
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>
        </div>
      </header>
    </TooltipProvider>
  );
}
