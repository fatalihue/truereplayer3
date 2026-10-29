import { scanRowTokenUsage, orphanHead, type ColumnUsage } from '../../lib/rowTokenUsage';
import { useTt } from '../../state/LanguageContext';
import { useToast } from '../../state/ToastContext';
import { focusList } from '../inspector/inspectorState';
import { Section, Segmented, Switch } from '../inspector/fields';
import { selection } from '../list/selection';
import { useApp, useShell } from '../store';
import { showMacroTab, useUi } from '../ui';
import { useShellBand } from '../useShellBand';
import { useDataOps, useShown, validName, type DataOps } from './model';

/** "step 4", "steps 4 and 15", "steps 2, 4 and 9", "7 steps". */
function stepsText(steps: number[]): string {
  const n = steps.map(i => i + 1);
  if (n.length === 1) return `step ${n[0]}`;
  if (n.length > 3) return `${n.length} steps`;
  return `steps ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** The table's first filled cell in a row: what names the row ("row 3 (João Pereira)"). */
const rowName = (row: string[] | undefined) => row?.find(cell => cell.trim() !== '')?.trim() ?? '';

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
  const tt = useTt();
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
      () => showToast(tt(`${token} copied`, `${token} copiado`), 'success'),
      () => showToast(tt('Could not copy — click inside the window and try again.', 'Não foi possível copiar — clique dentro da janela e tente de novo.'), 'error'),
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
    shown.loopOverData ? 'every row in one go' : null,
    forEach ? 'For Each Data Row blocks' : null,
    callers.length === 1 ? `“${callers[0]}” running this macro once per data row` : callers.length > 1 ? `${callers.length} macros running this one once per data row` : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <div className="insp-head">
        <span className="insp-tile dl-tile"><span className="step-icon" data-icon="table-2" /></span>
        <div className="insp-title">
          <span className="insp-name" data-display="">Data Loop</span>
          <span className="insp-sub">{none ? 'No table yet' : `${rows === 1 ? '1 row' : `${rows} rows`} · ${cols === 1 ? '1 column' : `${cols} columns`}`}</span>
        </div>
        {asked && band === 'over' && (
          <button type="button" className="insp-close" aria-label="Close Data Loop settings" onClick={() => { useUi.setState({ dataSettings: false }); focusList(); }}>
            <span className="step-icon" data-icon="x" />
          </button>
        )}
      </div>
      <div className="insp-body">
        {none && <p className="insp-hint">With a table, how replay walks its rows is set here.</p>}
        {!none && <Section label="How replay uses the rows">
          <Segmented
            label="How replay uses the rows"
            value={shown.loopOverData ? 'all' : 'next'}
            disabled={locked}
            options={[
              { value: 'next', label: 'Next row each time', tip: tt('Each replay uses one row, then moves to the next', 'Cada replay usa uma linha e passa para a próxima') },
              { value: 'all', label: 'Every row, in one go', tip: tt('One replay runs once per row; it overrides the Loops and the hotkey’s looping', 'Um replay roda uma vez por linha; vence os Loops e a repetição do atalho') },
            ]}
            onChange={(v) => ops.setLoop(v === 'all')}
          />
          {rows === 0 ? (
            <div className="dl-card" data-tone={shown.loopOverData ? 'error' : undefined}>
              {shown.loopOverData ? 'No rows — replay won’t start.' : 'The table has no rows yet: each replay will use the next one.'}
            </div>
          ) : cursorMode ? (
            <div className="dl-card" data-tone="ok">
              The next replay uses <strong>row {cursor + 1}{rowName(shown.rows[cursor]) ? ` (${rowName(shown.rows[cursor])})` : ''}</strong>
              {rows > 1 ? <> and then moves to row {cursor + 2 > rows ? 1 : cursor + 2}. After the last row it starts over at row 1.</> : <>, every time.</>}
              {' '}A replay you stop has still used its row.
            </div>
          ) : (
            <div className="dl-card" data-tone="ok">
              Each replay runs all {rows === 1 ? '1 row' : `${rows} rows`}, once per row — in place of the Loops and the hotkey’s looping.
            </div>
          )}
          {cursorMode && rows > 0 && (
            <div className="insp-row">
              <span className="insp-row-label">Next row</span>
              <span className="dl-next-row">{cursor + 1} of {rows}</span>
              <button
                type="button"
                className="insp-button"
                disabled={locked || cursor === 0}
                data-tip={tt('The next replay starts at the top of the table', 'O próximo replay começa no topo da tabela')}
                onClick={() => ops.resetCursor()}
              >
                Back to row 1
              </button>
            </div>
          )}
          {cursorMode && rows > 1 && (
            <div className="insp-row">
              <span className="insp-row-label">Tell me when the list wraps</span>
              <Switch
                label="Tell me when the list wraps"
                checked={shown.notifyOnLapComplete}
                disabled={locked}
                tip={tt('A chime and a tray balloon when a replay uses the last row', 'Um som e um balão na bandeja quando um replay usa a última linha')}
                onChange={(on) => ops.setNotify(on)}
              />
            </div>
          )}
        </Section>}

        {!none && scope.length > 0 && (
          <Section label="If a row fails" hint={`Counts for ${scope.join(', and for ')}. Skipped rows are summed up when the run ends.`}>
            <Segmented
              label="If a row fails"
              value={shown.onRowError}
              disabled={locked}
              options={[
                { value: 'halt', label: 'Stop', tip: tt('The run stops at the first row that fails', 'A execução para na primeira linha que falha') },
                { value: 'skip', label: 'Skip the row', tip: tt('The row is logged and the run goes on with the next', 'A linha é registrada e a execução segue com a próxima') },
              ]}
              onChange={(v) => ops.setOnRowError(v)}
            />
          </Section>
        )}

        {(cols > 0 || orphans.length > 0) && (
          <Section label="Columns" hint="Names ignore case. {row} is the row number.">
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
      <div className="insp-foot" data-locked={note ? '' : undefined}>{note ?? 'Applies as you type · Ctrl+Z undoes'}</div>
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
  const tt = useTt();
  if (!validName(name)) {
    return (
      <div className="dl-col" data-invalid="">
        <span className="step-icon dl-warn" data-icon="triangle-alert" />
        <span className="dl-col-name">{name || `(empty, column ${c + 1})`}</span>
        <span className="dl-col-what">not a token name</span>
        <button
          type="button"
          className="insp-button"
          disabled={locked}
          aria-label={`Fix column name ${name || `column ${c + 1}`}`}
          data-tip={tt('Puts _ in place of { } and :, and keeps it unique', 'Troca { } e : por _ e mantém o nome único')}
          onClick={onFix}
        >
          Fix
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
          ? tt(`Not read by this macro’s steps. ${inheritors.join(', ')} run(s) on this macro’s row (Run Macro without “once per data row”) and may read it — check before deleting it.`,
            `Não é lida pelos passos deste macro. ${inheritors.join(', ')} roda(m) na linha deste macro (Run Macro sem “once per data row”) e pode(m) lê-la — confira antes de apagá-la.`)
          : undefined}
      >
        {used ? `used by ${stepsText(usage!.steps)}` : inheritors.length > 0 ? 'not used here' : 'not used yet'}
      </span>
      <button type="button" className="insp-icon-button" aria-label={`Copy token ${token}`} data-tip={tt('Copy token', 'Copiar o token')} onClick={() => onCopy(token)}>
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
  const who = usage.steps.length === 1 ? `Step ${usage.steps[0] + 1} reads` : `${stepsText(usage.steps).replace(/^s/, 'S')} read`;
  return (
    <div className="dl-orphan" role="alert">
      <span className="step-icon" data-icon="triangle-alert" />
      <div className="dl-orphan-body">
        <span>
          {who} <code>{token}</code>, but there is no such column, so it types nothing
          {passers.length > 0 ? <> when this macro runs on its own; run from {passers.join(', ')}, it reads that macro’s row.</> : '.'}
        </span>
        <span className="dl-orphan-actions">
          <button type="button" className="insp-button" disabled={locked || !validName(usage.name)} onClick={onAdd}>Add column {usage.name}</button>
          <button type="button" className="insp-button" onClick={onGo}>Go to step {usage.steps[0] + 1}</button>
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
