import {
  Brackets, CheckCheck, ChevronsDownUp, ChevronsUpDown, ClipboardCopy, ClipboardPaste, Code2, Combine, Crosshair,
  Eye, EyeOff, Files, Focus, Link, MoreHorizontal, MousePointerClick, Pencil, Repeat, RotateCcw, Split, Table2, Trash2,
} from 'lucide-react';
import type { ActionItem } from '../../bridge/messageTypes';
import { deleteIntent, type useSteps } from '../../logic/useSteps';
import { hasConditionFields, isStructuralRow, snapIndicesToBlocks } from '../../utils/conditionalBlocks';
import { CLICK_FAMILY_TYPES, clickFormOf, isCoordinateClick, isFocusClickEligible } from '../../utils/displayUtils';
import { canCollapse, canExpand, expandKeystroke } from '../../utils/keyRepeat';
import type { MenuEntry } from '../Menu';
import { useShell } from '../store';
import { scopeOf, type BlockMap } from './blocks';
import { arrival } from './selection';

type Tt = (en: string, pt: string) => string;

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
  select: (indices: number[]) => void;
  toast: (message: string, kind?: 'success' | 'error' | 'info') => void;
  tt: Tt;
}

/**
 * The step's right-click menu (lista-054 and on): the concept's order — Edit, Pick from screen,
 * Change click type, Duplicate, Copy, Paste below, Skip, Convert, More, Delete — with the items
 * the inventory adds (Select block and the More tools, D8; One row / Two rows under Convert, D14).
 * Every item acts on the selection when the step is in it, else on the step alone, and says how
 * many rows that is. The scope rules are the ones the list keeps everywhere: a lone If, loop or
 * Else If takes its own block, loop or arm, and anything that touches a marker takes whole blocks.
 */
export function stepMenuEntries(ctx: StepMenuContext): MenuEntry[] {
  const { steps, blocks, row, targets, cmds, tt } = ctx;
  const step = steps[row];
  if (!step) return [];
  const t = step.actionType;
  const count = (n: number) => (n > 1 ? ` (${n})` : '');
  const duplicateSet = scopeOf(targets, steps, blocks);
  const del = deleteIntent(targets, steps, (o) => blocks.closerOf.get(o));
  const delScope = deleteScope(targets, steps);
  const allSkipped = targets.every(i => steps[i]?.isSkipped);
  const entries: MenuEntry[] = [
    { label: 'Edit', icon: Pencil, shortcut: 'Enter', onSelect: () => ctx.edit(row) },
  ];

  // A Set Variable in Cycle starts its list over (lista-070): right under Edit, as today. The
  // engine confirms it ("Cycle '<name>' reset to the first item").
  if (t === 'SetVariable' && step.variableMode === 'cycle') {
    entries.push({
      label: 'Reset cycle position',
      icon: RotateCcw,
      tip: tt('The next run starts at the first item of the list', 'A próxima execução começa no primeiro item da lista'),
      onSelect: () => cmds.resetCycle({ index: row }),
    });
  }

  if (isStructuralRow(t)) {
    const block = snapIndicesToBlocks([row], steps);
    if (block.length > 1) {
      entries.push({
        label: 'Select block',
        icon: Brackets,
        tip: tt('Selects the whole block, both markers included', 'Seleciona o bloco inteiro, com os dois marcadores'),
        onSelect: () => {
          ctx.select(block);
          ctx.toast(tt(`Selected ${block.length} steps`, `${block.length} passos selecionados`), 'success');
        },
      });
    }
  }

  if (isCoordinateClick(t)) {
    if (!step.atCursor) entries.push({ label: 'Pick from screen', icon: Crosshair, onSelect: () => ctx.pick(row) });
    entries.push(clickTypeEntry(ctx));
  }

  entries.push(
    'separator',
    {
      label: `Duplicate${count(duplicateSet.length)}`,
      icon: Files,
      tip: duplicateSet.length > targets.length
        ? tt('The selection touches a block marker, so whole blocks are duplicated', 'A seleção toca um marcador de bloco, então blocos inteiros são duplicados')
        : undefined,
      onSelect: () => cmds.duplicate({ indices: duplicateSet }),
    },
    // The engine says how many it copied (alert:show); a second toast here would repeat it.
    { label: `Copy${count(targets.length)}`, icon: ClipboardCopy, shortcut: 'Ctrl+C', onSelect: () => cmds.copyInternal({ indices: targets }) },
    { label: 'Paste below', icon: ClipboardPaste, shortcut: 'Ctrl+V', onSelect: () => cmds.paste({ insertIndex: row + 1 }) },
    {
      label: `${allSkipped ? 'Enable' : 'Skip'}${count(targets.length)}`,
      icon: allSkipped ? Eye : EyeOff,
      tip: allSkipped
        ? tt('Puts these steps back in the run', 'Devolve estes passos ao run')
        : tt('Keeps the steps, skips them at run time', 'Mantém os passos, pula na execução'),
      onSelect: () => {
        cmds.toggleSkip({ indices: targets });
        ctx.toast(allSkipped
          ? tt(`Enabled ${targets.length} step(s)`, `${targets.length} passo(s) ativado(s)`)
          : tt(`Skipped ${targets.length} step(s)`, `${targets.length} passo(s) pulado(s)`), 'success');
      },
    },
    'separator',
    { label: 'Convert', icon: Repeat, submenu: convertEntries(ctx) },
    { label: 'More', icon: MoreHorizontal, submenu: moreEntries(ctx) },
    'separator',
    {
      label: delScope === 'block' ? 'Delete block' : delScope === 'loop' ? 'Delete loop' : delScope === 'arm' ? 'Delete arm'
        : `Delete${count(del.count)}`,
      icon: Trash2,
      danger: true,
      shortcut: 'Del',
      tip: delScope === 'block' ? tt('Deletes the whole If block, End If included', 'Apaga o bloco If inteiro, com o End If')
        : delScope === 'loop' ? tt('Deletes the whole loop, End Loop included', 'Apaga o loop inteiro, com o End Loop')
        : delScope === 'arm' ? tt('Deletes only this Else If arm', 'Apaga só este braço Else If')
        : del.count > targets.length ? tt('The selection touches a block marker, so whole blocks go', 'A seleção toca um marcador de bloco, então blocos inteiros vão junto')
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
    label: `Change click type${clicks.length > 1 ? ` (${clicks.length})` : ''}`,
    icon: MousePointerClick,
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
function convertEntries({ steps, row, targets, cmds, convertCoordinates, tt, toast }: StepMenuContext): MenuEntry[] {
  const t = steps[row].actionType;
  const form = isCoordinateClick(t) ? clickFormOf(t) : null;
  const clicks = targets.filter(i => isCoordinateClick(steps[i]?.actionType ?? '') && clickFormOf(steps[i].actionType) === form);
  const out: MenuEntry[] = [];
  if (form === '') {
    out.push({
      label: 'Two rows',
      icon: Split,
      tip: tt('Down and Up as separate rows — needed for a drag', 'Down e Up em linhas separadas — preciso para um arrasto'),
      onSelect: () => cmds.convertMode({ direction: 'toPaired', indices: clicks }),
    });
  } else if (form === 'Down' || form === 'Up') {
    // A half means "this pair": reach for each twin rather than asking for both halves.
    const seeds = clicks.length > 1 ? clicks : [row];
    const pair = [...new Set(seeds.flatMap(i => (form === 'Down' ? [i, i + 1] : [i - 1, i])))]
      .filter(i => i >= 0 && i < steps.length)
      .sort((a, b) => a - b);
    // D14: the merge keeps the Down half. A button or a point that differs, the engine refuses and
    // says why; the notes of an Up half go in silence, so they are said at once.
    const upNotes = pair.some(i => clickFormOf(steps[i].actionType) === 'Up' && (steps[i].comment ?? '') !== ''
      && steps[i].comment !== (steps[i - 1]?.comment ?? ''));
    out.push({
      label: 'One row',
      icon: Combine,
      tip: tt('Press and release together', 'Aperta e solta juntos'),
      onSelect: () => {
        cmds.convertMode({ direction: 'toCombined', indices: pair });
        if (upNotes) toast(tt('One row keeps the Down half: the notes of the Up half are gone. Ctrl+Z brings them back.', 'Uma linha fica com a metade Down: as notas da metade Up saíram. Ctrl+Z as traz de volta.'), 'info');
      },
    });
  }
  if (out.length > 0) out.push('separator');
  out.push(
    { label: 'Coordinates to relative', onSelect: () => convertCoordinates('toRelative') },
    { label: 'Coordinates to absolute', onSelect: () => convertCoordinates('toAbsolute') },
    'separator',
    { label: 'All clicks and keys to one row', tip: tt('Joins every Down + Up pair in the macro', 'Junta todos os pares Down + Up do macro'), onSelect: () => cmds.convertMode({ direction: 'toCombined' }) },
    { label: 'All clicks and keys to two rows', tip: tt('Splits every click and key of the macro into Down + Up', 'Separa todos os cliques e teclas do macro em Down + Up'), onSelect: () => cmds.convertMode({ direction: 'toPaired' }) },
  );
  return out;
}

/** More ▸: the rarer tools. */
function moreEntries(ctx: StepMenuContext): MenuEntry[] {
  const { steps, row, targets, cmds, tt } = ctx;
  const step = steps[row];
  const t = step.actionType;
  const copy = (text: string, done: string) => {
    navigator.clipboard.writeText(text)
      .then(() => ctx.toast(done, 'success'))
      .catch(() => ctx.toast(tt('Copy failed', 'Falha ao copiar'), 'error'));
  };
  const out: MenuEntry[] = [
    // The whole list, as a table (the engine's own format).
    { label: 'Copy as table', icon: Table2, onSelect: () => cmds.copy({}) },
  ];
  if (isCoordinateClick(t) && !step.atCursor) {
    out.push({ label: 'Copy coordinates', icon: Crosshair, onSelect: () => copy(`${step.x}, ${step.y}`, tt(`Copied ${step.x}, ${step.y}`, `Copiado ${step.x}, ${step.y}`)) });
  } else if (t === 'BrowserNavigate') {
    out.push({ label: 'Copy URL', icon: Link, onSelect: () => copy(step.key ?? '', tt('URL copied', 'URL copiada')) });
  } else if (t.startsWith('Browser')) {
    out.push({ label: 'Copy selector', icon: Code2, onSelect: () => copy(step.key ?? '', tt('Selector copied', 'Seletor copiado')) });
  } else if (t === 'SendText') {
    out.push({ label: 'Copy text', icon: Code2, onSelect: () => copy(step.key ?? '', tt('Text copied', 'Texto copiado')) });
  }
  out.push('separator', {
    label: 'Select similar',
    icon: CheckCheck,
    onSelect: () => {
      const key = similarKey(step);
      const similar = steps.flatMap((s, i) => (s.actionType === t && similarKey(s) === key ? [i] : []));
      ctx.select(similar);
      ctx.toast(tt(`Selected ${similar.length} similar step(s)`, `${similar.length} passo(s) semelhante(s) selecionado(s)`), 'success');
    },
  });
  if (isFocusClickEligible(t)) {
    const clicks = targets.filter(i => isFocusClickEligible(steps[i]?.actionType ?? ''));
    out.push({
      label: `Focus click${clicks.length > 1 ? ` (${clicks.length})` : ''}`,
      icon: Focus,
      checked: clicks.length > 0 && clicks.every(i => steps[i].isFocusClick),
      tip: tt('Clicks twice, a few pixels apart, so a small target takes the focus', 'Clica duas vezes, a poucos pixels, para um alvo pequeno pegar o foco'),
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
      label: 'Collapse to × N',
      icon: ChevronsDownUp,
      disabled: !collapse,
      tip: collapse
        ? tt(`Folds ${collapse.count} presses into one step`, `Junta ${collapse.count} pressões num passo`)
        : tt('Select adjacent Key Down + Key Up pairs of the same key', 'Selecione pares Key Down + Key Up adjacentes da mesma tecla'),
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
      label: 'Expand × N',
      icon: ChevronsUpDown,
      disabled: !expandOk,
      tip: expandOk
        ? tt('Splits it back into one step per press', 'Divide de volta num passo por pressão')
        : tt('Select one Keystroke × N step with a single key (no combo)', 'Selecione um passo Keystroke × N de tecla única (sem combo)'),
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
  const t = steps[sel[0]]?.actionType;
  if (t === 'If') return 'block';
  if (t === 'While' || t === 'ForEachRow') return 'loop';
  if (t === 'ElseIf') return 'arm';
  if (snapIndicesToBlocks(sel, steps).length > 1) return t === 'EndLoop' ? 'loop' : 'block';
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

