import { useEffect, useMemo, useRef, useState } from 'react';
import { TriangleAlert, Zap, Plus, Trash2, Pipette, Camera, Frame, X, ScanSearch, ScanText, Check, Play, Power, Crosshair } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { useAppState } from '../state/AppStateContext';
import { useTt } from '../state/LanguageContext';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { Button } from './common/Button';
import { Toggle } from './common/Toggle';
import { IconToggle } from './common/IconToggle';
import { SegmentedControl } from './common/SegmentedControl';
import { NumberInput } from './common/NumberInput';
import { ProfileSearchList } from './common/ProfileSearchList';
import { Field } from './sheet/Field';
import { FieldError } from './common/FieldError';
import { WindowTargetFields } from './WindowTargetFields';
import { ImageCropper } from './ImageCropper';
import { rangeParts, phaseLockRisk } from '../utils/activeHours';
import { useEditorClaim } from '../hooks/useEditorClaim';
import type { AutomationEntry, TriggerConfig } from '../bridge/messageTypes';
import { effectiveOperator, parsesAsNumber, regexProblem } from '../utils/screenText';

// Day-pill order matches the backend bitmask convention (Sun = 1<<0, the If-Time one).
const DAY_PILLS = [
  { bit: 1 << 1, label: 'Mon' },
  { bit: 1 << 2, label: 'Tue' },
  { bit: 1 << 3, label: 'Wed' },
  { bit: 1 << 4, label: 'Thu' },
  { bit: 1 << 5, label: 'Fri' },
  { bit: 1 << 6, label: 'Sat' },
  { bit: 1 << 0, label: 'Sun' },
];

const CONDITION_TYPES = [
  { value: 'WindowOpen', label: 'Window open' },
  { value: 'ProcessRunning', label: 'Process running' },
  { value: 'FileExists', label: 'File exists' },
  { value: 'PixelColorMatch', label: 'Pixel color' },
  { value: 'ImageFound', label: 'Image on screen' },
  { value: 'ScreenText', label: 'Text on screen' },
  { value: 'ClipboardChanged', label: 'Clipboard changed' },
];

function defaultTrigger(): TriggerConfig {
  return {
    kind: 'interval',
    armed: false,
    intervalSeconds: 300,
    timeOfDay: '12:00',
    daysOfWeek: 0,
    conditionType: 'WindowOpen',
    windowProcessName: '',
    windowTitle: '',
    windowTitleMatchMode: 'contains',
    windowMatchForegroundOnly: false,
    // Same position as the push literal in WebViewBridge, for readability only: triggerShape
    // compares canonically (keys sorted, null = absent), so the order no longer decides anything.
    useRelativeCoordinates: false,
    filePath: '',
    pixelX: 0,
    pixelY: 0,
    pixelColor: '#FFFFFF',
    pixelTolerance: 10,
    imagePath: null,
    imageConfidence: 0.8,
    imageBase64: null,
    searchRegion: null,
    clipboardPattern: '',
    // 0 is the SENTINEL for "use the per-condition default", which is 5 s for ClipboardChanged and
    // 30 s for everything else. Seeding a literal 30 silently overrode the clipboard default on
    // every new automation — while defaultCooldownSec in this very file knows it is 5, and the
    // field's own hint says so. pollIntervalMs already seeds the sentinel; this was the odd one out.
    cooldownSeconds: 0,
    retrigger: 'edge',
    pollIntervalMs: 0,
  };
}

/** How long a sent save may go unconfirmed before the panel calls the work unsaved again. */
const SAVE_ECHO_TIMEOUT_MS = 4000;

/**
 * The config as the SAVE sees it — the shape two triggers are compared by.
 *
 * imageBase64 is display-only and deliberately sent as null; armed is not an editor field (the
 * list toggle owns it), so neither takes part. At module scope because two places ask the same
 * question and they must not drift: the echo that confirms a save, and the seeding effect that
 * decides whether a fresh push has anything new to show.
 *
 * CANONICAL, not a plain JSON.stringify of the object as it stands. The bridge serialises with
 * WhenWritingNull, so a null imagePath / searchRegion / timeOfDay arrives as a MISSING key, while
 * the draft holds the key with null — and a key the draft gained by a patch lands at the end of
 * its key order, not where the push puts it. Either way the two strings never matched: the echo
 * never confirmed, and a saved automation stayed "unsaved" for good (the dot, "Run now" refused
 * with "Save first", Close offering to discard work already on disk). Keys sorted, null and absent
 * read as the same thing, all the way down.
 */
function canonicalShape(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonicalShape);
  if (v === null || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v).sort()) {
    const x = (v as Record<string, unknown>)[k];
    if (x !== null && x !== undefined) out[k] = canonicalShape(x);
  }
  return out;
}
// The ScreenText fields as WebViewBridge.ParseTriggerConfig stores them: kept only for that type,
// the operator resolved for the mode, an empty operand as absent, the colour as #RRGGBB (an
// invalid one dropped), the tolerance clamped. Compared raw, the draft never matched its own
// save echo — an untouched Match ("contains" once stored), a lowercase colour, or fields left over
// from a type the automation used to be — and a saved automation stayed "unsaved" for good.
function storedScreenTextShape(t: TriggerConfig): TriggerConfig {
  if (t.conditionType !== 'ScreenText') {
    return { ...t, conditionOperator: null, conditionOperand: null, ocrReadAs: null, ocrTextColor: null, ocrColorTolerance: null };
  }
  const number = t.ocrReadAs === 'number';
  const hex = (t.ocrTextColor ?? '').trim();
  const tol = t.ocrColorTolerance;
  return {
    ...t,
    ocrReadAs: number ? 'number' : null,
    conditionOperator: t.conditionOperator == null ? t.conditionOperator : effectiveOperator(t.conditionOperator, number),
    conditionOperand: t.conditionOperand ? t.conditionOperand : null,
    ocrTextColor: /^#?[0-9A-Fa-f]{6}$/.test(hex) ? ('#' + hex.replace(/^#/, '')).toUpperCase() : null,
    ocrColorTolerance: typeof tol === 'number' && Number.isFinite(tol) ? Math.min(255, Math.max(0, Math.trunc(tol))) : null,
  };
}
const triggerShape = (t: TriggerConfig) => JSON.stringify(canonicalShape({ ...storedScreenTextShape(t), imageBase64: null, armed: false }));

// Default poll cadence per condition type — mirrors TriggerService.PollCadenceMs so the
// placeholder shown when the field is left at 0 is the number the daemon will actually use.
const DEFAULT_POLL_MS: Record<string, number> = { PixelColorMatch: 250, ClipboardChanged: 500 };
const defaultPollMs = (conditionType: string | null | undefined) =>
  DEFAULT_POLL_MS[conditionType ?? ''] ?? 1000;

// The cooldown default is per-condition too (Clipboard is 5 s, everything else 30 s) — the hint
// said 30 s for all of them, which is wrong exactly where a user is most likely to care, since a
// clipboard watcher is the one that can fire in bursts.
const defaultCooldownSec = (conditionType: string | null | undefined) =>
  conditionType === 'ClipboardChanged' ? 5 : 30;

/**
 * Why a trigger cannot ever fire, or null when it can.
 *
 * The failure this prevents is silent and permanent: a condition whose required field is blank
 * probes FALSE forever (WindowMatcher returns zero for a criteria-less target by design), so the
 * watcher arms, shows Running, spins at 1 Hz and never fires — with nothing on screen saying so.
 * ImageFound was the only family that self-reported, which taught users that silence means healthy.
 */
function whyCannotFire(t: TriggerConfig): string | null {
  if (t.kind === 'schedule') {
    if (!t.timeOfDay) return 'Pick a time of day.';
    // Schedule and the active-hours window share TimeOfDay, and switching kind does not clear the
    // other one's value — so a range configured as active hours arrives here looking truthy while
    // the "At" field shows blank. The daemon then stops the watcher on its first line. Detected by
    // SHAPE, using the same helper the summary uses, rather than by a stricter HH:mm regex:
    // TimeSpan.TryParse accepts forms like "1.09:00" from an imported profile, and rejecting those
    // would be over-matching — the regression in the opposite direction.
    if (rangeParts(t.timeOfDay)) {
      return 'That is an active-hours range, not a time of day — pick a single time.';
    }
  }
  if (t.kind !== 'condition') return null;
  // A âncora de janela reusa os campos do WindowOpen, que num gatilho de pixel ou de imagem
  // chegam vazios — nada nunca pediu que fossem preenchidos. Com os dois em branco o daemon
  // procura uma janela sem critério, não acha, e a condição fica falsa em todo tick para sempre.
  // Espelha o mesmo teste no TriggerService.DescribeUnfireable, e fica ANTES do switch porque
  // vale para os dois tipos que têm coordenada.
  if (t.useRelativeCoordinates && (t.conditionType === 'PixelColorMatch' || t.conditionType === 'ImageFound' || t.conditionType === 'ScreenText')
    && !(t.windowProcessName ?? '').trim() && !(t.windowTitle ?? '').trim()) {
    return 'The coordinates are anchored to a window — fill in a process name or a window title.';
  }
  switch (t.conditionType) {
    case 'WindowOpen':
      return (t.windowProcessName ?? '').trim() || (t.windowTitle ?? '').trim()
        ? null
        : 'Fill in a process name or a window title — with both blank this can never match.';
    case 'ProcessRunning':
      return (t.windowProcessName ?? '').trim()
        ? null
        : 'Fill in a process name.';
    case 'FileExists':
      return (t.filePath ?? '').trim()
        ? null
        : 'Fill in a file or folder path.';
    case 'ImageFound':
      return t.imagePath
        ? null
        : 'Capture a reference image.';
    case 'ScreenText': {
      // Mirrors TriggerService.DescribeUnfireable. The region is REQUIRED here (not just advised):
      // a whole-screen read every check costs ~0.45 s of CPU.
      if (!t.searchRegion) return 'Set a search region — reading the whole screen every check is too slow.';
      const number = t.ocrReadAs === 'number';
      const operand = t.conditionOperand ?? '';
      // A colour the backend cannot parse is DROPPED on save, and the watcher then reads every
      // colour — said here instead of saving something other than what is on screen.
      const color = (t.ocrTextColor ?? '').trim();
      if (color && !/^#?[0-9A-Fa-f]{6}$/.test(color)) return 'Text color must be 6 hex digits (RRGGBB) — use Pick, or clear it.';
      if (number) return parsesAsNumber(operand) ? null : 'Enter a number to compare with.';
      if (effectiveOperator(t.conditionOperator, false) === 'regex') {
        if (!operand) return 'Enter the pattern to watch for.';
        const bad = regexProblem(operand);
        return bad ? `${bad}.` : null;
      }
      // Contains/Equals compare normalised text: spaces alone are nothing (the daemon agrees).
      return operand.trim() ? null : 'Enter the text to watch for.';
    }
    case 'PixelColorMatch':
      // Mirrors PixelColorService.ParseHex: six hex digits, optional leading #. The default
      // (#FFFFFF) and the eyedropper both produce that, so this only catches a hand-typed value —
      // which is exactly the case that used to arm and never fire.
      return /^#?[0-9A-Fa-f]{6}$/.test((t.pixelColor ?? '').trim())
        ? null
        : 'Enter a 6-digit hex colour, like #FF0000 — shorthand such as #F00 is not accepted.';
    default:
      return null;   // ClipboardChanged is valid with its defaults
  }
}

/** Where an interrupted navigation was headed. See the pendingNav declaration for why this is
 *  a tagged union rather than `string | 'close'`. */
type NavDest = { kind: 'close' } | { kind: 'row'; name: string; asNewDraft: boolean };

const inputCls =
  'h-8 px-2 rounded bg-bg-input border border-border-subtle text-[12px] text-text-primary ' +
  'focus:outline-none focus:border-accent-solid w-full';

/**
 * Time alone for today, day and month prepended otherwise.
 *
 * lastFiredAt is persisted in the sidecar and survives restarts, and nextDueAt reaches up to seven
 * full days out (ComputeNextOccurrence scans the whole day mask). Showing only the clock therefore
 * read "2× · 09:00:04 · next 09:00" on a Wednesday for a Monday-only schedule — as though it had
 * already run today and would run again this morning. That defeats the question the persistence
 * exists to answer: did this run while I was away?
 *
 * A weekday name is NOT enough: the next occurrence can be a full seven days out, so "Mon 09:00"
 * is ambiguous with today. Only a date disambiguates.
 */
function fmtWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (sameDay) return time;
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`;
}

/** The active-hours window, ONLY when it is a range — mirrors TriggerService.ParseActiveHours, whose
 *  remarks explain why a bare time must not count. */
function activeHours(t: TriggerConfig): string | null {
  if (t.kind === 'schedule') return null;          // there, timeOfDay is the fire time
  const r = rangeParts(t.timeOfDay);
  return r ? `${r.from}–${r.to}` : null;
}

function kindSummary(t: TriggerConfig): string {
  const hours = activeHours(t);
  const within = hours ? `, ${hours}` : '';
  if (t.kind === 'interval') {
    const s = Math.max(5, t.intervalSeconds);
    const every = s % 60 === 0 ? `every ${s / 60} min` : `every ${s}s`;
    return every + within;
  }
  if (t.kind === 'schedule') return `at ${t.timeOfDay ?? '--:--'}`;
  const c = CONDITION_TYPES.find((x) => x.value === t.conditionType);
  return `when ${c?.label ?? t.conditionType ?? '?'}` + within;
}

export function AutomationPanel({ onClose }: { onClose: () => void }) {
  const { send, subscribe } = useBridge();
  const { automation, profiles } = useAppState();
  const tt = useTt();

  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<TriggerConfig | null>(null);
  const [dirty, setDirty] = useState(false);
  const [cropperOpen, setCropperOpen] = useState(false); // ImageFound: re-crop the reference PNG
  const [testMatchResult, setTestMatchResult] = useState<{ found: boolean; score: number; error?: string } | null>(null);
  const [testReadResult, setTestReadResult] = useState<{ ok: boolean; text: string; error?: string } | null>(null);
  // A not-yet-saved automation for a profile that has none. Only one at a time.
  const [newDraftProfile, setNewDraftProfile] = useState<string | null>(null);
  // Por que a coordenada foi limpa ao virar o interruptor de âncora. Some na próxima captura,
  // que é exatamente quando a frase deixa de ser verdadeira.
  const [anchorSpaceNotice, setAnchorSpaceNotice] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const seededForRef = useRef<string | null>(null);
  // Confirm gates. `confirmDelete` mirrors the action grid's Clear All popover; `pendingNav`
  // holds the navigation an unsaved draft is blocking (a row name, or 'close') until the user
  // decides. Both are deliberately in-panel rather than window.confirm, which DialogShell's
  // Escape handling would race.
  const [confirmDelete, setConfirmDelete] = useState(false);
  // A typed destination, not a bare string: a profile can legitimately be NAMED "close", and a
  // `string | 'close'` union collapses to `string`, so the sentinel would silently hijack it.
  // `asNewDraft` carries the Add-automation intent through the prompt.
  const [pendingNav, setPendingNav] = useState<NavDest | null>(null);
  // A save that has been sent and not yet confirmed by the state echo. Keyed by PROFILE and
  // stamped: keyed, because a bare boolean could be consumed by whichever row happened to be
  // selected when an echo landed; stamped, because an echo that never comes must not leave the
  // panel waiting forever (see SAVE_ECHO_TIMEOUT_MS).
  const [pendingSave, setPendingSave] = useState<{ profile: string; at: number } | null>(null);
  // Result of a manual "Run now", shown next to the button. Cleared on selection change.
  const [testFireResult, setTestFireResult] = useState<{ ok: boolean; text: string } | null>(null);

  // Live status refresh while open: pushes are change-driven, so a quiet watcher's
  // nextDue countdown would go stale without a poll. 2 s is plenty.
  useEffect(() => {
    send({ type: 'automation:request', payload: {} });
    const id = window.setInterval(() => send({ type: 'automation:request', payload: {} }), 2000);
    return () => window.clearInterval(id);
  }, [send]);

  const entries = automation.entries;
  const entryByProfile = useMemo(() => {
    const m = new Map<string, AutomationEntry>();
    for (const e of entries) m.set(e.profile, e);
    return m;
  }, [entries]);

  // Display list = saved automations + the one unsaved draft (if any).
  const listProfiles = useMemo(() => {
    const names = entries.map((e) => e.profile);
    if (newDraftProfile && !names.includes(newDraftProfile)) names.push(newDraftProfile);
    return names;
  }, [entries, newDraftProfile]);

  const profilesWithoutTrigger = useMemo(
    () => profiles.filter((p) => !entryByProfile.has(p.name) && p.name !== newDraftProfile).map((p) => p.name),
    [profiles, entryByProfile, newDraftProfile],
  );

  // Seed the editor draft from the store. Later automation:state pushes carry runtime status and
  // must never stomp in-progress config edits — but "seed once per selection" was too blunt a way
  // to say that, and it lost work the OTHER way: leaving an automation and coming back while a
  // save was still in flight re-seeded from the store, which still held the PRE-save config, and
  // stamped the ref — so when the echo finally arrived there was nobody listening, and the editor
  // sat on the old values for good, with Save greyed out because nothing looked dirty.
  //
  // The real rule is: re-seed only when the editor holds nothing of the user's. Dirty, a save in
  // flight, or a store with nothing to offer all mean "leave it alone". The shape comparison keeps
  // it quiet the rest of the time — a status-only push must not rebuild the draft object.
  useEffect(() => {
    if (selected == null) { setDraft(null); seededForRef.current = null; return; }
    const stored = entryByProfile.get(selected);
    if (seededForRef.current === selected) {
      if (dirty || pendingSave != null || !stored || !draft) return;
      if (triggerShape(stored.trigger) === triggerShape(draft)) return;
    }
    seededForRef.current = selected;
    setDraft(stored ? { ...stored.trigger } : defaultTrigger());
    setDirty(false);
  }, [selected, entryByProfile, dirty, pendingSave, draft]);

  // A saved entry vanishing (deleted elsewhere / profile removed) clears a matching selection.
  useEffect(() => {
    if (selected && !listProfiles.includes(selected)) {
      setSelected(null);
      setDraft(null);
    }
  }, [selected, listProfiles]);

  const patch = (p: Partial<TriggerConfig>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
    // The flight describes the draft AS SENT. The moment the draft moves past it there is
    // unsaved work again, and the echo — which will confirm the older shape — must not be
    // allowed to speak for it. Without this, editing while a save was in the air hid the new
    // edits behind "saving" and let them be navigated away from without a word.
    setPendingSave(null);
  };

  // An automation that has never been saved has unsaved work by definition — the seeded
  // default IS a complete, valid "every 5 minutes" config. Gating Save on `dirty` alone left
  // the button inert on the single most obvious thing to create, with no tooltip and no hint,
  // and the only escape was to discover you must nudge a field first. `dirty` keeps meaning
  // "the user edited something"; the Save gate is what widens.
  const isNewDraft = selected != null && !entryByProfile.has(selected);
  const cannotFire = draft ? whyCannotFire(draft) : null;
  // "Sent, waiting for the backend to confirm" — a THIRD state, not a flavour of unsaved.
  //
  // `dirty` deliberately survives handleSave (see the note there: a save can fail on the backend
  // and roll back), but treating the flight as unsaved work is what made a successful Save look
  // like it did nothing: the row kept its ● dot, and Close or a click on another automation
  // raised "Unsaved automation" over work that was already being written. "Save and continue"
  // then appeared to be the thing that saved it — it only re-sent and cleared `dirty` by
  // navigating. The window is the whole backend round trip (read the profile JSON, write it,
  // re-arm the daemon, push state + profile list), which on a large profile easily outlasts the
  // user's next click.
  const saving = pendingSave != null && pendingSave.profile === selected;
  const hasUnsavedWork = !saving && (dirty || isNewDraft) && draft != null;
  const canSave = hasUnsavedWork && !cannotFire;
  // The draft lives here until Save, so the backend cannot see it: closing the window or a silent
  // update after a run threw it away without a word. The claim lets both gates ask first. (It does
  // NOT hold automations off — a fire cannot reach this draft; see AutomationGuard.BlockedReason.)
  useEditorClaim('automation-panel', hasUnsavedWork);

  // Every exit from a dirty editor routes through here. Without it, Close, Escape (DialogShell
  // turns a bare Esc into onClose) and a click on another row all discarded the draft in
  // silence — including a just-captured reference image, whose PNG is already on disk and
  // becomes an orphan, and a search region the user snapped by hand.
  // Commit a navigation, no questions asked. seededForRef is cleared so the seed effect re-runs
  // even when the destination equals the current selection (React bails out of a same-value
  // setState, which would otherwise leave the "discarded" draft on screen).
  const go = (dest: NavDest) => {
    setPendingNav(null);
    // The flight belongs to the row being left. Carrying it over would arm the echo comparison
    // against a different automation's config — and a new draft, which has no stored entry to
    // compare against, would inherit a "saving" state it never asked for and sit there with a
    // dead Save button.
    setPendingSave(null);
    if (dest.kind === 'close') { onClose(); return; }
    seededForRef.current = null;
    if (dest.asNewDraft) setNewDraftProfile(dest.name);
    setSelected(dest.name);
    setDraft(entryByProfile.get(dest.name) ? { ...entryByProfile.get(dest.name)!.trigger } : defaultTrigger());
    setDirty(false);
  };

  const navigateTo = (dest: NavDest) => {
    // Once the prompt is up it owns the decision. Without this, DialogShell's Escape keeps
    // calling through underneath the overlay and rewrites the pending destination to 'close' —
    // so answering "Discard" would close the panel instead of going to the row that was clicked.
    if (pendingNav) return;
    // Re-selecting the row you are already on is not a navigation; prompting about it and then
    // "discarding" would leave the edits visibly on screen.
    if (dest.kind === 'row' && dest.name === selected && !dest.asNewDraft) return;
    if (hasUnsavedWork) { setPendingNav(dest); return; }
    go(dest);
  };

  const discardAndGo = (dest: NavDest) => {
    setDirty(false);
    if (isNewDraft) setNewDraftProfile(null);
    go(dest);
  };

  const handleSave = () => {
    if (!selected || !draft) return;
    // Armed is NOT an editor field — the list toggle is the sole arming surface
    // (automation:setArmed persists immediately). Sending the seeded draft.armed here
    // would silently revert a list-toggle made after the draft was seeded.
    const armed = entryByProfile.get(selected)?.trigger.armed ?? false;
    // imageBase64 is display-only (the on-disk PNG is the source) — the backend never parses it, so
    // send null instead of round-tripping the large derived blob across the bridge on every save.
    send({ type: 'automation:save', payload: { profile: selected, trigger: { ...draft, imageBase64: null, armed } } });
    // Deliberately NOT clearing `dirty` here. The save can fail on the backend — a locked .json,
    // antivirus, a full disk — and it rolls back and toasts. Clearing optimistically then left the
    // panel claiming success: Save disabled (nothing dirty, so no way to retry without touching a
    // field), "Run now" re-enabled and running the OLD config, and the canClose guard disarmed, so
    // closing discarded the edits without asking. The echo effect below clears it on the state push
    // that only arrives when the write actually landed.
    //
    // What the flight marker changes is only what the panel SAYS meanwhile: "saving", not
    // "unsaved". If the echo never confirms, the timeout below puts the panel back exactly where
    // this comment left it — Save live again, ready to retry.
    setPendingSave({ profile: selected, at: Date.now() });
    // newDraftProfile stays set until the automation:state echo lands — clearing it now
    // would drop the row from the list (entries doesn't have it yet) and blank the editor.
  };

  // New-draft handoff: once the backend echo carries the saved entry, the store row
  // replaces the local draft row.
  useEffect(() => {
    if (newDraftProfile && entryByProfile.has(newDraftProfile)) setNewDraftProfile(null);
  }, [newDraftProfile, entryByProfile]);

  const handleRemove = () => {
    if (!selected) return;
    // Not while a save is in the air. newDraftProfile outlives the first save's flight (see
    // handleSave), so "still a new draft" did not mean "nothing on disk": a delete in that window
    // only dropped the local marker, the save landed after it, and the automation the user had
    // just deleted came back in the list. The buttons are disabled for the flight; this is the
    // funnel behind them, for a confirm that was already showing when Save was pressed.
    if (saving) return;
    if (newDraftProfile === selected) {
      setNewDraftProfile(null);
    } else {
      send({ type: 'automation:save', payload: { profile: selected, trigger: null } });
    }
    setConfirmDelete(false);
    setDirty(false);
    setSelected(null);
    setDraft(null);
  };

  // Fire this automation ONCE, right now, through the real trigger path — so the answer covers
  // the gates too (busy / unsaved edits / dialog open), not just "is the condition true". The
  // only way to validate an automation used to be to retype the schedule to two minutes out,
  // wait, and set it back; a condition watcher could not be exercised at all.
  const testFireReqRef = useRef<string | null>(null);
  const runNow = () => {
    if (!selected) return;
    const id = `autofire-${Date.now()}`;
    testFireReqRef.current = id;
    setTestFireResult(null);
    send({ type: 'automation:testFire', payload: { requestId: id, profile: selected } });
  };

  // ── Pick-from-screen round-trips (pixel color + image capture) ──
  const pickReqRef = useRef<string | null>(null);
  const captureReqRef = useRef<string | null>(null);
  const regionReqRef = useRef<string | null>(null);
  const testMatchReqRef = useRef<string | null>(null);
  const textColorReqRef = useRef<string | null>(null);
  const testReadReqRef = useRef<string | null>(null);

  // Remembers the last non-empty half of the active-hours pair, so clearing one input does not
  // destroy the other and the sibling never has to invent 00:00 / 23:59.
  const lastHoursRef = useRef({ from: '09:00', to: '18:00' });

  // Stable, so it runs on MOUNT and not on every render. As an inline arrow it was a new callback
  // each time, and the panel re-renders on the 2 s automation poll — which pulled focus back to
  // the discard prompt every two seconds while the user was trying to answer it, and made the
  // "Focusing on mount" comment beside it false.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'pixel:colorPicked' && msg.payload.requestId === pickReqRef.current) {
        pickReqRef.current = null;
        if (!msg.payload.cancelled && msg.payload.hex) {
          setAnchorSpaceNotice(null);
          patch({ pixelX: msg.payload.x ?? 0, pixelY: msg.payload.y ?? 0, pixelColor: msg.payload.hex });
        }
      }
      if (msg.type === 'automation:imageCaptured' && msg.payload.requestId === captureReqRef.current) {
        captureReqRef.current = null;
        if (!msg.payload.cancelled && msg.payload.imagePath) {
          // A new/cropped reference makes any test-match badge stale → drop it. A fresh CAPTURE (not a
          // crop of the same image, which keeps its location) may point at a different target, so also
          // clear the snapped ROI — otherwise the daemon would search the new image inside the old box.
          const wasCrop = msg.payload.requestId.startsWith('autocrop-');
          setTestMatchResult(null);
          patch({ imagePath: msg.payload.imagePath, imageBase64: msg.payload.imageBase64 ?? null, ...(wasCrop ? {} : { searchRegion: null }) });
        }
      }
      // Shared reply message with SheetPanel's WaitImage ROI — the autoregion- requestId + this
      // per-panel ref guard keep the two listeners from crossing wires.
      if (msg.type === 'waitimage:searchRegionSet' && msg.payload.requestId === regionReqRef.current) {
        regionReqRef.current = null;
        const r = msg.payload;
        if (!r.cancelled && r.w && r.h && r.w > 0 && r.h > 0) {
          setAnchorSpaceNotice(null);
          patch({ searchRegion: { x: r.x ?? 0, y: r.y ?? 0, w: r.w, h: r.h } });
        }
      }
      // Test match reply (shared type with SheetPanel; testMatchReqRef guards it). On a hit, snap the
      // search region to an 80px box around where the image was found — one click sets the ROI right.
      if (msg.type === 'image:testMatchResult' && msg.payload.requestId === testMatchReqRef.current) {
        testMatchReqRef.current = null;
        const r = msg.payload;
        setTestMatchResult({ found: r.found, score: r.score, error: r.error });
        if (r.found) {
          // No Math.max(0,…): watcher coords are ABSOLUTE virtual-screen and go negative on a monitor
          // left of / above the primary; the backend MatchOnce clamps the ROI to the bitmap itself.
          const m = 80;
          patch({ searchRegion: { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 } });
        }
      }
      if (msg.type === 'pixel:colorPicked' && msg.payload.requestId === textColorReqRef.current) {
        textColorReqRef.current = null;
        if (!msg.payload.cancelled && msg.payload.hex) patch({ ocrTextColor: msg.payload.hex });
      }
      // Test read (Text on screen). Same snap as Test match: a hit with no region yet sets one.
      if (msg.type === 'ocr:testReadResult' && msg.payload.requestId === testReadReqRef.current) {
        testReadReqRef.current = null;
        const r = msg.payload;
        if (r.error) { setTestReadResult({ ok: false, text: '', error: r.error }); }
        else {
          setTestReadResult({ ok: !!r.matched, text: r.text ?? '' });
        }
      }
      if (msg.type === 'automation:testFireResult' && msg.payload.requestId === testFireReqRef.current) {
        testFireReqRef.current = null;
        setTestFireResult({ ok: msg.payload.fired, text: msg.payload.detail });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  // Drop stale badges when switching automations. The anchor notice is one of them: it is a
  // sentence about the coordinate fields of the automation that was on screen, and it used to
  // follow the user to the next one — a clipboard watcher included, which has no coordinates.
  useEffect(() => {
    setTestMatchResult(null);
    setTestReadResult(null);
    setTestFireResult(null);
    setConfirmDelete(false);
    setPendingSave(null);
    setAnchorSpaceNotice(null);
    // Drop the in-flight correlation ids too, not just the rendered badges. The subscribe
    // handlers match on requestId alone, so a reply that lands after the user has moved on
    // would attach an authoritative-sounding result ("Fired — the profile is running now") to
    // whichever automation is now on screen.
    testFireReqRef.current = null;
    testMatchReqRef.current = null;
    pickReqRef.current = null;
    regionReqRef.current = null;
    captureReqRef.current = null;
    testReadReqRef.current = null;
    textColorReqRef.current = null;
  }, [selected]);

  // The echo landed (or the entry existed all along) — the save is no longer in flight.
  useEffect(() => {
    if (!pendingSave || !selected || pendingSave.profile !== selected || !draft) return;
    const stored = entryByProfile.get(selected)?.trigger;
    if (!stored) return;
    // Cleared when the STORE actually reflects what we sent — not merely when an entry for this
    // profile exists, which for an existing automation was already true at the moment of the save
    // and therefore proved nothing. Without this, `dirty` survived a successful save: the unsaved
    // dot stayed up, "Run now" stayed disabled with a tooltip about pending edits, and closing the
    // panel offered to discard work that was already on disk.
    //
    // Comparing rather than trusting a token is what keeps B13 intact: when the backend save throws
    // it rolls the mirrors back, the stored value then differs from the draft, and the panel
    // correctly goes on considering the edits unsaved.
    //
    // imageBase64 is display-only and deliberately sent as null; armed is not an editor field (the
    // list toggle owns it), so neither takes part in the comparison.
    if (triggerShape(stored) === triggerShape(draft)) {
      setPendingSave(null);
      setDirty(false);
    }
  }, [pendingSave, selected, entryByProfile, draft]);

  // Backstop for an echo that never confirms — a save that threw and rolled back, or one whose
  // stored shape genuinely differs from the draft. The panel must not sit in "saving" over work
  // it can no longer vouch for: falling back to "unsaved" is the honest reading, and it puts the
  // Save button back so the user can retry. Generous on purpose — the flight is a profile read,
  // a profile write and a daemon re-arm, and calling a slow disk a failure would be the same
  // lie in the other direction.
  useEffect(() => {
    if (!pendingSave) return;
    const left = SAVE_ECHO_TIMEOUT_MS - (Date.now() - pendingSave.at);
    const id = window.setTimeout(() => setPendingSave(null), Math.max(0, left));
    return () => window.clearTimeout(id);
  }, [pendingSave]);

  /**
   * The window this watcher anchors its coordinates to, or null when it does not.
   *
   * Every capture request below carries it, and that is what puts the stored coordinate in the
   * SAME space the daemon reads it in. The feature shipped with only the daemon half — it added
   * the window origin at every tick while these three kept storing virtual-screen coordinates, so
   * an anchored watcher sampled the picked point PLUS the origin.
   *
   * `absolute: true` stays on all three and means what it always meant: not the ACTIVE PROFILE's
   * target. The anchor is this trigger's own, and the two must not be confused.
   */
  // Sent whenever the anchor is ON, even with the window fields still BLANK — the blank case
  // is the one that needed a voice. Withholding it made 'anchor off' and 'anchor on, window not
  // named yet' arrive at the backend as the same empty payload, so a pick made in that state was
  // stored as a SCREEN coordinate in silence. And the panel forces the user into exactly that
  // state: Save is blocked until a process or title is filled in, so the only way forward is to
  // name the window AFTER picking — which re-reads the number in a space it was never in.
  const anchorPayload = () =>
    draft?.useRelativeCoordinates
      && (draft.conditionType === 'PixelColorMatch' || draft.conditionType === 'ImageFound' || draft.conditionType === 'ScreenText')
      ? {
        anchor: {
          processName: draft.windowProcessName ?? '',
          windowTitle: draft.windowTitle ?? '',
          titleMatchMode: draft.windowTitleMatchMode === 'regex' ? 'regex' : 'contains',
        },
      }
      : {};

  const pickPixel = () => {
    const id = `autopix-${Date.now()}`;
    pickReqRef.current = id;
    // absolute: watcher coords are virtual-screen — the profile-relative translation
    // the If/WaitPixel editors want would store coords the daemon samples wrongly.
    send({ type: 'pixel:pickColor', payload: { requestId: id, absolute: true, ...anchorPayload() } });
  };
  const captureImage = () => {
    if (!selected) return;
    const id = `autoimg-${Date.now()}`;
    captureReqRef.current = id;
    send({ type: 'automation:captureImage', payload: { requestId: id, profile: selected } });
  };
  const configureRegion = () => {
    if (!selected) return;
    const id = `autoregion-${Date.now()}`;
    regionReqRef.current = id;
    // absolute: watcher ROI is virtual-screen coords (the backend skips the rel-coords round-trip).
    const r = draft?.searchRegion;
    send({ type: 'waitimage:configureSearchRegion', payload: { requestId: id, absolute: true, ...anchorPayload(), ...(r ? { x: r.x, y: r.y, w: r.w, h: r.h } : {}) } });
  };
  // Crop the current reference tighter — the backend replies over automation:imageCaptured (new
  // path + thumbnail), so reuse captureReqRef to match it. rect is image-pixel coords from the cropper.
  const cropReference = (rect: { x: number; y: number; w: number; h: number }) => {
    if (!selected || !draft?.imagePath) { setCropperOpen(false); return; }
    const id = `autocrop-${Date.now()}`;
    captureReqRef.current = id;
    send({ type: 'automation:cropReference', payload: { requestId: id, profile: selected, imagePath: draft.imagePath, ...rect } });
    setCropperOpen(false);
  };
  const testMatch = () => {
    if (!selected || !draft?.imagePath) return;
    const id = `autotest-${Date.now()}`;
    testMatchReqRef.current = id;
    setTestMatchResult(null);
    // absolute + profile: the test image lives under the trigger's profile and its coords are
    // virtual-screen (the backend skips the rel-coords round-trip and reports absolute).
    const r = draft.searchRegion;
    send({ type: 'image:testMatch', payload: { requestId: id, absolute: true, ...anchorPayload(), profile: selected, imagePath: draft.imagePath, confidence: draft.imageConfidence || 0.8, ...(r ? { searchRegion: r } : {}) } });
  };

  const pickTextColor = () => {
    const id = `autotextcolor-${Date.now()}`;
    textColorReqRef.current = id;
    send({ type: 'pixel:pickColor', payload: { requestId: id } });
  };
  const testRead = () => {
    if (!draft) return;
    const id = `autoread-${Date.now()}`;
    testReadReqRef.current = id;
    setTestReadResult(null);
    const number = draft.ocrReadAs === 'number';
    const r = draft.searchRegion;
    send({ type: 'ocr:testRead', payload: {
      requestId: id, absolute: true, ...anchorPayload(), ...(r ? { searchRegion: r } : {}),
      readAs: number ? 'number' : null,
      operator: effectiveOperator(draft.conditionOperator, number),
      operand: draft.conditionOperand ?? '',
      match: true,
      textColor: /^#?[0-9A-Fa-f]{6}$/.test((draft.ocrTextColor ?? '').trim()) ? draft.ocrTextColor : null,
      tolerance: draft.ocrColorTolerance ?? 70,
    } });
  };

  const selectedEntry = selected ? entryByProfile.get(selected) : undefined;
  const selectedProfile = selected ? profiles.find((p) => p.name === selected) : undefined;
  const noTarget = selectedProfile ? !selectedProfile.hasEffectiveTarget : false;

  return (
    <>
    <DialogShell
      icon={<Zap size={14} className="text-accent-light" />}
      title="Automation"
      size="full"
      // Above the Sheet (scrim z-60, panel z-70): the tray's "Automations…" opens this from
      // OUTSIDE the stack, and at the default z-50 it painted under an open Sheet — unreachable,
      // with DialogShell pulling the focus into it. Its own prompt sits a layer higher still, and
      // the cropper (z-80, rendered after this shell) paints over it by DOM order.
      zClass="z-[80]"
      onClose={onClose}
      // Pre-close veto, NOT an onClose that declines: DialogShell's onClose runs after it has
      // already committed to leaving, so refusing there fades the panel out and leaves it
      // mounted — an invisible modal over the whole app.
      canClose={() => {
        // The prompt already owns the decision — the same guard navigateTo keeps, and for the
        // same reason. Escape does NOT go through navigateTo (DialogShell calls this directly),
        // so without it an Escape while the prompt is up silently rewrote the pending destination
        // to 'close', and answering "Discard" or "Save and continue" closed the panel instead of
        // going to the row that was clicked. Nothing was lost but the place.
        if (pendingNav) return false;
        if (!hasUnsavedWork) return true;
        setPendingNav({ kind: 'close' });
        return false;
      }}
      closeOnBackdrop={false}
      showClose
      footer={() => (
        <>
          {/* IconToggle, not Toggle: this is the daemon's master enable, not a settings row —
              the Power glyph says what it gates, which a generic switch can't. */}
          <div className="flex items-center gap-2 mr-auto">
            <IconToggle isOn={automation.enabled} icon={Power} ariaLabel="Automations enabled"
              onChange={(v) => send({ type: 'automation:setEnabled', payload: { enabled: v } })} />
            <span className="text-[12px] text-text-secondary">Automations enabled</span>
          </div>
          <Button variant="secondary" size="md" onClick={() => navigateTo({ kind: 'close' })}>Close</Button>
          {/* The tooltip explains a blocked Save (cannotFire); when there's simply nothing
              unsaved, the button just sits disabled with no tooltip. */}
          {/* "Saving…" is the whole point of the flight state being visible: a Save that greys
              out with no other change reads as a click that did nothing. */}
          <span data-tip={hasUnsavedWork ? cannotFire ?? undefined : undefined}>
            <Button variant="primary" size="md" onClick={handleSave} disabled={!canSave}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </span>
        </>
      )}
    >
      <div className="flex h-full min-h-0">
        {/* ── Left: automations list ── */}
        <div className="w-72 shrink-0 border-r border-border-subtle flex flex-col min-h-0">
          <div className="p-2 border-b border-border-subtle">
            {addOpen ? (
              // Search-and-pick instead of a native <select>: the OS dropdown has no filter,
              // so choosing among ~80 profiles meant scrolling a wall of names. Same
              // type-to-narrow behaviour as the Profiles panel and the export dialog.
              // Dismissal is the ✕ or Esc — NOT blur, which a click on a list row also fires.
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className="label-micro text-text-tertiary flex-1">
                    {'Pick a profile'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAddOpen(false)}
                    aria-label={'Cancel'}
                    className="text-text-disabled hover:text-text-secondary transition-colors shrink-0"
                  >
                    <X size={12} />
                  </button>
                </div>
                <ProfileSearchList
                  profiles={profilesWithoutTrigger}
                  value={null}
                  onChange={(name) => {
                    setAddOpen(false);
                    // Through the SAME gate as the other exits. Only one unsaved draft can exist
                    // at a time, so picking a profile here replaces the current draft outright —
                    // the very destruction the guard was added to prevent, and the one route
                    // that still bypassed it.
                    navigateTo({ kind: 'row', name, asNewDraft: true });
                  }}
                  autoFocus
                  onCancel={() => setAddOpen(false)}
                  listMaxHeightClass="max-h-[220px]"
                  ariaLabel={'Profiles without an automation'}
                />
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}
                disabled={profilesWithoutTrigger.length === 0}>
                <Plus size={12} /> Add automation
              </Button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {listProfiles.length === 0 && (
              <div className="p-4 text-[12px] text-text-tertiary leading-relaxed">
                {'No automations yet. One fires a profile on a timer, a schedule or a watched condition — no hotkey needed.'}
              </div>
            )}
            {listProfiles.map((name) => {
              const entry = entryByProfile.get(name);
              const trig = name === newDraftProfile && !entry ? null : entry?.trigger;
              const isSel = selected === name;
              // State dot, two channels with the arm toggle beside it: green = watching, amber =
              // armed but not watching, grey = off. The reason behind an amber dot is in its tooltip
              // and in the editor's own callout — the row used to spell it out as a fourth line of
              // red 10 px text, on every such row (84 px per row, four lines in three colours).
              const armed = !!entry?.trigger.armed;
              const dotColor = entry?.running ? 'var(--color-replay)' : armed ? 'var(--color-warning)' : 'var(--color-text-disabled)';
              // Only a watcher that HAS a level condition can report one. Interval and schedule
              // never write ConditionTrue, and neither does ClipboardChanged — which is kind
              // 'condition' but edge-triggered — so the tooltip used to assert "condition false
              // now" about a condition that does not exist, reading as "this will not fire" on a
              // perfectly healthy watcher.
              const showsCondition = entry?.trigger.kind === 'condition'
                && entry.trigger.conditionType !== 'ClipboardChanged';
              const dotTip = entry?.running
                ? (showsCondition
                  ? (entry.conditionTrue
                    ? tt('Watching · condition true now', 'Vigiando · condição verdadeira agora')
                    : tt('Watching · condition false now', 'Vigiando · condição falsa agora'))
                  : tt('Watching', 'Vigiando'))
                : armed
                  ? (!automation.enabled
                    ? tt('Armed · automations paused', 'Armada · automações pausadas')
                    : entry?.isDisabled
                      ? tt('Armed · profile disabled', 'Armada · profile desativado')
                      : tt('Armed · not watching (see the editor)', 'Armada · não vigia (veja o editor)'))
                  : entry ? tt('Off', 'Desligada') : tt('Not saved yet', 'Ainda não salva');
              return (
                <div
                  key={name}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigateTo({ kind: 'row', name, asNewDraft: false })}
                  // Only when the ROW itself is focused — the same target guard the action grid
                  // keeps. Without it the row swallowed Enter and Space aimed at the arm toggle
                  // nested inside it, so the switch could not be operated from the keyboard at
                  // all: aria-checked never moved, nothing was sent, and the row got selected
                  // instead. The list toggle is the ONLY surface that arms an automation, which
                  // the editor's own footer says, so that was the whole feature unreachable.
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigateTo({ kind: 'row', name, asNewDraft: false }); }
                  }}
                  className={`w-full text-left px-3 py-2 border-b border-border-subtle/60 transition-colors cursor-pointer ${
                    isSel ? 'bg-bg-elevated' : 'hover:bg-bg-elevated/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: dotColor, boxShadow: armed || entry?.running ? `0 0 0 3px color-mix(in srgb, ${dotColor} 20%, transparent)` : undefined }}
                      data-tip={dotTip}
                    />
                    <span className="text-[12px] text-text-primary truncate flex-1">{name}</span>
                    {/* Unsaved marker — nothing in the list used to distinguish an edited row,
                        so a draft could be abandoned without ever looking abandoned. */}
                    {isSel && hasUnsavedWork && (
                      <span className="text-[10px] text-accent-light shrink-0"
                        data-tip={tt('Unsaved changes', 'Alterações não salvas')}>●</span>
                    )}
                    {entry ? (
                      <span onClick={(e) => e.stopPropagation()}
                        data-tip={entry.isDisabled
                          ? tt('Profile disabled — enable it in the sidebar', 'Profile desativado — reative na barra lateral')
                          : undefined}>
                        <Toggle size="sm" isOn={entry.trigger.armed} disabled={entry.isDisabled}
                          onChange={(v) => send({ type: 'automation:setArmed', payload: { profile: name, armed: v } })} />
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-tertiary uppercase">{'new'}</span>
                    )}
                  </div>
                  {/* One meta line: schedule · fires · last · next · result. */}
                  {/* The whole line on hover: it is `truncate` in a 248 px column, so the tail —
                      which is where the last result lands — is exactly what gets cut. */}
                  <div
                    className="mt-0.5 pl-4 text-[11px] text-text-tertiary truncate"
                    data-tip={[
                      trig ? kindSummary(trig) : 'not saved yet',
                      entry && entry.fireCount > 0 ? `${entry.fireCount}× · ${fmtWhen(entry.lastFiredAt)}` : null,
                      entry?.trigger.armed && entry.running && entry.nextDueAt ? `next ${fmtWhen(entry.nextDueAt)}` : null,
                      entry?.lastResult && entry.lastResult !== 'fired' ? entry.lastResult : null,
                    ].filter(Boolean).join(' · ')}
                    data-tip-reveal
                  >
                    {trig ? kindSummary(trig) : 'not saved yet'}
                    {entry && entry.fireCount > 0 && ` · ${entry.fireCount}× · ${fmtWhen(entry.lastFiredAt)}`}
                    {entry?.trigger.armed && entry.running && entry.nextDueAt && ` · next ${fmtWhen(entry.nextDueAt)}`}
                    {entry?.lastResult && entry.lastResult !== 'fired' && ` · ${entry.lastResult}`}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: editor ── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4">
          {!selected || !draft ? (
            <div className="h-full flex items-center justify-center text-[12px] text-text-tertiary">
              {'Select an automation on the left, or add one.'}
            </div>
          ) : (
            // key={selected} for the same reason SettingsPanel keys its tab content:
            // without it, picking a different automation keeps this subtree mounted and
            // React reuses every node by position — measured: 49 of 49 nodes survive the
            // switch. The "Foreground only" Toggle would then slide its knob
            // (transition-[left], 150ms) as the new automation's value replaced the old
            // one, i.e. a switch animating on a control the user never touched. draft and
            // selected live in this component, not in the subtree, so remounting is free.
            <div key={selected} className="flex flex-col gap-4 max-w-[520px]">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[13px] font-medium text-text-primary truncate">{selected}</div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Run now: the ONLY way to find out whether an automation works without
                      waiting for its real trigger. Goes through the same fire path, so the
                      answer includes the gates (busy / unsaved edits / dialog open) — a
                      condition probe alone would report success on a fire that gets skipped. */}
                  {/* Only the DISABLED reason survives, never a tip on the working button — the
                      enabled tooltip just restated the label and was rightly cut. This half is
                      not noise: whyCannotFire cannot cover it (it sees only the TriggerConfig,
                      never the unsaved state, and returns null outright for the default
                      `interval` kind), so without this the button greys out with nothing on
                      screen tying it to the pending edit. Same wrapper the Save button uses, for
                      the same reason — a tip on a disabled <button> does still show here, since
                      Button sets no pointer-events:none. */}
                  {/* `saving` counts here too: for an EXISTING automation mid-flight the edits are
                      no longer "unsaved", but the daemon is still holding the old config — firing
                      now would run it and report an authoritative result about the wrong thing. */}
                  <span data-tip={isNewDraft || hasUnsavedWork || saving
                    ? (saving ? tt('Saving…', 'Salvando…') : tt('Save first', 'Salve primeiro'))
                    : undefined}>
                    <Button variant="secondary" size="sm" onClick={runNow} disabled={isNewDraft || hasUnsavedWork || saving}>
                      <Play size={12} /> {'Run now'}
                    </Button>
                  </span>
                  {confirmDelete ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-text-secondary">{'Delete?'}</span>
                      <span data-tip={saving ? tt('Saving…', 'Salvando…') : undefined}>
                        <Button variant="destructive" size="sm" onClick={handleRemove} disabled={saving}>{'Yes'}</Button>
                      </span>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>{'No'}</Button>
                    </div>
                  ) : (
                    // Confirm rather than fire-and-forget: this deletes a captured reference
                    // image, a hand-snapped ROI and a weekday mask with no undo. The action
                    // grid's Clear All already asks; a one-click destroy here was the outlier.
                    // Held for a save's flight, like Run now: see handleRemove.
                    <span data-tip={saving ? tt('Saving…', 'Salvando…') : undefined}>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)} disabled={saving}>
                        <Trash2 size={12} />
                      </Button>
                    </span>
                  )}
                </div>
              </div>

              {testFireResult && (
                <div className={`flex items-center gap-1.5 text-[11px] ${testFireResult.ok ? 'text-accent-light' : 'text-text-tertiary'}`}>
                  {testFireResult.ok ? <Check size={12} /> : <X size={12} />}
                  {testFireResult.text}
                </div>
              )}

              {/* Why a watcher that is ARMED is not watching. The daemon writes that reason
                  into lastResult and nowhere else, and the dot's tooltip points here — but the
                  editor rendered none of it, so the only place the text ever appeared was the
                  tail of a truncated 248 px meta line. The tray balloon that also carries it is
                  once per (profile, reason) and then gone.

                  Gated narrowly on purpose. "Paused" and "profile disabled" have their own
                  callouts below, and cannotFire already says the same thing when the TS mirror
                  caught it — repeating either would be noise. Purely informational results
                  ("outside active hours", "skipped — 12 min late") land in the neutral line
                  further down instead of being promoted to a warning. */}
              {automation.enabled && !selectedEntry?.isDisabled && selectedEntry?.trigger.armed
                && !selectedEntry.running && selectedEntry.lastResult && !cannotFire && (
                <div className="rounded border px-3 py-2 text-[11px] leading-relaxed"
                  style={{
                    color: 'var(--color-warning-ink)',
                    borderColor: 'color-mix(in srgb, var(--color-warning) 40%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--color-warning) 10%, transparent)',
                  }}>
                  {'Armed, but not watching. '}
                  {selectedEntry.lastResult}
                </div>
              )}

              {/* Stated where it is fixable, and BEFORE it can be saved. A watcher whose
                  required field is blank probes false forever: it arms, reports Running, and
                  never fires, with nothing on screen to say why. */}
              {cannotFire && (
                <div className="rounded border px-3 py-2 text-[11px] leading-relaxed"
                  style={{
                    color: 'var(--color-recording-fg)',
                    borderColor: 'color-mix(in srgb, var(--color-recording) 40%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--color-recording) 10%, transparent)',
                  }}>
                  {'Never fires as configured. '}
                  {cannotFire}
                </div>
              )}

              {selectedEntry?.isDisabled && (
                <div className="rounded border px-3 py-2 text-[11px] leading-relaxed"
                  style={{
                    color: 'var(--color-recording-fg)',
                    borderColor: 'color-mix(in srgb, var(--color-recording) 40%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--color-recording) 10%, transparent)',
                  }}>
                  {'Profile disabled — its automation can’t run or be armed until you enable it in the sidebar.'}
                </div>
              )}

              {noTarget && (
                <div className="rounded border px-3 py-2 text-[11px] leading-relaxed"
                  style={{
                    color: 'var(--color-recording-fg)',
                    borderColor: 'color-mix(in srgb, var(--color-recording) 40%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--color-recording) 10%, transparent)',
                  }}>
                  {'No target window — it acts on whichever window is focused when it fires.'}
                </div>
              )}

              <Field label="Trigger">
                <SegmentedControl
                  ariaLabel="Trigger kind"
                  grow
                  value={draft.kind}
                  onChange={(v) => {
                    const next = v as TriggerConfig['kind'];
                    // Entering Schedule drops an active-hours RANGE, because there TimeOfDay means
                    // the fire time and a range can never be one. Only on the way IN, and only for
                    // a range: clearing on the way OUT would throw away the window on an innocent
                    // round trip, and would also erase the bare "12:00" that two real profiles
                    // carry from an abandoned draft — which ParseActiveHours ignores on purpose.
                    patch(next === 'schedule' && rangeParts(draft.timeOfDay)
                      ? { kind: next, timeOfDay: null }
                      : { kind: next });
                  }}
                  options={[
                    { value: 'interval', label: 'Interval' },
                    { value: 'schedule', label: 'Schedule' },
                    { value: 'condition', label: 'Condition' },
                  ]}
                />
              </Field>

              {draft.kind === 'interval' && (
                <Field label="Every" hint={'Min 5 s. First fire comes one interval after arming.'}>
                  <NumberInput
                    value={draft.intervalSeconds}
                    onChange={(v) => patch({ intervalSeconds: Math.max(5, v ?? 5) })}
                    // Whole seconds: the backend reads an int, and a fraction used to be dropped there
                    // in favour of the 300 s default — the saved automation fired every five minutes.
                    integer
                    min={5}
                    max={86400}
                    suffix="s"
                    inputWidth="w-24"
                  />
                </Field>
              )}

              {/* Active hours — interval and condition only, because for a schedule TimeOfDay IS
                  the fire time. Two start-and-end inputs rather than one free-text box: they can
                  only ever produce the range form the backend accepts, which is what keeps a bare
                  "12:00" from ever being written here. (That value is not hypothetical — profiles
                  drafted as a schedule and switched to condition carry it, and the backend ignores
                  a bare time precisely so those keep firing.) */}
              {draft.kind !== 'schedule' && (() => {
                const parts = (draft.timeOfDay ?? '').split('-');
                const from = parts.length === 2 ? parts[0].trim() : '';
                const to = parts.length === 2 ? parts[1].trim() : '';
                // Clearing ONE input must not throw the other away. The old form dropped the
                // whole window the moment either half went blank, and the sibling then wrote a
                // silent 00:00 / 23:59 fallback on the next keystroke — so backspacing the start
                // and retyping it turned 09:00-18:00 into 10:00-23:59 without saying so. The
                // remembered half survives an empty box until the pair is whole again.
                const write = (f: string, t: string) => {
                  lastHoursRef.current = { from: f || lastHoursRef.current.from, to: t || lastHoursRef.current.to };
                  patch({ timeOfDay: f && t ? `${f}-${t}` : null });
                };
                return (
                  <Field
                    label="Active hours"
                    hint={'Empty = always. An end before the start crosses midnight.'}
                  >
                    <div className="flex items-center gap-2">
                      <input type="time" className={`${inputCls} w-28`} value={from}
                        onChange={(e) => write(e.target.value, to || lastHoursRef.current.to)} />
                      <span className="text-[12px] text-text-tertiary">{'to'}</span>
                      <input type="time" className={`${inputCls} w-28`} value={to}
                        onChange={(e) => write(from || lastHoursRef.current.from, e.target.value)} />
                      {(from || to) && (
                        <Button variant="ghost" size="sm" onClick={() => patch({ timeOfDay: null })}>
                          {'Clear'}
                        </Button>
                      )}
                    </div>
                    {/* Warning, not a Save block: whether it actually locks depends on the moment
                        the automation is armed, so refusing the pairing outright would reject
                        configurations that work. See phaseLockRisk. */}
                    <FieldError
                      show={phaseLockRisk(draft)}
                      tip={tt('This interval only ticks at a few times of day — all may fall outside the window', 'Este intervalo só bate em alguns horários — todos podem cair fora da janela')}
                    >
                      {'Interval longer than the active hours — it may never fire. Shorten it or widen the hours.'}
                    </FieldError>
                  </Field>
                );
              })()}

              {draft.kind === 'schedule' && (
                <>
                  <Field label="At">
                    <input
                      type="time"
                      className={`${inputCls} w-28`}
                      value={draft.timeOfDay ?? ''}
                      onChange={(e) => patch({ timeOfDay: e.target.value })}
                    />
                  </Field>
                  <Field label="Days" hint={'None = every day.'}>
                    <div className="flex gap-1">
                      {DAY_PILLS.map((d) => {
                        const on = (draft.daysOfWeek & d.bit) !== 0;
                        return (
                          <button
                            key={d.label}
                            type="button"
                            onClick={() => patch({ daysOfWeek: draft.daysOfWeek ^ d.bit })}
                            className={`h-7 px-2 rounded text-[11px] border transition-colors ${
                              on
                                ? 'bg-accent-solid border-accent-solid text-[color:var(--color-accent-ink)]'
                                : 'bg-bg-input border-border-subtle text-text-secondary hover:border-border-strong'
                            }`}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </Field>
                </>
              )}

              {draft.kind === 'condition' && (
                <>
                  <Field label="Condition">
                    <select
                      className={inputCls}
                      value={draft.conditionType ?? 'WindowOpen'}
                      onChange={(e) => {
                        const next = e.target.value;
                        // Leaving ImageFound has to drop the reference image with it. Four
                        // separate guards — the orphan sweep, the copy carry, the export
                        // collector, the rename move — all ask `conditionType === 'ImageFound'`
                        // before they protect a trigger's PNG, so a stale imagePath under another
                        // condition type is a file nothing defends: the next startup sweep deletes
                        // it. Switching back then left a config that passes validation (imagePath
                        // is truthy) pointing at a file that no longer exists, and Save and Arm
                        // both allowed it.
                        //
                        // Clearing here rather than loosening those guards on purpose: making the
                        // PNG survive every condition type would make it immortal, against the
                        // collection design documented at each of those four sites.
                        const leavingImage = draft.conditionType === 'ImageFound' && next !== 'ImageFound';
                        // Sair para um tipo SEM coordenada leva a âncora junto. Só PixelColorMatch
                        // e ImageFound têm ponto para ancorar, então o interruptor some da tela nos
                        // outros quatro — e a flag ficava ligada, invisível, sem controle nenhum
                        // para desligá-la. Duas consequências: o pin de compatibilidade passa a
                        // exigir 2.43.0 por uma propriedade que o motor prova ignorar, e voltar ao
                        // tipo de origem reacendia uma âncora que o usuário não sabia ter deixado
                        // ligada. Os CAMPOS de janela ficam (eles são do WindowOpen também); só o
                        // opt-in cai, que é o que a UI deixa de oferecer.
                        //
                        // A FLAG FICA. Dropar o opt-in ao sair do tipo era seguro enquanto a flag
                        // só somava (erradamente) uma origem na LEITURA; desde que a metade de
                        // ESCRITA existe, ela DECLARA o espaço de pixelX/pixelY — que já estão em
                        // coordenada de janela — e apagá-la re-significa esses números como tela
                        // sem converter nada. Ir para WindowOpen e voltar deixava o vigia
                        // amostrando (60,60) no canto do monitor, com o painel exibindo "X 60
                        // Y 60", auto-salvo pelo debounce, armado e verde, e nunca disparando.
                        //
                        // Os dois motivos originais para dropar caíram: o pin de compatibilidade
                        // agora gateia no KIND e no ConditionType, então uma flag residual não
                        // prende mais o perfil; e "reacender uma âncora esquecida" é o mesmo
                        // estado que estava lá antes da troca — preservar é o que não surpreende.
                        patch({
                          conditionType: next,
                          ...(leavingImage ? { imagePath: null, imageBase64: null, searchRegion: null } : {}),
                        });
                        // The anchor notice speaks about the coordinate fields of the type being left.
                        setAnchorSpaceNotice(null);
                      }}
                    >
                      {CONDITION_TYPES.map((c) => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </select>
                  </Field>

                  {draft.conditionType === 'WindowOpen' && (
                    <>
                      <WindowTargetFields
                        value={{
                          processName: draft.windowProcessName ?? '',
                          windowTitle: draft.windowTitle ?? '',
                          titleMatchMode: draft.windowTitleMatchMode === 'regex' ? 'regex' : 'contains',
                        }}
                        onChange={(p) =>
                          patch({
                            ...(p.processName !== undefined ? { windowProcessName: p.processName } : {}),
                            ...(p.windowTitle !== undefined ? { windowTitle: p.windowTitle } : {}),
                            ...(p.titleMatchMode !== undefined ? { windowTitleMatchMode: p.titleMatchMode } : {}),
                          })
                        }
                      />
                      <div className="flex items-center gap-2">
                        <Toggle size="sm" isOn={draft.windowMatchForegroundOnly}
                          onChange={(v) => patch({ windowMatchForegroundOnly: v })} />
                        <span className="text-[12px] text-text-secondary"
                          data-tip={tt('Must be in front, not just open', 'Precisa estar em primeiro plano, não só aberta')}>
                          Foreground only
                        </span>
                      </div>
                    </>
                  )}

                  {draft.conditionType === 'ProcessRunning' && (
                    <Field label="Process" hint={'With or without .exe.'}>
                      <input
                        className={inputCls}
                        value={draft.windowProcessName ?? ''}
                        onChange={(e) => patch({ windowProcessName: e.target.value })}
                        placeholder="app.exe"
                      />
                    </Field>
                  )}

                  {draft.conditionType === 'FileExists' && (
                    <Field label="Path" hint={'File or folder.'}>
                      <input
                        className={inputCls}
                        value={draft.filePath ?? ''}
                        onChange={(e) => patch({ filePath: e.target.value })}
                        placeholder="C:\\path\\to\\flag.txt"
                      />
                    </Field>
                  )}

                  {/* Ancora de janela — so para as duas condicoes que TEM coordenada. O opt-in e
                      o proprio interruptor: com ele desligado a coordenada segue absoluta, que e
                      o que toda automacao existente faz. Os campos de janela sao os MESMOS que o
                      WindowOpen usa; aqui eles respondem 'onde fica', nao 'esta aberta'. */}
                  {(draft.conditionType === 'PixelColorMatch' || draft.conditionType === 'ImageFound' || draft.conditionType === 'ScreenText') && (
                    <>
                      <div className="flex items-center gap-2">
                        <Toggle size="sm" isOn={draft.useRelativeCoordinates}
                          onChange={(v) => {
                            // This switch does not add a behaviour any more — it DECLARES which
                            // space the stored numbers are in, and nothing here can convert them:
                            // the origin belongs to a window that may not even be open. Flipping
                            // it used to reinterpret whatever was on disk in silence, so a ROI the
                            // user drew at (829,561) started being probed at (1829,761) with the
                            // caption below cheerfully asserting the new space over the old number.
                            //
                            // Clearing the coordinate is the honest move: it costs one re-pick and
                            // it cannot produce a watcher that is armed, green and permanently
                            // false. The window FIELDS stay — they are the part worth keeping.
                            const hadPoint = (draft.pixelX ?? 0) !== 0 || (draft.pixelY ?? 0) !== 0;
                            const hadRegion = !!draft.searchRegion;
                            // Both are cleared — a residual point from a Pixel-color past is in the
                            // wrong space too — but the notice only speaks for the field ON SCREEN:
                            // X/Y belong to Pixel color, the search region to Image on screen. It
                            // used to announce "Coordinates cleared" on an Image watcher over a
                            // point it never shows, with no visible field having changed.
                            const visibleCleared = draft.conditionType === 'PixelColorMatch' ? hadPoint : hadRegion;
                            patch({
                              useRelativeCoordinates: v,
                              ...(hadPoint ? { pixelX: 0, pixelY: 0 } : {}),
                              ...(hadRegion ? { searchRegion: null } : {}),
                            });
                            setAnchorSpaceNotice(!visibleCleared ? null : v
                              ? tt('Coordinates cleared — they were screen coordinates. Pick again to store them relative to the window.',
                                   'Coordenadas limpas — elas eram de tela. Pegue de novo para gravá-las relativas à janela.')
                              : tt('Coordinates cleared — they were relative to the window. Pick again to store them as screen coordinates.',
                                   'Coordenadas limpas — elas eram relativas à janela. Pegue de novo para gravá-las como coordenadas de tela.'));
                          }} />
                        <span className="text-[12px] text-text-secondary"
                          data-tip={tt('Coordinates follow the window instead of the screen',
                                       'As coordenadas seguem a janela em vez da tela')}>
                          Relative to a window
                        </span>
                      </div>
                      {draft.useRelativeCoordinates && (
                        <WindowTargetFields
                          value={{
                            processName: draft.windowProcessName ?? '',
                            windowTitle: draft.windowTitle ?? '',
                            titleMatchMode: draft.windowTitleMatchMode === 'regex' ? 'regex' : 'contains',
                          }}
                          onChange={(p) =>
                            patch({
                              ...(p.processName !== undefined ? { windowProcessName: p.processName } : {}),
                              ...(p.windowTitle !== undefined ? { windowTitle: p.windowTitle } : {}),
                              ...(p.titleMatchMode !== undefined ? { windowTitleMatchMode: p.titleMatchMode } : {}),
                            })
                          }
                        />
                      )}
                    </>
                  )}

                  {/* Em que ESPAÇO os números abaixo estão. Só aparece quando não é o óbvio: uma
                      coordenada de tela não precisa de legenda, uma ancorada precisa muito, porque
                      40,60 é idêntico nos dois casos. Mesma regra e quase a mesma frase da Sheet. */}
                  {draft.useRelativeCoordinates
                    && (draft.conditionType === 'PixelColorMatch' || draft.conditionType === 'ImageFound' || draft.conditionType === 'ScreenText')
                    && (
                      <div className="text-[11px] text-text-tertiary flex items-center gap-1.5 flex-wrap">
                        <Crosshair size={11} className="shrink-0 opacity-70" />
                        <span>
                          {(draft.windowProcessName ?? '').trim() || (draft.windowTitle ?? '').trim()
                            ? `Relative to ${((draft.windowProcessName ?? '').trim() || (draft.windowTitle ?? '').trim())}'s top-left corner`
                            : 'Relative to the anchored window’s top-left corner'}
                        </span>
                      </div>
                    )}

                  {/* Por que a coordenada sumiu. Mora aqui e não num toast porque é uma afirmação
                      sobre o CAMPO logo abaixo, e some sozinha na próxima captura. */}
                  <FieldError show={!!anchorSpaceNotice} tip={anchorSpaceNotice ?? undefined}>
                    {anchorSpaceNotice}
                  </FieldError>

                  {draft.conditionType === 'PixelColorMatch' && (
                    <>
                      <div className="flex items-end gap-2">
                        <Field label="X">
                          <NumberInput value={draft.pixelX} onChange={(v) => patch({ pixelX: v ?? 0 })}
                            integer min={-20000} max={20000} inputWidth="w-20" />
                        </Field>
                        <Field label="Y">
                          <NumberInput value={draft.pixelY} onChange={(v) => patch({ pixelY: v ?? 0 })}
                            integer min={-20000} max={20000} inputWidth="w-20" />
                        </Field>
                        {/* Swatch + hex, same pairing as Wait Pixel Color / If Pixel in the Sheet:
                            a hex code alone is unreadable, and this is the field a user checks to
                            confirm the eyedropper grabbed what they meant. Dashed border = the
                            text isn't a valid colour yet, so there is nothing to show. */}
                        <Field label="Color">
                          <div className="flex items-center gap-2">
                            {(() => {
                              const raw = (draft.pixelColor ?? '').trim();
                              // Six digits only, matching PixelColorService.ParseHex. Accepting
                              // three made the swatch render #F00 as solid red — actively telling
                              // the user the value was good — while the backend read it as "no
                              // colour set" and the watcher polled false forever.
                              const validHex = /^#?[0-9A-Fa-f]{6}$/.test(raw);
                              return (
                                <span
                                  className={`w-8 h-8 rounded border shrink-0 ${validHex ? 'border-border-default' : 'border-dashed border-border-default'}`}
                                  style={{ background: validHex ? (raw.startsWith('#') ? raw : '#' + raw) : 'transparent' }}
                                />
                              );
                            })()}
                            <input
                              className={`${inputCls} w-24 font-mono`}
                              value={draft.pixelColor ?? ''}
                              onChange={(e) => patch({ pixelColor: e.target.value })}
                              placeholder="#RRGGBB"
                            />
                          </div>
                        </Field>
                        <Button variant="secondary" size="sm" onClick={pickPixel}
>
                          <Pipette size={12} /> Pick
                        </Button>
                      </div>
                      <Field label="Tolerance" hint={'Per channel. 0 = exact.'}>
                        <NumberInput value={draft.pixelTolerance} onChange={(v) => patch({ pixelTolerance: v ?? 10 })}
                          integer min={0} max={255} inputWidth="w-20" />
                      </Field>
                    </>
                  )}

                  {draft.conditionType === 'ScreenText' && (() => {
                    const number = draft.ocrReadAs === 'number';
                    const op = effectiveOperator(draft.conditionOperator, number);
                    return (
                    <>
                      <Field label="Search region" hint={draft.searchRegion ? undefined : 'Required — reading the whole screen every check is too slow.'}>
                        <div className="flex items-center gap-2">
                          <div className={`${inputCls} flex-1 flex items-center ${draft.searchRegion ? 'font-mono text-[11px]' : 'text-text-disabled italic'}`}>
                            {draft.searchRegion
                              ? `${draft.searchRegion.x}, ${draft.searchRegion.y}  ·  ${draft.searchRegion.w} × ${draft.searchRegion.h}`
                              : 'Not set'}
                          </div>
                          <Button variant="secondary" size="sm" onClick={configureRegion}>
                            <Frame size={12} /> {'Configure'}
                          </Button>
                          {draft.searchRegion && (
                            <button type="button" onClick={() => patch({ searchRegion: null })}
                              className="h-7 w-7 shrink-0 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors">
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </Field>
                      <Field label="Read as">
                        <SegmentedControl<'text' | 'number'>
                          ariaLabel="Read as"
                          value={number ? 'number' : 'text'}
                          onChange={(v) => patch({ ocrReadAs: v === 'number' ? 'number' : null, conditionOperator: v === 'number' ? 'eq' : 'contains' })}
                          options={[
                            { value: 'text', label: 'Text' },
                            { value: 'number', label: 'Number', tip: tt('The first number in the region', 'O primeiro número da região') },
                          ]}
                        />
                      </Field>
                      {number ? (
                        <Field label="Compare">
                          <div className="flex items-center gap-2">
                            <SegmentedControl<'eq' | 'neq' | 'gt' | 'lt'>
                              ariaLabel="Compare"
                              value={op as 'eq' | 'neq' | 'gt' | 'lt'}
                              onChange={(v) => patch({ conditionOperator: v })}
                              options={[
                                { value: 'eq', label: '=' },
                                { value: 'neq', label: '≠' },
                                { value: 'gt', label: '>' },
                                { value: 'lt', label: '<' },
                              ]}
                            />
                            <input className={`${inputCls} font-mono`} value={draft.conditionOperand ?? ''} placeholder="30"
                              onChange={(e) => patch({ conditionOperand: e.target.value })} />
                          </div>
                        </Field>
                      ) : (
                        <>
                          <Field label="Match">
                            <SegmentedControl<'contains' | 'eq' | 'regex'>
                              ariaLabel="Match"
                              value={op as 'contains' | 'eq' | 'regex'}
                              onChange={(v) => patch({ conditionOperator: v })}
                              options={[
                                { value: 'contains', label: 'Contains' },
                                { value: 'eq', label: 'Equals' },
                                { value: 'regex', label: 'Regex' },
                              ]}
                            />
                          </Field>
                          <Field label="Text" hint="Ignores case, spaces and accents.">
                            <input className={`${inputCls} font-mono`} value={draft.conditionOperand ?? ''} placeholder="Victory"
                              onChange={(e) => patch({ conditionOperand: e.target.value })} />
                          </Field>
                        </>
                      )}
                      <Field label="Text color" hint={draft.ocrTextColor ? undefined : 'Any. Pick the text color to read game HUDs.'}>
                        <div className="flex items-center gap-2">
                          <input className={`${inputCls} font-mono`} value={draft.ocrTextColor ?? ''} placeholder="Any"
                            onChange={(e) => patch({ ocrTextColor: e.target.value || null })} />
                          <Button variant="secondary" size="sm" onClick={pickTextColor}>
                            <Pipette size={12} /> Pick
                          </Button>
                          {draft.ocrTextColor && (
                            <button type="button" onClick={() => patch({ ocrTextColor: null })}
                              className="h-7 w-7 shrink-0 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors">
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </Field>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={testRead}>
                          <ScanText size={12} /> Test read
                        </Button>
                      </div>
                      {testReadResult && (
                        <div className={`flex items-start gap-1.5 text-[11px] ${testReadResult.ok ? 'text-accent-light' : 'text-text-tertiary'}`}>
                          {testReadResult.ok ? <Check size={12} className="shrink-0 mt-px" /> : <X size={12} className="shrink-0 mt-px" />}
                          <span className="break-words">
                            {testReadResult.error
                              ? testReadResult.error
                              : `${testReadResult.ok ? 'Match' : 'No match'} — read: "${testReadResult.text || 'nothing'}"`}
                          </span>
                        </div>
                      )}
                    </>
                    );
                  })()}
                  {draft.conditionType === 'ImageFound' && (
                    <>
                      <Field label="Reference image">
                        <div
                          onClick={() => draft.imageBase64 && setCropperOpen(true)}
                          className={draft.imageBase64
                            ? 'w-full rounded border border-border-subtle bg-bg-input p-1 cursor-pointer hover:border-accent-solid transition-colors'
                            : `${inputCls} flex items-center text-text-tertiary truncate`}>
                          {draft.imageBase64
                            ? <img src={`data:image/png;base64,${draft.imageBase64}`} alt="" className="max-h-[120px] w-full object-contain" />
                            : (draft.imagePath ?? 'none captured')}
                        </div>
                      </Field>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={captureImage}
>
                          <Camera size={12} /> Capture
                        </Button>
                        <Button variant="secondary" size="sm" onClick={testMatch} disabled={!draft.imagePath}
>
                          <ScanSearch size={12} /> Test match
                        </Button>
                      </div>
                      {testMatchResult && (
                        <div className={`flex items-center gap-1.5 text-[11px] ${testMatchResult.found ? 'text-accent-light' : 'text-text-tertiary'}`}>
                          {testMatchResult.found ? <Check size={12} /> : <X size={12} />}
                          {testMatchResult.error
                            ? testMatchResult.error
                            : testMatchResult.found
                              ? `${'Found'} (${Math.round(testMatchResult.score * 100)}%) — ${'region snapped to it'}`
                              : `${'Not found on screen'} (${Math.round(testMatchResult.score * 100)}%)`}
                        </div>
                      )}
                      <Field label="Search region" hint={'Empty = full screen (slower, more false matches).'}>
                        <div className="flex items-center gap-2">
                          <div className={`${inputCls} flex-1 flex items-center ${draft.searchRegion ? 'font-mono text-[11px]' : 'text-text-disabled italic'}`}>
                            {draft.searchRegion
                              ? `${draft.searchRegion.x}, ${draft.searchRegion.y}  ·  ${draft.searchRegion.w} × ${draft.searchRegion.h}`
                              : 'Full screen (default)'}
                          </div>
                          <Button variant="secondary" size="sm" onClick={configureRegion}>
                            <Frame size={12} /> {'Configure'}
                          </Button>
                          {draft.searchRegion && (
                            <button type="button" onClick={() => patch({ searchRegion: null })}
                              className="h-7 w-7 shrink-0 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors">
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </Field>
                      <Field label="Confidence" hint={'Start at 80%. 100% never matches a live screen.'}>
                        <NumberInput
                          value={Math.round((draft.imageConfidence || 0.8) * 100)}
                          onChange={(v) => patch({ imageConfidence: Math.min(99, Math.max(10, v ?? 80)) / 100 })}
                          min={10} max={99} suffix="%" inputWidth="w-20"
                        />
                      </Field>
                    </>
                  )}

                  {draft.conditionType === 'ClipboardChanged' && (
                    <Field label="Contains" hint={'Empty = any change. The app’s own clipboard writes never count.'}>
                      <input
                        className={inputCls}
                        value={draft.clipboardPattern ?? ''}
                        onChange={(e) => patch({ clipboardPattern: e.target.value })}
                        placeholder={'text the clipboard must contain'}
                      />
                    </Field>
                  )}

                  {draft.conditionType !== 'ClipboardChanged' && (
                    <Field label="Re-trigger">
                      <SegmentedControl
                        ariaLabel="Retrigger mode"
                        grow
                        value={draft.retrigger === 'level' ? 'level' : 'edge'}
                        onChange={(v) => patch({ retrigger: v })}
                        options={[
                          { value: 'edge', label: 'Once per appearance', tip: tt('Fires when it turns true; re-arms when it turns false', 'Dispara ao ficar verdadeira; rearma ao ficar falsa') },
                          { value: 'level', label: 'Continuous', tip: tt('Fires every cooldown while true', 'Dispara a cada cooldown enquanto verdadeira') },
                        ]}
                      />
                    </Field>
                  )}

                  {(() => {
                    const cd = defaultCooldownSec(draft.conditionType);
                    return (
                      <Field label="Cooldown" hint={`0 = default (${cd} s).`}>
                        <NumberInput value={draft.cooldownSeconds} onChange={(v) => patch({ cooldownSeconds: v ?? 0 })}
                          integer min={0} max={86400} suffix="s" inputWidth="w-24" />
                      </Field>
                    );
                  })()}

                  {/* The one knob that trades reaction time for CPU. Worth surfacing because the
                      cost is wildly uneven per family: an image watcher captures the entire
                      virtual screen and template-matches it on EVERY tick, so a slow thing to
                      wait for (an app launching, a download landing) is far cheaper watched at
                      5 s than at the 1 s default, and gives up nothing. */}
                  {(() => {
                    const def = defaultPollMs(draft.conditionType);
                    const heavy = draft.conditionType === 'ImageFound';
                    return (
                      <Field
                        label="Check every"
                        hint={`0 = default (${def} ms).` +
                            (heavy ? ' Image checks scan the whole screen — raise this if you can wait a few seconds.' : '')}>
                        <NumberInput value={draft.pollIntervalMs} onChange={(v) => patch({ pollIntervalMs: v ?? 0 })}
                          min={0} max={600000} step={250} thousands suffix="ms" inputWidth="w-28" />
                      </Field>
                    );
                  })()}
                </>
              )}

              <div className="pt-2 border-t border-border-subtle text-[11px] text-text-tertiary leading-relaxed"
>
                {'The list toggle arms or disarms at once, independent of Save.'}
              </div>

              {selectedEntry && (selectedEntry.skippedBusy > 0 || selectedEntry.skippedDirty > 0 || selectedEntry.skippedModal > 0) && (
                <div className="text-[11px] text-text-tertiary leading-relaxed">
                  {'Skipped fires'}: {selectedEntry.skippedBusy} {'busy'} ·{' '}
                  {selectedEntry.skippedDirty} {'unsaved changes'} ·{' '}
                  {selectedEntry.skippedModal} {'dialog open'}
                </div>
              )}

              {/* Kept apart from the skip counters above: these were never fire attempts. A
                  clipboard watcher is deaf for a moment after each replay so the app's own paste
                  and restore traffic doesn't trigger it — a copy the user made in that window is
                  swallowed with it, and used to be invisible. */}
              {selectedEntry && selectedEntry.skippedSuppressed > 0 && (
                <div className="text-[11px] text-text-tertiary leading-relaxed">
                  {'Clipboard changes ignored just after a replay'}: {selectedEntry.skippedSuppressed}
                </div>
              )}

              {/* The tallies are LIFETIME totals, so an afternoon of test-firing leaves a skip
                  count stuck to an automation that has run cleanly ever since — and those numbers
                  only mean anything as "how is this doing now". Offered only once there is
                  something to clear. The next fire time is untouched: it is the interval's anchor,
                  not a statistic. */}
              {selectedEntry && (selectedEntry.fireCount > 0 || selectedEntry.skippedBusy > 0
                || selectedEntry.skippedDirty > 0 || selectedEntry.skippedModal > 0
                || selectedEntry.skippedSuppressed > 0) && (
                <div className="pt-1">
                  <Button variant="ghost" size="sm"
                    onClick={() => send({ type: 'automation:resetCounters', payload: { profile: selectedEntry.profile } })}>
                    {'Reset counters'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </DialogShell>
    {cropperOpen && draft?.imageBase64 && (
      <ImageCropper
        imageBase64={draft.imageBase64}
        onSave={cropReference}
        onCancel={() => setCropperOpen(false)}
      />
    )}
    {/* Unsaved-draft gate. Rendered OUTSIDE the DialogShell (sibling, like the cropper) so its
        own Escape handling can't be swallowed by the panel's. "Save and continue" is offered
        only when the draft is actually saveable — otherwise the sole options are to go back
        and fix it or to throw it away, which is the honest set. */}
    {pendingNav && (
      <DialogShell
        icon={<TriangleAlert size={14} style={{ color: 'var(--color-warning-ink)' }} />}
        title="Unsaved automation"
        size="sm"
        zClass="z-[90]"
        onClose={() => setPendingNav(null)}
        footer={
          <DialogFooter
            secondary={{ label: 'Keep editing', onClick: () => setPendingNav(null), autoFocus: true }}
            extra={<Button variant="destructiveText" size="md" onClick={() => discardAndGo(pendingNav)}>Discard</Button>}
            /* "Save", not "Save and continue": at 360 px the three buttons wanted 341 px of a
               326 px track and the primary hung 7 px outside the card. The twin prompt (Send
               Text's "Unsaved text") already says plain Save for the same three-way choice, and
               "it also continues" is what the prompt is about — the tip says it outright. */
            primary={canSave ? {
              label: 'Save',
              tip: tt('Save and go to where you clicked', 'Salvar e ir para onde você clicou'),
              onClick: () => { const dest = pendingNav; handleSave(); go(dest); },
            } : undefined}
          />
        }
      >
        <p className="px-4 py-4 text-xs text-text-secondary leading-relaxed">
          Unsaved changes will be lost — including the captured image and search region.
        </p>
      </DialogShell>
    )}
    </>
  );
}
