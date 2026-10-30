import { create } from 'zustand';
import { useApp, useShell } from '../../store';
import { diffFields, fieldsOf, orderPatch, type Display, type FieldKey, type Fields } from './clickerModel';

/**
 * What the Clicker page's parts share (phase 3, slice 6): the preset its edits save into, the values
 * sent and not yet echoed, the page's undo, and what the page remembers between visits (the Rate's
 * unit, the values a switch seeded). The engine holds the settings and the presets; the page holds
 * which preset is "selected", since the concept saves every edit into it ("Edits save into the one
 * that is selected").
 */
interface Snap {
  fields: Fields;
  selected: string | null;
  /** A Delete, which Ctrl+Z undoes as the toast's Undo does. The engine keeps the last one only. */
  deleted?: string;
}
/** What the history does to the presets: the engine's restore of the last Delete, and the Delete again. */
export interface PresetSteps { restore: (name: string) => void; remove: (name: string) => void }
interface ClickerUi {
  /** The preset the edits save into, or null (no preset: New keeps the settings under a name). */
  selected: string | null;
  /** Values sent and not yet echoed, over the engine's (rule 3). */
  pending: Partial<Fields>;
  /** The values an apply or an undo waits for; until they come, edits do not save into the preset. */
  expect: Fields | null;
  /** The Rate field's unit, kept while the app runs. */
  unit: 'cps' | 'ms';
  /** New's name field, and the header's Rename… field. */
  naming: boolean;
  renaming: boolean;
  /** What New's name field holds, kept while the page is away (paineis-158); Esc and Enter let it go. */
  draftName: string;
  /** The presets laid over the page where the window has no room for them beside it. */
  peek: boolean;
  /** What a switch's seed value replaced (Clicks 100, Jitter and Spread 10), to put back when it goes off untouched. */
  seeds: Partial<Record<FieldKey, string>>;
  /** The delay the last Rate entry was clamped to, for the note under it. */
  clampedAt: number | null;
  /** The monitors (screen:displays), for the drawing of the display the area or the point is on. */
  displays: Display[] | null;
  /** When the last run ended (Date.now()), for "Last run 14:10 · …". */
  endedAt: number | null;
  past: Snap[];
  future: Snap[];
}
export const useClickerUi = create<ClickerUi>(() => ({
  selected: null, pending: {}, expect: null, unit: 'cps', naming: false, renaming: false, draftName: '', peek: false,
  seeds: {}, clampedAt: null, displays: null, endedAt: null, past: [], future: [],
}));

type Send = (key: FieldKey, value: unknown) => void;

/** The settings on screen: the engine's, with the ones just sent over them. */
export function useFields(): Fields {
  const settings = useApp(a => a.settings);
  const pending = useClickerUi(s => s.pending);
  return { ...fieldsOf(settings), ...pending };
}
export const engineFields = (): Fields => fieldsOf(useShell.getState().app.settings);
/** The same, read in a handler: what a change builds on. */
export const fieldsNow = (): Fields => ({ ...engineFields(), ...useClickerUi.getState().pending });

let dropTimer = 0;
/** Values on screen ahead of the engine. No echo within a second (the engine kept its own): its values show again. */
function hold(patch: Partial<Fields>) {
  useClickerUi.setState(s => ({ pending: { ...s.pending, ...patch } }));
  clearTimeout(dropTimer);
  dropTimer = window.setTimeout(() => useClickerUi.setState({ pending: {} }), 1000);
}
/** Sends a patch: on screen at once, then to the engine key by key (the modes in the order that keeps one on). */
export function sendFields(patch: Partial<Fields>, send: Send) {
  const entries = orderPatch(patch);
  if (entries.length === 0) return;
  hold(patch);
  for (const [k, v] of entries) send(k, v);
}
/** The echo came: what the engine now holds leaves the pending. */
export function settle(engine: Fields) {
  const { pending } = useClickerUi.getState();
  const keys = Object.keys(pending) as FieldKey[];
  if (keys.length === 0) return;
  const left = diffFields(engine, pending);
  if (Object.keys(left).length !== keys.length) useClickerUi.setState({ pending: left });
}

let expectTimer = 0;
/** Waits for these values (an apply, an undo) before edits save into the preset again; 1.5 s at most. */
export function expectFields(fields: Fields) {
  useClickerUi.setState({ expect: fields });
  clearTimeout(expectTimer);
  expectTimer = window.setTimeout(() => { if (useClickerUi.getState().expect === fields) useClickerUi.setState({ expect: null }); }, 1500);
}

// ── The undo ──

/** Changes of one control closer than this are one step (an arrow held in a number). */
const MERGE_MS = 600;
const MAX_STEPS = 50;
// None yet is -Infinity, so a young page's first change is a step too.
let lastAt = -Infinity;
let lastControl: string | null = null;
function record(control?: string) {
  const before: Snap = { fields: fieldsNow(), selected: useClickerUi.getState().selected };
  const t = performance.now();
  if (!control || control !== lastControl || t - lastAt > MERGE_MS) useClickerUi.setState(s => ({ past: [...s.past.slice(1 - MAX_STEPS), before], future: [] }));
  else if (useClickerUi.getState().future.length) useClickerUi.setState({ future: [] });
  lastAt = t;
  lastControl = control ?? null;
}

/** A change of the page's: the values before it are a step, and the patch goes out (only what it changes). */
export function commitFields(patch: Partial<Fields>, send: Send, control?: string) {
  const changed = diffFields(fieldsNow(), patch);
  if (Object.keys(changed).length === 0) return;
  record(control);
  sendFields(changed, send);
}

/** A preset chosen: the values before it are a step, and its own show at once (the engine applies it). */
export function choosePreset(name: string, fields: Fields, apply: (name: string) => void) {
  record();
  useClickerUi.setState({ selected: name });
  hold(fields);
  expectFields(fields);
  apply(name);
}

const presetExists = (name: string | null) => !!name
  && (useShell.getState().app.settings.cursorClickPresets ?? []).some(p => p.name.toLowerCase() === name.toLowerCase());

/** A preset deleted: a step of its own. The engine keeps only the last Delete, so an older one leaves the history. */
export function recordDelete(name: string) {
  const s = useClickerUi.getState();
  const step: Snap = { fields: fieldsNow(), selected: s.selected, deleted: name };
  useClickerUi.setState({ past: [...s.past.filter(p => !p.deleted).slice(1 - MAX_STEPS), step], future: [], selected: null });
  lastAt = -Infinity;
  lastControl = null;
}

/**
 * Ctrl+Z (or Ctrl+Y): the settings and the selected preset one step back (or forward). A Delete
 * brings its preset back (selected again once it is, by the page) or deletes it again; a preset gone
 * since a step is not selected again.
 */
export function stepFields(back: boolean, send: Send, presets: PresetSteps): boolean {
  const { past, future, selected } = useClickerUi.getState();
  const to = (back ? past : future).at(-1);
  if (!to) return false;
  lastAt = -Infinity;
  lastControl = null;
  if (to.deleted) {
    useClickerUi.setState(back
      ? { past: past.slice(0, -1), future: [...future, to], selected: null }
      : { future: future.slice(0, -1), past: [...past, to], selected: null });
    if (back) presets.restore(to.deleted);
    else presets.remove(to.deleted);
    return true;
  }
  const now: Snap = { fields: fieldsNow(), selected };
  const next = presetExists(to.selected) ? to.selected : null;
  useClickerUi.setState(back
    ? { past: past.slice(0, -1), future: [...future, now], selected: next }
    : { future: future.slice(0, -1), past: [...past, now], selected: next });
  expectFields(to.fields);
  sendFields(diffFields(now.fields, to.fields), send);
  return true;
}

/** The toast's Undo: Ctrl+Z when the Delete is the last step; otherwise the preset comes back and its step goes. */
export function undoDelete(name: string, send: Send, presets: PresetSteps) {
  if (useClickerUi.getState().past.at(-1)?.deleted === name) {
    stepFields(true, send, presets);
    return;
  }
  useClickerUi.setState(s => ({ past: s.past.filter(p => p.deleted !== name), future: s.future.filter(p => p.deleted !== name) }));
  presets.restore(name);
}
