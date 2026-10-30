import { create } from 'zustand';
import type { AutomationEntry, ProfileEntry, TriggerConfig } from '../../../bridge/messageTypes';
import type { useAutomations } from '../../../logic/useAutomations';
import { useApp, useShell } from '../../store';
import { shapeOf } from './automationModel';

/**
 * What the Automations page's parts share (phase 3, slice 8): the automation open in "Automation
 * settings" (by its macro), the filter, what was just sent, and the page's undo. The concept's panel
 * "Applies as you type · Ctrl+Z undoes"; the engine's undo covers the open macro only, so the page
 * keeps a history of its own, as Key Remaps does. Run automations stays out of it: it is the switch
 * of them all, as in the status bar, not an edit of one.
 */
export type Filter = 'all' | 'armed' | 'off' | 'attention';
export type Cmds = ReturnType<typeof useAutomations>;
/** A change of one macro's automation: what it was and what it became (null: none). */
interface Step { profile: string; before: TriggerConfig | null; after: TriggerConfig | null }
interface Sent { trigger: TriggerConfig | null; at: number }
interface AutomationsUi {
  /** The macro whose automation is in the panel, or none (no panel). */
  open: string | null;
  /** The macro whose reference image is being cropped, in the expanded panel (dialogos-087). */
  crop: string | null;
  filter: Filter;
  query: string;
  /** Each macro's automation as last sent, on screen until the engine says the same (rule 3). */
  sent: Record<string, Sent>;
  /** Run automations as last sent. */
  master: { on: boolean; at: number } | null;
  past: Step[];
  future: Step[];
}
export const useAutomationsUi = create<AutomationsUi>(() => ({ open: null, crop: null, filter: 'all', query: '', sent: {}, master: null, past: [], future: [] }));

export const openAutomation = (profile: string) => useAutomationsUi.setState(s => (s.crop && s.crop !== profile ? { open: profile, crop: null } : { open: profile }));
export const closePanel = () => useAutomationsUi.setState({ open: null, crop: null });

/**
 * The reference images asked for (a capture, a crop), by the macro whose automation they are for:
 * the answer lands on that automation, whichever one the panel shows by then.
 */
export const imageAsks = new Map<string, string>();

// ── The list (rule 3: the screen changes at once, the engine confirms after) ──

/** No echo this long after a send (a write that failed and rolled back): the engine's value shows again. */
const ECHO_MS = 4000;

/** A macro's automation as the page shows it: one just made has no history yet. */
function fresh(profile: string, trigger: TriggerConfig, profiles: ProfileEntry[]): AutomationEntry {
  const p = profiles.find(x => x.name === profile);
  return {
    profile, isDisabled: p?.isDisabled ?? false, hasEffectiveTarget: p?.hasEffectiveTarget ?? false, trigger,
    running: false, conditionTrue: false, nextDueAt: null, lastFiredAt: null, fireCount: 0,
    skippedBusy: 0, skippedDirty: 0, skippedModal: 0, skippedSuppressed: 0, lastResult: null,
  };
}
/** The engine's automations with what was sent over them. */
export function merged(engine: AutomationEntry[], sent: Record<string, Sent>, profiles: ProfileEntry[]): AutomationEntry[] {
  const out: AutomationEntry[] = [];
  for (const e of engine) {
    const s = sent[e.profile];
    if (!s) out.push(e);
    else if (s.trigger) out.push({ ...e, trigger: s.trigger });
  }
  for (const [profile, s] of Object.entries(sent)) {
    if (s.trigger && !engine.some(e => e.profile === profile)) out.push(fresh(profile, s.trigger, profiles));
  }
  return out;
}
/** The automations on screen. */
export function useEntries(): AutomationEntry[] {
  const engine = useApp(a => a.automation.entries);
  const profiles = useApp(a => a.profiles);
  const sent = useAutomationsUi(s => s.sent);
  return merged(engine, sent, profiles);
}
/** One macro's automation as it stands now, read in a handler: what a change builds on. */
export function triggerNow(profile: string): TriggerConfig | null {
  const s = useAutomationsUi.getState().sent[profile];
  if (s) return s.trigger;
  return useShell.getState().app.automation.entries.find(e => e.profile === profile)?.trigger ?? null;
}
/** Run automations as the page shows it. */
export function useRunAutomations(): boolean {
  const engine = useApp(a => a.automation.enabled);
  const master = useAutomationsUi(s => s.master);
  return master ? master.on : engine;
}

/** What the engine said came: what it now holds as sent stops covering it. */
export function reconcile(engine: { enabled: boolean; entries: AutomationEntry[] }) {
  const { sent, master } = useAutomationsUi.getState();
  let next: Record<string, Sent> | null = null;
  for (const [profile, s] of Object.entries(sent)) {
    const now = engine.entries.find(e => e.profile === profile)?.trigger ?? null;
    if (shapeOf(now, true) === shapeOf(s.trigger, true)) {
      next ??= { ...sent };
      delete next[profile];
    }
  }
  const masterDone = master && master.on === engine.enabled;
  if (next || masterDone) useAutomationsUi.setState({ ...(next ? { sent: next } : {}), ...(masterDone ? { master: null } : {}) });
}

function cover(profile: string, trigger: TriggerConfig | null) {
  const mark: Sent = { trigger, at: Date.now() };
  useAutomationsUi.setState(s => ({ sent: { ...s.sent, [profile]: mark } }));
  setTimeout(() => {
    const { sent } = useAutomationsUi.getState();
    if (sent[profile] !== mark) return;
    const next = { ...sent };
    delete next[profile];
    useAutomationsUi.setState({ sent: next });
  }, ECHO_MS);
}

/** Sends what `next` needs over `before`: the automation saved, armed or disarmed, or deleted. */
function apply(profile: string, before: TriggerConfig | null, next: TriggerConfig | null, cmds: Cmds) {
  cover(profile, next);
  if (!next) {
    if (before) cmds.remove(profile);
    return;
  }
  if (!before || shapeOf(before) !== shapeOf(next)) cmds.save(profile, next);
  // A save keeps the armed state the engine holds (PreserveArmed): arming is its own message.
  if ((before?.armed ?? false) !== next.armed) cmds.setArmed(profile, next.armed);
}

/** Run automations, on or off: not a step of the undo. */
export function setRunAutomations(on: boolean, cmds: Cmds) {
  const mark = { on, at: Date.now() };
  useAutomationsUi.setState({ master: mark });
  cmds.setEnabled(on);
  setTimeout(() => { if (useAutomationsUi.getState().master === mark) useAutomationsUi.setState({ master: null }); }, ECHO_MS);
}

// ── The undo ──

/** Changes of one control of one automation closer than this are one step (the days clicked in a row). */
const MERGE_MS = 600;
const MAX_STEPS = 50;
// The last change: when, and the control and the macro it came from (no control: a step on its own).
let lastAt = -Infinity;
let lastControl: string | null = null;
let lastProfile: string | null = null;

/**
 * A change of the page's: a macro's automation becomes `next` (null deletes it). What it was becomes
 * a step of the undo; a change from the same `control` close after another joins that step instead.
 */
export function commit(profile: string, next: TriggerConfig | null, cmds: Cmds, control?: string) {
  const before = triggerNow(profile);
  if (shapeOf(before, true) === shapeOf(next, true)) return;
  const t = performance.now();
  const { past } = useAutomationsUi.getState();
  const top = past.at(-1);
  const join = !!top && top.profile === profile && !!control && control === lastControl && profile === lastProfile && t - lastAt <= MERGE_MS;
  if (join && shapeOf(top.before, true) === shapeOf(next, true)) {
    // Back where the step began (a switch off and on again): no step at all, and the next change
    // starts one of its own (the step under it is another one's).
    useAutomationsUi.setState({ past: past.slice(0, -1), future: [] });
    lastControl = null;
    lastProfile = null;
  } else {
    useAutomationsUi.setState({
      past: join ? [...past.slice(0, -1), { ...top, after: next }] : [...past.slice(1 - MAX_STEPS), { profile, before, after: next }],
      future: [],
    });
    lastControl = control ?? null;
    lastProfile = profile;
  }
  lastAt = t;
  apply(profile, before, next, cmds);
}

/**
 * Ctrl+Z (or Ctrl+Y): one step back (or forward), moved to the other side. A step whose macro is gone
 * (deleted, renamed) is passed over. Answers the macro whose automation changed, or null.
 */
export function stepHistory(back: boolean, cmds: Cmds, exists: (profile: string) => boolean): string | null {
  const { past, future } = useAutomationsUi.getState();
  const step = (back ? past : future).at(-1);
  if (!step) return null;
  useAutomationsUi.setState(back
    ? { past: past.slice(0, -1), future: [...future, step] }
    : { future: future.slice(0, -1), past: [...past, step] });
  lastAt = -Infinity;
  lastControl = null;
  lastProfile = null;
  if (!exists(step.profile)) return null;
  apply(step.profile, triggerNow(step.profile), back ? step.before : step.after, cmds);
  return step.profile;
}
