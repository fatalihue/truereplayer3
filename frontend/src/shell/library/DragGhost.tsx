import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Folder } from 'lucide-react';
import type { DragKind } from './useLibraryDrag';

const at = (x: number, y: number) => `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%) rotate(1.5deg)`;

/**
 * The card that follows the pointer while a macro or a folder is dragged. It follows on its own,
 * by transform once a frame (rule 8), so the move never re-renders the library.
 */
export function DragGhost({ kind, name, x, y }: { kind: DragKind; name: string; x: number; y: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let frame = 0;
    let px = x;
    let py = y;
    const move = (e: MouseEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (ref.current) ref.current.style.transform = at(px, py);
      });
    };
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('mousemove', move);
      cancelAnimationFrame(frame);
    };
  }, [x, y]);
  return createPortal(
    <div ref={ref} className="lib-ghost" style={{ transform: at(x, y) }}>
      {kind === 'folder' ? <Folder aria-hidden="true" /> : <FileText aria-hidden="true" />}
      {name}
    </div>,
    document.body,
  );
}
