import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useBridge } from '../bridge/BridgeContext';
import type { IncomingMessage } from '../bridge/messageTypes';
import { useAskInput } from '../logic/useReplay';
import { useImport } from './importState';
import { preload, useLoaded } from './lazyModule';
import { loadPalette, usePalette } from './palette/paletteState';
import { useShell } from './store';
import { loadExamples, useUi } from './ui';

// The Input needed dialog of today (common/DialogShell): its code comes with the first question.
const loadAskInput = () => import('../components/AskInputDialog');
// What listens out of sight (the update's splash, the tray's doors): at the first idle moment.
const loadWatch = () => import('./watch');

/**
 * What opens over the whole shell: Ctrl+K, "Input needed" — the {input:Label} token asking for a
 * value in the middle of a run (dialogos-080): over everything, not closed by a press outside, Esc
 * or Cancel stopping the run — the examples' browser and the update's splash. All listen from the
 * start; their code loads when first needed.
 */
export function Overlays() {
  return (
    <>
      <Palette />
      <InputNeeded />
      <Examples />
      <Watch />
    </>
  );
}

function Examples() {
  const open = useUi(s => s.examples !== null);
  const mod = useLoaded(loadExamples);
  useEffect(() => {
    if (open && !mod) void preload(loadExamples);
  }, [open, mod]);
  const Dialog = mod?.default;
  return open && Dialog ? <Dialog /> : null;
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

/**
 * The watch (watch.tsx) comes at the first idle moment after the opening. The engine checks for an
 * update as soon as the page is up, so what it says meanwhile is kept here and handed over, as is a
 * tray door asked before it came; either one brings it at once.
 */
const early: IncomingMessage[] = [];
function Watch() {
  const booted = useShell(s => s.booted);
  const mod = useLoaded(loadWatch);
  const { subscribe } = useBridge();
  useEffect(() => (mod ? undefined : subscribe((m) => {
    if (!m.type.startsWith('update:') && !m.type.startsWith('coexist:') && !m.type.startsWith('import:') && m.type !== 'extension:openHelp' && m.type !== 'automation:open' && m.type !== 'tray:command') return;
    early.push(m);
    void preload(loadWatch);
  })), [mod, subscribe]);
  useEffect(() => {
    if (mod || !booted) return;
    const id = requestIdleCallback(() => { void preload(loadWatch); });
    return () => cancelIdleCallback(id);
  }, [mod, booted]);
  // Settings › General opens the import dialog, which lives in the watch's chunk.
  const importing = useImport(s => s.open);
  useEffect(() => { if (importing && !mod) void preload(loadWatch); }, [importing, mod]);
  const Loaded = mod?.Watch;
  return Loaded ? <Loaded early={early} /> : null;
}
