import { cn } from '../utils';
import { forwardRef } from 'react';

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'border-input bg-card flex min-h-[60px] w-full rounded-lg border px-3 py-2 text-sm transition-[border-color,box-shadow] duration-150',
        'shadow-[inset_0_1px_2px_hsl(var(--shadow)/0.04)]',
        'placeholder:text-muted-foreground/80 resize-none',
        'focus-visible:border-ring/60 focus-visible:ring-ring/25 focus-visible:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
