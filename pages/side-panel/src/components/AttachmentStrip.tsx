import { ImageLightbox } from './ImageLightbox';
import { FileText, X } from 'lucide-react';
import { useState } from 'react';

/**
 * AttachmentStrip — chip list above the composer.
 *
 *   - Image attachments: 64×64 rounded thumbnail. Click to enlarge in a
 *     fullscreen lightbox (Esc / backdrop click closes). Remove (×) badge
 *     appears top-right on hover only, with a "Remove" tooltip — keeps
 *     the resting state minimal (Claude / ChatGPT pattern).
 *   - Non-image attachments: file icon + truncated name (no preview to
 *     show, so the name has to stay).
 *
 * Layout note on the × badge: the inner thumbnail uses `overflow-hidden`
 * so `rounded-lg` clips the image. The badge sits on a SEPARATE outer
 * wrapper (no overflow clipping) so its half-protruding circle isn't
 * cut by the thumbnail's rounded corner.
 */

export interface Attachment {
  id: string;
  name: string;
  type: string;
  /** Bytes. */
  size: number;
  /** Optional preview URL (data: or blob:). */
  preview?: string;
}

interface Props {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

export function AttachmentStrip({ attachments, onRemove }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (attachments.length === 0) return null;
  const expanded = expandedId ? attachments.find(a => a.id === expandedId) : null;

  return (
    <>
      <div className="mx-auto flex w-full max-w-2xl flex-wrap gap-2 px-3 pb-2 pt-1">
        {attachments.map(att => {
          const isImage = att.type.startsWith('image/') && !!att.preview;
          return isImage ? (
            <ImageThumb key={att.id} att={att} onRemove={onRemove} onExpand={() => setExpandedId(att.id)} />
          ) : (
            <FileChip key={att.id} att={att} onRemove={onRemove} />
          );
        })}
      </div>
      {expanded?.preview && <ImageLightbox preview={expanded.preview} onClose={() => setExpandedId(null)} />}
    </>
  );
}

function ImageThumb({
  att,
  onRemove,
  onExpand,
}: {
  att: Attachment;
  onRemove: (id: string) => void;
  onExpand: () => void;
}) {
  return (
    // `group` lets the × badge react to hover anywhere inside the wrapper.
    // No overflow-hidden here so the badge can protrude past the rounded
    // corner without getting clipped.
    <div className="group relative">
      <button
        type="button"
        onClick={onExpand}
        aria-label="Expand image"
        className="border-border/70 bg-muted shadow-soft block h-16 w-16 cursor-zoom-in overflow-hidden rounded-lg border transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <img src={att.preview} alt={att.name} className="h-full w-full object-cover" draggable={false} />
      </button>
      <RemoveBadge onClick={() => onRemove(att.id)} />
    </div>
  );
}

function FileChip({ att, onRemove }: { att: Attachment; onRemove: (id: string) => void }) {
  return (
    <div className="group relative">
      <div className="border-border/60 bg-card shadow-soft inline-flex h-16 max-w-[180px] items-center gap-2 rounded-lg border px-3 text-xs">
        <FileText className="text-primary h-4 w-4 flex-shrink-0" />
        <span className="truncate font-mono">{att.name}</span>
      </div>
      <RemoveBadge onClick={() => onRemove(att.id)} />
    </div>
  );
}

function RemoveBadge({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={e => {
        // Don't propagate to the thumbnail's expand-on-click handler.
        e.stopPropagation();
        onClick();
      }}
      title="Remove"
      aria-label="Remove attachment"
      // Hover-only: invisible at rest, fades in on group hover or focus.
      // Focus-visible keeps keyboard-only users able to remove without a mouse.
      className="bg-foreground/90 text-background hover:bg-foreground shadow-soft absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100 focus:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring">
      <X className="h-3 w-3" strokeWidth={2.75} />
    </button>
  );
}

