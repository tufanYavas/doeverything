import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@doeverything/ui';
import { AlertTriangle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Reusable destructive/info confirmation dialog. The chat clear button,
 * sign-out, and skip-permission switch all hand off to this component to
 * stay consistent.
 */
interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  icon?: LucideIcon;
  onConfirm: () => void;
}

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  destructive,
  icon: Icon = AlertTriangle,
  onConfirm,
}: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div
            className={
              destructive
                ? 'bg-destructive/10 mb-2 flex h-10 w-10 items-center justify-center rounded-full'
                : 'bg-warning/10 mb-2 flex h-10 w-10 items-center justify-center rounded-full'
            }>
            <Icon className={destructive ? 'text-destructive h-5 w-5' : 'text-warning h-5 w-5'} />
          </div>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel ?? 'Cancel'}
          </Button>
          <Button
            variant={destructive ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm();
              onOpenChange(false);
            }}>
            {confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
