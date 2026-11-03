import { fmtNum, t } from '../../i18n';
import { scanRowTokenUsage, orphanHead, type ColumnUsage } from '../../lib/rowTokenUsage';
import { useToast } from '../../state/ToastContext';
import { focusList } from '../inspector/inspectorState';
import { Section, Segmented, Switch } from '../inspector/fields';
import { selection } from '../list/selection';
import { useApp, useShell } from '../store';
import { showMacroTab, useUi } from '../ui';
import { useShellBand } from '../useShellBand';
import { CUT, useDataOps, useShown, validName, type DataOps } from './model';

/** Who reads a column, beside its token: "used by step 4", "used by steps 4 and 15", "used by steps 2, 4 and 9", "used by 7 steps". */
function usedBy(steps: number[]): string {
  const n = steps.map(i => i + 1);
  if (n.length === 1) return t('dataLoop.settings.usedOne', { number: n[0] });
  if (n.length > 3) return t('dataLoop.settings.usedMany', { n: fmtNum(n.length) });
  return t('dataLoop.settings.usedList', { list: n.slice(0, -1).join(', '), last: n[n.length - 1] });
}

/**
 * The alert of a token no column answers: who reads it, said as the steps above are, and what it
 * does when another macro runs this one (passers). The token is CUT, for its <code>.
 */
function orphanText(steps: number[], passers: string[]): string {
  const n = steps.map(i => i + 1);
  const list = n.slice(0, -1).join(', ');
  const last = n[n.length - 1];
  const token = CUT;
  if (passers.length > 0) {
    const macros = passers.join(', ');
    if (n.length === 1) return t('dataLoop.settings.orphan.oneStepFrom', { number: n[0], token, macros });
    if (n.length > 3) return t('dataLoop.settings.orphan.manyStepsFrom', { n: fmtNum(n.length), token, macros });
    return t('dataLoop.settings.orphan.someStepsFrom', { list, last, token, macros });
  }
  if (n.length === 1) return t('dataLoop.settings.orphan.oneStep', { number: n[0], token });
  if (n.length > 3) return t('dataLoop.settings.orphan.manySteps', { n: fmtNum(n.length), token });
  return t('dataLoop.settings.orphan.someSteps', { list, last, token });
}

/** For what If a row fails counts, as one sentence: one to three ways the table is walked. */
function scopeText(scope: string[]): string | null {
  if (scope.length === 0) return null;
  if (scope.length === 1) return t('dataLoop.settings.scope1', { a: scope[0] });
  if (scope.length === 2) return t('dataLoop.settings.scope2', { a: scope[0], b: scope[1] });
  return t('dataLoop.settings.scope3', { a: scope[0], b: scope[1], c: scope[2] });
}

/** The table's first filled cell in a row: what names the row ("row 3 (João Pereira)"). */
const rowName = (row: string[] | undefined) => row?.find(cell => cell.trim() !== '')?.trim() ?? '';
/** From here a table is a large one (today's LARGE_TABLE_WARN). */
const LARGE_TABLE = 1000;

/**
 * ⑧ The Inspector on the Data Loop tab ("Data Loop settings"): how replay uses the rows — the next
 * row each time, or every row in one go (paineis-119) — with where the next one is and the way back
 * to row 1 (paineis-113), the lap notice (paineis-120), what a failed row does (paineis-121, 122),
 * and the columns as tokens: which steps read each one, and the tokens no column answers, with the
 * column to add and the step to go to (paineis-123 to 126). Each change applies on the press.
 */
export function DataSettings({ locked, note }: { locked: boolean; note: string | null }) {
  const shown = useShown();
  const ops = useDataOps();
  const actions = useApp(a => a.actions);
  const profiles = useApp(a => a.profiles);
  const open = useApp(a => a.activeProfile);
  const asked = useUi(s => s.dataSettings);
  const band = useShellBand();
  const { showToast } = useToast();
  const rows = shown.saved;
  const cols = shown.headers.length;
  // No columns, no table: what the tab says too (DataMain).
  const none = cols === 0;
  const cursorMode = !shown.loopOverData;
  const cursor = Math.min(shown.cursorRow, Math.max(0, rows - 1));

  const usage = scanRowTokenUsage(actions);
  // The two paths that walk the table row by row without "Every row": a For Each Data Row block
  // here, and another macro's Run Macro once per data row. The failure policy counts for them too.
  const forEach = actions.some(a => a.actionType === 'ForEachRow');
  const callers = open ? profiles.filter(p => p.name !== open && (p.runOverDataTargets ?? []).includes(open)).map(p => p.name) : [];
  // Run Macro without "once per data row" runs its macro on this macro's row: a column none of
  // these steps reads may still be read there.
  const inheritors = [...new Set(actions.filter(a => a.actionType === 'RunProfile' && a.runOverData !== true && (a.key ?? '').trim() !== '').map(a => a.key.trim()))];
  const passers = open
    ? profiles.filter(p => p.name !== open && (p.runProfileTargets ?? []).includes(open) && !(p.runOverDataTargets ?? []).includes(open)).map(p => p.name)
    : [];
  const have = new Set(shown.headers.map(h => h.trim().toLowerCase()));
  const orphans = [...usage.entries()].filter(([key]) => !have.has(key));

  const copy = (token: string) => {
    navigator.clipboard?.writeText(token).then(
      () => showToast(t('dataLoop.settings.copied', { token }), 'success'),
      () => showToast(t('dataLoop.copyFailed'), 'error'),
    );
  };
  // The step, selected in the list: the Inspector opens it there.
  const goToStep = (index: number) => {
    showMacroTab('steps');
    selection.only(useShell.getState().app.actions, index);
    requestAnimationFrame(() => {
      document.querySelector(`.steps-body .step[data-index="${index}"]`)?.scrollIntoView({ block: 'center' });
      focusList();
    });
  };
  const scope = [
    shown.loopOverData ? t('dataLoop.settings.scopeAll') : null,
    forEach ? t('dataLoop.settings.scopeForEach') : null,
    callers.length === 1 ? t('dataLoop.settings.scopeCaller', { name: callers[0] }) : callers.length > 1 ? t('dataLoop.settings.scopeCallers', { n: fmtNum(callers.length) }) : null,
  ].filter(Boolean) as string[];
  const scopeHint = scopeText(scope);

  // The card of the mode that walks the rows: the marked row, in bold where the sentence puts it.
  const named = rowName(shown.rows[cursor]);
  const marked = named ? t('dataLoop.settings.rowNamed', { number: cursor + 1, name: named }) : t('dataLoop.settings.row', { number: cursor + 1 });
  const [before, after = ''] = (rows > 1
    ? t('dataLoop.settings.nextMoves', { row: CUT, next: cursor + 2 > rows ? 1 : cursor + 2 })
    : t('dataLoop.settings.nextAlways', { row: CUT })).split(CUT);

  return (
    <>
      <div className="insp-head">
        <span className="insp-tile dl-tile"><span className="step-icon" data-icon="table-2" /></span>
        <div className="insp-title">
          <span className="insp-name" data-display="" data-glossary="">Data Loop</span>
          <span className="insp-sub">{none ? t('dataLoop.noTable') : `${t('dataLoop.rows', { count: rows, n: fmtNum(rows) })} · ${t('dataLoop.columns', { count: cols, n: fmtNum(cols) })}`}</span>
        </div>
        {asked && band === 'over' && (
          <button type="button" className="insp-close" aria-label={t('dataLoop.settings.close')} onClick={() => { useUi.setState({ dataSettings: false }); focusList(); }}>
            <span className="step-icon" data-icon="x" />
          </button>
        )}
      </div>
      <div className="insp-body">
        {none && <p className="insp-hint">{t('dataLoop.settings.noTableHint')}</p>}
        {/* Today's note from 1,000 rows (paineis-118): the whole table lives in the macro's file. */}
        {rows >= LARGE_TABLE && <p className="insp-hint" role="status">{t('dataLoop.settings.large')}</p>}
        {!none && <Section label={t('dataLoop.settings.uses')}>
          <Segmented
            label={t('dataLoop.settings.uses')}
            value={shown.loopOverData ? 'all' : 'next'}
            disabled={locked}
            options={[
              { value: 'next', label: t('dataLoop.settings.modes.next'), tip: t('dataLoop.settings.nextTip') },
              { value: 'all', label: t('dataLoop.settings.modes.all'), tip: t('dataLoop.settings.allTip') },
            ]}
            onChange={(v) => ops.setLoop(v === 'all')}
          />
          {rows === 0 ? (
            <div className="dl-card" data-tone={shown.loopOverData ? 'error' : undefined} role="status">
              {shown.loopOverData ? t('dataLoop.settings.noRowsAll') : t('dataLoop.settings.noRowsNext')}
            </div>
          ) : cursorMode ? (
            <div className="dl-card" data-tone="ok">
              {before}<strong>{marked}</strong>{after}
            </div>
          ) : (
            <div className="dl-card" data-tone="ok">
              {t('dataLoop.settings.allRows', { count: rows, n: fmtNum(rows) })}
            </div>
          )}
          {cursorMode && rows > 0 && (
            <div className="insp-row">
              <span className="insp-row-label">{t('dataLoop.settings.nextRow')}</span>
              <span className="dl-next-row">{t('dataLoop.settings.nextOf', { number: cursor + 1, total: fmtNum(rows) })}</span>
              <button
                type="button"
                className="insp-button"
                disabled={locked || cursor === 0}
                data-tip={t('dataLoop.settings.backToFirstTip')}
                onClick={() => ops.resetCursor()}
              >
                {t('dataLoop.settings.backToFirst')}
              </button>
            </div>
          )}
          {cursorMode && rows > 1 && (
            <div className="insp-row">
              <span className="insp-row-label">{t('dataLoop.settings.wraps')}</span>
              <Switch
                label={t('dataLoop.settings.wraps')}
                checked={shown.notifyOnLapComplete}
                disabled={locked}
                tip={t('dataLoop.settings.wrapsTip')}
                onChange={(on) => ops.setNotify(on)}
              />
            </div>
          )}
        </Section>}

        {!none && scopeHint && (
          <Section label={t('dataLoop.settings.fails')} hint={scopeHint}>
            <Segmented
              label={t('dataLoop.settings.fails')}
              value={shown.onRowError}
              disabled={locked}
              options={[
                { value: 'halt', label: t('common.actions.stop'), tip: t('dataLoop.settings.haltTip') },
                { value: 'skip', label: t('dataLoop.settings.skip'), tip: t('dataLoop.settings.skipTip') },
              ]}
              onChange={(v) => ops.setOnRowError(v)}
            />
          </Section>
        )}

        {(cols > 0 || orphans.length > 0) && (
          <Section label={t('dataLoop.columnsLabel')} hint={t('dataLoop.settings.columnsHint')}>
            {shown.headers.map((h, c) => (
              <ColumnLine
                key={c}
                c={c}
                name={h.trim()}
                usage={usage.get(h.trim().toLowerCase())}
                inheritors={inheritors}
                locked={locked}
                onCopy={copy}
                onFix={() => fixName(ops, shown.headers, c)}
              />
            ))}
            {orphans.map(([key, u]) => (
              <Orphan
                key={key}
                usage={u}
                passers={passers}
                locked={locked}
                onAdd={() => ops.addColumn(undefined, u.name)}
                onGo={() => goToStep(u.steps[0])}
              />
            ))}
          </Section>
        )}
      </div>
      <div className="insp-foot" data-locked={note ? '' : undefined}>{note ?? t('dataLoop.settings.foot')}</div>
    </>
  );
}

/** A column as a token: what reads it, and its copy. A name that is not a token's has its Fix. */
function ColumnLine({ c, name, usage, inheritors, locked, onCopy, onFix }: {
  c: number;
  name: string;
  usage: ColumnUsage | undefined;
  inheritors: string[];
  locked: boolean;
  onCopy: (token: string) => void;
  onFix: () => void;
}) {
  if (!validName(name)) {
    return (
      <div className="dl-col" data-invalid="">
        <span className="step-icon dl-warn" data-icon="triangle-alert" />
        <span className="dl-col-name">{name || t('dataLoop.settings.emptyColumn', { number: c + 1 })}</span>
        <span className="dl-col-what">{t('dataLoop.settings.notToken')}</span>
        <button
          type="button"
          className="insp-button"
          disabled={locked}
          aria-label={name ? t('dataLoop.settings.fixLabel', { name }) : t('dataLoop.settings.fixLabelUnnamed', { number: c + 1 })}
          data-tip={t('dataLoop.settings.fixTip')}
          onClick={onFix}
        >
          {t('dataLoop.settings.fix')}
        </button>
      </div>
    );
  }
  const token = `{row:${name}}`;
  const used = (usage?.count ?? 0) > 0;
  return (
    <div className="dl-col">
      <span className="dl-token" data-used={used || undefined}>{token}</span>
      <span
        className="dl-col-what"
        data-tip={!used && inheritors.length > 0
          ? t('dataLoop.settings.inherited', { count: inheritors.length, macros: inheritors.join(', ') })
          : undefined}
      >
        {used ? usedBy(usage!.steps) : inheritors.length > 0 ? t('dataLoop.settings.notUsedHere') : t('dataLoop.settings.notUsedYet')}
      </span>
      <button type="button" className="insp-icon-button" aria-label={t('dataLoop.settings.copyTokenLabel', { token })} data-tip={t('dataLoop.settings.copyToken')} onClick={() => onCopy(token)}>
        <span className="step-icon" data-icon="copy" />
      </button>
    </div>
  );
}

/** A token no column answers: it types nothing, and here are the column to add and the step to see. */
function Orphan({ usage, passers, locked, onAdd, onGo }: {
  usage: ColumnUsage;
  passers: string[];
  locked: boolean;
  onAdd: () => void;
  onGo: () => void;
}) {
  const token = `{${orphanHead(usage)}:${usage.name}}`;
  // The token, in <code>, where the catalog's sentence puts it.
  const [before, after = ''] = orphanText(usage.steps, passers).split(CUT);
  return (
    <div className="dl-orphan" role="alert">
      <span className="step-icon" data-icon="triangle-alert" />
      <div className="dl-orphan-body">
        <span>
          {before}<code>{token}</code>{after}
        </span>
        <span className="dl-orphan-actions">
          <button type="button" className="insp-button" disabled={locked || !validName(usage.name)} onClick={onAdd}>{t('dataLoop.settings.addColumn', { name: usage.name })}</button>
          <button type="button" className="insp-button" onClick={onGo}>{t('dataLoop.settings.goToStep', { number: usage.steps[0] + 1 })}</button>
        </span>
      </div>
    </div>
  );
}

/** Fix: { } and : become _, and the name stays unique (the columns of a table brought in from outside). */
function fixName(ops: DataOps, headers: string[], c: number) {
  let base = headers[c].trim().replace(/[{}:]+/g, '_').replace(/^_+|_+$/g, '').trim();
  if (base === '') base = `col${c + 1}`;
  const others = new Set(headers.filter((_, i) => i !== c).map(h => h.trim().toLowerCase()));
  let name = base;
  let n = 2;
  while (others.has(name.toLowerCase())) name = `${base}_${n++}`;
  ops.renameColumn(c, name);
}
