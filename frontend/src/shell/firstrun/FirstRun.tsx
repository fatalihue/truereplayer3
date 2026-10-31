import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { BookOpen, Download, ListPlus, Upload } from 'lucide-react';
import { APP_NAME, TR2_NAME } from '../../appIdentity';
import { useBridge } from '../../bridge/BridgeContext';
import type { Tr2ImportSummary } from '../../bridge/messageTypes';
import { useMacro } from '../../logic/useMacro';
import { useToast } from '../../state/ToastContext';
import { openImport } from '../importState';
import { freeName, keycaps } from '../library/model';
import { useApp, useShell } from '../store';
import { armTips } from '../tips/tipsState';
import { openExamples, useUi } from '../ui';
import './firstRun.css';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What TrueReplayer 2 would bring, said in a line: "141 macros in 15 folders, settings, key remaps and theme". */
function tr2Parts(s: Tr2ImportSummary): string {
  const parts = [
    s.macros > 0 ? plural(s.macros, 'macro', 'macros') + (s.folders > 0 ? ` in ${plural(s.folders, 'folder', 'folders')}` : '') : '',
    s.settings ? 'settings' : '',
    s.remaps > 0 ? 'key remaps' : '',
    s.appearance ? 'theme' : '',
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0] ?? '';
}

/**
 * Runs `then` once the macro is the open one (and, to record, a recording may start): the engine
 * creates and opens a new macro a moment after it is asked. A create it refused never opens, and
 * nothing waits for it.
 */
function whenOpen(name: string, record: boolean, then: () => void) {
  let timer = 0;
  const stop = useShell.subscribe((s) => {
    if (s.app.activeProfile !== name || (record && !s.app.buttonStates.recordEnabled)) return;
    stop();
    clearTimeout(timer);
    then();
  });
  timer = window.setTimeout(stop, 10000);
}

/**
 * The first use (phase 5; biblioteca-011, FirstRun board): with no macro yet, this takes the place of
 * the macro's zones. Three ways to start — record the task, build it from the catalog, or start from
 * one of the 19 examples inside the app (decision 4). With TrueReplayer 2's data on this computer, the
 * first way is to bring it (plan truereplayer3-paralelo, phase C: it replaces the A4 offer), and the
 * catalog is still a press away in the macro the others make. A macro file dropped here, or Import…,
 * comes in as any import does. Under them, how a macro runs: the two global keys and its own shortcut.
 *
 * Someone new sees it: the tips of a first recording are armed here (tipsState).
 */
export default function FirstRun() {
  const { send, subscribe } = useBridge();
  const profiles = useApp(a => a.profiles);
  const recordKey = useApp(a => a.settings.recordingHotkey);
  const replayKey = useApp(a => a.settings.replayHotkey);
  const ready = useApp(a => a.status === 'ready' && !a.settings.useCursorClick);
  const startImport = useUi(s => s.startImport);
  const macro = useMacro();
  const { showToast } = useToast();
  const [tr2, setTr2] = useState<Tr2ImportSummary | null>(null);
  const [over, setOver] = useState(false);
  // A way chosen: a second press would make a second macro and run its follow-up twice (a recording
  // started and stopped). The screen goes once the macro opens; a create the engine refused frees it.
  const [going, setGoing] = useState(false);

  useEffect(() => { armTips(); }, []);
  // TrueReplayer 2's data, for the card that brings it.
  useEffect(() => {
    const stop = subscribe((m) => { if (m.type === 'import:summary') setTr2(m.payload); });
    send({ type: 'import:scan', payload: {} });
    return stop;
  }, [send, subscribe]);

  // A new macro, born saved and open as "Untitled macro"; then the recording starts in it, or its
  // catalog opens — pressed on the insert row's own Add step, once that row is drawn for it (the
  // frame after the macro opens), so it opens where it always does.
  const make = (then: 'record' | 'catalog') => {
    if (going) return;
    setGoing(true);
    window.setTimeout(() => setGoing(false), 4000);
    const name = freeName('Untitled macro', profiles.map(p => p.name));
    if (then === 'record') whenOpen(name, true, () => send({ type: 'recording:toggle', payload: { insertIndex: 0 } }));
    else whenOpen(name, false, () => requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.ins-add')?.click()));
    macro.create(name, null);
  };

  // A dropped file (FirstRun board: "Drop it here"): the page sends the File itself, and the engine
  // reads it from its path. Anything but a .trprofile is said, not tried; so is a file WebView2 will
  // not hand over, one that is not on the disk (dragged out of an archive, say).
  const files = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const drop = (e: DragEvent) => {
    if (!files(e)) return;
    e.preventDefault();
    setOver(false);
    const file = Array.from(e.dataTransfer.files).find(f => /\.trprofile$/i.test(f.name));
    const webview = window.chrome?.webview;
    if (!file) showToast('Only a .trprofile file, a macro export, comes in here.', 'error');
    else if (!webview?.postMessageWithAdditionalObjects) startImport?.();
    else {
      try {
        webview.postMessageWithAdditionalObjects({ type: 'profile:importDropped', payload: {} }, [file]);
      } catch {
        showToast('That file can’t be read from here. Save it to a folder first, or use Import….', 'error');
      }
    }
  };

  const record = (
    <Way
      key="record"
      label="Record it"
      tile={<span className="fr-tile" data-tone="record"><span className="hdr-rec-dot" aria-hidden="true" /></span>}
      text="Do the task once. Every click and key you press becomes a step."
      action={(
        <div className="hdr-split" data-tone="record" data-disabled={!ready || going || undefined}>
          <button type="button" className="hdr-run" disabled={!ready || going} onClick={() => make('record')}>
            <span className="hdr-rec-dot" aria-hidden="true" />
            Record
            {recordKey && <kbd className="kbd">{keycaps(recordKey)}</kbd>}
          </button>
        </div>
      )}
    />
  );
  const build = (
    <Way
      key="build"
      label="Build it step by step"
      tile={<span className="fr-tile" data-tone="accent"><ListPlus aria-hidden="true" /></span>}
      text="Pick steps from the catalog — click, key, text, wait, if — and fill them in."
      action={<button type="button" className="fr-button" disabled={!ready || going} onClick={() => make('catalog')}><span className="step-icon" data-icon="plus" />Add step</button>}
    />
  );
  const example = (
    <Way
      key="example"
      label="Start from an example"
      tile={<span className="fr-tile"><BookOpen aria-hidden="true" /></span>}
      text="19 short macros that show text tokens, variables, conditions and tables. Each one types into Notepad, so you can watch it work."
      action={<button type="button" className="fr-button" onClick={() => openExamples()}>Browse examples</button>}
    />
  );
  const fromTr2 = tr2?.tr2Found && (
    <Way
      key="tr2"
      label={`Import from ${TR2_NAME}`}
      tile={<span className="fr-tile" data-tone="accent"><Download aria-hidden="true" /></span>}
      text={`Your ${tr2Parts(tr2)}, as a copy: ${TR2_NAME} stays as it is.`}
      note={tr2.tr2Running ? `Close ${TR2_NAME} first: its files must not change while they are copied.` : undefined}
      action={<button type="button" className="fr-button" data-primary="" onClick={() => openImport()}>Import…</button>}
    />
  );

  return (
    <main
      className="fr"
      aria-label="Make your first macro"
      onDragOver={(e) => {
        if (!files(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setOver(true);
      }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={drop}
    >
      <div className="fr-body">
        <header className="fr-head">
          <h1 className="fr-title">Make your first macro</h1>
          <p className="fr-lead">A macro is a list of steps — clicks, keys, text and waits — that {APP_NAME} plays back for you, as many times as you want.</p>
        </header>

        <div className="fr-ways">{fromTr2 ? [fromTr2, record, example] : [record, build, example]}</div>

        <div className="fr-drop" data-over={over || undefined}>
          <Upload aria-hidden="true" />
          <span>Have a macro file? Drop it here, or</span>
          <button type="button" className="fr-button" disabled={!startImport} onClick={() => startImport?.()}>Import…</button>
        </div>

        <section className="fr-how" aria-label="How a macro runs">
          <How n={1} label="Record" keys={recordKey} text="Starts and stops recording, from any app." />
          <How n={2} label="Replay" keys={replayKey} text="Plays the macro. Press it again to stop." />
          <How n={3} label="Shortcut" text="Give the macro its own key to run it from any app." />
        </section>
      </div>
    </main>
  );
}

function Way({ label, tile, text, note, action }: { label: string; tile: ReactNode; text: string; note?: string; action: ReactNode }) {
  return (
    <section className="fr-way" aria-label={label}>
      {tile}
      <h2 className="fr-way-title">{label}</h2>
      <p className="fr-way-text">{text}</p>
      {note && <p className="fr-way-note" role="status">{note}</p>}
      <div className="fr-way-action">{action}</div>
    </section>
  );
}

function How({ n, label, keys, text }: { n: number; label: string; keys?: string; text: string }) {
  return (
    <div className="fr-how-item">
      <span className="fr-how-n" aria-hidden="true">{n}</span>
      <span className="fr-how-text">
        <span className="fr-how-label">{label}{keys && <kbd className="kbd">{keycaps(keys)}</kbd>}</span>
        <span>{text}</span>
      </span>
    </div>
  );
}
