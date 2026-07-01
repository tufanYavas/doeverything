import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@doeverything/ui';
import { Hammer, Rocket } from 'lucide-react';

/**
 * AntBuildUpsell.
 *
 * Lightweight nag the side panel can show when the user pushes a complex
 * multi-step build prompt and the agent could benefit from a longer context
 * model. Stores `doe:antbuild-dismissed` to suppress repeats.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpgrade: () => void;
}

export function AntBuildUpsell({ open, onOpenChange, onUpgrade }: Props) {
  const dismiss = async () => {
    await chrome.storage.local.set({ 'doe:antbuild-dismissed': { ts: Date.now() } });
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="bg-primary/10 mb-2 flex h-10 w-10 items-center justify-center rounded-full">
            <Hammer className="text-primary h-5 w-5" />
          </div>
          <DialogTitle>Building something complex?</DialogTitle>
          <DialogDescription>
            doeverything can switch to a longer-context model on tasks like this. Provider switch happens for one run only —
            the rest of the conversation continues on your default LLM.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={dismiss}>
            Don't show again
          </Button>
          <Button
            onClick={() => {
              onUpgrade();
              onOpenChange(false);
            }}>
            <Rocket className="h-4 w-4" /> Try it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
