import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { AppWindow, ArrowRightLeft, Ban, Download, Ellipsis, Mouse, Plus, Upload, X } from 'lucide-react';
import type { RemapEntryDto } from '../../../bridge/messageTypes';
import { useBridge } from '../../../bridge/BridgeContext';
import { useEditorTools } from '../../../logic/useEditorTools';
import { SINGLE_KEY_CAPTURE_IDLE_MS, useKeyCapture } from '../../../logic/useKeyCapture';
import { remapKeyProblem, useRemaps } from '../../../logic/useRemaps';
import { useTt } from '../../../state/LanguageContext';
import { useToast } from '../../../state/ToastContext';
import { isModalDialogOpen } from '../../../utils/modalDialog';
import { DraftField, Keys, Segmented, Switch } from '../../inspector/fields';
import { ProcessPicker } from '../../inspector/probeKit';
import { useAsk } from '../../inspector/probes';
import { keycaps } from '../../library/model';
import { Menu } from '../../Menu';
import { anchorBelow, type MenuAnchor } from '../../menuAnchor';
import { useApp } from '../../store';
import { useUi } from '../../ui';
import {
  appName, describeKey, draftOf, draftProblem, emptyDraft, EXPORT_KIND, fromWarning, hotkeysOf, indexOf, MAX_REMAPS,
  mergeImport, MOUSE_TARGETS, mouseTarget, normProcess, parseRemapImport, refOf, ruleArrow, ruleKey, ruleOf, ruleWords,
  targetOf, toNote, type Draft,
} from './remapModel';
import { closePanel, commitList, listNow, stepList, useList, useRemapsUi, type Filter } from './remapsStore';
import '../../inspector/editors.css';
import './remaps.css';

/**
 * ② Key Remaps (phase 3, slice 5; the concept's KeyRemaps board): the rules, each with its On, what
 * it does and where, the filters and the count, Import and Export; and "Remap settings" beside them,
 * which applies as you type. A rule that is not one yet (a key still to press, the same key twice)
 * stays without effect until it is, with the reason in the panel. Ctrl+Z and Ctrl+Y undo and redo
 * the page's changes. Today's Settings › Keys › Key Remaps is the reference (components/RemapSection).
 */
export default function RemapsPage() {
  const list = useList();
  const open = useRemapsUi(s => s.open);
  const { save } = useRemaps();
  const editing = open && open !== 'new' ? indexOf(list.entries, open) : null;
  const panel = open === 'new' || editing !== null;
  const saveRef = useRef(save);
  useEffect(() => { saveRef.current = save; });

  // A rule the panel held that is gone (deleted, an undo): the panel goes with it.
  useEffect(() => { if (open && !panel) closePanel(); }, [open, panel]);
  // "New remap" asked from Ctrl+K, before the page was here or while it is.
  const asked = useUi(s => s.remapNew);
  useEffect(() => {
    if (!asked) return;
    useUi.setState({ remapNew: false });
    startNew();
  }, [asked]);

  // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z), while the page is on screen; a text field keeps its own.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.metaKey) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || t.tagName === 'TEXTAREA'
        || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)));
      if (typing || isModalDialogOpen()) return;
      e.preventDefault();
      const moved = stepList(key === 'z' && !e.shiftKey, saveRef.current);
      if (moved) followUndo(moved.before.entries, moved.after.entries);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="shell-page rm" aria-label="Key Remaps" data-panel={panel || undefined}>
      <div className="rm-main">
        <Head />
        <Quarantine />
        {list.entries.length > 0 ? <Rules editing={editing} /> : <Empty />}
      </div>
      {panel && <Panel editing={editing} />}
    </section>
  );
}

/** After an undo or a redo, the panel follows its rule into the list restored, or closes. */
function followUndo(before: RemapEntryDto[], after: RemapEntryDto[]) {
  const { open } = useRemapsUi.getState();
  if (!open || open === 'new') return;
  const at = indexOf(after, open) ?? indexOf(before, open);
  if (at === null || !after[at]) { closePanel(); return; }
  useRemapsUi.setState({ open: refOf(after, at), draft: draftOf(after[at]), refused: null });
}

function startNew() {
  if (listNow().entries.length >= MAX_REMAPS) return;
  useRemapsUi.setState({ open: 'new', draft: emptyDraft(), refused: null });
}
const startEdit = (i: number) => {
  const { entries } = listNow();
  if (entries[i]) useRemapsUi.setState({ open: refOf(entries, i), draft: draftOf(entries[i]), refused: null });
};

/** Deletes a rule, with an Undo that puts it back where it was (unless a rule like it came meanwhile). */
function useRemove() {
  const { save } = useRemaps();
  const { showToast } = useToast();
  const tt = useTt();
  return (i: number) => {
    const now = listNow();
    const rule = now.entries[i];
    if (!rule) return;
    commitList({ enabled: now.enabled, entries: now.entries.filter((_, j) => j !== i) }, save);
    const words = ruleArrow(rule);
    showToast(tt(`Removed the remap ${words}`, `Remap ${words} removido`), {
      type: 'success',
      duration: 10000,
      action: {
        label: 'Undo',
        onClick: () => {
          const back = listNow();
          if (back.entries.length >= MAX_REMAPS || back.entries.some(e => ruleKey(e) === ruleKey(rule))) return;
          const at = Math.min(i, back.entries.length);
          commitList({ enabled: back.enabled, entries: [...back.entries.slice(0, at), rule, ...back.entries.slice(at)] }, save);
        },
      },
    });
  };
}

function Head() {
  const tt = useTt();
  const list = useList();
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  const { save } = useRemaps();
  const full = list.entries.length >= MAX_REMAPS;
  return (
    <header className="rm-head">
      <div className="rm-titles">
        <h1 className="rm-title">Key Remaps</h1>
        <p className="rm-sub">Turn a key into another key, a mouse button or nothing, everywhere or in one app</p>
      </div>
      <div className="rm-head-end">
        {list.enabled && !shortcuts && (
          <span className="rm-paused" data-tip={tt('Shortcuts are off, and the remaps pause with them', 'Os atalhos estão desligados, e os remaps pausam com eles')}>Paused</span>
        )}
        <span className="rm-use">
          Use remaps
          <Switch label="Use remaps" checked={list.enabled} onChange={(on) => commitList({ enabled: on, entries: listNow().entries }, save)} />
        </span>
        <span className="rm-sep" aria-hidden="true" />
        <button
          type="button"
          className="insp-button rm-new"
          data-variant="primary"
          disabled={full}
          data-tip={full ? tt(`${MAX_REMAPS} is the limit`, `${MAX_REMAPS} é o limite`) : undefined}
          onClick={startNew}
        >
          <Plus aria-hidden="true" />
          New remap
        </button>
      </div>
    </header>
  );
}

/** remaps.json could not be read (RemapService quarantines it): what is shown, where changes go, and the way out. */
function Quarantine() {
  const remaps = useApp(a => a.settings.remaps);
  const cmds = useRemaps();
  if (!remaps.loadFailed) return null;
  const pending = remaps.pendingFile ?? 'remaps.pending.json';
  return (
    <div className="rm-warn" role="alert">
      <div className="rm-warn-body">
        <p className="rm-warn-text">
          {remaps.loadedFromBackup
            ? `remaps.json could not be read, so the last backup is shown. Changes go to ${pending} until the file is replaced.`
            : `remaps.json could not be read and there is no backup, so the list shows empty. Changes go to ${pending} until the file is replaced.`}
        </p>
        {remaps.loadFailureDetail && <p className="rm-warn-detail">{remaps.loadFailureDetail}</p>}
      </div>
      <button type="button" className="insp-button" onClick={cmds.overwriteUnreadable}>Replace remaps.json</button>
    </div>
  );
}

// ── None yet (the EmptyStates board) ──

const COMMON: { from: string; to: string; label: string }[] = [
  { from: 'CapsLock', to: 'Escape', label: 'Add Caps to Esc' },
  { from: 'Insert', to: '', label: 'Add Insert to nothing' },
  { from: 'F1', to: '', label: 'Add F1 to nothing' },
];

function Empty() {
  const { save } = useRemaps();
  const add = (from: string, to: string) => {
    const now = listNow();
    if (now.entries.some(e => ruleKey(e) === ruleKey({ from }))) return;
    const entries = [...now.entries, { from, to, enabled: true }];
    commitList({ enabled: now.enabled, entries }, save);
    useRemapsUi.setState({ open: refOf(entries, entries.length - 1), draft: draftOf(entries[entries.length - 1]), refused: null });
  };
  return (
    <>
      <Transfer />
      <div className="rm-empty">
        <span className="rm-empty-icon" aria-hidden="true"><ArrowRightLeft /></span>
        <span className="rm-empty-title">No remaps yet</span>
        <span className="rm-empty-text">A remap turns one key into another key, a mouse button or nothing — everywhere or in one app.</span>
        <span className="rm-empty-common">Common ones</span>
        <div className="rm-empty-list">
          {COMMON.map(c => (
            <button key={c.from} type="button" className="rm-common" aria-label={c.label} onClick={() => add(c.from, c.to)}>
              <kbd className="kbd">{keycaps(c.from)}</kbd>
              <span className="rm-arrow" aria-hidden="true">→</span>
              {c.to ? <kbd className="kbd">{keycaps(c.to)}</kbd> : <span className="rm-nothing">Nothing</span>}
              <Plus className="rm-common-add" aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// ── The list ──

const ALL: Filter = { kind: 'all' };
const matches = (f: Filter, r: RemapEntryDto) => (f.kind === 'all' ? true
  : f.kind === 'everywhere' ? !r.process
  : f.kind === 'off' ? !r.enabled
  : normProcess(r.process) === f.app);
const sameFilter = (a: Filter, b: Filter) => a.kind === b.kind && (a.kind !== 'app' || (b.kind === 'app' && a.app === b.app));
/** The filter in effect: the one chosen, or All once it has no rule left. */
function useShownFilter(entries: RemapEntryDto[]): Filter {
  const filter = useRemapsUi(s => s.filter);
  return filter.kind === 'all' || entries.some(r => matches(filter, r)) ? filter : ALL;
}

function Rules({ editing }: { editing: number | null }) {
  return (
    <>
      <Transfer chips />
      <Table editing={editing} />
    </>
  );
}

/** The filters (all, everywhere, one per app, off) with their counts, the count, and the list in and out of a file. */
function Transfer({ chips }: { chips?: boolean }) {
  const tt = useTt();
  const list = useList();
  const filter = useShownFilter(list.entries);
  // A filter left with no rule is All from then on, not again when a rule matches it once more.
  const chosen = useRemapsUi(s => s.filter);
  useEffect(() => { if (filter !== chosen) useRemapsUi.setState({ filter }); }, [filter, chosen]);
  const { save } = useRemaps();
  const fileRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState('');
  useEffect(() => {
    if (!note) return;
    const id = setTimeout(() => setNote(''), 5000);
    return () => clearTimeout(id);
  }, [note]);
  const entries = list.entries;

  // One filter per app, in the order the rules name them; a filter with no rule stays out.
  const apps: { app: string; label: string; n: number }[] = [];
  for (const r of entries) {
    if (!r.process) continue;
    const app = normProcess(r.process);
    const known = apps.find(a => a.app === app);
    if (known) known.n++;
    else apps.push({ app, label: appName(r.process), n: 1 });
  }
  const every: { f: Filter; label: string; n: number }[] = [
    { f: ALL, label: 'All', n: entries.length },
    { f: { kind: 'everywhere' }, label: 'Everywhere', n: entries.filter(r => !r.process).length },
    ...apps.map(a => ({ f: { kind: 'app', app: a.app } as Filter, label: a.label, n: a.n })),
    { f: { kind: 'off' }, label: 'Off', n: entries.filter(r => !r.enabled).length },
  ];
  const filters = every.filter(c => c.f.kind === 'all' || c.n > 0);

  // Export goes through the system's Save dialog: a download from the page went to Downloads
  // without asking where. The count is said once the file is written; a cancel says nothing.
  const tools = useEditorTools();
  const exported = useRef(0);
  const saving = useAsk('dialog:saveFileResult', (r) => {
    if (r.error) setNote('Could not save the file');
    else if (r.path) setNote(`Saved ${exported.current} remap${exported.current === 1 ? '' : 's'}`);
  });
  const exportFile = () => {
    const now = listNow();
    if (now.entries.length === 0) return;
    exported.current = now.entries.length;
    const text = JSON.stringify({ kind: EXPORT_KIND, version: 1, enabled: now.enabled, remaps: now.entries }, null, 2);
    saving.ask(requestId => tools.saveFile({ requestId, name: `truereplayer-remaps-${new Date().toISOString().slice(0, 10)}.json`, text, title: 'Export remaps' }));
  };
  const importFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setNote('Could not read that file');
    reader.onload = () => {
      const result = parseRemapImport(String(reader.result ?? ''));
      if (!result.ok) { setNote(result.reason); return; }
      const now = listNow();
      const { next, added, skipped } = mergeImport(now.entries, result.entries);
      if (added > 0) commitList({ enabled: now.enabled, entries: next }, save);
      setNote(skipped > 0 ? `Added ${added} · skipped ${skipped}` : `Added ${added}`);
    };
    reader.readAsText(file);
  };

  return (
    <div className="rm-bar">
      {chips && (
        <div className="rm-chips" role="group" aria-label="Filter remaps">
          {filters.map(({ f, label, n }) => (
            <button key={f.kind === 'app' ? `app:${f.app}` : f.kind} type="button" className="rm-chip" aria-pressed={sameFilter(f, filter)}
              onClick={() => useRemapsUi.setState({ filter: f })}>
              {label}{' '}<span className="rm-chip-n">{n}</span>
            </button>
          ))}
        </div>
      )}
      <span className="rm-spacer" />
      <span className="rm-count" role="status">{note || `${entries.length} of ${MAX_REMAPS}`}</span>
      <button type="button" className="insp-button rm-file" data-tip={tt('Adds the file’s remaps to yours', 'Soma os remaps do arquivo aos seus')} onClick={() => fileRef.current?.click()}>
        <Upload aria-hidden="true" />
        Import
      </button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
      <button type="button" className="insp-button rm-file" disabled={entries.length === 0 || saving.waiting} onClick={exportFile}>
        <Download aria-hidden="true" />
        Export
      </button>
    </div>
  );
}

/** What a rule does, as the table says it: a keycap, a mouse target or Nothing. */
function Does({ to }: { to: string }) {
  if (!to) return <span className="rm-does rm-nothing"><Ban aria-hidden="true" />Nothing</span>;
  const m = mouseTarget(to);
  return m ? <span className="rm-does"><Mouse aria-hidden="true" />{m.label}</span> : <kbd className="kbd">{keycaps(to)}</kbd>;
}

function Table({ editing }: { editing: number | null }) {
  const list = useList();
  const filter = useShownFilter(list.entries);
  const { save } = useRemaps();
  const remove = useRemove();
  const [menu, setMenu] = useState<{ i: number; anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const entries = list.entries;
  const rows = entries.map((r, i) => ({ r, i })).filter(({ r }) => matches(filter, r));

  const toggle = (i: number) => {
    const now = listNow();
    if (now.entries[i]) commitList({ enabled: now.enabled, entries: now.entries.map((e, j) => (j === i ? { ...e, enabled: !e.enabled } : e)) }, save);
  };
  return (
    <div className="rm-scroll">
      <table className="rm-table" data-off={!list.enabled || undefined}>
        <colgroup>
          <col className="rm-col-on" />
          <col className="rm-col-from" />
          <col className="rm-col-arrow" />
          <col className="rm-col-does" />
          <col />
          <col className="rm-col-more" />
        </colgroup>
        <thead>
          <tr>
            <th className="rm-c">On</th>
            <th>When I press</th>
            <th aria-hidden="true" />
            <th>It does</th>
            <th>Where</th>
            <th><span className="rm-sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, i }) => {
            const ref = refOf(entries, i);
            const words = ruleWords(r);
            return (
              <tr key={`${ref.key}#${ref.nth}`} data-open={editing === i || undefined} data-rule-off={!r.enabled || undefined}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) startEdit(i); }}>
                <td className="rm-c"><Switch label={words} checked={r.enabled} onChange={() => toggle(i)} /></td>
                <td>
                  <button type="button" className="rm-edit" aria-label={`Edit ${words}`} aria-current={editing === i || undefined} onClick={() => startEdit(i)}>
                    <kbd className="kbd">{keycaps(r.from)}</kbd>
                  </button>
                </td>
                <td className="rm-arrow" aria-hidden="true">→</td>
                <td><Does to={r.to} /></td>
                <td>
                  {r.process
                    ? <span className="rm-where"><AppWindow aria-hidden="true" />Only in {appName(r.process)}</span>
                    : <span className="rm-where rm-anywhere">Everywhere</span>}
                </td>
                <td>
                  <button type="button" className="insp-icon-button rm-more" aria-label="Remap actions" aria-haspopup="menu" aria-expanded={menu?.i === i}
                    onClick={(e) => setMenu(menu?.i === i ? null : { i, anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
                    <Ellipsis aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="rm-none" role="status">No remaps in this filter.</p>}
      <ShortcutsNote />
      {menu && entries[menu.i] && (
        <Menu
          anchor={menu.anchor}
          label="Remap actions"
          toggle={menu.button}
          entries={[
            { label: 'Edit', onSelect: () => startEdit(menu.i) },
            { label: entries[menu.i].enabled ? 'Turn off' : 'Turn on', onSelect: () => toggle(menu.i) },
            'separator',
            { label: 'Delete', danger: true, onSelect: () => remove(menu.i) },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function ShortcutsNote() {
  const key = useApp(a => a.settings.profileKeyToggleHotkey);
  return (
    <p className="rm-note">
      {key
        ? `The Shortcuts key (${keycaps(key)}) also pauses remaps, so one key silences everything the app does with the keyboard. The status bar shows when that happens.`
        : 'Turning Shortcuts off also pauses remaps, so one switch silences everything the app does with the keyboard. The status bar shows when that happens.'}
    </p>
  );
}

// ── Remap settings ──

/**
 * The rule open: when I press, what it does (another key, a mouse target, nothing) and where. Every
 * change that leaves a rule applies at once; one that does not yet is shown with the reason, and the
 * list keeps the rule as it last was.
 */
function Panel({ editing }: { editing: number | null }) {
  const list = useList();
  const settings = useApp(a => a.settings);
  const profiles = useApp(a => a.profiles);
  const draft = useRemapsUi(s => s.draft);
  const refused = useRemapsUi(s => s.refused);
  const { save } = useRemaps();
  const remove = useRemove();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  // A new rule's panel takes the focus on its key, ready for Enter or a click to listen.
  const isNew = editing === null;
  useEffect(() => {
    if (isNew) asideRef.current?.querySelector<HTMLElement>('.rm-capture')?.focus();
  }, [isNew]);
  if (!draft) return null;
  const entries = list.entries;
  const hotkeys = hotkeysOf(settings, profiles);
  const problem = draftProblem(draft, entries, editing);

  // Read in the handler, not from the render: a change before the last one's echo builds on it.
  // `control` names the one whose quick changes are a single undo step (the mouse targets' arrows).
  const change = (patch: Partial<Draft>, control?: string) => {
    const { draft: was, open } = useRemapsUi.getState();
    if (!was) return;
    const next = { ...was, ...patch };
    useRemapsUi.setState({ draft: next, refused: null });
    const now = listNow();
    const at = open && open !== 'new' ? indexOf(now.entries, open) : null;
    if (draftProblem(next, now.entries, at)) return;
    const rule = ruleOf(next, at !== null ? now.entries[at].enabled : true);
    if (at !== null) {
      const old = now.entries[at];
      if (old.from === rule.from && old.to === rule.to && (old.process ?? '') === (rule.process ?? '')) return;
    }
    const entriesNext = at !== null ? now.entries.map((e, j) => (j === at ? rule : e)) : [...now.entries, rule];
    commitList({ enabled: now.enabled, entries: entriesNext }, save, control);
    useRemapsUi.setState({ open: refOf(entriesNext, at ?? entriesNext.length - 1) });
  };
  const toggle = () => {
    const now = listNow();
    if (editing === null || !now.entries[editing]) return;
    commitList({ enabled: now.enabled, entries: now.entries.map((e, j) => (j === editing ? { ...e, enabled: !e.enabled } : e)) }, save);
  };
  const close = () => {
    // The focus goes back to the rule's row, or to New remap (found now: the row loses its mark on close).
    const back = document.querySelector<HTMLElement>('.rm-table .rm-edit[aria-current="true"]') ?? document.querySelector<HTMLElement>('.rm-new');
    closePanel();
    requestAnimationFrame(() => back?.focus());
  };
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Escape' || (e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();
    close();
  };

  const target = targetOf(draft);
  const title = !draft.from ? 'New remap'
    : draft.does === 'key' && !draft.toKey ? `${describeKey(draft.from)} → …`
    : `${describeKey(draft.from)} → ${draft.does === 'nothing' ? 'Nothing' : describeKey(target)}`;
  const where = draft.where === 'app' && draft.process.trim() ? `only in ${appName(draft.process)}` : 'everywhere';
  const warning = fromWarning(draft.from, hotkeys);
  const note = draft.does === 'nothing' ? null : toNote(draft.from, target, hotkeys);
  const rule = editing !== null ? entries[editing] : null;

  return (
    <aside ref={asideRef} className="rm-panel" aria-label="Remap settings" onKeyDown={onKeyDown}>
      <div className="rm-panel-head">
        <span className="rm-panel-icon" aria-hidden="true"><ArrowRightLeft /></span>
        <div className="rm-panel-titles">
          <span className="rm-panel-title">{title}</span>
          <span className="rm-panel-sub">{rule && !rule.enabled ? `Remap · ${where} · off` : `Remap · ${where}`}</span>
        </div>
        {rule && (
          <button type="button" className="insp-icon-button" aria-label="Remap actions" aria-haspopup="menu" aria-expanded={!!menu}
            onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
            <Ellipsis aria-hidden="true" />
          </button>
        )}
        <button type="button" className="insp-icon-button" aria-label="Close remap settings" onClick={close}>
          <X aria-hidden="true" />
        </button>
      </div>
      {menu && rule && (
        <Menu anchor={menu.anchor} label="Remap actions" toggle={menu.button} onClose={() => setMenu(null)}
          entries={[
            { label: rule.enabled ? 'Turn off' : 'Turn on', onSelect: toggle },
            'separator',
            { label: 'Delete', danger: true, onSelect: () => { if (editing !== null) remove(editing); } },
          ]} />
      )}
      <div className="rm-panel-body">
        <section className="rm-sec" aria-label="When I press">
          <span className="rm-label">When I press</span>
          <CaptureButton side="from" value={draft.from} label="Capture the key to remap" onKey={(key) => change({ from: key })} />
          {refused?.side === 'from' && <p className="rm-msg" data-tone="refused" role="alert">{refused.text}</p>}
          {warning && <p className="rm-msg" data-tone="warn">{warning}</p>}
        </section>
        <section className="rm-sec" aria-label="It does">
          <span className="rm-label">It does</span>
          <Segmented<Draft['does']>
            label="It does"
            value={draft.does}
            options={[{ value: 'key', label: 'Another key' }, { value: 'mouse', label: 'Mouse' }, { value: 'nothing', label: 'Nothing' }]}
            onChange={(does) => change({ does })}
          />
          {draft.does === 'key' && (
            <CaptureButton side="to" value={draft.toKey} label="Capture the key it sends"
              onKey={(key) => change(mouseTarget(key) ? { does: 'mouse', mouse: key } : { toKey: key })} />
          )}
          {draft.does === 'mouse' && <MouseTargets value={draft.mouse} onPick={(mouse) => change({ mouse }, 'mouse')} />}
          {draft.does === 'nothing' && <p className="rm-hint">The key does nothing while the remap is on.</p>}
          {refused?.side === 'to' && <p className="rm-msg" data-tone="refused" role="alert">{refused.text}</p>}
          {note && <p className="rm-msg">{note}</p>}
        </section>
        <section className="rm-sec" aria-label="Where">
          <span className="rm-label">Where</span>
          <Segmented<Draft['where']>
            label="Where"
            value={draft.where}
            options={[{ value: 'everywhere', label: 'Everywhere' }, { value: 'app', label: 'Only in one app' }]}
            onChange={(w) => change({ where: w })}
          />
          {draft.where === 'app' && <AppField value={draft.process} onChange={(process) => change({ process })} />}
          {draft.where === 'app' && draft.from && draft.process.trim() && <p className="rm-hint">{elsewhere(draft.from)}</p>}
        </section>
        {problem && <p className="rm-msg" data-tone={problem.kind === 'refused' ? 'refused' : undefined} role="status">{problem.text}</p>}
      </div>
      <div className="rm-panel-foot">Applies as you type · Ctrl+Z undoes</div>
    </aside>
  );
}

/** What the key does in the other apps (the concept: "In every other app, Q still types q."). */
function elsewhere(from: string): string {
  if (/^[A-Z]$/.test(from)) return `In every other app, ${from} still types ${from.toLowerCase()}.`;
  if (/^[0-9]$/.test(from)) return `In every other app, ${from} still types ${from}.`;
  return `In every other app, ${describeKey(from)} works as usual.`;
}

/**
 * A side of the rule, captured from the keyboard (the hook's capture, settings-101 and 102): one press
 * of one key, Esc included (Caps → Esc is the classic). A combo is refused, and the wheel as the key
 * pressed, and the listening goes on for the next one. A second press, 4 s without a key, or the
 * focus leaving it end the listening (settings-119).
 */
function CaptureButton({ side, value, label, onKey }: { side: 'from' | 'to'; value: string; label: string; onKey: (key: string) => void }) {
  const capture = useKeyCapture();
  const [owner] = useState(() => `remap-${side}-${crypto.randomUUID()}`);
  const [listening, setListening] = useState(false);
  const onKeyRef = useRef(onKey);
  useEffect(() => { onKeyRef.current = onKey; });
  useEffect(() => {
    if (!listening) return;
    capture.arm(owner);
    const stop = () => setListening(false);
    let idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
    const off = capture.listen(owner, (combo) => {
      if (typeof combo !== 'string' || combo === '') return;
      clearTimeout(idle);
      idle = setTimeout(stop, SINGLE_KEY_CAPTURE_IDLE_MS);
      const problem = remapKeyProblem(combo, side);
      if (problem) { useRemapsUi.setState({ refused: { side, text: problem } }); return; }
      stop();
      onKeyRef.current(combo);
    });
    return () => {
      clearTimeout(idle);
      off();
      capture.release(owner);
    };
  }, [listening, capture, owner, side]);
  return (
    <button
      type="button"
      className="insp-capture rm-capture"
      aria-label={label}
      aria-pressed={listening}
      data-listening={listening || undefined}
      onClick={() => setListening(on => !on)}
      onBlur={() => setListening(false)}
    >
      {value ? <Keys combo={value} /> : <span className="insp-capture-none">No key yet</span>}
      <span className="insp-capture-hint">
        {listening ? 'Listening — press one key' : value ? 'Click, then press a key to change it' : 'Click, then press a key'}
      </span>
    </button>
  );
}

/** The seven mouse targets (settings-103 to 110): a radio group, where the arrows pick as they move. */
function MouseTargets({ value, onPick }: { value: string; onPick: (name: string) => void }) {
  const at = MOUSE_TARGETS.findIndex(m => m.name.toLowerCase() === value.toLowerCase());
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = MOUSE_TARGETS.length;
    const from = Math.max(0, at);
    const next = e.key === 'Home' ? 0
      : e.key === 'End' ? n - 1
      : e.key === 'ArrowDown' || e.key === 'ArrowRight' ? (from + 1) % n
      : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? (from - 1 + n) % n
      : null;
    if (next === null) return;
    e.preventDefault();
    if (next !== at) onPick(MOUSE_TARGETS[next].name);
    e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  };
  return (
    <div className="rm-mouse" role="radiogroup" aria-label="Mouse target" onKeyDown={onKeyDown}>
      {MOUSE_TARGETS.map((m, i) => (
        <button key={m.name} type="button" role="radio" className="rm-radio" aria-checked={i === at} tabIndex={i === Math.max(0, at) ? 0 : -1}
          onClick={() => { if (i !== at) onPick(m.name); }}>
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** The app of "Only in one app": its process name, typed or picked among the running ones, and whether it runs now. */
function AppField({ value, onChange }: { value: string; onChange: (process: string) => void }) {
  const tools = useEditorTools();
  const { subscribe } = useBridge();
  const [running, setRunning] = useState<string[] | null>(null);
  useEffect(() => subscribe((message) => {
    if (message.type === 'process:list') setRunning(message.payload.processes.map(p => normProcess(p.name)));
  }), [subscribe]);
  const name = value.trim();
  // Asked again for each app named: "running now" is about now.
  useEffect(() => { if (name) tools.listProcesses({}); }, [tools, name]);
  const isRunning = running && name ? running.includes(normProcess(name)) : null;
  return (
    <div className="rm-app">
      <div className="insp-line">
        <DraftField stepId="remap" field="process" label="App" kind="mono" empty="clear" placeholder="RobloxPlayerBeta.exe" stored={value} onApply={onChange} />
        <ProcessPicker onPick={onChange} />
      </div>
      {isRunning !== null && <span className="rm-hint">{isRunning ? `${name} · running now` : `${name} · not running now`}</span>}
    </div>
  );
}
