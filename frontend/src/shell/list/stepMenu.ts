import {
  Brackets, CheckCheck, ChevronsDownUp, ChevronsUpDown, ClipboardCopy, ClipboardPaste, Code2, Combine, Crosshair,
  Eye, EyeOff, Files, Focus, Link, MoreHorizontal, MousePointerClick, Pencil, Repeat, RotateCcw, Split, SquareArrowOutUpRight,
  Table2, Trash2,
} from 'lucide-react';
import type { ActionItem, IncomingMessage } from '../../bridge/messageTypes';
import { fmtNum, t } from '../../i18n';
import { deleteIntent, type useSteps } from '../../logic/useSteps';
import { hasConditionFields, isStructuralRow, snapIndicesToBlocks } from '../../utils/conditionalBlocks';
import { CLICK_FAMILY_TYPES, clickFormOf, isCoordinateClick, isFocusClickEligible } from '../../utils/displayUtils';
import { canCollapse, canExpand, expandKeystroke } from '../../utils/keyRepeat';
import type { MenuEntry } from '../Menu';
import { useShell } from '../store';
import { scopeOf, type BlockMap } from './blocks';
import { arrival } from './selection';


export interface StepMenuContext {
  steps: ActionItem[];
  blocks: BlockMap;
  /** The step right-clicked. */
  row: number;
  /** What the menu acts on: the selection when the step is in it, else the step alone. */
  targets: number[];
  cmds: ReturnType<typeof useSteps>;
  /** The open macro, for the conversions of its coordinates. */
  convertCoordinates: (direction: 'toRelative' | 'toAbsolute') => void;
  /** Picks a point on screen for the step, then writes it (the list's own flow). */
  pick: (row: number) => void;
  /** Opens the step in the Inspector, with the focus in its first field. */
  edit: (row: number) => void;
  /** Opens another macro (a Run Macro's). */
  openMacro: (name: string) => void;
  select: (indices: number[]) => void;
  toast: (message: string, kind?: 'success' | 'error' | 'info') => void;
  /** The bridge's subscribe: what One row says about the notes waits for the engine's answer. */
  subscribe: (handler: (message: IncomingMessage) => void) => () => void;
}

/**
 * The step's right-click menu (lista-054 and on): the concept's order — Edit, Pick from screen,
 * Change click type, Duplicate, Copy, Paste below, Skip, Convert, More, Delete — with the items
 * the inventory adds (Select block and the More tools, D8; One row / Two rows under Convert, D14).
 * Every item acts on the selection when the step is in it, else on the step alone, and says how
 * many rows that is. The scope rules are the ones the list keeps everywhere: a lone If, loop or
 * Else If takes its own block, loop or arm, and anything that touches a marker takes whole blocks.
 * The labels, tips and notices come from the catalog (i18n/<language>/list.ts, menu): a label that
 * says how many is a plural there, "Duplicate" for one and "Duplicate (3)" for more.
 */
export function stepMenuEntries(ctx: StepMenuContext): MenuEntry[] {
  const { steps, blocks, row, targets, cmds } = ctx;
  const step = steps[row];
  if (!step) return [];
  const type = step.actionType;
  const duplicateSet = scopeOf(targets, steps, blocks);
  const del = deleteIntent(targets, steps, (o) => blocks.closerOf.get(o));
  const delScope = deleteScope(targets, steps);
  const allSkipped = targets.every(i => steps[i]?.isSkipped);
  const entries: MenuEntry[] = [
    { label: t('common.actions.edit'), icon: Pencil, shortcut: 'Enter', onSelect: () => ctx.edit(row) },
  ];

  // A Run Macro opens the macro it calls (lista-074), when it is in the library: it always opens it,
  // and never closes the one open (D1).
  const called = type === 'RunProfile' ? step.key ?? '' : '';
  if (called && useShell.getState().app.profiles.some(p => p.name === called)) {
    entries.push({ label: t('list.menu.openMacro'), icon: SquareArrowOutUpRight, onSelect: () => ctx.openMacro(called) });
  }

  // A Set Variable in Cycle starts its list over (lista-070): right under Edit, as today. The
  // engine confirms it ("Cycle '<name>' reset to the first item").
  if (type === 'SetVariable' && step.variableMode === 'cycle') {
    entries.push({
      label: t('list.menu.resetCycle'),
      icon: RotateCcw,
      tip: t('list.menu.resetCycleTip'),
      onSelect: () => cmds.resetCycle({ index: row }),
    });
  }

  if (isStructuralRow(type)) {
    const block = snapIndicesToBlocks([row], steps);
    if (block.length > 1) {
      entries.push({
        label: t('list.menu.selectBlock'),
        icon: Brackets,
        tip: t('list.menu.selectBlockTip'),
        onSelect: () => {
          ctx.select(block);
          ctx.toast(t('list.menu.selectedBlock', { n: fmtNum(block.length) }), 'success');
        },
      });
    }
  }

  if (isCoordinateClick(type)) {
    if (!step.atCursor) entries.push({ label: t('list.menu.pickFromScreen'), icon: Crosshair, onSelect: () => ctx.pick(row) });
    entries.push(clickTypeEntry(ctx));
  }

  const skipCount = targets.length;
  entries.push(
    'separator',
    {
      label: t('list.menu.duplicate', { count: duplicateSet.length, n: fmtNum(duplicateSet.length) }),
      icon: Files,
      tip: duplicateSet.length > targets.length ? t('list.menu.duplicateTip') : undefined,
      onSelect: () => cmds.duplicate({ indices: duplicateSet }),
    },
    // The engine says how many it copied (alert:show); a second toast here would repeat it.
    { label: t('list.menu.copy', { count: targets.length, n: fmtNum(targets.length) }), icon: ClipboardCopy, shortcut: 'Ctrl+C', onSelect: () => cmds.copyInternal({ indices: targets }) },
    { label: t('list.menu.pasteBelow'), icon: ClipboardPaste, shortcut: 'Ctrl+V', onSelect: () => cmds.paste({ insertIndex: row + 1 }) },
    {
      label: allSkipped
        ? t('list.menu.enable', { count: skipCount, n: fmtNum(skipCount) })
        : t('list.menu.skip', { count: skipCount, n: fmtNum(skipCount) }),
      icon: allSkipped ? Eye : EyeOff,
      tip: allSkipped ? t('list.menu.enableTip') : t('list.menu.skipTip'),
      onSelect: () => {
        cmds.toggleSkip({ indices: targets });
        ctx.toast(allSkipped
          ? t('list.menu.enabled', { count: skipCount, n: fmtNum(skipCount) })
          : t('list.menu.skipped', { count: skipCount, n: fmtNum(skipCount) }), 'success');
      },
    },
    'separator',
    { label: t('list.menu.convert'), icon: Repeat, submenu: convertEntries(ctx) },
    { label: t('common.actions.more'), icon: MoreHorizontal, submenu: moreEntries(ctx) },
    'separator',
    {
      label: delScope === 'block' ? t('list.menu.deleteBlock') : delScope === 'loop' ? t('list.menu.deleteLoop') : delScope === 'arm' ? t('list.menu.deleteArm')
        : t('list.menu.delete', { count: del.count, n: fmtNum(del.count) }),
      icon: Trash2,
      danger: true,
      shortcut: 'Del',
      tip: delScope === 'block' ? t('list.menu.deleteBlockTip')
        : delScope === 'loop' ? t('list.menu.deleteLoopTip')
        : delScope === 'arm' ? t('list.menu.deleteArmTip')
        : del.count > targets.length ? t('list.menu.deleteWiderTip')
        : undefined,
      onSelect: () => cmds.removeSteps(del),
    },
  );
  return entries;
}

/** The click types for the step and the selected clicks of the same shape (one message, one undo). */
function clickTypeEntry({ steps, row, targets, cmds }: StepMenuContext): MenuEntry {
  const form = clickFormOf(steps[row].actionType);
  const options = form ? CLICK_FAMILY_TYPES.filter(o => isFocusClickEligible(o.value)) : CLICK_FAMILY_TYPES;
  const clicks = targets.filter(i => isCoordinateClick(steps[i]?.actionType ?? '') && clickFormOf(steps[i].actionType) === form);
  return {
    label: t('list.menu.changeClickType', { count: clicks.length, n: fmtNum(clicks.length) }),
    icon: MousePointerClick,
    // The click types are glossary (Left Click, Hold Left…): the same in both languages.
    submenu: options.map((o): MenuEntry => {
      const target = o.value + form;
      const current = clicks.length > 0 && clicks.every(i => steps[i].actionType === target);
      return { label: o.label, checked: current, onSelect: () => { if (!current) cmds.bulkUpdateType({ indices: clicks, actionType: target }); } };
    }),
  };
}

/**
 * Convert ▸: a click's shape (D14: One row and Two rows, for the selected clicks) and the whole
 * macro's coordinates and shapes. The engine refuses what it cannot convert, and says why.
 */
function convertEntries({ steps, row, targets, cmds, convertCoordinates, toast, subscribe }: StepMenuContext): MenuEntry[] {
  const type = steps[row].actionType;
  const form = isCoordinateClick(type) ? clickFormOf(type) : null;
  const clicks = targets.filter(i => isCoordinateClick(steps[i]?.actionType ?? '') && clickFormOf(steps[i].actionType) === form);
  const out: MenuEntry[] = [];
  if (form === '') {
    out.push({
      label: t('list.menu.twoRows'),
      icon: Split,
      tip: t('list.menu.twoRowsTip'),
      onSelect: () => cmds.convertMode({ direction: 'toPaired', indices: clicks }),
    });
  } else if (form === 'Down' || form === 'Up') {
    // A half means "this pair": reach for each twin rather than asking for both halves.
    const seeds = clicks.length > 1 ? clicks : [row];
    const pair = [...new Set(seeds.flatMap(i => (form === 'Down' ? [i, i + 1] : [i - 1, i])))]
      .filter(i => i >= 0 && i < steps.length)
      .sort((a, b) => a - b);
    // D14: the merge keeps the Down half. A button or a point that differs, the engine refuses and
    // says why; the notes of an Up half go in silence, so they are said once the engine has merged
    // it: the Up row is then gone from the list it sends back. A refused pair keeps its notes.
    const upNotes = pair.flatMap((i) => {
      const s = steps[i];
      return clickFormOf(s.actionType) === 'Up' && (s.comment ?? '') !== '' && s.comment !== (steps[i - 1]?.comment ?? '') && s.id ? [s.id] : [];
    });
    out.push({
      label: t('list.menu.oneRow'),
      icon: Combine,
      tip: t('list.menu.oneRowTip'),
      onSelect: () => {
        if (upNotes.length > 0) {
          afterConvert(subscribe, (after) => {
            if (after && upNotes.some(id => !after.some(s => s.id === id))) {
              toast(t('list.menu.oneRowNotes'), 'info');
            }
          });
        }
        cmds.convertMode({ direction: 'toCombined', indices: pair });
      },
    });
  }
  if (out.length > 0) out.push('separator');
  out.push(
    { label: t('list.menu.toRelative'), onSelect: () => convertCoordinates('toRelative') },
    { label: t('list.menu.toAbsolute'), onSelect: () => convertCoordinates('toAbsolute') },
    'separator',
    { label: t('list.menu.allToOneRow'), tip: t('list.menu.allToOneRowTip'), onSelect: () => cmds.convertMode({ direction: 'toCombined' }) },
    { label: t('list.menu.allToTwoRows'), tip: t('list.menu.allToTwoRowsTip'), onSelect: () => cmds.convertMode({ direction: 'toPaired' }) },
  );
  return out;
}

/**
 * The engine's answer to a convert: the new list (actions:updated) when it changed the steps, then
 * the alert:show that says what it did; only that alert:show, saying why, when it refused. `then`
 * gets the new steps, or null for a refusal. An answer that never comes is let go after 5 s.
 */
function afterConvert(subscribe: StepMenuContext['subscribe'], then: (steps: ActionItem[] | null) => void) {
  let steps: ActionItem[] | null = null;
  let timer = 0;
  const off = subscribe((message) => {
    if (message.type === 'actions:updated') steps = message.payload.actions;
    else if (message.type === 'alert:show') {
      off();
      window.clearTimeout(timer);
      then(steps);
    }
  });
  timer = window.setTimeout(off, 5000);
}

/** More ▸: the rarer tools. */
function moreEntries(ctx: StepMenuContext): MenuEntry[] {
  const { steps, row, targets, cmds } = ctx;
  const step = steps[row];
  const type = step.actionType;
  const copy = (text: string, done: string) => {
    navigator.clipboard.writeText(text)
      .then(() => ctx.toast(done, 'success'))
      .catch(() => ctx.toast(t('list.menu.copyFailed'), 'error'));
  };
  const out: MenuEntry[] = [
    // The whole list, as a table (the engine's own format).
    { label: t('list.menu.copyTable'), icon: Table2, onSelect: () => cmds.copy({}) },
  ];
  if (isCoordinateClick(type) && !step.atCursor) {
    out.push({ label: t('list.menu.copyCoordinates'), icon: Crosshair, onSelect: () => copy(`${step.x}, ${step.y}`, t('list.menu.coordinatesCopied', { x: step.x, y: step.y })) });
  } else if (type === 'BrowserNavigate') {
    out.push({ label: t('list.menu.copyUrl'), icon: Link, onSelect: () => copy(step.key ?? '', t('list.menu.urlCopied')) });
  } else if (type.startsWith('Browser')) {
    out.push({ label: t('list.menu.copySelector'), icon: Code2, onSelect: () => copy(step.key ?? '', t('list.menu.selectorCopied')) });
  } else if (type === 'SendText') {
    out.push({ label: t('list.menu.copyText'), icon: Code2, onSelect: () => copy(step.key ?? '', t('list.menu.textCopied')) });
  }
  out.push('separator', {
    label: t('list.menu.selectSimilar'),
    icon: CheckCheck,
    onSelect: () => {
      const key = similarKey(step);
      const similar = steps.flatMap((s, i) => (s.actionType === type && similarKey(s) === key ? [i] : []));
      ctx.select(similar);
      ctx.toast(t('list.menu.selectedSimilar', { count: similar.length, n: fmtNum(similar.length) }), 'success');
    },
  });
  if (isFocusClickEligible(type)) {
    const clicks = targets.filter(i => isFocusClickEligible(steps[i]?.actionType ?? ''));
    out.push({
      label: t('list.menu.focusClick', { count: clicks.length, n: fmtNum(clicks.length) }),
      icon: Focus,
      checked: clicks.length > 0 && clicks.every(i => steps[i].isFocusClick),
      tip: t('list.menu.focusClickTip'),
      onSelect: () => cmds.toggleFocusClick({ indices: clicks }),
    });
  }
  // Folding key presses: contiguous Down + Up pairs of one key into a Keystroke × N, and back.
  const contiguous = targets.every((v, i) => i === 0 || v === targets[i - 1] + 1);
  const collapse = contiguous ? canCollapse(targets.map(i => steps[i])) : null;
  const expandOk = targets.length === 1 && canExpand(steps[targets[0]]);
  out.push(
    'separator',
    {
      label: t('list.menu.collapse'),
      icon: ChevronsDownUp,
      disabled: !collapse,
      tip: collapse ? t('list.menu.collapseTip', { count: collapse.count, n: fmtNum(collapse.count) }) : t('list.menu.collapseHint'),
      onSelect: () => {
        if (!collapse) return;
        // The new step has a new id: it is selected when it lands, not by the ids of before.
        arrival.expect(targets[0], useShell.getState().app.activeProfile ?? null);
        cmds.replaceRange({
          startIndex: targets[0],
          count: targets.length,
          replacement: [{ actionType: 'Keystroke', key: collapse.key, delay: collapse.delay, repeatCount: collapse.count, repeatDelayMs: collapse.repeatDelayMs, comment: collapse.comment }],
        });
      },
    },
    {
      label: t('list.menu.expand'),
      icon: ChevronsUpDown,
      disabled: !expandOk,
      tip: expandOk ? t('list.menu.expandTip') : t('list.menu.expandHint'),
      onSelect: () => {
        if (!expandOk) return;
        const replacement = expandKeystroke(steps[targets[0]]);
        arrival.expect(targets[0], useShell.getState().app.activeProfile ?? null, undefined, replacement.length);
        cmds.replaceRange({ startIndex: targets[0], count: 1, replacement });
      },
    },
  );
  return out;
}

/** What Delete takes, named: a lone If its block, a loop opener its loop, an Else If its arm; a lone closer what the snap gives it. */
function deleteScope(sel: number[], steps: ActionItem[]): 'block' | 'loop' | 'arm' | 'rows' {
  if (sel.length !== 1) return 'rows';
  const type = steps[sel[0]]?.actionType;
  if (type === 'If') return 'block';
  if (type === 'While' || type === 'ForEachRow') return 'loop';
  if (type === 'ElseIf') return 'arm';
  if (snapIndicesToBlocks(sel, steps).length > 1) return type === 'EndLoop' ? 'loop' : 'block';
  return 'rows';
}

/**
 * What makes two steps "the same" for Select similar: the type, and the thing the step is about —
 * the image, the pixel, the window or process, the clipboard text, the screen region and its rule —
 * else the key and the point.
 */
function similarKey(s: ActionItem): string {
  const c = hasConditionFields(s.actionType) ? s.conditionType : null;
  if (s.actionType === 'WaitImage' || c === 'ImageFound') return `image:${s.imagePath ?? ''}`;
  if (s.actionType === 'WaitPixelColor' || c === 'PixelColorMatch') return `pixel:${s.pixelX ?? ''}:${s.pixelY ?? ''}:${s.pixelColor ?? ''}`;
  if (s.actionType === 'ActivateWindow' || c === 'WindowOpen' || c === 'ProcessRunning') return `window:${s.windowProcessName ?? ''}:${s.windowTitle ?? ''}`;
  if (c === 'ClipboardMatch') return `clipboard:${s.clipboardPattern ?? ''}`;
  if (s.actionType === 'WaitText' || c === 'ScreenText') {
    return `text:${s.waitImageSearchX ?? ''},${s.waitImageSearchY ?? ''},${s.waitImageSearchW ?? ''},${s.waitImageSearchH ?? ''}:${s.ocrReadAs ?? ''}:${s.conditionOperator ?? ''}:${s.conditionOperand ?? ''}`;
  }
  return `default:${s.key}:${s.x}:${s.y}`;
}
