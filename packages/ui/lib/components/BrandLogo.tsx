import { BrandMark } from './BrandMark';
import { cn } from '../utils';

interface BrandLogoProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: 'sm' | 'md' | 'lg';
  showWordmark?: boolean;
  pulsing?: boolean;
}

const SIZES = {
  sm: { mark: 18, text: 'text-xs' },
  md: { mark: 22, text: 'text-sm' },
  lg: { mark: 30, text: 'text-base' },
} as const;

export function BrandLogo({
  size = 'md',
  showWordmark = true,
  pulsing = false,
  className,
  ...rest
}: BrandLogoProps) {
  const s = SIZES[size];
  return (
    <div className={cn('inline-flex select-none items-center gap-2', s.text, className)} {...rest}>
      <BrandMark size={s.mark} pulsing={pulsing} />
      {showWordmark && (
        <span className="font-medium tracking-tight">
          doeverythi<span className="text-primary">ng</span>
        </span>
      )}
    </div>
  );
}
