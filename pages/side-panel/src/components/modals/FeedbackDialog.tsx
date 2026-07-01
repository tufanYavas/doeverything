import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Textarea,
} from '@doeverything/ui';
import { MessageSquare, Send } from 'lucide-react';
import { useState } from 'react';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * FeedbackDialog — collects free-text feedback and stores it in
 * `chrome.storage.local` under `doe:feedback`. A future build can
 * forward submissions to a remote endpoint when telemetry is enabled.
 */
export function FeedbackDialog({ open, onOpenChange }: Props) {
  const [text, setText] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const entry = { text: text.trim(), at: Date.now(), version: chrome.runtime.getManifest().version };
    if (!entry.text) return;
    const record = await chrome.storage.local.get('doe:feedback');
    const list = (record?.['doe:feedback'] as Array<typeof entry> | undefined) ?? [];
    list.push(entry);
    await chrome.storage.local.set({ 'doe:feedback': list });
    setSent(true);
    setText('');
    setTimeout(() => {
      setSent(false);
      onOpenChange(false);
    }, 1200);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="bg-primary/10 mb-2 flex h-10 w-10 items-center justify-center rounded-full">
            <MessageSquare className="text-primary h-5 w-5" />
          </div>
          <DialogTitle>Send feedback to doeverything</DialogTitle>
          <DialogDescription>
            Tell us what's working and what isn't. We store this locally — nothing is sent unless you opted into
            telemetry.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="fb">Your message</Label>
          <Textarea
            id="fb"
            rows={6}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="What happened?"
          />
        </div>
        <DialogFooter className="flex-row gap-2 sm:justify-between">
          <span className={sent ? 'text-success text-xs font-medium' : 'text-muted-foreground text-xs'}>
            {sent ? 'Saved · thank you!' : ' '}
          </span>
          <Button onClick={submit} disabled={!text.trim()}>
            <Send className="h-4 w-4" /> Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
