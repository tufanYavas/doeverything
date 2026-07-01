import { cn } from '../utils';
import { forwardRef } from 'react';

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      ref={ref}
      className={cn(
        'border-input bg-card flex h-9 w-full rounded-lg border px-3 py-1 text-sm transition-[border-color,box-shadow] duration-150',
        'shadow-[inset_0_1px_2px_hsl(var(--shadow)/0.04)]',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        'placeholder:text-muted-foreground/80',
        'focus-visible:border-ring/60 focus-visible:ring-ring/25 focus-visible:outline-none focus-visible:ring-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
