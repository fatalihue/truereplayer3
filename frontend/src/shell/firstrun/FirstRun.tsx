import { useEffect, useState, type DragEvent, type ReactNode } from 'react';
import { BookOpen, Download, ListPlus, Upload } from 'lucide-react';
import { APP_NAME, TR2_NAME } from '../../appIdentity';
import { useBridge } from '../../bridge/BridgeContext';
import type { Tr2ImportSummary } from '../../bridge/messageTypes';
import { t } from '../../i18n';
import { useMacro } from '../../logic/useMacro';
import { useToast } from '../../state/ToastContext';
import { openImport } from '../importState';
import { freeName, keycaps } from '../library/model';
import { whenOpen } from '../recordNew';
import { useApp } from '../store';
import { armTips } from '../tips/tipsState';
import { openExamples, useUi } from '../ui';
import { UNTITLED_MACRO } from '../untitled';
import './firstRun.css';

/**
 * What TrueReplayer 2 would bring, said in a line: "141 macros in 15 folders, settings, key remaps and
 * theme". Each part comes whole from the catalog, and so does the "and" before the last one.
 */
function tr2Parts(s: Tr2ImportSummary): string {
  const macros = s.macros > 0 ? t('shell.import.macros', { count: s.macros }) : '';
  // Its own name, not a t() inside the blank: the build replaces a t() that is a blank's whole value
  // only when it sits inside something else.
  const folderCount = t('shell.import.folders', { count: s.folders });
  const parts = [
    macros && s.folders > 0 ? t('shell.import.macrosInFolders', { macros, folderCount }) : macros,
    s.settings ? t('firstrun.tr2.settings') : '',
    s.remaps > 0 ? t('firstrun.tr2.remaps') : '',
    s.appearance ? t('firstrun.tr2.theme') : '',
  ].filter(Boolean);
  return parts.length > 1 ? t('firstrun.tr2.list', { first: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] }) : parts[0] ?? '';
}

/**
 * The first use (phase 5; biblioteca-011, FirstRun board): with no macro yet, this takes the place of
 * the macro's zones. Three ways to start — record the task, build it from the catalog, or start from
 * one of the examples inside the app (decision 4). With TrueReplayer 2's data on this computer, the
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

  // A new macro, born saved and open as "Untitled macro" (in the interface's language); then the
  // recording starts in it, or its catalog opens — pressed on the insert row's own Add step, once that
  // row is drawn for it (the frame after the macro opens), so it opens where it always does.
  const make = (then: 'record' | 'catalog') => {
    if (going) return;
    setGoing(true);
    window.setTimeout(() => setGoing(false), 4000);
    const name = freeName(UNTITLED_MACRO, profiles.map(p => p.name));
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
    if (!file) showToast(t('firstrun.dropOnly'), 'error');
    else if (!webview?.postMessageWithAdditionalObjects) startImport?.();
    else {
      try {
        webview.postMessageWithAdditionalObjects({ type: 'profile:importDropped', payload: {} }, [file]);
      } catch {
        showToast(t('firstrun.dropUnreadable'), 'error');
      }
    }
  };

  const record = (
    <Way
      key="record"
      label={t('firstrun.record.title')}
      tile={<span className="fr-tile" data-tone="record"><span className="hdr-rec-dot" aria-hidden="true" /></span>}
      text={t('firstrun.record.text')}
      action={(
        <div className="hdr-split" data-tone="record" data-disabled={!ready || going || undefined}>
          <button type="button" className="hdr-run" disabled={!ready || going} onClick={() => make('record')}>
            <span className="hdr-rec-dot" aria-hidden="true" />
            {t('common.actions.record')}
            {recordKey && <kbd className="kbd">{keycaps(recordKey)}</kbd>}
          </button>
        </div>
      )}
    />
  );
  const build = (
    <Way
      key="build"
      label={t('firstrun.build.title')}
      tile={<span className="fr-tile" data-tone="accent"><ListPlus aria-hidden="true" /></span>}
      text={t('firstrun.build.text')}
      action={<button type="button" className="fr-button" disabled={!ready || going} onClick={() => make('catalog')}><span className="step-icon" data-icon="plus" />{t('firstrun.build.button')}</button>}
    />
  );
  const example = (
    <Way
      key="example"
      label={t('firstrun.example.title')}
      tile={<span className="fr-tile"><BookOpen aria-hidden="true" /></span>}
      text={t('firstrun.example.text')}
      action={<button type="button" className="fr-button" onClick={() => openExamples()}>{t('firstrun.example.button')}</button>}
    />
  );
  const fromTr2 = tr2?.tr2Found && (
    <Way
      key="tr2"
      label={t('shell.import.title', { tr2: TR2_NAME })}
      tile={<span className="fr-tile" data-tone="accent"><Download aria-hidden="true" /></span>}
      text={t('firstrun.tr2.text', { parts: tr2Parts(tr2), tr2: TR2_NAME })}
      note={tr2.tr2Running ? t('shell.import.closeTr2First', { tr2: TR2_NAME }) : undefined}
      action={<button type="button" className="fr-button" data-primary="" onClick={() => openImport()}>{t('common.actions.importEllipsis')}</button>}
    />
  );

  return (
    <main
      className="fr"
      aria-label={t('firstrun.title')}
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
          <h1 className="fr-title">{t('firstrun.title')}</h1>
          <p className="fr-lead">{t('firstrun.lead', { app: APP_NAME })}</p>
        </header>

        <div className="fr-ways">{fromTr2 ? [fromTr2, record, example] : [record, build, example]}</div>

        <div className="fr-drop" data-over={over || undefined}>
          <Upload aria-hidden="true" />
          <span>{t('firstrun.drop')}</span>
          <button type="button" className="fr-button" disabled={!startImport} onClick={() => startImport?.()}>{t('common.actions.importEllipsis')}</button>
        </div>

        <section className="fr-how" aria-label={t('firstrun.how.label')}>
          <How n={1} label={t('common.actions.record')} keys={recordKey} text={t('firstrun.how.record')} />
          <How n={2} label={t('common.actions.replay')} keys={replayKey} text={t('firstrun.how.replay')} />
          <How n={3} label={t('firstrun.how.shortcut')} text={t('firstrun.how.shortcutText')} />
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
