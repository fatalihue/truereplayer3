import { useEffect, useRef, useState } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { useBridge } from '../../bridge/BridgeContext';
import { t, tn } from '../../i18n';
import { newRequestId, useEditorTools } from '../../logic/useEditorTools';
import { useSteps } from '../../logic/useSteps';
import { useLanguage } from '../../state/LanguageContext';
import { useToast } from '../../state/ToastContext';
import { CLICK_COORD_TOLERANCE_PX, clickDefaultGap } from '../../utils/actionCost';
import { clickFormOf, formatMs, isClickHold, isCombinedClick, isFocusClickEligible } from '../../utils/displayUtils';
import { useApp } from '../store';
import { Chips, DraftField, Section, Segmented, Switch, Vary } from './fields';
import { applyEdits, durationStep, type StepEdit } from './inspectorState';
import { useCaptureFor } from './captureFor';

type Button = 'Left' | 'Right' | 'Middle';
type Kind = 'single' | 'double' | 'triple' | 'hold';

const BUTTONS: Button[] = ['Left', 'Right', 'Middle'];
// The buttons' names: on the segmented, and inside a sentence of the summary.
const BUTTON_LABELS = tn('editors.click.buttons');
const BUTTON_WORDS = tn('editors.click.buttonWord');
const HOLD_CHIPS = [100, 500, 1000, 5000];
const COORD = 2_000_000;
const DEFAULT_HOLD_MS = 1000;

const kindOf = (type: string): Kind =>
  type === 'DoubleClick' ? 'double' : type === 'TripleClick' ? 'triple' : isClickHold(type) ? 'hold' : 'single';
const buttonOf = (type: string): Button =>
  (type === 'DoubleClick' || type === 'TripleClick' ? 'Left' : type.replace(/Click(Hold|Down|Up)?$/, '')) as Button;
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
  const captureFor = useCaptureFor();
  const { send, subscribe } = useBridge();
  const { showToast } = useToast();
  const { language } = useLanguage();
  const target = useApp(a => {
    const p = a.profiles.find(x => x.name === a.activeProfile);
    return p?.effectiveUseRelativeCoordinates ? (p.effectiveTargetWindowTitle || p.effectiveTargetProcessName || '') : null;
  });
  const id = step.id ?? '';
  const type = step.actionType;
  const form = clickFormOf(type);
  const kind = kindOf(type);
  const button = buttonOf(type);
  const combined = isCombinedClick(type);
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
      if (refused) showToast(t('list.toasts.pickBusy'), 'error');
      else if (!cancelled && x != null && y != null) answer.current.point(pending.what, x, y);
    } else if (message.type === 'clipboard:content' && pasteWait.current) {
      pasteWait.current = false;
      const m = POINT.exec(message.payload.text ?? '');
      if (m) answer.current.point('press', Number(m[1]), Number(m[2]));
      else setPasteFailed(true);
    }
  }), [subscribe, showToast]);
  const pick = (what: 'press' | 'release') => {
    const requestId = newRequestId();
    pickRef.current = { requestId, what };
    setPicking(what);
    tools.pickPosition({ requestId, captureFor });
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
      setReleaseNote(t('editors.click.releaseTooClose'));
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
    else if (!Number.isFinite(x) || !Number.isFinite(y)) setReleaseNote(t('editors.click.releaseNeedsBoth'));
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
    const fromGap = clickDefaultGap(type);
    const toGap = clickDefaultGap(nextType);
    if (fromGap !== toGap && step.repeatDelayMs === fromGap) edits.push({ field: 'repeatDelayMs', value: String(toGap) });
    edit(edits);
  };

  const gap = step.repeatDelayMs ?? clickDefaultGap(type);
  const times = form === '' && repeat > 1 ? t('editors.click.summary.times', { n: repeat, ms: formatMs(gap, language) }) : '';
  const btn = BUTTON_WORDS[button];
  // The summary (D13), a whole sentence for each case: a half of a click is never at the cursor.
  const summary = form === 'Down'
    ? pairedUp
      ? dragged(step, pairedUp)
        ? t('editors.click.summary.downDrag', { button: btn, x: step.x, y: step.y, x2: pairedUp.x, y2: pairedUp.y })
        : t('editors.click.summary.downThen', { button: btn, x: step.x, y: step.y, x2: pairedUp.x, y2: pairedUp.y })
      : t('editors.click.summary.down', { button: btn, x: step.x, y: step.y })
    : form === 'Up' ? t('editors.click.summary.up', { button: btn, x: step.x, y: step.y })
    : kind === 'hold'
      ? atCursor
        ? t('editors.click.summary.holdCursor', { button: btn, ms: formatMs(step.holdDurationMs || DEFAULT_HOLD_MS, language) })
        : t('editors.click.summary.hold', { button: btn, x: step.x, y: step.y, ms: formatMs(step.holdDurationMs || DEFAULT_HOLD_MS, language) })
    : kind === 'double'
      ? atCursor ? t('editors.click.summary.doubleCursor', { times }) : t('editors.click.summary.double', { x: step.x, y: step.y, times })
    : kind === 'triple'
      ? atCursor ? t('editors.click.summary.tripleCursor', { times }) : t('editors.click.summary.triple', { x: step.x, y: step.y, times })
    : atCursor ? t('editors.click.summary.singleCursor', { button: btn, times }) : t('editors.click.summary.single', { button: btn, x: step.x, y: step.y, times });

  return (
    <>
      <Section label={t('editors.click.button')}>
        <Segmented<Button>
          label={t('editors.click.buttonField')}
          value={button}
          options={BUTTONS.map(b => ({ value: b, label: BUTTON_LABELS[b], disabled: multi, tip: multi ? t('editors.click.leftOnlyTip') : undefined }))}
          onChange={(b) => edit([{ field: 'actionType', value: compose(b, kind, form) }])}
          disabled={locked}
        />
      </Section>
      <Section label={t('editors.click.clicks')} hint={form ? t('editors.click.halfHint') : undefined}>
        <Segmented<Kind>
          label={t('editors.click.clicks')}
          value={kind}
          options={([
            { value: 'single', label: t('editors.click.single') },
            { value: 'double', label: t('editors.click.double'), tip: t('editors.click.doubleTip') },
            { value: 'triple', label: t('editors.click.triple'), tip: t('editors.click.tripleTip') },
            { value: 'hold', label: t('editors.click.hold'), tip: t('editors.click.holdTip') },
          ] satisfies { value: Kind; label: string; tip?: string }[]).map(o => ({ ...o, disabled: form !== '' }))}
          onChange={switchKind}
          disabled={locked}
        />
      </Section>
      {kind === 'hold' && (
        <Section label={t('editors.holdLabel')}>
          <DraftField stepId={id} field="holdDurationMs" label={t('editors.holdField')} kind="int" min={10} max={60000} step={durationStep} unit="ms" stored={String(step.holdDurationMs || DEFAULT_HOLD_MS)} disabled={locked} />
          <Chips values={HOLD_CHIPS} current={step.holdDurationMs || DEFAULT_HOLD_MS} onPick={(ms) => edit([{ field: 'holdDurationMs', value: String(ms) }])} disabled={locked} />
        </Section>
      )}
      <Section
        label={t('editors.click.position')}
        hint={!atCursor && target !== null
          ? (target ? t('editors.click.relativeTo', { window: target }) : t('editors.click.relativeToTarget'))
          : undefined}
      >
        <Segmented<'point' | 'cursor'>
          label={t('editors.click.positionField')}
          value={atCursor ? 'cursor' : 'point'}
          options={[
            { value: 'point', label: t('editors.click.thisPoint') },
            { value: 'cursor', label: t('editors.click.atCursor'), disabled: !combined, tip: t('editors.click.atCursorTip') },
          ]}
          onChange={(v) => edit([{ field: 'atCursor', value: v === 'cursor' ? 'true' : 'false' }])}
          disabled={locked}
        />
        {!atCursor && (
          <>
            <div className="insp-pair">
              <DraftField stepId={id} field="x" label={t('editors.click.x')} kind="int" signed min={-COORD} max={COORD} prefix="X" stored={String(step.x)} disabled={locked} />
              <DraftField stepId={id} field="y" label={t('editors.click.y')} kind="int" signed min={-COORD} max={COORD} prefix="Y" stored={String(step.y)} disabled={locked} />
            </div>
            <div className="insp-pair">
              <button type="button" className="insp-button" disabled={locked || picking !== null} onClick={() => pick('press')}>
                <span className="step-icon" data-icon="crosshair" />
                {picking === 'press' ? t('editors.click.picking') : t('editors.click.pick')}
              </button>
              <button
                type="button"
                className="insp-button"
                data-error={pasteFailed || undefined}
                data-tip={pasteFailed ? t('editors.click.pasteFailed') : t('editors.click.pasteTip')}
                disabled={locked}
                onClick={paste}
              >
                <span className="step-icon" data-icon="clipboard-paste" />
                {t('common.actions.paste')}
              </button>
            </div>
            {was && (was.x !== step.x || was.y !== step.y) && (
              <span className="insp-hint">{t('editors.click.was', { x: was.x, y: was.y })}</span>
            )}
          </>
        )}
      </Section>
      {form === '' && (
        <Section label={t('editors.repeat')}>
          <div className="insp-pair">
            <DraftField stepId={id} field="repeat" label={t('editors.timesField')} kind="int" min={1} max={999} unit={t('editors.click.times')} stored={String(repeat)} disabled={locked} />
            <DraftField
              stepId={id}
              field="repeatDelayMs"
              label={t('editors.click.gapField')}
              kind="int"
              min={0}
              max={5000}
              empty="clear"
              unit={t('editors.click.gapUnit')}
              placeholder={String(clickDefaultGap(type))}
              stored={step.repeatDelayMs == null ? '' : String(step.repeatDelayMs)}
              disabled={locked || repeat <= 1}
              tip={kind === 'double' || kind === 'triple' ? t('editors.click.gapTip') : undefined}
            />
          </div>
          <Vary
            label={t('editors.varyGap')}
            tip={t('editors.varyGapTip')}
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
              label={t('editors.click.varyPoint')}
              tip={atCursor ? t('editors.click.varyPointCursorTip') : t('editors.click.varyPointTip')}
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
      {isFocusClickEligible(type) && (
        <div className="insp-row">
          <Switch
            label={t('list.focusClick')}
            checked={!!step.isFocusClick}
            tip={t('editors.click.focusTip')}
            onChange={() => cmds.toggleFocusClick({ indices: [index] })}
            disabled={locked}
          />
          <span className="insp-row-label">{t('list.focusClick')}</span>
        </div>
      )}
      {canDrag && (
        <Section label={t('editors.click.releaseAt')} hint={releaseNote ?? t('editors.click.releaseHint')}>
          <div className="insp-pair">
            <ReleaseField label={t('editors.click.releaseX')} prefix="X" text={release.x} disabled={locked} onCommit={(x) => commitRelease({ ...release, x })} />
            <ReleaseField label={t('editors.click.releaseY')} prefix="Y" text={release.y} disabled={locked} onCommit={(y) => commitRelease({ ...release, y })} />
          </div>
          <button type="button" className="insp-button" disabled={locked || picking !== null} onClick={() => pick('release')}>
            <span className="step-icon" data-icon="crosshair" />
            {picking === 'release' ? t('editors.click.picking') : t('editors.click.pickRelease')}
          </button>
        </Section>
      )}
      {pairedUp && (
        <Section label={t('editors.click.releaseAt')} hint={dragged(step, pairedUp) ? undefined : t('editors.click.withinTwo')}>
          <div className="insp-pair">
            <DraftField stepId={pairedUp.id ?? ''} field="x" label={t('editors.click.releaseX')} kind="int" signed min={-COORD} max={COORD} prefix="X" stored={String(pairedUp.x)} disabled={locked} />
            <DraftField stepId={pairedUp.id ?? ''} field="y" label={t('editors.click.releaseY')} kind="int" signed min={-COORD} max={COORD} prefix="Y" stored={String(pairedUp.y)} disabled={locked} />
          </div>
          <button type="button" className="insp-button" disabled={locked} onClick={mergeDrag}>{t('editors.click.oneClick')}</button>
        </Section>
      )}
      {pairedDown && <span className="insp-hint">{t('editors.click.releasesFrom', { number: index })}</span>}
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
