import { cn } from '../utils';

interface BrandMarkProps extends React.SVGAttributes<SVGSVGElement> {
  /** Pixel size of the square mark. */
  size?: number;
  /** Adds the twinkle animation to the star lines (agent busy state). */
  pulsing?: boolean;
}

/**
 * Standalone brand mark — the solidD glyph: a terracotta D-letter shape with
 * a circular O-cutout in the stem, holding a 3-line asterisk at its center.
 * Derived from the `doeverything-glyph-solidD` brand asset. Drawn on a 100×100
 * grid so it maps directly to the brand SVG coordinates.
 *
 * The solid app-icon / favicon tile lives as a standalone asset in
 * `chrome-extension/public/icon.svg`.
 */
export function BrandMark({ size = 24, pulsing = false, className, ...rest }: BrandMarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="doeverything"
      className={cn('shrink-0', className)}
      {...rest}>
      {/* D-letter shape with circular inner cutout (fill-rule evenodd creates the O hole) */}
      <path
        fillRule="evenodd"
        fill="#d2754f"
        d="M20 18 H50 A32 32 0 0 1 50 82 H20 Z M49 30 A20 20 0 1 0 49 70 A20 20 0 1 0 49 30 Z"
      />
      {/* Circle ring inside the O cutout */}
      <circle cx="49" cy="50" r="15" fill="none" stroke="#d2754f" strokeWidth="4" />
      {/* 3-line asterisk (vertical + two diagonals) */}
      <g
        stroke="#F5C518"
        strokeWidth="4"
        strokeLinecap="round"
        className={cn(pulsing && 'de-twinkle')}>
        <line x1="49" y1="41.5" x2="49" y2="58.5" />
        <line x1="41.6" y1="45.75" x2="56.4" y2="54.25" />
        <line x1="56.4" y1="45.75" x2="41.6" y2="54.25" />
      </g>
    </svg>
  );
}
