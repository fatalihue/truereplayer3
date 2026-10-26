import { useEffect, useRef, useState } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useBridge } from '../../bridge/BridgeContext';
import { newRequestId, useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { useLanguage, useTt } from '../../state/LanguageContext';
import { useToast } from '../../state/ToastContext';
import { CLICK_COORD_TOLERANCE_PX, clickDefaultGap } from '../../utils/actionCost';
import { clickFormOf, formatMs, isClickHold, isCombinedClick, isFocusClickEligible } from '../../utils/displayUtils';
import { useApp } from '../store';
import { Chips, DraftField, Section, Segmented, Switch, Vary } from './fields';
import { applyEdits, durationStep, type StepEdit } from './inspectorState';

type Button = 'Left' | 'Right' | 'Middle';
type Kind = 'single' | 'double' | 'triple' | 'hold';

const BUTTONS: Button[] = ['Left', 'Right', 'Middle'];
const HOLD_CHIPS = [100, 500, 1000, 5000];
const COORD = 2_000_000;
const DEFAULT_HOLD_MS = 1000;

const kindOf = (t: string): Kind =>
  t === 'DoubleClick' ? 'double' : t === 'TripleClick' ? 'triple' : isClickHold(t) ? 'hold' : 'single';
const buttonOf = (t: string): Button =>
  (t === 'DoubleClick' || t === 'TripleClick' ? 'Left' : t.replace(/Click(Hold|Down|Up)?$/, '')) as Button;
/** The type for a button and a kind; a half stays a half (the replay dispatches on the suffix). */
const compose = (button: Button, kind: Kind, form: '' | 'Down' | 'Up') =>
  kind === 'double' ? 'DoubleClick' : kind === 'triple' ? 'TripleClick' : kind === 'hold' ? `${button}ClickHold` : `${button}Click${form}`;

/** "640, 512", "640,512", "640;512" or "640 512" — a point copied from anywhere. */
const POINT = /^\s*\(?\s*(-?\d{1,7})\s*[,; ]\s*(-?\d{1,7})\s*\)?\s*$/;

/**
 * ⑧ Left Click, and every click: the button, how many clicks (Hold is the fourth), where — this
 * point or wherever the cursor is — with Pick from screen and Paste (D15), the repeat with its two
 * variations, the hold's duration, the focus click, and an optional release point that makes the
 * step a drag (D14). Each control applies at once; a summary under them says what the step does
 * (D13). A half of a click (Down or Up) keeps its form: only its button and point change here.
 */
export function ClickEditor({ step, index, steps, locked }: { step: ActionItem; index: number; steps: ActionItem[]; locked: boolean }) {
  const cmds = useSteps();
  const tools = useEditorTools();
  const { send, subscribe } = useBridge();
  const { showToast } = useToast();
  const { language } = useLanguage();
  const tt = useTt();
  const target = useApp(a => {
    const p = a.profiles.find(x => x.name === a.activeProfile);
    return p?.effectiveUseRelativeCoordinates ? (p.effectiveTargetWindowTitle || p.effectiveTargetProcessName || '') : null;
  });
  const id = step.id ?? '';
  const t = step.actionType;
  const form = clickFormOf(t);
  const kind = kindOf(t);
  const button = buttonOf(t);
  const combined = isCombinedClick(t);
  const atCursor = combined && !!step.atCursor;
  const repeat = step.repeatCount ?? 1;
  const multi = kind === 'double' || kind === 'triple';
  const next = steps[index + 1];
  const pairedUp = form === 'Down' && next && next.actionType === `${button}ClickUp` ? next : null;
  const prev = steps[index - 1];
  const pairedDown = form === 'Up' && prev && prev.actionType === `${button}ClickDown` ? prev : null;

  const edit = (edits: StepEdit[]) => applyEdits(cmds, id, edits);
  // What the point was before a pick or a paste: "Was 640, 512 · Ctrl+Z undoes".
  const [was, setWas] = useState<{ x: number; y: number } | null>(null);
  const setPoint = (x: number, y: number) => {
    setWas({ x: step.x, y: step.y });
    edit([{ field: 'x', value: String(x) }, { field: 'y', value: String(y) }]);
  };

  // The engine's answers (a picked point, the clipboard) land in the latest of these (set below).
  const answer = useRef<{ point: (what: 'press' | 'release', x: number, y: number) => void }>({ point: () => {} });

  // Pick from screen: the next click anywhere is the point, applied at once (ScreenCapture board).
  const [picking, setPicking] = useState<null | 'press' | 'release'>(null);
  const pickRef = useRef<{ requestId: string; what: 'press' | 'release' } | null>(null);
  // Paste (D15): a point from the clipboard, read through the engine (the page cannot read it).
  const [pasteFailed, setPasteFailed] = useState(false);
  const pasteWait = useRef(false);
  useEffect(() => subscribe((message) => {
    if (message.type === 'mouse:positionPicked') {
      const pending = pickRef.current;
      if (!pending || message.payload.requestId !== pending.requestId) return;
      pickRef.current = null;
      setPicking(null);
      const { cancelled, refused, x, y } = message.payload;
      if (refused) showToast(tt('Another pick is open — finish it first.', 'Outra captura está aberta — termine-a primeiro.'), 'error');
      else if (!cancelled && x != null && y != null) answer.current.point(pending.what, x, y);
    } else if (message.type === 'clipboard:content' && pasteWait.current) {
      pasteWait.current = false;
      const m = POINT.exec(message.payload.text ?? '');
      if (m) answer.current.point('press', Number(m[1]), Number(m[2]));
      else setPasteFailed(true);
    }
  }), [subscribe, showToast, tt]);
  const pick = (what: 'press' | 'release') => {
    const requestId = newRequestId();
    pickRef.current = { requestId, what };
    setPicking(what);
    tools.pickPosition({ requestId });
  };
  useEffect(() => {
    if (!pasteFailed) return;
    const timer = setTimeout(() => setPasteFailed(false), 1500);
    return () => clearTimeout(timer);
  }, [pasteFailed]);
  const paste = () => {
    pasteWait.current = true;
    send({ type: 'clipboard:read', payload: {} });
  };

  // Release at (D14): a point for the release makes the click a drag — two steps, Down then Up, in
  // one undo entry. Within 2 px it would be one click again, so it is refused with the reason.
  const [release, setReleaseText] = useState<{ x: string; y: string }>({ x: '', y: '' });
  const [releaseNote, setReleaseNote] = useState<string | null>(null);
  const setRelease = (x: number, y: number) => {
    if (Math.abs(x - step.x) <= CLICK_COORD_TOLERANCE_PX && Math.abs(y - step.y) <= CLICK_COORD_TOLERANCE_PX) {
      setReleaseText({ x: String(x), y: String(y) });
      setReleaseNote('Release within 2 px of the press — the app reads that as one click, not a drag.');
      return;
    }
    setReleaseNote(null);
    setReleaseText({ x: '', y: '' });
    // The press keeps the step's id (it stays selected); the release is a new step.
    const half = { ...without(step, 'rowNumber'), repeatCount: 1, repeatDelayMs: null, repeatDelayJitterPct: null, repeatPositionJitterPx: null, atCursor: false, isFocusClick: false, holdDurationMs: 0 };
    const noId = without(half, 'id');
    cmds.replaceRange({
      startIndex: index,
      count: 1,
      replacement: [
        { ...half, actionType: `${button}ClickDown` },
        { ...noId, actionType: `${button}ClickUp`, x, y, delay: 0, comment: '' },
      ],
    });
  };
  const commitRelease = (text: { x: string; y: string }) => {
    setReleaseText(text);
    const x = Number.parseInt(text.x, 10);
    const y = Number.parseInt(text.y, 10);
    if (text.x === '' && text.y === '') setReleaseNote(null);
    else if (!Number.isFinite(x) || !Number.isFinite(y)) setReleaseNote('A drag needs both X and Y for the release.');
    else setRelease(Math.max(-COORD, Math.min(COORD, x)), Math.max(-COORD, Math.min(COORD, y)));
  };
  /** One click again: the drag's two steps become the press, at its own point. */
  const mergeDrag = () => {
    if (!pairedUp) return;
    cmds.replaceRange({ startIndex: index, count: 2, replacement: [{ ...without(step, 'rowNumber'), actionType: `${button}Click` }] });
  };
  const canDrag = form === '' && kind === 'single' && !atCursor && repeat <= 1 && !step.isFocusClick;
  useEffect(() => {
    answer.current.point = (what, x, y) => {
      if (what === 'press') setPoint(x, y);
      else setRelease(x, y);
    };
  });

  const switchKind = (nextKind: Kind) => {
    const nextType = compose(button, nextKind, form);
    const edits: StepEdit[] = [{ field: 'actionType', value: nextType }];
    // A gap still on the old type's default follows the new one (30 ms single, 600 ms double and
    // triple): untouched means "the default", and 30 ms between double-clicks blurs them into one.
    const fromGap = clickDefaultGap(t);
    const toGap = clickDefaultGap(nextType);
    if (fromGap !== toGap && step.repeatDelayMs === fromGap) edits.push({ field: 'repeatDelayMs', value: String(toGap) });
    edit(edits);
  };

  const where = atCursor ? 'wherever the mouse is' : `at ${step.x}, ${step.y}`;
  const gap = step.repeatDelayMs ?? clickDefaultGap(t);
  const times = form === '' && repeat > 1 ? ` · ${repeat}×, ${formatMs(gap, language)} ms apart` : '';
  const btn = button.toLowerCase();
  const summary = form === 'Down'
    ? pairedUp
      ? `Presses the ${btn} button ${where}, then releases at ${pairedUp.x}, ${pairedUp.y}${dragged(step, pairedUp) ? ' — a drag' : ''}.`
      : `Presses the ${btn} button ${where} and keeps it down.`
    : form === 'Up' ? `Releases the ${btn} button ${where}.`
    : kind === 'hold' ? `Presses the ${btn} button ${where}, holds ${formatMs(step.holdDurationMs || DEFAULT_HOLD_MS, language)} ms, releases.`
    : kind === 'double' ? `Double-clicks ${where}${times}.`
    : kind === 'triple' ? `Triple-clicks ${where}${times}.`
    : `Clicks the ${btn} button ${where}${times}.`;

  return (
    <>
      <Section label="Button">
        <Segmented<Button>
          label="Mouse button"
          value={button}
          options={BUTTONS.map(b => ({ value: b, label: b, disabled: multi, tip: multi ? tt('Double and triple clicks use the left button', 'Duplo e triplo clicam com o botão esquerdo') : undefined }))}
          onChange={(b) => edit([{ field: 'actionType', value: compose(b, kind, form) }])}
          disabled={locked}
        />
      </Section>
      <Section label="Clicks" hint={form ? 'A half of a click keeps its form; Convert ▸ in the step menu joins the two.' : undefined}>
        <Segmented<Kind>
          label="Clicks"
          value={kind}
          options={([
            { value: 'single', label: 'Single' },
            { value: 'double', label: 'Double', tip: tt('Left button only', 'Só o botão esquerdo') },
            { value: 'triple', label: 'Triple', tip: tt('Left button only — selects a paragraph', 'Só o botão esquerdo — seleciona um parágrafo') },
            { value: 'hold', label: 'Hold', tip: tt('Press, wait, release — still one step', 'Aperta, espera, solta — ainda um passo') },
          ] satisfies { value: Kind; label: string; tip?: string }[]).map(o => ({ ...o, disabled: form !== '' }))}
          onChange={switchKind}
          disabled={locked}
        />
      </Section>
      {kind === 'hold' && (
        <Section label="Hold">
          <DraftField stepId={id} field="holdDurationMs" label="Hold duration in milliseconds" kind="int" min={10} max={60000} step={durationStep} unit="ms" stored={String(step.holdDurationMs || DEFAULT_HOLD_MS)} disabled={locked} />
          <Chips values={HOLD_CHIPS} current={step.holdDurationMs || DEFAULT_HOLD_MS} onPick={(ms) => edit([{ field: 'holdDurationMs', value: String(ms) }])} disabled={locked} />
        </Section>
      )}
      <Section
        label="Position"
        hint={!atCursor && target !== null
          ? `Relative to ${target || 'the target window'}'s top-left corner`
          : undefined}
      >
        <Segmented<'point' | 'cursor'>
          label="Click position source"
          value={atCursor ? 'cursor' : 'point'}
          options={[
            { value: 'point', label: 'This point' },
            { value: 'cursor', label: 'At cursor', disabled: !combined, tip: tt('Wherever the mouse is at run time', 'Onde o mouse estiver na hora') },
          ]}
          onChange={(v) => edit([{ field: 'atCursor', value: v === 'cursor' ? 'true' : 'false' }])}
          disabled={locked}
        />
        {!atCursor && (
          <>
            <div className="insp-pair">
              <DraftField stepId={id} field="x" label="X coordinate" kind="int" signed min={-COORD} max={COORD} prefix="X" stored={String(step.x)} disabled={locked} />
              <DraftField stepId={id} field="y" label="Y coordinate" kind="int" signed min={-COORD} max={COORD} prefix="Y" stored={String(step.y)} disabled={locked} />
            </div>
            <div className="insp-pair">
              <button type="button" className="insp-button" disabled={locked || picking !== null} onClick={() => pick('press')}>
                <span className="step-icon" data-icon="crosshair" />
                {picking === 'press' ? 'Picking…' : 'Pick from screen'}
              </button>
              <button
                type="button"
                className="insp-button"
                data-error={pasteFailed || undefined}
                data-tip={pasteFailed ? tt('No point like 640, 512 on the clipboard', 'Nenhum ponto como 640, 512 na área de transferência') : tt('A point copied as 640, 512', 'Um ponto copiado como 640, 512')}
                disabled={locked}
                onClick={paste}
              >
                <span className="step-icon" data-icon="clipboard-paste" />
                Paste
              </button>
            </div>
            {was && (was.x !== step.x || was.y !== step.y) && (
              <span className="insp-hint">Was {was.x}, {was.y} · Ctrl+Z undoes</span>
            )}
          </>
        )}
      </Section>
      {form === '' && (
        <Section label="Repeat">
          <div className="insp-pair">
            <DraftField stepId={id} field="repeat" label="Times to repeat" kind="int" min={1} max={999} unit="times" stored={String(repeat)} disabled={locked} />
            <DraftField
              stepId={id}
              field="repeatDelayMs"
              label="Gap between clicks (ms)"
              kind="int"
              min={0}
              max={5000}
              empty="clear"
              unit="ms gap"
              placeholder={String(clickDefaultGap(t))}
              stored={step.repeatDelayMs == null ? '' : String(step.repeatDelayMs)}
              disabled={locked || repeat <= 1}
              tip={kind === 'double' || kind === 'triple' ? tt('Keep it above your system double-click speed (~½ s).', 'Mantenha acima da velocidade de duplo-clique do sistema (~½ s).') : undefined}
            />
          </div>
          <Vary
            label="Vary the gap"
            tip={tt('Random ±% on each gap — less robotic.', 'Variação ±% aleatória em cada intervalo — menos robótico.')}
            stepId={id}
            field="repeatDelayJitterPct"
            value={step.repeatDelayJitterPct ?? 0}
            first={20}
            unit="%"
            max={100}
            disabled={locked || repeat <= 1}
            onSwitch={(v) => edit([{ field: 'repeatDelayJitterPct', value: v }])}
          />
          {combined && (
            <Vary
              label="Vary the point"
              tip={atCursor ? tt('Not at cursor — the scatter would move the cursor it reads', 'Não no cursor — o espalhamento moveria o cursor que ele lê') : tt('Random ±px on the click point — less robotic.', 'Variação ±px aleatória no ponto — menos robótico.')}
              stepId={id}
              field="repeatPositionJitterPx"
              value={step.repeatPositionJitterPx ?? 0}
              first={3}
              unit="px"
              max={500}
              disabled={locked || repeat <= 1 || atCursor}
              onSwitch={(v) => edit([{ field: 'repeatPositionJitterPx', value: v }])}
            />
          )}
        </Section>
      )}
      {isFocusClickEligible(t) && (
        <div className="insp-row">
          <Switch
            label="Focus click"
            checked={!!step.isFocusClick}
            tip={tt('Clicks twice, a few pixels apart, to focus a small target', 'Clica duas vezes, a poucos pixels, para focar um alvo pequeno')}
            onChange={() => cmds.toggleFocusClick({ indices: [index] })}
            disabled={locked}
          />
          <span className="insp-row-label">Focus click</span>
        </div>
      )}
      {canDrag && (
        <Section label="Release at" hint={releaseNote ?? 'Leave it empty and the release lands on the press point.'}>
          <div className="insp-pair">
            <ReleaseField label="Release X coordinate" prefix="X" text={release.x} disabled={locked} onCommit={(x) => commitRelease({ ...release, x })} />
            <ReleaseField label="Release Y coordinate" prefix="Y" text={release.y} disabled={locked} onCommit={(y) => commitRelease({ ...release, y })} />
          </div>
          <button type="button" className="insp-button" disabled={locked || picking !== null} onClick={() => pick('release')}>
            <span className="step-icon" data-icon="crosshair" />
            {picking === 'release' ? 'Picking…' : 'Pick the release'}
          </button>
        </Section>
      )}
      {pairedUp && (
        <Section label="Release at" hint={dragged(step, pairedUp) ? undefined : 'Within 2 px of the press — the app reads it as one click.'}>
          <div className="insp-pair">
            <DraftField stepId={pairedUp.id ?? ''} field="x" label="Release X coordinate" kind="int" signed min={-COORD} max={COORD} prefix="X" stored={String(pairedUp.x)} disabled={locked} />
            <DraftField stepId={pairedUp.id ?? ''} field="y" label="Release Y coordinate" kind="int" signed min={-COORD} max={COORD} prefix="Y" stored={String(pairedUp.y)} disabled={locked} />
          </div>
          <button type="button" className="insp-button" disabled={locked} onClick={mergeDrag}>Make it one click</button>
        </Section>
      )}
      {pairedDown && <span className="insp-hint">Releases the button pressed in step {index}.</span>}
      <p className="insp-summary" aria-live="polite">{summary}</p>
    </>
  );
}

/** A copy of a step without some of its fields (what replaceRange should not carry over). */
function without<T extends object, K extends keyof T>(o: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...o };
  for (const k of keys) delete copy[k];
  return copy;
}

const dragged = (down: ActionItem, up: ActionItem) =>
  Math.abs(up.x - down.x) > CLICK_COORD_TOLERANCE_PX || Math.abs(up.y - down.y) > CLICK_COORD_TOLERANCE_PX;

/** A release coordinate, kept here until both are typed (it is not a field of the step yet). */
function ReleaseField({ label, prefix, text, disabled, onCommit }: { label: string; prefix: string; text: string; disabled: boolean; onCommit: (text: string) => void }) {
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => {
    if (typed === null) return;
    setTyped(null);
    onCommit(typed);
  };
  return (
    <label className="insp-box" data-disabled={disabled || undefined}>
      <span className="insp-box-prefix">{prefix}</span>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        className="insp-mono"
        value={typed ?? text}
        disabled={disabled}
        placeholder="—"
        autoComplete="off"
        onChange={(e) => {
          const raw = e.target.value;
          const minus = raw.trim().startsWith('-') ? '-' : '';
          setTyped(minus + raw.replace(/\D/g, '').slice(0, 7));
        }}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        onBlur={commit}
      />
    </label>
  );
}
