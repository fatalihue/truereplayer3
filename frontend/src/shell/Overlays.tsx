import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useAskInput } from '../logic/useReplay';
import { preload, useLoaded } from './lazyModule';
import { loadPalette, usePalette } from './palette/paletteState';

// The Input needed dialog of today (common/DialogShell): its code comes with the first question.
const loadAskInput = () => import('../components/AskInputDialog');

/**
 * What opens over the whole shell: Ctrl+K, and "Input needed" — the {input:Label} token asking for
 * a value in the middle of a run (dialogos-080): over everything, not closed by a press outside, Esc
 * or Cancel stopping the run. Both listen from the start; their code loads when first needed.
 */
export function Overlays() {
  return (
    <>
      <Palette />
      <InputNeeded />
    </>
  );
}

function Palette() {
  const open = usePalette(s => s.open);
  const mod = useLoaded(loadPalette);
  useEffect(() => {
    if (open && !mod) void preload(loadPalette);
  }, [open, mod]);
  const CommandPalette = mod?.default;
  return open && CommandPalette ? <CommandPalette /> : null;
}

function InputNeeded() {
  const { request, submit, cancel } = useAskInput();
  const mod = useLoaded(loadAskInput);
  useEffect(() => {
    if (request && !mod) void preload(loadAskInput);
  }, [request, mod]);
  const Dialog = mod?.AskInputDialog;
  if (!request || !Dialog) return null;
  return createPortal(
    <Dialog key={request.requestId} label={request.label} options={request.options} onSubmit={submit} onCancel={cancel} />,
    document.body,
  );
}
