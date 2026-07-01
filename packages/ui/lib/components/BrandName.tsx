import { cn } from '../utils';

interface BrandNameProps extends React.HTMLAttributes<HTMLSpanElement> {}

/**
 * Inline brand wordmark — "doeverything" with "ng" in terracotta.
 * Use in headings, dialogs, and body text where just the styled name is needed
 * without the icon. For the full logo (icon + wordmark) use <BrandLogo />.
 */
export function BrandName({ className, ...rest }: BrandNameProps) {
  return (
    <span className={cn('font-medium', className)} {...rest}>
      doeverythi<span className="text-primary">ng</span>
    </span>
  );
}
