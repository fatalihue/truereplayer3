import { lazy, Suspense, type ReactNode } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { fmtNum, LANG, t } from '../../i18n';
import { formatKeyCombo, formatMs, getDisplayKey, isClickHold, isCombinedClick, isCoordinateClick } from '../../utils/displayUtils';
import { isNumberMode, screenTextSummary } from '../../utils/screenText';

// The Send Text cell carries the engine's token grammar; it loads with the first Send Text step.
const SendTextCell = lazy(() => import('./SendTextCell'));

/**
 * The Details cell of a step: what it acts on, in one line (lista-003). A plain function, not a
 * component, so a row costs no extra component instance; it is called by the row, which the
 * React Compiler memoizes on the step.
 *
 * Where the concept changed a summary, this follows it: a condition names its family ("Image
 * found", "Pixel color"), a Wait Image reads "95% · up to 10 s", a Pause "F8 or 3,000 ms" and a
 * While's ceiling "max 20×". The words come from the catalog (i18n/<language>/list.ts), each
 * summary a whole phrase; the families are glossary and stay as they are.
 */
export function stepDetails(step: ActionItem, dataRows: number): ReactNode {
  const type = step.actionType;
  if (type === 'If' || type === 'ElseIf' || type === 'While' || type === 'Assert') return condition(step);
  switch (type) {
    case 'WaitImage': {
      const parts = [`${Math.round((step.confidence ?? 0.8) * 100)}%`];
      if ((step.timeout ?? 0) > 0) parts.push(t('list.details.upTo', { seconds: seconds(step.timeout!) }));
      return <>{thumb(step)}<span className="step-mono">{parts.join(' · ')}</span></>;
    }
    case 'WaitPixelColor':
      return pixel(step);
    case 'WaitText':
      return <span className="step-mono">{step.waitMode === 'changes' ? t('list.details.changes') : screenTextSummary(step)}</span>;
    case 'Pause': {
      const key = step.key ? getDisplayKey(step.key) : '';
      const ms = step.timeout ?? 0;
      if (key && ms > 0) return <span className="step-mono">{t('list.details.keyOrTime', { key, ms: formatMs(ms) })}</span>;
      if (key) return <span className="step-mono">{key}</span>;
      if (ms > 0) return <span className="step-mono">{msText(ms)}</span>;
      return <span className="step-quiet">{t('list.details.skipped')}</span>;
    }
    case 'HoldKey':
      return <span className="step-mono">{t('list.details.holdFor', { key: formatKeyCombo(step.key), ms: formatMs(holdMs(step)) })}</span>;
    case 'Keystroke':
      return <span className="step-mono step-combo">{formatKeyCombo(step.key)}</span>;
    case 'SendText':
      return (
        <span className="step-mono step-cut" data-tip={step.key} data-tip-reveal="">
          <Suspense fallback={step.key}>
            <SendTextCell step={step} />
          </Suspense>
        </span>
      );
    case 'SetVariable':
      return cut(setVariable(step));
    case 'CopyToSlot':
      return cut(copyToSlot(step));
    case 'ActivateWindow':
      return cut(activateWindow(step));
    case 'RunProfile':
      return <span className="step-cut" data-tip={step.key} data-tip-reveal="">{step.key}</span>;
    case 'ForEachRow':
      return <span className="step-mono">{t('list.details.rows', { count: dataRows, n: fmtNum(dataRows) })}</span>;
  }
  if (type.startsWith('Browser')) return cut(step.key ?? '');
  if (isCoordinateClick(type)) {
    const point = step.atCursor && isCombinedClick(type) ? '' : `${step.x}, ${step.y}`;
    const hold = isClickHold(type) ? msText(holdMs(step)) : '';
    return <span className="step-mono">{[point, hold].filter(Boolean).join(' · ')}</span>;
  }
  return <span className="step-mono">{getDisplayKey(step.key)}</span>;
}

// ── conditions ──

// The families are glossary: the same in both languages (i18n/glossario.ts, CONDICOES).
const FAMILY: Record<string, string> = {
  ImageFound: 'Image found',
  PixelColorMatch: 'Pixel color',
  WindowOpen: 'Window open',
  ClipboardMatch: 'Clipboard',
  BrowserElementState: 'Browser element',
  Random: 'Random',
  Variable: 'Variable',
  ProcessRunning: 'Process running',
  FileExists: 'File exists',
  TimeWindow: 'Time',
  ScreenText: 'Text on screen',
};

// Contains is a word ("has"), so it is a whole phrase of the catalog; the others are symbols.
const OPERATOR: Record<string, string> = { neq: '≠', gt: '>', lt: '<' };

function condition(step: ActionItem): ReactNode {
  const c = step.conditionType ?? '';
  let value: ReactNode = null;
  switch (c) {
    case 'ImageFound': value = thumb(step); break;
    case 'PixelColorMatch': value = pixel(step); break;
    case 'WindowOpen': value = mono([step.windowProcessName, step.windowTitle].filter(Boolean).join(' · ')); break;
    case 'ClipboardMatch': value = mono(step.clipboardPattern ?? ''); break;
    case 'BrowserElementState': value = mono(step.key ?? ''); break;
    case 'Random': value = mono(`${step.randomPercent ?? 0}%`); break;
    case 'Variable': value = step.key ? mono(variable(step.key, step.conditionOperator, step.conditionOperand ?? '')) : null; break;
    case 'ProcessRunning': value = mono(step.windowProcessName ?? ''); break;
    case 'FileExists': value = mono(step.filePath ?? ''); break;
    case 'TimeWindow': value = mono(timeWindow(step)); break;
    case 'ScreenText': value = mono(screenTextSummary(step)); break;
  }
  const cap = step.actionType === 'While' && (step.loopMaxIterations ?? 0) > 0
    ? <span className="step-mono"> · {t('list.details.maxTimes', { n: fmtNum(step.loopMaxIterations!) })}</span>
    : null;
  return (
    <>
      <span className="step-family">{FAMILY[c] ?? c}</span>
      {value}
      {cap}
    </>
  );
}

function variable(name: string, operator: string | null | undefined, operand: string): string {
  if (operator === 'contains') return t('list.details.has', { name, value: operand });
  return `${name} ${OPERATOR[operator ?? 'eq'] ?? '='} ${operand}`;
}

function pixel(step: ActionItem): ReactNode {
  const at = step.pixelX != null && step.pixelY != null ? ` · ${step.pixelX}, ${step.pixelY}` : '';
  return (
    <>
      {step.pixelColor && <span className="step-swatch" style={{ background: step.pixelColor }} />}
      <span className="step-mono">{step.pixelColor}{at}</span>
    </>
  );
}

function thumb(step: ActionItem): ReactNode {
  if (step.imageBase64) return <img className="step-thumb" src={`data:image/png;base64,${step.imageBase64}`} alt="" />;
  const path = step.imagePath ?? '';
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  return name ? <span className="step-mono">{name}</span> : null;
}

// The days of the week, short, in the build's language (Intl, plan §3.4): "Mon–Fri", "seg–sex". Made
// once, when a Time condition is first drawn, not when this module loads: an Intl object is not
// free. Sunday first, as the mask counts them; the period some languages end the abbreviation with
// ("seg.") is left out, so the list stays as compact as the cell: "Sun,Tue,Thu", "dom,ter,qui".
let weekdays: string[] | undefined;
const weekday = (d: number): string => {
  if (!weekdays) {
    const f = new Intl.DateTimeFormat(LANG, { weekday: 'short', timeZone: 'UTC' });
    // 2023-01-01 was a Sunday.
    weekdays = Array.from({ length: 7 }, (_, i) => f.format(Date.UTC(2023, 0, 1 + i)).replace(/\.$/, ''));
  }
  return weekdays[d];
};

function timeWindow(step: ActionItem): string {
  const mask = (step.daysOfWeek ?? 0) & 0x7F;
  let days = '';
  if (mask !== 0 && mask !== 0x7F) {
    if (mask === 0b0111110) days = `${weekday(1)}–${weekday(5)}`;
    else if (mask === 0b1000001) days = `${weekday(6)}–${weekday(0)}`;
    else days = [0, 1, 2, 3, 4, 5, 6].filter(d => (mask & (1 << d)) !== 0).map(weekday).join(',');
  }
  const time = step.timeStart && step.timeEnd ? `${step.timeStart}–${step.timeEnd}` : '';
  return [days, time].filter(Boolean).join(' ');
}

// ── the other summaries, as the shell of today writes them ──

function setVariable(step: ActionItem): string {
  const name = step.key;
  if (!name) return '';
  if (step.variableMode === 'cycle') {
    const n = (step.variableValue ?? '').split('\n').filter(l => l.trim()).length;
    return t('list.details.cycle', { count: n, name, n: fmtNum(n) });
  }
  if (step.variableMode === 'add') return `${name} += ${step.variableValue ?? ''}`;
  if (step.variableMode === 'screen') {
    return isNumberMode(step.ocrReadAs) ? t('list.details.fromScreenNumber', { name }) : t('list.details.fromScreen', { name });
  }
  return `${name} = ${step.variableValue ?? ''}`;
}

function copyToSlot(step: ActionItem): string {
  const clip = step.key ? `{clip:${step.key.toLowerCase()}}` : '';
  if (step.slotMode === 'clear') return clip ? t('list.details.clearSlot', { clip }) : t('list.details.clearAll');
  return clip ? t('list.details.toSlot', { clip }) : '';
}

function activateWindow(step: ActionItem): string {
  const matcher = [step.windowProcessName, step.windowTitle].filter(s => s && s.trim()).join(' · ');
  const nth = step.windowMatchIndex && step.windowMatchIndex > 1 ? ` #${step.windowMatchIndex}` : '';
  // Maximize launches on a miss too; only Minimize and Close never do.
  const launches = !!step.launchPath?.trim() && step.windowVerb !== 'minimize' && step.windowVerb !== 'close';
  if (matcher) {
    const target = matcher + nth;
    switch (step.windowVerb) {
      case 'maximize': return launches ? t('list.details.window.maximizeLaunch', { window: target }) : t('list.details.window.maximize', { window: target });
      case 'minimize': return t('list.details.window.minimize', { window: target });
      case 'close': return t('list.details.window.close', { window: target });
      default: return launches ? t('list.details.window.launch', { window: target }) : target;
    }
  }
  return step.launchPath ? t('list.details.window.run', { path: step.launchPath }) : '';
}

const holdMs = (step: ActionItem) => (step.holdDurationMs && step.holdDurationMs > 0 ? step.holdDurationMs : 1000);

// Whole seconds as they are ("10"), the rest with one decimal ("1.5", "1,5"), in the build's language.
let oneDecimal: Intl.NumberFormat | undefined;
function seconds(ms: number): string {
  if (ms % 1000 === 0) return fmtNum(ms / 1000);
  return (oneDecimal ??= new Intl.NumberFormat(LANG, { minimumFractionDigits: 1, maximumFractionDigits: 1 })).format(ms / 1000);
}

// A time alone: the unit is the same in both languages.
const msText = (ms: number) => `${formatMs(ms)} ms`;

const mono = (text: string) => (text ? <span className="step-mono step-cut" data-tip={text} data-tip-reveal="">{text}</span> : null);
const cut = (text: string) => mono(text);
