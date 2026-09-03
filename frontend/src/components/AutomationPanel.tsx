import { useEffect, useMemo, useRef, useState } from 'react';
import { Zap, Plus, Trash2, Pipette, Camera, CircleDot, Frame, X, ScanSearch, Check, Play, Power } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { useAppState } from '../state/AppStateContext';
import { useTt } from '../state/LanguageContext';
import { DialogShell, PANEL_SIZE, PANEL_MAX_WIDTH } from './common/DialogShell';
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
import type { AutomationEntry, TriggerConfig } from '../bridge/messageTypes';

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
function whyCannotFire(t: TriggerConfig, tt: (en: string, pt: string) => string): string | null {
  if (t.kind === 'schedule') {
    if (!t.timeOfDay) return tt('Pick a time of day.', 'Escolha um horário.');
    // Schedule and the active-hours window share TimeOfDay, and switching kind does not clear the
    // other one's value — so a range configured as active hours arrives here looking truthy while
    // the "At" field shows blank. The daemon then stops the watcher on its first line. Detected by
    // SHAPE, using the same helper the summary uses, rather than by a stricter HH:mm regex:
    // TimeSpan.TryParse accepts forms like "1.09:00" from an imported profile, and rejecting those
    // would be over-matching — the regression in the opposite direction.
    if (rangeParts(t.timeOfDay)) {
      return tt('That is an active-hours range, not a time of day — pick a single time.',
                'Isso é uma faixa de horário ativo, não um horário — escolha um horário único.');
    }
  }
  if (t.kind !== 'condition') return null;
  switch (t.conditionType) {
    case 'WindowOpen':
      return (t.windowProcessName ?? '').trim() || (t.windowTitle ?? '').trim()
        ? null
        : tt('Fill in a process name or a window title — with both blank this can never match.',
             'Preencha um nome de processo ou um título de janela — com os dois vazios isto nunca casa.');
    case 'ProcessRunning':
      return (t.windowProcessName ?? '').trim()
        ? null
        : tt('Fill in a process name.', 'Preencha um nome de processo.');
    case 'FileExists':
      return (t.filePath ?? '').trim()
        ? null
        : tt('Fill in a file or folder path.', 'Preencha um caminho de arquivo ou pasta.');
    case 'ImageFound':
      return t.imagePath
        ? null
        : tt('Capture a reference image.', 'Capture uma imagem de referência.');
    case 'PixelColorMatch':
      // Mirrors PixelColorService.ParseHex: six hex digits, optional leading #. The default
      // (#FFFFFF) and the eyedropper both produce that, so this only catches a hand-typed value —
      // which is exactly the case that used to arm and never fire.
      return /^#?[0-9A-Fa-f]{6}$/.test((t.pixelColor ?? '').trim())
        ? null
        : tt('Enter a 6-digit hex colour, like #FF0000 — shorthand such as #F00 is not accepted.',
             'Informe uma cor hex de 6 dígitos, como #FF0000 — a forma curta #F00 não é aceita.');
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

/** The range form "HH:mm-HH:mm", or null. One helper because three places now ask the same
 *  question — the summary, the schedule guard and the phase-lock warning — and they must agree
 *  with TriggerService.ParseActiveHours, which is the only opinion that decides behaviour. */
function rangeParts(timeOfDay: string | null | undefined): { from: string; to: string } | null {
  const s = (timeOfDay ?? '').trim();
  const dash = s.indexOf('-');
  if (dash <= 0 || dash === s.length - 1) return null;
  const from = s.slice(0, dash).trim();
  const to = s.slice(dash + 1).trim();
  return from && to && from !== to ? { from, to } : null;
}

/** Seconds since midnight, or null when the half is not HH:mm. */
function clockSeconds(hhmm: string): number | null {
  const m = /^(d{1,2}):(d{2})$/.exec(hhmm);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 3600 + min * 60 : null;
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** The active-hours window, ONLY when it is a range — mirrors TriggerService.ParseActiveHours, whose
 *  remarks explain why a bare time must not count. */
function activeHours(t: TriggerConfig): string | null {
  if (t.kind === 'schedule') return null;          // there, timeOfDay is the fire time
  const r = rangeParts(t.timeOfDay);
  return r ? `${r.from}–${r.to}` : null;
}

/**
 * True when NO tick of this interval can ever land inside the window, for some starting phase.
 *
 * The ticks of a period P visit the clock at multiples of gcd(P, 24h): a 24 h interval hits one
 * instant a day, a 12 h interval two. If that spacing is WIDER than the window, a phase exists
 * where every tick misses — and the loop preserves phase when it skips, so the automation stays
 * armed, keeps reporting a next-due time, and never runs. Below the spacing, the pigeonhole
 * guarantees a hit and the pairing is always safe.
 *
 * A warning rather than a Save block: whether it actually locks depends on the arming moment, so
 * refusing the configuration outright would reject pairings that work.
 */
function phaseLockRisk(t: TriggerConfig): boolean {
  if (t.kind !== 'interval') return false;
  const r = rangeParts(t.timeOfDay);
  if (!r) return false;
  const start = clockSeconds(r.from);
  const end = clockSeconds(r.to);
  if (start == null || end == null) return false;
  const width = end > start ? end - start : 86400 - start + end;   // wraps midnight
  return gcd(Math.max(5, t.intervalSeconds), 86400) > width;
}

function kindSummary(t: TriggerConfig, tt: (en: string, pt: string) => string): string {
  const hours = activeHours(t);
  const within = hours ? tt(`, ${hours}`, `, ${hours}`) : '';
  if (t.kind === 'interval') {
    const s = Math.max(5, t.intervalSeconds);
    const every = s % 60 === 0 ? tt(`every ${s / 60} min`, `a cada ${s / 60} min`) : tt(`every ${s}s`, `a cada ${s}s`);
    return every + within;
  }
  if (t.kind === 'schedule') return tt(`at ${t.timeOfDay ?? '--:--'}`, `às ${t.timeOfDay ?? '--:--'}`);
  const c = CONDITION_TYPES.find((x) => x.value === t.conditionType);
  return tt(`when ${c?.label ?? t.conditionType ?? '?'}`, `quando ${c?.label ?? t.conditionType ?? '?'}`) + within;
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
  // A not-yet-saved automation for a profile that has none. Only one at a time.
  const [newDraftProfile, setNewDraftProfile] = useState<string | null>(null);
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
  // Set by handleSave, cleared when the state echo carries the entry (or on selection change).
  const [savedPendingEcho, setSavedPendingEcho] = useState(false);
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

  // Seed the editor draft ONCE per selection — later automation:state pushes carry
  // runtime status and must never stomp in-progress config edits.
  useEffect(() => {
    if (selected == null) { setDraft(null); seededForRef.current = null; return; }
    if (seededForRef.current === selected) return;
    seededForRef.current = selected;
    const entry = entryByProfile.get(selected);
    setDraft(entry ? { ...entry.trigger } : defaultTrigger());
    setDirty(false);
  }, [selected, entryByProfile]);

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
  };

  // An automation that has never been saved has unsaved work by definition — the seeded
  // default IS a complete, valid "every 5 minutes" config. Gating Save on `dirty` alone left
  // the button inert on the single most obvious thing to create, with no tooltip and no hint,
  // and the only escape was to discover you must nudge a field first. `dirty` keeps meaning
  // "the user edited something"; the Save gate is what widens.
  const isNewDraft = selected != null && !entryByProfile.has(selected);
  const cannotFire = draft ? whyCannotFire(draft, tt) : null;
  // savedPendingEcho closes a gap the new-draft rule opens: handleSave clears `dirty`, but the
  // row only stops being a "new draft" when the backend echo lands, so for those few frames the
  // panel would still call the work unsaved — offering to save an already-saved automation and
  // popping the discard prompt on the very next click.
  const hasUnsavedWork = (dirty || (isNewDraft && !savedPendingEcho)) && draft != null;
  const canSave = hasUnsavedWork && !cannotFire;

  // Every exit from a dirty editor routes through here. Without it, Close, Escape (DialogShell
  // turns a bare Esc into onClose) and a click on another row all discarded the draft in
  // silence — including a just-captured reference image, whose PNG is already on disk and
  // becomes an orphan, and a search region the user snapped by hand.
  // Commit a navigation, no questions asked. seededForRef is cleared so the seed effect re-runs
  // even when the destination equals the current selection (React bails out of a same-value
  // setState, which would otherwise leave the "discarded" draft on screen).
  const go = (dest: NavDest) => {
    setPendingNav(null);
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
    setSavedPendingEcho(true);
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
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'pixel:colorPicked' && msg.payload.requestId === pickReqRef.current) {
        pickReqRef.current = null;
        if (!msg.payload.cancelled && msg.payload.hex) {
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
      if (msg.type === 'automation:testFireResult' && msg.payload.requestId === testFireReqRef.current) {
        testFireReqRef.current = null;
        setTestFireResult({ ok: msg.payload.fired, text: msg.payload.detail });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribe]);

  // Drop stale badges when switching automations.
  useEffect(() => {
    setTestMatchResult(null);
    setTestFireResult(null);
    setConfirmDelete(false);
    setSavedPendingEcho(false);
    // Drop the in-flight correlation ids too, not just the rendered badges. The subscribe
    // handlers match on requestId alone, so a reply that lands after the user has moved on
    // would attach an authoritative-sounding result ("Fired — the profile is running now") to
    // whichever automation is now on screen.
    testFireReqRef.current = null;
    testMatchReqRef.current = null;
    pickReqRef.current = null;
    regionReqRef.current = null;
    captureReqRef.current = null;
  }, [selected]);

  // The echo landed (or the entry existed all along) — the save is no longer in flight.
  useEffect(() => {
    if (savedPendingEcho && selected && entryByProfile.has(selected)) setSavedPendingEcho(false);
  }, [savedPendingEcho, selected, entryByProfile]);

  const pickPixel = () => {
    const id = `autopix-${Date.now()}`;
    pickReqRef.current = id;
    // absolute: watcher coords are virtual-screen — the profile-relative translation
    // the If/WaitPixel editors want would store coords the daemon samples wrongly.
    send({ type: 'pixel:pickColor', payload: { requestId: id, absolute: true } });
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
    send({ type: 'waitimage:configureSearchRegion', payload: { requestId: id, absolute: true, ...(r ? { x: r.x, y: r.y, w: r.w, h: r.h } : {}) } });
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
    send({ type: 'image:testMatch', payload: { requestId: id, absolute: true, profile: selected, imagePath: draft.imagePath, confidence: draft.imageConfidence || 0.8, ...(r ? { searchRegion: r } : {}) } });
  };

  const selectedEntry = selected ? entryByProfile.get(selected) : undefined;
  const selectedProfile = selected ? profiles.find((p) => p.name === selected) : undefined;
  const noTarget = selectedProfile ? !selectedProfile.hasEffectiveTarget : false;

  return (
    <>
    <DialogShell
      icon={<Zap size={14} className="text-accent-light" />}
      title="Automation"
      widthClass={PANEL_SIZE}
      maxWidthClass={PANEL_MAX_WIDTH}
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
          <Button variant="secondary" onClick={() => navigateTo({ kind: 'close' })}>Close</Button>
          {/* The tooltip explains a blocked Save (cannotFire); when there's simply nothing
              unsaved, the button just sits disabled with no tooltip. */}
          <span data-tip={hasUnsavedWork ? cannotFire ?? undefined : undefined}>
            <Button variant="primary" onClick={handleSave} disabled={!canSave}>Save</Button>
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
                    {tt('Pick a profile', 'Escolha um profile')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAddOpen(false)}
                    aria-label={tt('Cancel', 'Cancelar')}
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
                  ariaLabel={tt('Profiles without an automation', 'Profiles sem automação')}
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
                {tt('No automations yet. Add one to fire a profile on a timer, a clock schedule, or a watched condition — no hotkey press needed.',
                  'Nenhuma automação ainda. Adicione uma para disparar um profile por timer, horário ou condição vigiada — sem apertar hotkey.')}
              </div>
            )}
            {listProfiles.map((name) => {
              const entry = entryByProfile.get(name);
              const trig = name === newDraftProfile && !entry ? null : entry?.trigger;
              const isSel = selected === name;
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
                          ? tt('Profile is disabled — enable it in the sidebar before arming.', 'Profile desativado — reative na barra lateral antes de armar.')
                          : undefined}>
                        <Toggle size="sm" isOn={entry.trigger.armed} disabled={entry.isDisabled}
                          onChange={(v) => send({ type: 'automation:setArmed', payload: { profile: name, armed: v } })} />
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-tertiary uppercase">{tt('new', 'novo')}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-0.5 text-[11px] text-text-tertiary">
                    {entry?.running && (
                      <CircleDot size={10}
                        className={entry.conditionTrue ? 'text-[var(--color-replay-fg)]' : 'text-accent-light'}
                        data-tip={entry.conditionTrue
                          ? tt('Watching — the condition is TRUE right now', 'Vigiando — a condição está VERDADEIRA agora')
                          : tt('Watching — the condition is false right now', 'Vigiando — a condição está falsa agora')} />
                    )}
                    <span className="truncate">
                      {trig ? kindSummary(trig, tt) : tt('not saved yet', 'ainda não salvo')}
                      {entry && entry.fireCount > 0 && ` · ${entry.fireCount}× · ${fmtWhen(entry.lastFiredAt)}`}
                      {entry?.trigger.armed && entry.running && entry.nextDueAt && ` · ${tt('next', 'próx.')} ${fmtWhen(entry.nextDueAt)}`}
                    </span>
                  </div>
                  {/* Armed but NOT running is the state that reads as healthy and isn't: the toggle
                      is on, so the row looks live, while no watcher exists. It happens for three
                      ordinary reasons — the master switch is off, the profile is disabled, or the
                      loop stopped itself (missing reference image, unfillable condition). Name it,
                      instead of conveying it by the absence of a small unlabelled dot. */}
                  {entry?.trigger.armed && !entry.running && (
                    <div className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--color-recording-fg)' }}>
                      {!automation.enabled
                        ? tt('armed, but all automations are paused', 'armada, mas todas as automações estão pausadas')
                        : entry.isDisabled
                          ? tt('armed, but the profile is disabled', 'armada, mas o profile está desativado')
                          : tt('armed, but not watching — see the reason below', 'armada, mas não está vigiando — veja o motivo abaixo')}
                    </div>
                  )}
                  {entry?.lastResult && entry.lastResult !== 'fired' && (
                    <div className="text-[10px] text-text-tertiary mt-0.5 truncate">{entry.lastResult}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Right: editor ── */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4">
          {!selected || !draft ? (
            <div className="h-full flex items-center justify-center text-[12px] text-text-tertiary">
              {tt('Select an automation on the left, or add one.', 'Selecione uma automação à esquerda, ou adicione uma.')}
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
                  <span data-tip={isNewDraft || hasUnsavedWork
                    ? tt('Save first — Run now fires the SAVED automation.', 'Salve primeiro — o Run now dispara a automação SALVA.')
                    : undefined}>
                    <Button variant="secondary" size="sm" onClick={runNow} disabled={isNewDraft || hasUnsavedWork}>
                      <Play size={12} /> {tt('Run now', 'Rodar agora')}
                    </Button>
                  </span>
                  {confirmDelete ? (
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-text-secondary">{tt('Delete?', 'Excluir?')}</span>
                      <Button variant="destructive" size="sm" onClick={handleRemove}>{tt('Yes', 'Sim')}</Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>{tt('No', 'Não')}</Button>
                    </div>
                  ) : (
                    // Confirm rather than fire-and-forget: this deletes a captured reference
                    // image, a hand-snapped ROI and a weekday mask with no undo. The action
                    // grid's Clear All already asks; a one-click destroy here was the outlier.
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}
>
                      <Trash2 size={12} />
                    </Button>
                  )}
                </div>
              </div>

              {testFireResult && (
                <div className={`flex items-center gap-1.5 text-[11px] ${testFireResult.ok ? 'text-accent-light' : 'text-text-tertiary'}`}>
                  {testFireResult.ok ? <Check size={12} /> : <X size={12} />}
                  {testFireResult.text}
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
                  {tt('This automation can never fire as configured. ', 'Esta automação nunca vai disparar como está. ')}
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
                  {tt('This profile is DISABLED — its automation never runs (and cannot be armed) until you enable the profile in the sidebar.',
                    'Este profile está DESATIVADO — a automação dele nunca roda (nem pode ser armada) até você reativá-lo na barra lateral.')}
                </div>
              )}

              {noTarget && (
                <div className="rounded border px-3 py-2 text-[11px] leading-relaxed"
                  style={{
                    color: 'var(--color-recording-fg)',
                    borderColor: 'color-mix(in srgb, var(--color-recording) 40%, transparent)',
                    backgroundColor: 'color-mix(in srgb, var(--color-recording) 10%, transparent)',
                  }}>
                  {tt('This profile has no target window — when the trigger fires, it acts on whichever window happens to be focused.',
                    'Este profile não tem janela-alvo — quando o gatilho disparar, ele age sobre a janela que estiver em foco.')}
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
                <Field label="Every" hint={tt('Minimum 5 seconds. The first fire happens one interval after arming.', 'Mínimo 5 segundos. O primeiro disparo ocorre um intervalo após armar.')}>
                  <NumberInput
                    value={draft.intervalSeconds}
                    onChange={(v) => patch({ intervalSeconds: Math.max(5, v ?? 5) })}
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
                const write = (f: string, t: string) =>
                  patch({ timeOfDay: f && t ? `${f}-${t}` : null });
                return (
                  <Field
                    label="Active hours"
                    hint={tt('Leave empty to run around the clock. An end before the start crosses midnight.',
                             'Deixe vazio para rodar o tempo todo. Fim antes do início cruza a meia-noite.')}
                  >
                    <div className="flex items-center gap-2">
                      <input type="time" className={`${inputCls} w-28`} value={from}
                        onChange={(e) => write(e.target.value, to || '23:59')} />
                      <span className="text-[12px] text-text-tertiary">{tt('to', 'até')}</span>
                      <input type="time" className={`${inputCls} w-28`} value={to}
                        onChange={(e) => write(from || '00:00', e.target.value)} />
                      {(from || to) && (
                        <Button variant="ghost" size="sm" onClick={() => patch({ timeOfDay: null })}>
                          {tt('Clear', 'Limpar')}
                        </Button>
                      )}
                    </div>
                    {/* Warning, not a Save block: whether it actually locks depends on the moment
                        the automation is armed, so refusing the pairing outright would reject
                        configurations that work. See phaseLockRisk. */}
                    <FieldError
                      show={phaseLockRisk(draft)}
                      tip={tt('The ticks of this interval only ever land on a few times of day, and they can all fall outside the window.',
                              'Os ticks deste intervalo só caem em alguns horários do dia, e podem cair todos fora da janela.')}
                    >
                      {tt('This interval is too long for this window — it may never fire. Shorten the interval or widen the hours.',
                          'Este intervalo é longo demais para esta janela — pode nunca disparar. Diminua o intervalo ou amplie o horário.')}
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
                  <Field label="Days" hint={tt('None selected = every day.', 'Nenhum selecionado = todos os dias.')}>
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
                                ? 'bg-accent-solid border-accent-solid text-white'
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
                        patch(leavingImage
                          ? { conditionType: next, imagePath: null, imageBase64: null, searchRegion: null }
                          : { conditionType: next });
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
                          data-tip={tt('Only match when the window is in the FOREGROUND (instead of open anywhere).', 'Só considera quando a janela está em PRIMEIRO PLANO (em vez de aberta em qualquer lugar).')}>
                          Foreground only
                        </span>
                      </div>
                    </>
                  )}

                  {draft.conditionType === 'ProcessRunning' && (
                    <Field label="Process" hint={tt('Image name, e.g. "notepad" or "RobloxPlayerBeta.exe".', 'Nome do processo, ex. "notepad" ou "RobloxPlayerBeta.exe".')}>
                      <input
                        className={inputCls}
                        value={draft.windowProcessName ?? ''}
                        onChange={(e) => patch({ windowProcessName: e.target.value })}
                        placeholder="app.exe"
                      />
                    </Field>
                  )}

                  {draft.conditionType === 'FileExists' && (
                    <Field label="Path" hint={tt('Full path of a file or folder. Fires when it appears.', 'Caminho completo de arquivo ou pasta. Dispara quando ele aparece.')}>
                      <input
                        className={inputCls}
                        value={draft.filePath ?? ''}
                        onChange={(e) => patch({ filePath: e.target.value })}
                        placeholder="C:\\path\\to\\flag.txt"
                      />
                    </Field>
                  )}

                  {draft.conditionType === 'PixelColorMatch' && (
                    <>
                      <div className="flex items-end gap-2">
                        <Field label="X">
                          <NumberInput value={draft.pixelX} onChange={(v) => patch({ pixelX: v ?? 0 })}
                            min={-20000} max={20000} inputWidth="w-20" />
                        </Field>
                        <Field label="Y">
                          <NumberInput value={draft.pixelY} onChange={(v) => patch({ pixelY: v ?? 0 })}
                            min={-20000} max={20000} inputWidth="w-20" />
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
                      <Field label="Tolerance" hint={tt('Per-channel color tolerance (0 = exact).', 'Tolerância por canal de cor (0 = exata).')}>
                        <NumberInput value={draft.pixelTolerance} onChange={(v) => patch({ pixelTolerance: v ?? 10 })}
                          min={0} max={255} inputWidth="w-20" />
                      </Field>
                    </>
                  )}

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
                            : (draft.imagePath ?? tt('none captured', 'nenhuma capturada'))}
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
                              ? `${tt('Found', 'Encontrado')} (${Math.round(testMatchResult.score * 100)}%) — ${tt('region snapped to it', 'região ajustada no ponto')}`
                              : `${tt('Not found on screen', 'Não encontrado na tela')} (${Math.round(testMatchResult.score * 100)}%)`}
                        </div>
                      )}
                      <Field label="Search region" hint={tt('Limit matching to a screen region — faster and fewer false positives for a background watcher. Empty = full screen.', 'Limita a busca a uma região da tela — mais rápido e menos falso-positivo num vigia de fundo. Vazio = tela inteira.')}>
                        <div className="flex items-center gap-2">
                          <div className={`${inputCls} flex-1 flex items-center ${draft.searchRegion ? 'font-mono text-[11px]' : 'text-text-disabled italic'}`}>
                            {draft.searchRegion
                              ? `${draft.searchRegion.x}, ${draft.searchRegion.y}  ·  ${draft.searchRegion.w} × ${draft.searchRegion.h}`
                              : tt('Full screen (default)', 'Tela inteira (padrão)')}
                          </div>
                          <Button variant="secondary" size="sm" onClick={configureRegion}>
                            <Frame size={12} /> {tt('Configure', 'Configurar')}
                          </Button>
                          {draft.searchRegion && (
                            <button type="button" onClick={() => patch({ searchRegion: null })}
                              className="h-7 w-7 shrink-0 flex items-center justify-center rounded text-text-tertiary hover:text-text-primary hover:bg-bg-elevated transition-colors">
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      </Field>
                      <Field label="Confidence" hint={tt('Match threshold. 80% is a good start; 100% never matches a live screen.', 'Limiar de match. 80% é um bom começo; 100% nunca bate numa tela real.')}>
                        <NumberInput
                          value={Math.round((draft.imageConfidence || 0.8) * 100)}
                          onChange={(v) => patch({ imageConfidence: Math.min(99, Math.max(10, v ?? 80)) / 100 })}
                          min={10} max={99} suffix="%" inputWidth="w-20"
                        />
                      </Field>
                    </>
                  )}

                  {draft.conditionType === 'ClipboardChanged' && (
                    <Field label="Contains" hint={tt('Optional filter — empty fires on ANY clipboard change. App-made clipboard traffic (replays, capture-slot) never counts.', 'Filtro opcional — vazio dispara em QUALQUER mudança. Tráfego do próprio app (replays, capture-slot) nunca conta.')}>
                      <input
                        className={inputCls}
                        value={draft.clipboardPattern ?? ''}
                        onChange={(e) => patch({ clipboardPattern: e.target.value })}
                        placeholder={tt('text the clipboard must contain', 'texto que o clipboard deve conter')}
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
                          { value: 'edge', label: 'Once per appearance', tip: tt('Fires once when the condition becomes true; must turn false before it can fire again.', 'Dispara uma vez quando a condição fica verdadeira; precisa ficar falsa antes de disparar de novo.') },
                          { value: 'level', label: 'Continuous', tip: tt('Keeps firing every cooldown while the condition stays true.', 'Continua disparando a cada cooldown enquanto a condição fica verdadeira.') },
                        ]}
                      />
                    </Field>
                  )}

                  {(() => {
                    const cd = defaultCooldownSec(draft.conditionType);
                    return (
                      <Field label="Cooldown" hint={tt(`Minimum gap between fires. 0 = default (${cd} s).`, `Intervalo mínimo entre disparos. 0 = padrão (${cd} s).`)}>
                        <NumberInput value={draft.cooldownSeconds} onChange={(v) => patch({ cooldownSeconds: v ?? 0 })}
                          min={0} max={86400} suffix="s" inputWidth="w-24" />
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
                        hint={tt(
                          `How often to re-probe. 0 = default (${def} ms).` +
                            (heavy ? ' An image check grabs and scans the whole screen each time — raise this for something you can wait a few seconds for.' : ''),
                          `Com que frequência re-checar. 0 = padrão (${def} ms).` +
                            (heavy ? ' Uma checagem de imagem captura e varre a tela inteira a cada vez — aumente para algo que pode esperar alguns segundos.' : ''),
                        )}>
                        <NumberInput value={draft.pollIntervalMs} onChange={(v) => patch({ pollIntervalMs: v ?? 0 })}
                          min={0} max={600000} step={250} thousands suffix="ms" inputWidth="w-28" />
                      </Field>
                    );
                  })()}
                </>
              )}

              <div className="pt-2 border-t border-border-subtle text-[11px] text-text-tertiary leading-relaxed"
>
                {tt('Arm or disarm with the toggle on the list row — it takes effect immediately, independent of Save.',
                  'Arme ou desarme pelo toggle na linha da lista — vale imediatamente, independente do Save.')}
              </div>

              {selectedEntry && (selectedEntry.skippedBusy > 0 || selectedEntry.skippedDirty > 0 || selectedEntry.skippedModal > 0) && (
                <div className="text-[11px] text-text-tertiary leading-relaxed">
                  {tt('Skipped fires', 'Disparos pulados')}: {selectedEntry.skippedBusy} {tt('busy', 'ocupado')} ·{' '}
                  {selectedEntry.skippedDirty} {tt('unsaved changes', 'mudanças não salvas')} ·{' '}
                  {selectedEntry.skippedModal} {tt('dialog open', 'diálogo aberto')}
                </div>
              )}

              {/* Kept apart from the skip counters above: these were never fire attempts. A
                  clipboard watcher is deaf for a moment after each replay so the app's own paste
                  and restore traffic doesn't trigger it — a copy the user made in that window is
                  swallowed with it, and used to be invisible. */}
              {selectedEntry && selectedEntry.skippedSuppressed > 0 && (
                <div className="text-[11px] text-text-tertiary leading-relaxed">
                  {tt('Clipboard changes ignored just after a replay', 'Mudanças de clipboard ignoradas logo após um replay')}: {selectedEntry.skippedSuppressed}
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
                    onClick={() => send({ type: 'automation:resetCounters', payload: { profile: selectedEntry.profile } })}
                    data-tip={tt('Zero the fire and skip counts. The next scheduled run is not affected.',
                                 'Zera as contagens de disparo e de pulos. O próximo disparo agendado não muda.')}>
                    {tt('Reset counters', 'Zerar contadores')}
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
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
        onClick={() => setPendingNav(null)}>
        {/* A real dialog, not just a box that looks like one. As a bare div it was a SIBLING of
            the DialogShell card, so the shell's focus trap — which only knows about the card —
            never reached it: Tab could not get here, and Space on the armed toggle still behind
            the scrim fired automation:setArmed, which persists immediately. Focusing on mount and
            swallowing Escape here is what makes the overlay modal for the keyboard too; the
            stopPropagation is also what keeps Escape from reaching DialogShell's canClose and
            silently rewriting where this prompt was headed. */}
        <div className="w-[380px] rounded-lg border border-border-subtle bg-bg-surface p-4 shadow-xl outline-none"
          role="dialog"
          aria-modal="true"
          aria-label={tt('Unsaved automation', 'Automação não salva')}
          tabIndex={-1}
          ref={(el) => el?.focus()}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            e.stopPropagation();
            setPendingNav(null);
          }}
          onClick={(e) => e.stopPropagation()}>
          <div className="text-[13px] text-text-primary font-medium mb-1.5">
            {tt('Unsaved automation', 'Automação não salva')}
          </div>
          <div className="text-[12px] text-text-secondary leading-relaxed mb-4">
            {tt('This automation has changes that were never saved. Leaving now discards them — including any reference image you captured and the search region you set.',
                'Esta automação tem alterações que nunca foram salvas. Sair agora descarta tudo — inclusive a imagem de referência capturada e a região de busca definida.')}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPendingNav(null)}>
              {tt('Keep editing', 'Continuar editando')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => discardAndGo(pendingNav)}>
              {tt('Discard', 'Descartar')}
            </Button>
            {canSave && (
              <Button variant="primary" size="sm"
                onClick={() => { const dest = pendingNav; handleSave(); go(dest); }}>
                {tt('Save and continue', 'Salvar e continuar')}
              </Button>
            )}
          </div>
        </div>
      </div>
    )}
    </>
  );
}
