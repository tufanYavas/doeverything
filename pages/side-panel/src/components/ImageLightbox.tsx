import { X } from 'lucide-react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';

/**
 * Fullscreen image lightbox.
 *
 * Renders via React Portal into `document.body` so ancestor containing
 * blocks — most notably the Composer's `backdrop-blur`, which per CSS
 * spec turns it into a containing block for `position: fixed`
 * descendants — don't clip the modal. Without the portal the lightbox
 * was getting trapped inside the compose area.
 *
 * Escape, backdrop click, and the explicit × button all close. The
 * `keydown` listener is mounted only while a lightbox is rendered so it
 * never grabs Esc from anything else (slash-command menu, modals, …).
 */
export function ImageLightbox({ preview, onClose }: { preview: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    // Click on the backdrop (anywhere outside the image) closes the modal;
    // the image itself stops propagation so it isn't a close target.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[9999] flex cursor-zoom-out items-center justify-center bg-black/80 p-6 backdrop-blur-sm">
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- stopPropagation only; Esc + backdrop + × handle close */}
      <img
        src={preview}
        alt=""
        onClick={e => e.stopPropagation()}
        className="shadow-lifted max-h-full max-w-full cursor-default rounded-xl object-contain"
        draggable={false}
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="shadow-lifted absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
        <X className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  );
}
