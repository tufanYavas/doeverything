import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@doeverything/ui';
import { ShieldOff } from 'lucide-react';

/**
 * QuickModeConfirm.
 *
 * Shown the first time the user switches to `skip_all_permission_checks`.
 * Confirms they understand the agent will act without asking.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export function QuickModeConfirm({ open, onOpenChange, onConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="bg-destructive/10 mb-2 flex h-10 w-10 items-center justify-center rounded-full">
            <ShieldOff className="text-destructive h-5 w-5" />
          </div>
          <DialogTitle>Switch to "Skip all permission checks"?</DialogTitle>
          <DialogDescription>
            doeverything will perform every action without asking. Use this only on tasks you fully trust the agent with —
            think research and read-only flows, not anything that submits forms or spends money.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}>
            Yes, switch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
