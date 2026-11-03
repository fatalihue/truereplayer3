import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { AppWindow, ArrowRightLeft, Ban, Download, Ellipsis, Mouse, Plus, Upload, X } from 'lucide-react';
import type { RemapEntryDto } from '../../../bridge/messageTypes';
import { useBridge } from '../../../bridge/BridgeContext';
import { t } from '../../../i18n';
import { useEditorTools } from '../../../logic/useEditorTools';
import { SINGLE_KEY_CAPTURE_IDLE_MS, useKeyCapture } from '../../../logic/useKeyCapture';
import { remapKeyProblem, useRemaps } from '../../../logic/useRemaps';
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
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.isContentEditable || el.tagName === 'TEXTAREA'
        || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((el as HTMLInputElement).type)));
      if (typing || isModalDialogOpen()) return;
      e.preventDefault();
      const moved = stepList(key === 'z' && !e.shiftKey, saveRef.current);
      if (moved) followUndo(moved.before.entries, moved.after.entries);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="shell-page rm" aria-label={t('common.pages.remaps')} data-panel={panel || undefined}>
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
  return (i: number) => {
    const now = listNow();
    const rule = now.entries[i];
    if (!rule) return;
    commitList({ enabled: now.enabled, entries: now.entries.filter((_, j) => j !== i) }, save);
    showToast(t('remaps.rule.removed', { rule: ruleArrow(rule) }), {
      type: 'success',
      duration: 10000,
      action: {
        label: t('common.actions.undo'),
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
  const list = useList();
  const shortcuts = useApp(a => a.settings.profileKeyEnabled);
  const { save } = useRemaps();
  const full = list.entries.length >= MAX_REMAPS;
  return (
    <header className="rm-head">
      <div className="rm-titles">
        <h1 className="rm-title">{t('common.pages.remaps')}</h1>
        <p className="rm-sub">{t('remaps.head.sub')}</p>
      </div>
      <div className="rm-head-end">
        {list.enabled && !shortcuts && (
          <span className="rm-paused" data-tip={t('remaps.head.pausedTip')}>{t('remaps.head.paused')}</span>
        )}
        <span className="rm-use">
          {t('remaps.head.use')}
          <Switch label={t('remaps.head.use')} checked={list.enabled} onChange={(on) => commitList({ enabled: on, entries: listNow().entries }, save)} />
        </span>
        <span className="rm-sep" aria-hidden="true" />
        <button
          type="button"
          className="insp-button rm-new"
          data-variant="primary"
          disabled={full}
          data-tip={full ? t('remaps.head.limit', { max: MAX_REMAPS }) : undefined}
          onClick={startNew}
        >
          <Plus aria-hidden="true" />
          {t('remaps.head.newRemap')}
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
          {remaps.loadedFromBackup ? t('remaps.unreadable.backup', { pending }) : t('remaps.unreadable.noBackup', { pending })}
        </p>
        {remaps.loadFailureDetail && <p className="rm-warn-detail">{remaps.loadFailureDetail}</p>}
      </div>
      <button type="button" className="insp-button" onClick={cmds.overwriteUnreadable}>{t('remaps.unreadable.replace')}</button>
    </div>
  );
}

// ── None yet (the EmptyStates board) ──

// The keys in the names as their keycaps are known (Insert spelled out, as the concept has it).
const COMMON: { from: string; to: string; label: string }[] = [
  { from: 'CapsLock', to: 'Escape', label: t('remaps.empty.add', { from: 'Caps', to: 'Esc' }) },
  { from: 'Insert', to: '', label: t('remaps.empty.addNothing', { from: 'Insert' }) },
  { from: 'F1', to: '', label: t('remaps.empty.addNothing', { from: 'F1' }) },
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
        <span className="rm-empty-title">{t('remaps.empty.title')}</span>
        <span className="rm-empty-text">{t('remaps.empty.text')}</span>
        <span className="rm-empty-common">{t('remaps.empty.common')}</span>
        <div className="rm-empty-list">
          {COMMON.map(c => (
            <button key={c.from} type="button" className="rm-common" aria-label={c.label} onClick={() => add(c.from, c.to)}>
              <kbd className="kbd">{keycaps(c.from)}</kbd>
              <span className="rm-arrow" aria-hidden="true">→</span>
              {c.to ? <kbd className="kbd">{keycaps(c.to)}</kbd> : <span className="rm-nothing">{t('remaps.nothing')}</span>}
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
    { f: ALL, label: t('remaps.filter.all'), n: entries.length },
    { f: { kind: 'everywhere' }, label: t('remaps.everywhere'), n: entries.filter(r => !r.process).length },
    ...apps.map(a => ({ f: { kind: 'app', app: a.app } as Filter, label: a.label, n: a.n })),
    { f: { kind: 'off' }, label: t('remaps.filter.off'), n: entries.filter(r => !r.enabled).length },
  ];
  const filters = every.filter(c => c.f.kind === 'all' || c.n > 0);

  // Export goes through the system's Save dialog: a download from the page went to Downloads
  // without asking where. The count is said once the file is written; a cancel says nothing.
  const tools = useEditorTools();
  const exported = useRef(0);
  const saving = useAsk('dialog:saveFileResult', (r) => {
    if (r.error) setNote(t('remaps.note.saveFailed'));
    else if (r.path) setNote(t('remaps.note.saved', { count: exported.current }));
  });
  const exportFile = () => {
    const now = listNow();
    if (now.entries.length === 0) return;
    exported.current = now.entries.length;
    const text = JSON.stringify({ kind: EXPORT_KIND, version: 1, enabled: now.enabled, remaps: now.entries }, null, 2);
    saving.ask(requestId => tools.saveFile({ requestId, name: `truereplayer-remaps-${new Date().toISOString().slice(0, 10)}.json`, text, title: t('remaps.exportTitle') }));
  };
  const importFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setNote(t('remaps.note.readFailed'));
    reader.onload = () => {
      const result = parseRemapImport(String(reader.result ?? ''));
      if (!result.ok) { setNote(result.reason); return; }
      const now = listNow();
      const { next, added, skipped } = mergeImport(now.entries, result.entries);
      if (added > 0) commitList({ enabled: now.enabled, entries: next }, save);
      setNote(skipped > 0 ? t('remaps.note.addedSkipped', { added, skipped }) : t('remaps.note.added', { added }));
    };
    reader.readAsText(file);
  };

  return (
    <div className="rm-bar">
      {chips && (
        <div className="rm-chips" role="group" aria-label={t('remaps.filter.label')}>
          {filters.map(({ f, label, n }) => (
            <button key={f.kind === 'app' ? `app:${f.app}` : f.kind} type="button" className="rm-chip" aria-pressed={sameFilter(f, filter)}
              onClick={() => useRemapsUi.setState({ filter: f })}>
              {label}{' '}<span className="rm-chip-n">{n}</span>
            </button>
          ))}
        </div>
      )}
      <span className="rm-spacer" />
      <span className="rm-count" role="status">{note || t('remaps.count', { n: entries.length, max: MAX_REMAPS })}</span>
      <button type="button" className="insp-button rm-file" data-tip={t('remaps.importTip')} onClick={() => fileRef.current?.click()}>
        <Upload aria-hidden="true" />
        {t('common.actions.import')}
      </button>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
      <button type="button" className="insp-button rm-file" disabled={entries.length === 0 || saving.waiting} onClick={exportFile}>
        <Download aria-hidden="true" />
        {t('common.actions.export')}
      </button>
    </div>
  );
}

/** What a rule does, as the table says it: a keycap, a mouse target or Nothing. */
function Does({ to }: { to: string }) {
  if (!to) return <span className="rm-does rm-nothing"><Ban aria-hidden="true" />{t('remaps.nothing')}</span>;
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
            <th className="rm-c">{t('remaps.table.on')}</th>
            <th>{t('remaps.fields.from')}</th>
            <th aria-hidden="true" />
            <th>{t('remaps.fields.does')}</th>
            <th>{t('remaps.fields.where')}</th>
            <th><span className="rm-sr">{t('remaps.table.actions')}</span></th>
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
                  <button type="button" className="rm-edit" aria-label={t('remaps.table.edit', { rule: words })} aria-current={editing === i || undefined} onClick={() => startEdit(i)}>
                    <kbd className="kbd">{keycaps(r.from)}</kbd>
                  </button>
                </td>
                <td className="rm-arrow" aria-hidden="true">→</td>
                <td><Does to={r.to} /></td>
                <td>
                  {r.process
                    ? <span className="rm-where"><AppWindow aria-hidden="true" />{t('remaps.table.onlyIn', { app: appName(r.process) })}</span>
                    : <span className="rm-where rm-anywhere">{t('remaps.everywhere')}</span>}
                </td>
                <td>
                  <button type="button" className="insp-icon-button rm-more" aria-label={t('remaps.menu.label')} aria-haspopup="menu" aria-expanded={menu?.i === i}
                    onClick={(e) => setMenu(menu?.i === i ? null : { i, anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
                    <Ellipsis aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="rm-none" role="status">{t('remaps.table.none')}</p>}
      <ShortcutsNote />
      {menu && entries[menu.i] && (
        <Menu
          anchor={menu.anchor}
          label={t('remaps.menu.label')}
          toggle={menu.button}
          entries={[
            { label: t('common.actions.edit'), onSelect: () => startEdit(menu.i) },
            { label: entries[menu.i].enabled ? t('remaps.menu.turnOff') : t('remaps.menu.turnOn'), onSelect: () => toggle(menu.i) },
            'separator',
            { label: t('common.actions.delete'), danger: true, onSelect: () => remove(menu.i) },
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
      {key ? t('remaps.shortcutsNote.key', { key: keycaps(key) }) : t('remaps.shortcutsNote.noKey')}
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
  const from = describeKey(draft.from);
  const title = !draft.from ? t('remaps.head.newRemap')
    : draft.does === 'key' && !draft.toKey ? t('remaps.rule.arrowPending', { from })
    : draft.does === 'nothing' ? t('remaps.rule.arrowNothing', { from })
    : t('remaps.rule.arrow', { from, to: describeKey(target) });
  const app = draft.where === 'app' && draft.process.trim() ? appName(draft.process) : '';
  const warning = fromWarning(draft.from, hotkeys);
  const note = draft.does === 'nothing' ? null : toNote(draft.from, target, hotkeys);
  const rule = editing !== null ? entries[editing] : null;
  const off = !!rule && !rule.enabled;
  const sub = app
    ? (off ? t('remaps.panel.sub.appOff', { app }) : t('remaps.panel.sub.app', { app }))
    : (off ? t('remaps.panel.sub.everywhereOff') : t('remaps.panel.sub.everywhere'));

  return (
    <aside ref={asideRef} className="rm-panel" aria-label={t('remaps.panel.label')} onKeyDown={onKeyDown}>
      <div className="rm-panel-head">
        <span className="rm-panel-icon" aria-hidden="true"><ArrowRightLeft /></span>
        <div className="rm-panel-titles">
          <span className="rm-panel-title">{title}</span>
          <span className="rm-panel-sub">{sub}</span>
        </div>
        {rule && (
          <button type="button" className="insp-icon-button" aria-label={t('remaps.menu.label')} aria-haspopup="menu" aria-expanded={!!menu}
            onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
            <Ellipsis aria-hidden="true" />
          </button>
        )}
        <button type="button" className="insp-icon-button" aria-label={t('remaps.panel.close')} onClick={close}>
          <X aria-hidden="true" />
        </button>
      </div>
      {menu && rule && (
        <Menu anchor={menu.anchor} label={t('remaps.menu.label')} toggle={menu.button} onClose={() => setMenu(null)}
          entries={[
            { label: rule.enabled ? t('remaps.menu.turnOff') : t('remaps.menu.turnOn'), onSelect: toggle },
            'separator',
            { label: t('common.actions.delete'), danger: true, onSelect: () => { if (editing !== null) remove(editing); } },
          ]} />
      )}
      <div className="rm-panel-body">
        <section className="rm-sec" aria-label={t('remaps.fields.from')}>
          <span className="rm-label">{t('remaps.fields.from')}</span>
          <CaptureButton side="from" value={draft.from} label={t('remaps.panel.captureFrom')} onKey={(key) => change({ from: key })} />
          {refused?.side === 'from' && <p className="rm-msg" data-tone="refused" role="alert">{refused.text}</p>}
          {warning && <p className="rm-msg" data-tone="warn">{warning}</p>}
        </section>
        <section className="rm-sec" aria-label={t('remaps.fields.does')}>
          <span className="rm-label">{t('remaps.fields.does')}</span>
          <Segmented<Draft['does']>
            label={t('remaps.fields.does')}
            value={draft.does}
            options={[
              { value: 'key', label: t('remaps.panel.another') },
              { value: 'mouse', label: t('remaps.panel.mouse') },
              { value: 'nothing', label: t('remaps.nothing') },
            ]}
            onChange={(does) => change({ does })}
          />
          {draft.does === 'key' && (
            <CaptureButton side="to" value={draft.toKey} label={t('remaps.panel.captureTo')}
              onKey={(key) => change(mouseTarget(key) ? { does: 'mouse', mouse: key } : { toKey: key })} />
          )}
          {draft.does === 'mouse' && <MouseTargets value={draft.mouse} onPick={(mouse) => change({ mouse }, 'mouse')} />}
          {draft.does === 'nothing' && <p className="rm-hint">{t('remaps.panel.nothingHint')}</p>}
          {refused?.side === 'to' && <p className="rm-msg" data-tone="refused" role="alert">{refused.text}</p>}
          {note && <p className="rm-msg">{note}</p>}
        </section>
        <section className="rm-sec" aria-label={t('remaps.fields.where')}>
          <span className="rm-label">{t('remaps.fields.where')}</span>
          <Segmented<Draft['where']>
            label={t('remaps.fields.where')}
            value={draft.where}
            options={[{ value: 'everywhere', label: t('remaps.everywhere') }, { value: 'app', label: t('remaps.panel.oneApp') }]}
            onChange={(w) => change({ where: w })}
          />
          {draft.where === 'app' && <AppField value={draft.process} onChange={(process) => change({ process })} />}
          {draft.where === 'app' && draft.from && draft.process.trim() && <p className="rm-hint">{elsewhere(draft.from)}</p>}
        </section>
        {problem && <p className="rm-msg" data-tone={problem.kind === 'refused' ? 'refused' : undefined} role="status">{problem.text}</p>}
      </div>
      <div className="rm-panel-foot">{t('remaps.panel.foot')}</div>
    </aside>
  );
}

/** What the key does in the other apps (the concept: "In every other app, Q still types q."). */
function elsewhere(from: string): string {
  if (/^[A-Z]$/.test(from)) return t('remaps.panel.elsewhereTypes', { key: from, typed: from.toLowerCase() });
  if (/^[0-9]$/.test(from)) return t('remaps.panel.elsewhereTypes', { key: from, typed: from });
  return t('remaps.panel.elsewhereUsual', { key: describeKey(from) });
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
      {value ? <Keys combo={value} /> : <span className="insp-capture-none">{t('inspector.fields.noKey')}</span>}
      <span className="insp-capture-hint">
        {listening ? t('remaps.capture.listening') : value ? t('remaps.capture.change') : t('remaps.capture.press')}
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
    <div className="rm-mouse" role="radiogroup" aria-label={t('remaps.panel.mouseTarget')} onKeyDown={onKeyDown}>
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
        <DraftField stepId="remap" field="process" label={t('remaps.panel.app')} kind="mono" empty="clear" placeholder={t('remaps.panel.appPlaceholder')} stored={value} onApply={onChange} />
        <ProcessPicker onPick={onChange} />
      </div>
      {isRunning !== null && <span className="rm-hint">{isRunning ? t('remaps.panel.running', { app: name }) : t('remaps.panel.notRunning', { app: name })}</span>}
    </div>
  );
}
