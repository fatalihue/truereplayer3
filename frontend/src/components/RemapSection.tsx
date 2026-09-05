import { useEffect, useRef, useState } from 'react';
import { X, Plus, ArrowRight, Ban, Mouse, AppWindow, Download, Upload } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import type { RemapEntryDto } from '../bridge/messageTypes';
import { useAppState } from '../state/AppStateContext';
import { useTt } from '../state/LanguageContext';
import { Button } from './common/Button';
import { Callout } from './common/Callout';
import { FieldError } from './common/FieldError';
import { iconButtonClass } from './common/IconButton';
import { splitCombo } from './common/KbdTag';
import { ProcessNameInput } from './common/ProcessNameInput';
import { chipOn, chipOff, chipDotOn, chipDotOff } from './common/chipStyles';
import { compactKey } from '../utils/keyNames';

type RemapEntry = RemapEntryDto;

const MAX_REMAPS = 32;

// Mouse-side targets — the names RemapService.MouseTargets resolves, with the label the menu
// shows and the short form rows and chips use. The row has ~123px for "from → to (+ scope
// glyph)" — about 14 mono characters for the two names once a scope glyph is on — so a mouse
// side is ONE word ("Side button 1 → Middle click" truncated to "Side bu… → Middle…" in the
// first capture). Left and Right alone would read as the arrow keys (KeyUtils stores those as
// "Left" / "Right"), so those two carry a Mouse glyph; Middle, Side and Scroll cannot be keys.
// Left / middle / right cannot be captured (the capture channel excludes them so they do not
// fight the UI), so they live in the mouse menu beside the TO chip; a side button or a wheel
// tick can also be captured directly.
const MOUSE_TARGETS: { name: string; label: string; short: string; glyph?: boolean }[] = [
  { name: 'LeftClick', label: 'Left click', short: 'Left', glyph: true },
  { name: 'MiddleClick', label: 'Middle click', short: 'Middle' },
  { name: 'RightClick', label: 'Right click', short: 'Right', glyph: true },
  { name: 'XButton1', label: 'Side button 1', short: 'Side 1' },
  { name: 'XButton2', label: 'Side button 2', short: 'Side 2' },
  { name: 'ScrollUp', label: 'Scroll up', short: 'Scroll ↑' },
  { name: 'ScrollDown', label: 'Scroll down', short: 'Scroll ↓' },
];
const mouseTarget = (name: string) =>
  MOUSE_TARGETS.find((m) => m.name.toLowerCase() === name.toLowerCase());
// Plain-text form for tooltips and messages: the menu label for a mouse target, the keycap
// spelling for a key (PgDn, Esc, Ins, Caps — utils/keyNames, decided 2026-09-05 family-wide).
// The stored name stays raw; only display goes through compactKey.
const describeKey = (name: string) => mouseTarget(name)?.label ?? compactKey(name);

/** One side of a remap: keycap spelling for a key, or the short mouse word (Mouse glyph where the word alone is ambiguous). */
function KeyLabel({ name, className = '' }: { name: string; className?: string }) {
  const m = mouseTarget(name);
  return (
    <span className={`min-w-0 inline-flex items-center gap-1 ${className}`}>
      {m?.glyph && <Mouse size={10} className="shrink-0 opacity-70" aria-hidden />}
      <span className="truncate">{m ? m.short : compactKey(name)}</span>
    </span>
  );
}

/**
 * A remap side as a keycap — the same `.kbd` chip the Hotkeys section above draws, so one key
 * has one face in the panel (it was mono text + arrow here, keycaps 100px up). Neutral tone on
 * purpose: the row's own wash carries on/off, and accent-on-accent would shout. `.kbd` pins
 * min-width at 20px rather than auto, so the chip can shrink and the KeyLabel inside truncates
 * instead of the row overflowing.
 */
function KeyCap({ name }: { name: string }) {
  return (
    <span className="kbd">
      <KeyLabel name={name} />
    </span>
  );
}

// ── Hotkey collisions ─────────────────────────────────────────────────────────
// "LeftCtrl" / "RightAlt" (a hand-edited file) count as their family: the hook captures the
// generic names (KeyUtils maps both sides to Ctrl / Alt / Shift / Win) and every stored hotkey
// uses them, so a remap of either side is a remap of the key the hotkey names.
const keyFamily = (k: string) => k.replace(/^(Left|Right)(Ctrl|Alt|Shift|Win)$/i, '$2').toLowerCase();
const showCombo = (combo: string) => splitCombo(combo).map(compactKey).join('+');
const mainKey = (combo: string) => { const parts = splitCombo(combo); return parts[parts.length - 1] ?? combo; };
const hasModifiers = (combo: string) => splitCombo(combo).length > 1;
type HotkeyRef = { label: string; combo: string };
// "the Recording hotkey (F5)" · "a and b" · "a, b and c" — the combo shown where the caller asks.
const listHits = (hits: HotkeyRef[], withCombo: (h: HotkeyRef) => boolean) => {
  const items = hits.map((h) => (withCombo(h) ? `${h.label} (${showCombo(h.combo)})` : h.label));
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
};

// Same normalisation RemapService.NormalizeProcess applies: "Chrome.EXE" and "chrome" are one
// scope, so the duplicate check and the backend's first-wins agree on what "the same rule" is.
const normProcess = (p?: string) => {
  const s = (p ?? '').trim().toLowerCase();
  return s.endsWith('.exe') ? s.slice(0, -4) : s;
};
const ruleKey = (e: { from: string; process?: string }) => `${e.from.toLowerCase()}|${normProcess(e.process)}`;

// ── Transfer (export / import) ────────────────────────────────────────────────
// Browser mechanism, matching snippets and themes: Blob + a.download to save, a hidden file
// input + FileReader to load. The import accepts this envelope AND the bare sidecar shape
// (remaps.json is PascalCase — Remaps / From / To / Enabled / Process), so a file copied out of
// Documents\TrueReplayer loads as-is.
const EXPORT_KIND = 'truereplayer-remaps';
type ImportResult = { ok: true; entries: RemapEntry[] } | { ok: false; reason: string };
const pick = (o: Record<string, unknown>, key: string): unknown =>
  o[key] ?? o[key.charAt(0).toUpperCase() + key.slice(1)];
function parseRemapImport(text: string): ImportResult {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, reason: 'That file is not valid JSON' }; }
  if (!data || typeof data !== 'object') return { ok: false, reason: 'That is not a remaps file' };
  const list = pick(data as Record<string, unknown>, 'remaps') ?? pick(data as Record<string, unknown>, 'entries');
  if (!Array.isArray(list)) return { ok: false, reason: 'That is not a remaps file' };
  const entries: RemapEntry[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const from = pick(r, 'from');
    if (typeof from !== 'string' || !from.trim()) continue;
    const to = pick(r, 'to');
    const process = pick(r, 'process');
    entries.push({
      from: from.trim(),
      to: typeof to === 'string' ? to.trim() : '',
      enabled: pick(r, 'enabled') !== false,
      ...(typeof process === 'string' && process.trim() ? { process: process.trim() } : {}),
    });
  }
  if (entries.length === 0) return { ok: false, reason: 'No usable remaps in that file' };
  return { ok: true, entries };
}

/**
 * Body of the Settings → Keys → "Key Remaps" section: the always-on 1:1 layer
 * (CapsLock→Esc, XButton1→F, F→middle click, disable a key), optionally scoped to one app.
 * Rows edit + save the WHOLE list via remap:save (the backend sidecar is tiny); the master
 * switch lives in the parent SettingRow. The add/edit bar captures single keys through the
 * shared low-level hotkey:capture channel — combos are rejected (a remap source/target is
 * ONE key) — and offers the mouse-side targets from a menu.
 */
export function RemapSection() {
  const tt = useTt();
  const { send, subscribe } = useBridge();
  const { settings, profiles } = useAppState();
  const remaps = settings.remaps;

  const [addOpen, setAddOpen] = useState(false);
  // Index of the row being edited in place; null = adding a new one.
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [fromKey, setFromKey] = useState('');
  const [toKey, setToKey] = useState('');
  const [disableMode, setDisableMode] = useState(false);
  const [processKey, setProcessKey] = useState('');
  // 'from' | 'to' | null — which chip is armed for capture.
  const [capturing, setCapturing] = useState<'from' | 'to' | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [mouseMenuOpen, setMouseMenuOpen] = useState(false);
  const [transferNote, setTransferNote] = useState('');
  const mouseMenuRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const capturingRef = useRef(capturing);
  capturingRef.current = capturing;

  const stopCapture = () => {
    if (capturingRef.current) {
      send({ type: 'hotkey:capture', payload: { enabled: false, ownerId: 'remap-add' } });
    }
    setCapturing(null);
  };

  const startCapture = (side: 'from' | 'to') => {
    setCaptureError(null);
    setMouseMenuOpen(false);
    if (!capturingRef.current) {
      send({ type: 'hotkey:capture', payload: { enabled: true, ownerId: 'remap-add' } });
    }
    setCapturing(side);
  };

  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type !== 'hotkey:captured' || !capturingRef.current) return;
      // Owner filter: this chip is the app's only NON-modal capture consumer — a hotkey
      // dialog opened while the chip is armed registers LATER and is the intended
      // recipient of the broadcast; stealing it would pre-fill a remap key the user
      // never meant to set.
      if (msg.payload.owner && msg.payload.owner !== 'remap-add') return;
      const combo = msg.payload.combo;
      if (combo.includes('+')) {
        setCaptureError('Single keys only — combos are not remappable.');
        return;
      }
      // A wheel tick is a fine TARGET (one notch per press) but has no press/release to be
      // a SOURCE of. Side buttons are valid on both sides since 2026-09-05: as a target they
      // go out through SendInput's mouse path.
      if (capturingRef.current === 'from' && (combo === 'ScrollUp' || combo === 'ScrollDown')) {
        setCaptureError('The scroll wheel can be a target, not a source.');
        return;
      }
      if (capturingRef.current === 'from') setFromKey(combo);
      else setToKey(combo);
      stopCapture();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  // Leaving the section (panel collapse/unmount) must release the global capture.
  useEffect(() => () => stopCapture(), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The mouse menu closes on an outside click or Esc — capture phase so the Esc stops here
  // and does not also reach whatever hosts the panel.
  useEffect(() => {
    if (!mouseMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!mouseMenuRef.current?.contains(e.target as Node)) setMouseMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMouseMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [mouseMenuOpen]);

  const saveList = (entries: RemapEntry[], enabled = remaps.enabled) =>
    send({ type: 'remap:save', payload: { enabled, remaps: entries } });

  const resetForm = () => {
    setFromKey('');
    setToKey('');
    setDisableMode(false);
    setProcessKey('');
    setCaptureError(null);
    setEditIndex(null);
    setMouseMenuOpen(false);
  };
  const closeForm = () => {
    setAddOpen(false);
    stopCapture();
    resetForm();
  };
  // Edit in place: the same bar, pre-filled from the row; Save replaces the entry and keeps
  // its on/off state. Adding and editing are one form so they cannot drift apart.
  const startEdit = (i: number) => {
    const r = remaps.entries[i];
    if (!r) return;
    stopCapture();
    setFromKey(r.from);
    setToKey(r.to);
    setDisableMode(r.to === '');
    setProcessKey(r.process ?? '');
    setCaptureError(null);
    setMouseMenuOpen(false);
    setEditIndex(i);
    setAddOpen(true);
  };

  // The same FROM in the same scope is a duplicate; the same FROM in another app is a second
  // rule (the hook picks the one whose app is in front). The row being edited is not its own
  // duplicate.
  const duplicate = fromKey !== '' && remaps.entries.some((r, j) =>
    j !== editIndex && r.from.toLowerCase() === fromKey.toLowerCase()
      && normProcess(r.process) === normProcess(processKey));
  const selfRemap = fromKey !== '' && !disableMode && fromKey.toLowerCase() === toKey.toLowerCase();
  const atCap = editIndex === null && remaps.entries.length >= MAX_REMAPS;
  const nearCap = remaps.entries.length >= MAX_REMAPS * 0.75;

  // A transfer note is a moment, not a state: it clears itself so the reserved line goes back to
  // the count (or to blank) instead of announcing "Added 2" for the rest of the session.
  useEffect(() => {
    if (transferNote === '') return;
    const t = window.setTimeout(() => setTransferNote(''), 5000);
    return () => window.clearTimeout(t);
  }, [transferNote]);
  const canSave = fromKey !== '' && (disableMode || toKey !== '') && !duplicate && !selfRemap && !atCap;

  // Every hotkey the app listens for, with the name a message uses. The Clicker pair stays out
  // on purpose (owner decision: mode-gated, with its own conflict check).
  const hotkeys: HotkeyRef[] = [
    ...([
      [settings.recordingHotkey, 'the Recording hotkey'],
      [settings.replayHotkey, 'the Replay hotkey'],
      [settings.profileKeyToggleHotkey, 'the Profile Keys hotkey'],
      [settings.foregroundHotkey, 'the Foreground hotkey'],
      [settings.modeToggleHotkey, 'the Mode Toggle hotkey'],
      [settings.captureSlotHotkey, 'the Capture Slot hotkey'],
    ] as [string, string][]).filter(([combo]) => !!combo).map(([combo, label]) => ({ label, combo })),
    ...profiles.filter((p) => !!p.hotkey).map((p) => ({ label: `profile "${p.name}"`, combo: p.hotkey as string })),
  ];

  // FROM side: the remap runs before the hotkey matcher, so EVERY hotkey built on this key dies
  // with it — the bare F5, Ctrl+F5 (the F5 becomes X before Ctrl+F5 can compose), and every
  // Ctrl+… when the FROM is Ctrl itself. The check used to compare whole strings and caught only
  // the bare one; "hotkey silently not firing" is the #1 support issue, so list them all.
  const fromHits = fromKey
    ? hotkeys.filter((h) => splitCombo(h.combo).some((seg) => keyFamily(seg) === keyFamily(fromKey)))
    : [];
  const fromMessage = fromHits.length > 0
    ? `Also ${listHits(fromHits, () => true)} — the remap overrides ${fromHits.length > 1 ? 'them and those hotkeys stop' : 'it and that hotkey stops'} firing.`
    : null;

  // TO side: a KEY target that is a hotkey's main key TRIGGERS that hotkey (the hop in the
  // hook: Side 1 → F9 with F9 = Replay starts the replay instead of typing F9). Intentional —
  // the user just needs to know before saving, so this line is informative, not an error. A
  // MOUSE target is the opposite case: the injected click carries LLMHF_INJECTED and the hotkey
  // layer ignores injected input, so a remapped side button does NOT fire the profile bound to it.
  const toTarget = !disableMode ? toKey : '';
  const toHits = toTarget ? hotkeys.filter((h) => keyFamily(mainKey(h.combo)) === keyFamily(toTarget)) : [];
  const toMessage = (() => {
    if (toHits.length === 0) return null;
    const many = toHits.length > 1;
    const hits = listHits(toHits, (h) => hasModifiers(h.combo));
    if (mouseTarget(toTarget)) {
      return `${describeKey(toTarget)} is also ${hits} — a remapped press will not trigger ${many ? 'them' : 'it'} (hotkeys ignore injected input).`;
    }
    const via = fromKey ? describeKey(fromKey) : 'the remapped key';
    const modified = toHits.some((h) => hasModifiers(h.combo));
    return `${describeKey(toTarget)} is also ${hits} — ${via} will trigger ${many ? 'them' : 'it'}${modified ? ' with those modifiers held' : ''}.`;
  })();

  const handleSave = () => {
    if (!canSave) return;
    const process = processKey.trim();
    const entry: RemapEntry = {
      from: fromKey,
      to: disableMode ? '' : toKey,
      enabled: editIndex !== null ? remaps.entries[editIndex].enabled : true,
      ...(process ? { process } : {}),
    };
    const next = editIndex !== null
      ? remaps.entries.map((e, j) => (j === editIndex ? entry : e))
      : [...remaps.entries, entry];
    saveList(next);
    closeForm();
  };

  const handleExport = () => {
    if (remaps.entries.length === 0) return;
    const envelope = { kind: EXPORT_KIND, version: 1, enabled: remaps.enabled, remaps: remaps.entries };
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `truereplayer-remaps-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setTransferNote(`Saved ${remaps.entries.length} remap${remaps.entries.length === 1 ? '' : 's'}`);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input straight away so picking the SAME file twice still fires onChange.
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setTransferNote('Could not read that file');
    reader.onload = () => {
      const result = parseRemapImport(String(reader.result ?? ''));
      if (!result.ok) { setTransferNote(result.reason); return; }
      // Merge, never replace: the file adds rules the list does not have yet. A rule already
      // present (same FROM, same scope) is skipped, and so is anything past the cap.
      const seen = new Set(remaps.entries.map(ruleKey));
      const merged = [...remaps.entries];
      let added = 0;
      let skipped = 0;
      for (const en of result.entries) {
        const k = ruleKey(en);
        if (seen.has(k) || merged.length >= MAX_REMAPS) { skipped++; continue; }
        merged.push(en);
        seen.add(k);
        added++;
      }
      if (added > 0) saveList(merged);
      setTransferNote(skipped > 0 ? `Added ${added} · skipped ${skipped}` : `Added ${added}`);
    };
    reader.readAsText(file);
  };

  const keyChip = (side: 'from' | 'to', value: string, dimmed: boolean) => (
    <button
      type="button"
      onClick={() => (capturing === side ? stopCapture() : startCapture(side))}
      // flex-1 + min-w-0 lets the two chips split the row evenly instead of sizing to
      // their text and overflowing the 224px panel; truncate is the safety net for a
      // long key name (the placeholders themselves are kept short enough to fit).
      className={`h-7 flex-1 min-w-0 flex items-center justify-center px-1.5 rounded border text-[11px] transition-colors ${
        capturing === side
          ? 'border-accent-solid text-accent bg-accent-solid/10 animate-pulse'
          : value
            ? 'border-border-strong text-text-primary bg-bg-input'
            : 'border-border-default text-text-tertiary bg-bg-input'
      } ${dimmed ? 'opacity-40 pointer-events-none' : ''}`}
    >
      {capturing === side ? <span className="truncate">press…</span> : value ? <KeyLabel name={value} /> : <span className="truncate">set key</span>}
    </button>
  );

  // Full rule in words, for the row tooltip: the row truncates long pairs, and this is where
  // the whole thing stays reachable.
  const describeRule = (r: RemapEntry) =>
    `${describeKey(r.from)} → ${r.to ? describeKey(r.to) : 'disabled'}${r.process ? ` (only in ${r.process})` : ''}`;

  const quarantineText = remaps.loadedFromBackup
    ? `remaps.json could not be read, so the last backup is shown. Changes go to ${remaps.pendingFile ?? 'remaps.pending.json'} until the file is replaced.`
    : `remaps.json could not be read and there is no backup, so the list shows empty. Changes go to ${remaps.pendingFile ?? 'remaps.pending.json'} until the file is replaced.`;

  return (
    // px-2.5 = the SettingRow content inset, so the chip borders (and the add-flow /
    // empty-state text) line up with the rows above them.
    <div className="flex flex-col gap-1.5 px-2.5 py-1">
      {/* Sidecar quarantine (RemapService.LoadFailed). The service protects the file; this is
          the door out it never had — until now the only word of it was a tray balloon, and the
          only way past it was to restart once the file opened again. */}
      {remaps.loadFailed && (
        <Callout tone="warn" still role="alert">
          <div className="flex flex-col gap-1.5">
            <span>{quarantineText}</span>
            {remaps.loadFailureDetail && (
              <span className="text-[10px] font-mono opacity-80 break-words">{remaps.loadFailureDetail}</span>
            )}
            <div>
              <Button variant="secondary" size="sm" onClick={() => send({ type: 'remap:overwriteUnreadable', payload: {} })}>
                Replace remaps.json
              </Button>
            </div>
          </div>
        </Callout>
      )}

      {remaps.entries.length === 0 && !addOpen && (
        <div className="text-[11px] text-text-tertiary leading-relaxed">
          {'Nothing yet. A remap turns one key into another — CapsLock → Esc — or disables it.'}
        </div>
      )}

      {/* Each entry is one full-width EnableChip-style chip — the same enable-dot +
          accent-wash vocabulary the Execution value chips teach (2026-07 reorg, V1
          "chip" variant): dot toggles the entry, the middle edits it in place, ✕ removes it,
          all inside the chip so a row is a single object. Off = plain input chrome + tertiary
          text (the hollow dot carries the state; no strike-through needed). */}
      {remaps.entries.map((r, i) => (
        <div
          // Keyed by FROM + scope, not by index: with the index in the key, deleting one row
          // shifts every later row's key, so React unmounts and rebuilds the survivors —
          // dropping keyboard focus to <body> mid-list. The pair is unique by construction
          // (the form rejects a duplicate, and RemapService is first-wins), and the raw strings
          // are deliberate: lower-casing them would make "CapsLock" and "capslock" collide in a
          // hand-edited file, which raw keys keep distinct.
          key={`${r.from}|${r.process ?? ''}`}
          // Master switch off dims every row — none of them is doing anything — while each dot
          // keeps its own on/off, so the two channels stop disagreeing about one key.
          className={`h-7 flex items-center rounded border overflow-hidden transition-opacity ${editIndex === i ? 'ring-1 ring-accent-solid' : ''} ${remaps.enabled ? '' : 'opacity-50'}`}
          style={r.enabled ? chipOn : chipOff}
        >
          <button
            type="button"
            onClick={() => saveList(remaps.entries.map((e, j) => (j === i ? { ...e, enabled: !r.enabled } : e)))}
            aria-label={r.enabled ? 'Disable remap' : 'Enable remap'}
            className="h-full pl-1.5 pr-1 flex items-center shrink-0 cursor-pointer transition-colors hover:bg-[rgba(127,127,127,0.18)]"
          >
            <span
              className="w-2 h-2 rounded-full block shrink-0"
              style={r.enabled ? chipDotOn : chipDotOff}
            />
          </button>
          <button
            type="button"
            onClick={() => startEdit(i)}
            data-tip={tt(`Edit ${describeRule(r)}`, `Editar ${describeRule(r)}`)}
            className={`flex-1 min-w-0 h-full flex items-center gap-1 text-left cursor-pointer ${r.enabled ? '' : 'opacity-60'}`}
          >
            <KeyCap name={r.from} />
            <ArrowRight size={10} className="text-text-tertiary shrink-0" />
            {r.to ? (
              <KeyCap name={r.to} />
            ) : (
              <span className="text-[10px] font-mono text-text-tertiary flex items-center gap-1 min-w-0">
                <Ban size={9} className="shrink-0" /> <span className="truncate">{'disabled'}</span>
              </span>
            )}
            {r.process && (
              // Per-app scope, as a glyph: the row has no room for the process name, and the
              // tooltip carries it.
              <span
                className="shrink-0 text-text-tertiary"
                data-tip={tt(`Only in ${r.process}`, `Só em ${r.process}`)}
              >
                <AppWindow size={10} />
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => { if (editIndex === i) closeForm(); saveList(remaps.entries.filter((_, j) => j !== i)); }}
            aria-label="Remove remap"
            className="shrink-0 h-full px-1 flex items-center text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X size={11} />
          </button>
        </div>
      ))}

      {addOpen ? (
        <div className="flex flex-col gap-1.5 py-1 border-t border-border-subtle mt-1">
          <div className="flex items-center gap-2">
            {keyChip('from', fromKey, false)}
            <ArrowRight size={10} className="text-text-tertiary shrink-0" />
            {keyChip('to', disableMode ? '' : toKey, disableMode)}
            {/* Mouse-side targets. Left / middle / right cannot be captured, so this menu is
                the only way to name them; side buttons and the wheel are here too for the
                user who does not know they can be captured. */}
            <div ref={mouseMenuRef} className={`relative shrink-0 ${disableMode ? 'opacity-40 pointer-events-none' : ''}`}>
              <button
                type="button"
                onClick={() => { stopCapture(); setMouseMenuOpen((o) => !o); }}
                className={iconButtonClass('md', { active: mouseMenuOpen })}
                data-tip={tt('Mouse button or wheel as target', 'Botão do mouse ou roda como alvo')}
              >
                <Mouse size={14} />
              </button>
              {mouseMenuOpen && (
                <div className="absolute right-0 top-full mt-1 w-40 menu-surface z-20 py-1">
                  {MOUSE_TARGETS.map((m) => (
                    <button
                      key={m.name}
                      type="button"
                      onClick={() => { setToKey(m.name); setCaptureError(null); setMouseMenuOpen(false); }}
                      className={`menu-item w-full text-left ${toKey.toLowerCase() === m.name.toLowerCase() ? 'text-accent' : 'text-text-primary'}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-text-tertiary cursor-pointer select-none">
            <input type="checkbox" checked={disableMode}
              onChange={(e) => { setDisableMode(e.target.checked); if (capturing === 'to') stopCapture(); setMouseMenuOpen(false); }} />
            {'Just disable the key'}
          </label>
          {/* Per-app scope. Empty = everywhere, which is what every remap was before this
              field existed. The picker lists what is running now. */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-text-tertiary shrink-0 flex items-center gap-1">
              <AppWindow size={11} /> {'Only in'}
            </span>
            <div className="flex-1 min-w-0">
              <ProcessNameInput value={processKey} onChange={setProcessKey} placeholder="any app" />
            </div>
          </div>
          {captureError && <div className="text-[10px]" style={{ color: 'var(--color-recording-fg)' }}>{captureError}</div>}
          {duplicate && (
            <div className="text-[10px]" style={{ color: 'var(--color-recording-fg)' }}>
              {processKey.trim() ? 'That key is already remapped in this app.' : 'That key is already remapped.'}
            </div>
          )}
          {selfRemap && (
            <div className="text-[10px]" style={{ color: 'var(--color-recording-fg)' }}>
              {'Source and target are the same key.'}
            </div>
          )}
          {fromMessage && (
            <div className="text-[10px]" style={{ color: 'var(--color-recording-fg)' }}>{fromMessage}</div>
          )}
          {toMessage && (
            <div className="text-[10px] text-text-secondary">{toMessage}</div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={closeForm}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={handleSave} disabled={!canSave}>
              {editIndex !== null ? 'Save' : 'Add'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={() => { resetForm(); setAddOpen(true); }}
            disabled={remaps.entries.length >= MAX_REMAPS}
            data-tip={remaps.entries.length >= MAX_REMAPS ? tt(`${MAX_REMAPS} is the limit`, `${MAX_REMAPS} é o limite`) : undefined}>
            <Plus size={11} /> Add remap
          </Button>
          {/* Export / import — the same two glyphs the snippets library uses. Profiles and
              themes exported; the remap layer only travelled by copying the sidecar by hand. */}
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={handleExport}
              disabled={remaps.entries.length === 0}
              className={iconButtonClass('sm')}
              data-tip={tt('Export remaps', 'Exportar remaps')}
            >
              <Download size={13} />
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className={iconButtonClass('sm')}
              data-tip={tt('Import remaps (added to yours)', 'Importar remaps (somados aos seus)')}
            >
              <Upload size={13} />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImport}
            />
          </div>
        </div>
      )}
      {/* Reserved line (never pushes the rows): a transfer outcome while it is fresh, otherwise
          the count once the cap is near — from 24 of 32 — so the Add button going grey at 32 is
          a number the user watched climb, not a bug. It lives HERE rather than beside Add
          because that row is already full at 224px: "32/32" next to the button wrapped the
          button's label onto two lines in the capture. */}
      <FieldError show={transferNote !== '' || nearCap} className="text-[10px] text-text-tertiary tabular-nums">
        {transferNote !== '' ? transferNote : `${remaps.entries.length}/${MAX_REMAPS} remaps`}
      </FieldError>
    </div>
  );
}
