import { cn } from '@doeverything/ui';
import { Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * FileDropZone.
 *
 * Wraps an arbitrary container and shows a dashed overlay while files are
 * being dragged over it. Caller receives `File[]` on drop.
 *
 * The overlay sits inside the container so it matches the side panel's
 * narrow width; we use `pointer-events: none` outside drag-over to keep
 * the underlying composer interactive.
 */

interface Props {
  onDrop: (files: File[]) => void;
  children: ReactNode;
  className?: string;
}

export function FileDropZone({ onDrop, children, className }: Props) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let depth = 0;
    const onDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer?.types?.includes('Files')) return;
      depth++;
      setActive(true);
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setActive(false);
    };
    const onDrop = () => {
      depth = 0;
      setActive(false);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div
      className={cn('relative', className)}
      onDragOver={e => {
        if (!e.dataTransfer.types?.includes('Files')) return;
        e.preventDefault();
      }}
      onDrop={e => {
        if (!e.dataTransfer.files?.length) return;
        e.preventDefault();
        onDrop(Array.from(e.dataTransfer.files));
        setActive(false);
      }}>
      {children}
      {active && (
        <div className="border-primary bg-primary/5 pointer-events-none absolute inset-0 z-30 m-1 rounded-2xl border-2 border-dashed backdrop-blur-sm">
          <div className="text-primary flex h-full items-center justify-center gap-2 text-sm font-medium">
            <Upload className="h-4 w-4" />
            Drop files to attach
          </div>
        </div>
      )}
    </div>
  );
}
