import { lazy, Suspense, type ReactNode } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { formatKeyCombo, formatMs, getDisplayKey, isClickHold, isCombinedClick, isCoordinateClick } from '../../utils/displayUtils';
import { isNumberMode, screenTextSummary } from '../../utils/screenText';

// The Send Text cell carries the engine's token grammar; it loads with the first Send Text step.
const SendTextCell = lazy(() => import('./SendTextCell'));

type Language = 'en' | 'pt-BR';
type Tt = (en: string, pt: string) => string;

/**
 * The Details cell of a step: what it acts on, in one line (lista-003). A plain function, not a
 * component, so a row costs no extra component instance; it is called by the row, which the
 * React Compiler memoizes on the step.
 *
 * Where the concept changed a summary, this follows it: a condition names its family ("Image
 * found", "Pixel color"), a Wait Image reads "95% · up to 10 s", a Pause "F8 or 3,000 ms" and a
 * While's ceiling "max 20×".
 */
export function stepDetails(step: ActionItem, dataRows: number, language: Language, tt: Tt): ReactNode {
  const t = step.actionType;
  if (t === 'If' || t === 'ElseIf' || t === 'While' || t === 'Assert') return condition(step, language);
  switch (t) {
    case 'WaitImage': {
      const parts = [`${Math.round((step.confidence ?? 0.8) * 100)}%`];
      if ((step.timeout ?? 0) > 0) parts.push(`up to ${seconds(step.timeout!)}`);
      return <>{thumb(step)}<span className="step-mono">{parts.join(' · ')}</span></>;
    }
    case 'WaitPixelColor':
      return pixel(step);
    case 'WaitText':
      return <span className="step-mono">{step.waitMode === 'changes' ? 'changes' : screenTextSummary(step)}</span>;
    case 'Pause': {
      const key = step.key ? getDisplayKey(step.key) : '';
      const ms = step.timeout ?? 0;
      if (key && ms > 0) return <span className="step-mono">{key} or {msText(ms, language)}</span>;
      if (key) return <span className="step-mono">{key}</span>;
      if (ms > 0) return <span className="step-mono">{msText(ms, language)}</span>;
      return <span className="step-quiet">Skipped: no key and no time</span>;
    }
    case 'HoldKey':
      return <span className="step-mono">{formatKeyCombo(step.key)} for {msText(holdMs(step), language)}</span>;
    case 'Keystroke':
      return <span className="step-mono step-combo">{formatKeyCombo(step.key)}</span>;
    case 'SendText':
      return (
        <span className="step-mono step-cut" data-tip={step.key} data-tip-reveal="">
          <Suspense fallback={step.key}>
            <SendTextCell step={step} tt={tt} />
          </Suspense>
        </span>
      );
    case 'SetVariable':
      return cut(setVariable(step));
    case 'CopyToSlot':
      return cut(step.slotMode === 'clear'
        ? (!step.key ? 'clear all slots' : `clear {clip:${step.key.toLowerCase()}}`)
        : (!step.key ? '' : `selection → {clip:${step.key.toLowerCase()}}`));
    case 'ActivateWindow':
      return cut(activateWindow(step));
    case 'RunProfile':
      return <span className="step-cut" data-tip={step.key} data-tip-reveal="">{step.key}</span>;
    case 'ForEachRow':
      return <span className="step-mono">{dataRows === 1 ? '1 row' : `${dataRows} rows`}</span>;
  }
  if (t.startsWith('Browser')) return cut(step.key ?? '');
  if (isCoordinateClick(t)) {
    const point = step.atCursor && isCombinedClick(t) ? '' : `${step.x}, ${step.y}`;
    const hold = isClickHold(t) ? msText(holdMs(step), language) : '';
    return <span className="step-mono">{[point, hold].filter(Boolean).join(' · ')}</span>;
  }
  return <span className="step-mono">{getDisplayKey(step.key)}</span>;
}

// ── conditions ──

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

const OPERATOR: Record<string, string> = { neq: '≠', contains: 'has', gt: '>', lt: '<' };

function condition(step: ActionItem, language: Language): ReactNode {
  const c = step.conditionType ?? '';
  let value: ReactNode = null;
  switch (c) {
    case 'ImageFound': value = thumb(step); break;
    case 'PixelColorMatch': value = pixel(step); break;
    case 'WindowOpen': value = mono([step.windowProcessName, step.windowTitle].filter(Boolean).join(' · ')); break;
    case 'ClipboardMatch': value = mono(step.clipboardPattern ?? ''); break;
    case 'BrowserElementState': value = mono(step.key ?? ''); break;
    case 'Random': value = mono(`${step.randomPercent ?? 0}%`); break;
    case 'Variable': value = step.key ? mono(`${step.key} ${OPERATOR[step.conditionOperator ?? 'eq'] ?? '='} ${step.conditionOperand ?? ''}`) : null; break;
    case 'ProcessRunning': value = mono(step.windowProcessName ?? ''); break;
    case 'FileExists': value = mono(step.filePath ?? ''); break;
    case 'TimeWindow': value = mono(timeWindow(step)); break;
    case 'ScreenText': value = mono(screenTextSummary(step)); break;
  }
  const cap = step.actionType === 'While' && (step.loopMaxIterations ?? 0) > 0
    ? <span className="step-mono"> · max {formatMs(step.loopMaxIterations!, language)}×</span>
    : null;
  return (
    <>
      <span className="step-family">{FAMILY[c] ?? c}</span>
      {value}
      {cap}
    </>
  );
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

function timeWindow(step: ActionItem): string {
  const mask = (step.daysOfWeek ?? 0) & 0x7F;
  let days = '';
  if (mask !== 0 && mask !== 0x7F) {
    if (mask === 0b0111110) days = 'Mon–Fri';
    else if (mask === 0b1000001) days = 'Sat–Sun';
    else days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].filter((_, d) => (mask & (1 << d)) !== 0).join(',');
  }
  const time = step.timeStart && step.timeEnd ? `${step.timeStart}–${step.timeEnd}` : '';
  return [days, time].filter(Boolean).join(' ');
}

// ── the other summaries, as the shell of today writes them ──

function setVariable(step: ActionItem): string {
  if (!step.key) return '';
  if (step.variableMode === 'cycle') {
    const n = (step.variableValue ?? '').split('\n').filter(l => l.trim()).length;
    return `${step.key} ⟳ ${n === 1 ? '1 item' : `${n} items`}`;
  }
  if (step.variableMode === 'add') return `${step.key} += ${step.variableValue ?? ''}`;
  if (step.variableMode === 'screen') return `${step.key} ← screen${isNumberMode(step.ocrReadAs) ? ' #' : ''}`;
  return `${step.key} = ${step.variableValue ?? ''}`;
}

function activateWindow(step: ActionItem): string {
  const matcher = [step.windowProcessName, step.windowTitle].filter(s => s && s.trim()).join(' · ');
  const verb = step.windowVerb === 'maximize' ? 'Maximize · '
    : step.windowVerb === 'minimize' ? 'Minimize · '
    : step.windowVerb === 'close' ? 'Close · ' : '';
  const nth = step.windowMatchIndex && step.windowMatchIndex > 1 ? ` #${step.windowMatchIndex}` : '';
  // Maximize launches on a miss too; only Minimize and Close never do.
  const launches = !!step.launchPath?.trim() && step.windowVerb !== 'minimize' && step.windowVerb !== 'close';
  if (matcher) return `${verb}${matcher}${nth}${launches ? ' — launch' : ''}`;
  return step.launchPath ? `run: ${step.launchPath}` : '';
}

const holdMs = (step: ActionItem) => (step.holdDurationMs && step.holdDurationMs > 0 ? step.holdDurationMs : 1000);

function seconds(ms: number): string {
  return ms % 1000 === 0 ? `${ms / 1000} s` : `${(ms / 1000).toFixed(1)} s`;
}

const msText = (ms: number, language: Language) => `${formatMs(ms, language)} ms`;

const mono = (text: string) => (text ? <span className="step-mono step-cut" data-tip={text} data-tip-reveal="">{text}</span> : null);
const cut = (text: string) => mono(text);
