import type { ProfileEntry, RemapEntryDto, SettingsState } from '../../../bridge/messageTypes';
import { splitCombo } from '../../../components/common/KbdTag';
import { t, tn } from '../../../i18n';
import { compactKey } from '../../../utils/keyNames';

/**
 * Key Remaps' rules, without React (phase 3, slice 5): the names the engine knows, what makes a rule
 * the same rule, the file a list travels in, and what a rule does to the app's hotkeys. Ported from
 * today's RemapSection, whose decisions they keep. The words come from the catalog (the remaps area of
 * i18n/), one whole sentence per case.
 */

export const MAX_REMAPS = 32;

/** The mouse-side targets RemapService.MouseTargets resolves, in the panel's order, with their names on the page. */
const MOUSE_NAMES = tn('remaps.mouse');
export const MOUSE_TARGETS: { name: string; label: string }[] = (
  ['LeftClick', 'MiddleClick', 'RightClick', 'XButton1', 'XButton2', 'ScrollUp', 'ScrollDown'] as const
).map(name => ({ name, label: MOUSE_NAMES[name] }));
export const mouseTarget = (name: string) => MOUSE_TARGETS.find(m => m.name.toLowerCase() === name.toLowerCase());
/** A side, in words: the mouse target's name, or the key as its keycap says it (PgDn, Esc, Caps). */
export const describeKey = (name: string) => mouseTarget(name)?.label ?? compactKey(name);

// "Chrome.EXE" and "chrome" are one scope, as RemapService.NormalizeProcess has it.
export const normProcess = (p?: string) => {
  const s = (p ?? '').trim().toLowerCase();
  return s.endsWith('.exe') ? s.slice(0, -4) : s;
};
/** An app as the page says it: the process name without ".exe". */
export const appName = (p: string) => p.trim().replace(/\.exe$/i, '');
/** What makes a rule unique: its key and its scope. The engine is first-wins on the same pair. */
export const ruleKey = (e: { from: string; process?: string }) => `${e.from.toLowerCase()}|${normProcess(e.process)}`;

/** Which rule the panel holds: its ruleKey, and which of the rules sharing it (a hand-edited file). */
export interface RuleRef { key: string; nth: number }
export const refOf = (entries: RemapEntryDto[], i: number): RuleRef => {
  const key = ruleKey(entries[i]);
  return { key, nth: entries.slice(0, i).filter(e => ruleKey(e) === key).length };
};
/** Where that rule is now, or null when it is gone. */
export function indexOf(entries: RemapEntryDto[], ref: RuleRef | null): number | null {
  if (!ref) return null;
  let seen = 0;
  for (let i = 0; i < entries.length; i++) {
    if (ruleKey(entries[i]) !== ref.key) continue;
    if (seen === ref.nth) return i;
    seen++;
  }
  return null;
}

/** The rule in words: "Caps to Esc", "F1 disabled", "Q to left click in RobloxPlayerBeta". */
export function ruleWords(r: RemapEntryDto): string {
  const from = describeKey(r.from);
  const app = r.process ? appName(r.process) : '';
  if (!r.to) return app ? t('remaps.rule.offIn', { from, app }) : t('remaps.rule.off', { from });
  const m = mouseTarget(r.to);
  const to = m ? m.label.toLowerCase() : describeKey(r.to);
  return app ? t('remaps.rule.toIn', { from, to, app }) : t('remaps.rule.to', { from, to });
}

/** The rule as the panel's title says it: "Caps → Esc", "F1 → Nothing", "Q → Left click". */
export const ruleArrow = (r: RemapEntryDto) => (r.to
  ? t('remaps.rule.arrow', { from: describeKey(r.from), to: describeKey(r.to) })
  : t('remaps.rule.arrowNothing', { from: describeKey(r.from) }));

// ── The panel's working copy ──

export type Does = 'key' | 'mouse' | 'nothing';
export interface Draft {
  from: string;
  does: Does;
  /** The key it sends (Another key). */
  toKey: string;
  /** The mouse target it sends (Mouse). */
  mouse: string;
  where: 'everywhere' | 'app';
  process: string;
}
export const emptyDraft = (): Draft => ({ from: '', does: 'key', toKey: '', mouse: 'LeftClick', where: 'everywhere', process: '' });
export function draftOf(r: RemapEntryDto): Draft {
  const does: Does = !r.to ? 'nothing' : mouseTarget(r.to) ? 'mouse' : 'key';
  return {
    from: r.from,
    does,
    toKey: does === 'key' ? r.to : '',
    mouse: does === 'mouse' ? r.to : 'LeftClick',
    where: r.process ? 'app' : 'everywhere',
    process: r.process ?? '',
  };
}
export const targetOf = (d: Draft) => (d.does === 'nothing' ? '' : d.does === 'mouse' ? d.mouse : d.toKey);
export function ruleOf(d: Draft, enabled: boolean): RemapEntryDto {
  const process = d.where === 'app' ? d.process.trim() : '';
  return { from: d.from, to: targetOf(d), enabled, ...(process ? { process } : {}) };
}

/**
 * What keeps the working copy from being the rule (null when it is one). `kind` says whether it is a
 * refusal (red: the same key twice, the same key on both sides) or a step still to take.
 */
export function draftProblem(d: Draft, entries: RemapEntryDto[], editing: number | null): { kind: 'todo' | 'refused'; text: string } | null {
  if (!d.from) return { kind: 'todo', text: t('remaps.problem.pressFrom') };
  // The key taken where the rule applies is said at once, before anything else is asked.
  const scope = normProcess(d.where === 'app' ? d.process : '');
  if ((d.where === 'everywhere' || scope)
    && entries.some((r, j) => j !== editing && r.from.toLowerCase() === d.from.toLowerCase() && normProcess(r.process) === scope)) {
    return { kind: 'refused', text: scope ? t('remaps.problem.takenInApp') : t('remaps.problem.taken') };
  }
  if (d.does === 'key' && !d.toKey) return { kind: 'todo', text: t('remaps.problem.pressTo') };
  if (d.does === 'key' && d.toKey.toLowerCase() === d.from.toLowerCase()) return { kind: 'refused', text: t('remaps.problem.same') };
  if (d.where === 'app' && !scope) return { kind: 'todo', text: t('remaps.problem.nameApp') };
  if (editing === null && entries.length >= MAX_REMAPS) return { kind: 'refused', text: t('remaps.problem.limit', { max: MAX_REMAPS }) };
  return null;
}

// ── The hotkeys a rule touches (today's messages: "hotkey silently not firing" is the #1 support issue) ──

const keyFamily = (k: string) => k.replace(/^(Left|Right)(Ctrl|Alt|Shift|Win)$/i, '$2').toLowerCase();
const showCombo = (combo: string) => splitCombo(combo).map(compactKey).join('+');
const mainKey = (combo: string) => { const parts = splitCombo(combo); return parts[parts.length - 1] ?? combo; };
const hasModifiers = (combo: string) => splitCombo(combo).length > 1;
interface HotkeyRef { label: string; combo: string }
/** The hotkeys a message names, each with its keys when asked: "the Record hotkey (Ctrl+F9) and macro "Login"". */
const listHits = (hits: HotkeyRef[], withCombo: (h: HotkeyRef) => boolean) => {
  const items = hits.map(h => (withCombo(h) ? `${h.label} (${showCombo(h.combo)})` : h.label));
  return items.length <= 1 ? items.join('') : t('remaps.hotkeys.and', { first: items.slice(0, -1).join(', '), last: items[items.length - 1] });
};

/** Every hotkey the app listens for, with the name a message uses (the Clicker pair stays out, as today). */
export function hotkeysOf(s: SettingsState, profiles: ProfileEntry[]): HotkeyRef[] {
  const app: [string | undefined, string][] = [
    [s.recordingHotkey, t('remaps.hotkeys.record')],
    [s.replayHotkey, t('remaps.hotkeys.replay')],
    [s.profileKeyToggleHotkey, t('remaps.hotkeys.shortcuts')],
    [s.foregroundHotkey, t('remaps.hotkeys.front')],
    [s.modeToggleHotkey, t('remaps.hotkeys.clicker')],
    [s.captureSlotHotkey, t('remaps.hotkeys.clip')],
    [s.copyScreenTextHotkey, t('remaps.hotkeys.screenText')],
  ];
  return [
    ...app.filter(([combo]) => !!combo).map(([combo, label]) => ({ label, combo: combo as string })),
    ...profiles.filter(p => !!p.hotkey).map(p => ({ label: t('remaps.hotkeys.macro', { name: p.name }), combo: p.hotkey as string })),
  ];
}

/** The remap runs before the hotkeys: every hotkey built on its key stops firing. */
export function fromWarning(from: string, hotkeys: HotkeyRef[]): string | null {
  if (!from) return null;
  const hits = hotkeys.filter(h => splitCombo(h.combo).some(seg => keyFamily(seg) === keyFamily(from)));
  if (hits.length === 0) return null;
  const named = listHits(hits, () => true);
  return t('remaps.fromWarn', { count: hits.length, hits: named });
}

/** A key it sends that is a hotkey's main key fires that hotkey; a mouse one does not (injected input). */
export function toNote(from: string, to: string, hotkeys: HotkeyRef[]): string | null {
  if (!to) return null;
  const hits = hotkeys.filter(h => keyFamily(mainKey(h.combo)) === keyFamily(to));
  if (hits.length === 0) return null;
  const count = hits.length;
  const named = listHits(hits, h => hasModifiers(h.combo));
  const target = describeKey(to);
  if (mouseTarget(to)) return t('remaps.toNote.mouse', { count, to: target, named });
  const held = hits.some(h => hasModifiers(h.combo));
  if (!from) return held ? t('remaps.toNote.noFromHeld', { count, to: target, named }) : t('remaps.toNote.noFrom', { count, to: target, named });
  const pressed = describeKey(from);
  return held ? t('remaps.toNote.keyHeld', { count, to: target, named, from: pressed }) : t('remaps.toNote.key', { count, to: target, named, from: pressed });
}

// ── The file a list travels in (today's envelope, and the bare remaps.json, PascalCase) ──

export const EXPORT_KIND = 'truereplayer-remaps';
type ImportResult = { ok: true; entries: RemapEntryDto[] } | { ok: false; reason: string };
const pick = (o: Record<string, unknown>, key: string): unknown => o[key] ?? o[key.charAt(0).toUpperCase() + key.slice(1)];
export function parseRemapImport(text: string): ImportResult {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, reason: t('remaps.file.notJson') }; }
  if (!data || typeof data !== 'object') return { ok: false, reason: t('remaps.file.notRemaps') };
  const list = pick(data as Record<string, unknown>, 'remaps') ?? pick(data as Record<string, unknown>, 'entries');
  if (!Array.isArray(list)) return { ok: false, reason: t('remaps.file.notRemaps') };
  const entries: RemapEntryDto[] = [];
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
  if (entries.length === 0) return { ok: false, reason: t('remaps.file.noneUsable') };
  return { ok: true, entries };
}

/** The file's rules added to the list: one already there (same key, same app) is skipped, and so is
 *  anything past the limit. Never a replace. */
export function mergeImport(entries: RemapEntryDto[], incoming: RemapEntryDto[]): { next: RemapEntryDto[]; added: number; skipped: number } {
  const seen = new Set(entries.map(ruleKey));
  const next = [...entries];
  let added = 0;
  let skipped = 0;
  for (const en of incoming) {
    const k = ruleKey(en);
    if (seen.has(k) || next.length >= MAX_REMAPS) { skipped++; continue; }
    next.push(en);
    seen.add(k);
    added++;
  }
  return { next, added, skipped };
}
