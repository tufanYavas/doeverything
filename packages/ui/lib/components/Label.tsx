import { cn } from '../utils';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cva } from 'class-variance-authority';
import { forwardRef } from 'react';
import type { VariantProps } from 'class-variance-authority';

const labelVariants = cva(
  'text-xs font-semibold uppercase tracking-wide text-muted-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
);

export const Label = forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> & VariantProps<typeof labelVariants>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root ref={ref} className={cn(labelVariants(), className)} {...props} />
));
Label.displayName = 'Label';
