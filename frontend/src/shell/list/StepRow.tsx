import type { CSSProperties } from 'react';
import type { ActionItem } from '../../bridge/messageTypes';
import { LANG, t } from '../../i18n';
import { hasConditionFields } from '../../utils/conditionalBlocks';
import { formatMs, getActionTypeColors, isCombinedClick, isFocusClickEligible } from '../../utils/displayUtils';
import { useShell } from '../store';
import { blockColor, type RowBlock } from './blocks';
import { stepDetails } from './details';
import { useSelection } from './selection';
import { NO_DELAY_TYPES, stepIcon, stepName } from './stepTypes';

/** The build's language as formatMs still names it (plan §3.4: it loses the parameter later). */
const MS_LANGUAGE = LANG === 'pt-BR' ? 'pt-BR' : 'en';

/**
 * One step of the list (⑦). It only draws: the list handles the pointer and the keys for every
 * row at once (one listener, not a thousand), and finds the row by its data-index. The props are
 * plain values, so a step that did not change keeps its props and is not redrawn; whether it is
 * selected, running or paused it reads from the stores itself, so those change two rows, not all.
 */
export function StepRow({ step, index, k, depth, kind, owner, rails, broken, tip, skipped, dataRows }: {
  step: ActionItem;
  index: number;
  /** The step's key (its id). */
  k: string;
  depth: RowBlock['depth'];
  kind: RowBlock['kind'];
  owner: RowBlock['owner'];
  rails: RowBlock['rails'];
  broken: RowBlock['broken'];
  /** A marker's orientation ("Ends at step 10"), or why it is broken. */
  tip: string | undefined;
  skipped: boolean;
  dataRows: number;
}) {
  const selected = useSelection(s => s.keys.has(k));
  const cursor = useSelection(s => s.cursor === k);
  const running = useShell(s => s.highlight === index);
  const paused = useShell(s => s.highlight === index && s.app.pauseState.isPaused) && step.actionType === 'Pause';
  const type = step.actionType;
  const colors = getActionTypeColors(type);
  const icon = stepIcon(type);
  const openers = rails ? rails.split(',') : [];
  const own = kind !== null;
  const times = (type === 'Keystroke' || type === 'RunProfile' || isCombinedClick(type)) && (step.repeatCount ?? 1) > 1 && !step.runOverData;
  const perRow = type === 'RunProfile' && !!step.runOverData;
  const negated = hasConditionFields(type) && !!step.conditionNegate;
  const delay = !NO_DELAY_TYPES.has(type) && step.delay > 0;
  const level = own ? depth : depth - 1;
  return (
    <div
      role="option"
      id={`step-${k}`}
      aria-selected={selected}
      aria-posinset={index + 1}
      className="step"
      data-cursor={cursor || undefined}
      data-key={k}
      data-index={index}
      data-block-open={owner ?? undefined}
      data-kind={kind ?? undefined}
      data-skipped={skipped || undefined}
      data-running={running || undefined}
      data-paused={paused || undefined}
      style={{
        '--row-block-color': broken ? 'var(--color-recording)' : blockColor(level),
        '--step-indent': `${openers.length > 0 ? depth * 0.875 + 0.5 : 0}rem`,
      } as CSSProperties}
    >
      <span className="step-num">
        {running
          ? <span className="step-icon step-run" data-icon={paused ? 'pause' : 'play'} role="img" aria-label={paused ? t('list.row.paused') : t('list.row.running')} />
          : <span className="step-num-text">{index + 1}</span>}
        <span className="step-check" aria-hidden="true" data-tip={t('list.row.select', { number: index + 1 })} />
      </span>
      <span className="step-type">
        {openers.map((opener, i) => {
          const innermost = i === openers.length - 1;
          return (
            <span
              key={i}
              className="step-rail"
              data-rail-block={opener}
              data-strong={(own && innermost) || undefined}
              data-cap={own && innermost ? (kind === 'opener' ? 'top' : kind === 'closer' ? 'bottom' : undefined) : undefined}
              style={{ left: `${i * 0.875}rem`, '--rail-color': broken && innermost ? 'var(--color-recording)' : blockColor(i) } as CSSProperties}
            />
          );
        })}
        <span className="step-pill" style={{ background: colors.bg, color: colors.fg }} data-tip={tip}>
          {icon && <span className="step-icon" data-icon={icon} />}
          {stepName(type)}
          {negated && <span className="step-not">{t('list.row.not')}</span>}
          {times && <span className="step-times">×{step.repeatCount}</span>}
          {perRow && <span className="step-times">{t('list.row.perRow')}</span>}
          {step.isFocusClick && isFocusClickEligible(type) && (
            <span className="step-icon" data-icon="focus" role="img" aria-label={t('list.focusClick')} data-tip={t('list.row.focusClickTip')} />
          )}
          {step.atCursor && isCombinedClick(type) && (
            <span className="step-icon" data-icon="mouse-pointer-2" role="img" aria-label={t('list.row.atCursor')} data-tip={t('list.row.atCursorTip')} />
          )}
        </span>
        {skipped && <span className="step-icon step-skipped" data-icon="eye-off" role="img" aria-label={t('list.row.skipped')} />}
      </span>
      <span className="step-what">{stepDetails(step, dataRows, MS_LANGUAGE)}</span>
      <span className="step-delay">
        {delay && <>{formatMs(step.delay, MS_LANGUAGE)}<span className="step-ms">ms</span></>}
      </span>
      <span className="step-note">{step.comment}</span>
    </div>
  );
}
