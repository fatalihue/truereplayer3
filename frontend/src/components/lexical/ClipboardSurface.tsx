import React, { useMemo } from 'react';
import { ChevronLeft, RefreshCw, RotateCcw, Wand2 } from 'lucide-react';
import { SegmentedControl } from '../common/SegmentedControl';
import { NumberInput } from '../common/NumberInput';
import { FieldError } from '../common/FieldError';
import { Callout } from '../common/Callout';
import { t } from '../../i18n';
import { ArgInput, CheckRow as PopoverCheckRow, type CheckRowProps } from './popoverAtoms';

// Inline (not full-width) so the Lines / Clean up rows keep wrapping side by side.
const CheckRow = (props: CheckRowProps) => <PopoverCheckRow {...props} className="" />;
import { useClipboardContent } from '../../logic/useClipboardContent';
import {
  applyTransformPreview,
  previewIsRuntimeDependent,
  argRefIsUnfinished,
  buildChainToken,
  chainHeadIsUsable,
  linesStepActive,
  splitStepActive,
  dropNumStepActive,
  replaceStepActive,
  shapeStepActive,
  defaultStepActive,
  MAX_PAD_WIDTH,
  type CaseTransform,
  type ChainHead,
  type Extract,
  type Limit,
  type ListPick,
  type Split,
  type TransformState,
} from './clipboardModifiers';
import { useRunState, lookupRunState } from '../../logic/useRunState';
import { useAppState } from '../../state/AppStateContext';

// The surface is the ONE place a modifier chain is built, so its title names the SOURCE the
// token reads — "Clipboard" beside "Variable" and "Data column", not "Advanced Clipboard": no head
// is more advanced than the others, and "Advanced…" is the button that opens this, not its name.
// The text is the catalog's (i18n/<language>/clipboard.ts): each t() below becomes the build's text
// at compile time, so these tables still hold plain strings.
const HEAD_TITLES: Record<ChainHead['kind'], string> = {
  clipboard: t('clipboard.heads.clipboard'),
  row: t('clipboard.heads.row'),
  rownext: t('clipboard.heads.rownext'),
  var: t('clipboard.heads.var'),
  clip: t('clipboard.heads.clip'),
  winclip: t('clipboard.heads.winclip'),
  counter: t('clipboard.heads.counter'),
  loop: t('clipboard.heads.loop'),
  datarow: t('clipboard.heads.datarow'),
  uuid: t('clipboard.heads.uuid'),
  timestamp: t('clipboard.heads.timestamp'),
  env: t('clipboard.heads.env'),
};

// The three counters and {uuid} have no identity: the head IS the value, so the card above the
// ladder is not drawn for them at all (see HEAD_ONLY and the render), and these entries exist to
// satisfy the Record.
const IDENTITY_LABELS: Record<ChainHead['kind'], string> = {
  clipboard: '',
  row: t('clipboard.identity.column'),
  rownext: t('clipboard.identity.column'),
  var: t('clipboard.identity.variableName'),
  clip: t('clipboard.identity.slotName'),
  winclip: t('clipboard.identity.historyItem'),
  counter: '',
  loop: '',
  datarow: '',
  uuid: '',
  timestamp: t('clipboard.identity.unit'),
  env: t('clipboard.identity.variableName'),
};

// Heads with nothing above the ladder — the identity card is skipped for them.
const HEAD_ONLY: ReadonlySet<ChainHead['kind']> = new Set(['clipboard', 'counter', 'loop', 'datarow', 'uuid']);

const IDENTITY_HINTS: Record<ChainHead['kind'], string> = {
  clipboard: '',
  row: t('clipboard.identity.hints.row'),
  rownext: t('clipboard.identity.hints.rownext'),
  var: t('clipboard.identity.hints.var'),
  clip: t('clipboard.identity.hints.clip'),
  // One line at the column's width — the identity card is what pushes the ladder past the fold.
  winclip: t('clipboard.identity.hints.winclip'),
  counter: '',
  loop: '',
  datarow: '',
  uuid: '',
  timestamp: t('clipboard.identity.hints.timestamp'),
  // The same caution as the history item, for the same reason: a variable set by an installer or
  // a shell profile can hold a key or a token, and nothing here can tell.
  env: t('clipboard.identity.hints.env'),
};

// What to say when there is no source to preview against. Each reason is DIFFERENT, and saying
// the wrong one is worse than saying nothing: "nothing captured yet" is fixable by the user,
// "only the engine has it" is not.
const UNKNOWN_SOURCE_COPY: Record<ChainHead['kind'], string> = {
  clipboard: '',
  row: t('clipboard.unknown.column'),
  rownext: t('clipboard.unknown.column'),
  var: t('clipboard.unknown.variable'),
  clip: t('clipboard.unknown.slot'),
  winclip: t('clipboard.unknown.history'),
  counter: t('clipboard.unknown.counted'),
  loop: t('clipboard.unknown.counted'),
  datarow: t('clipboard.unknown.counted'),
  uuid: t('clipboard.unknown.generated'),
  timestamp: '',
  env: t('clipboard.unknown.machine'),
};

interface ClipboardSurfaceProps {
  /** Lifted TransformState — the parent owns it so the DialogShell footer
   *  (Insert/Apply, swapped in by SendTextDialog) can build the token too. */
  state: TransformState;
  onStateChange: React.Dispatch<React.SetStateAction<TransformState>>;
  /** Which token this chain belongs to, plus its identity (column / name / history index).
   *  Lifted for the same reason the state is: the footer builds the token from both. */
  head: ChainHead;
  onHeadChange: (next: ChainHead) => void;
  /** `‹ Editor` — leave the surface discarding changes (same as footer Cancel). */
  onBack: () => void;
  /** Reset to the session's starting state (DEFAULT_TRANSFORM on insert,
   *  the chip's original token on edit). */
  onReset: () => void;
  /** The token as the user actually has it, used ONLY by the read-only panel — see `token` below. */
  originalToken?: string;
  /** What `‹ Editor` says it does. A host that applies each change as it is made (the expanded
   *  Inspector) discards nothing on the way back. */
  backTip?: string;
}

// Full-body "Advanced Clipboard" sub-surface of the Insert Text dialog — the
// ThemeEditor surface-swap pattern, but mounted as an `absolute inset-0`
// OVERLAY inside the dialog's relative body wrapper so the Lexical editor
// underneath never unmounts (undo stack, caret and selection all survive a
// round-trip through this surface).
//
// The TWELVE config sections are laid out in the BACKEND PIPELINE ORDER
// (sequence → trim → replace → split → drop count → lines → extract → limit → clean up →
// count & pad → case → default — see the clipboardModifiers.ts header), each with a step badge that lights up while its step is
// active, so the UI reads as the data flow it actually is. sn() renumbers when the head is not
// the clipboard, because a gap at the top would say nothing true. Serialization stays
// exclusively in buildClipboardToken — this component emits no token strings of its own.
export function ClipboardSurface({ state, onStateChange, head, onHeadChange, onBack, onReset, originalToken, backTip }: ClipboardSurfaceProps) {
  // Only a chain on the clipboard previews against it: the other sources never read it.
  const { clipRaw, clipReady, refresh } = useClipboardContent(head.kind === 'clipboard');
  const runState = useRunState(head.kind === 'clip' || head.kind === 'var');
  const { dataTable } = useAppState();
  // While editable, the rebuilt token is correct — it is what an edit will write. While READ-ONLY
  // it is not: rebuilding is exactly what this surface is refusing to do, so show what the user has.
  const token = useMemo(
    () => (state.unmodeled && originalToken ? originalToken : buildChainToken(head, state)),
    [state, head, originalToken],
  );

  // What the chain will actually run against, per head. `unknown` is not the same as an empty
  // string: an unset slot means "nothing captured yet", and previewing a chain against "" would
  // claim the chain yields nothing — a statement about the user's work rather than about a
  // missing source.
  const source = useMemo((): { raw: string; ready: boolean; unknown: boolean; label: string; note?: string } => {
    switch (head.kind) {
      case 'clipboard':
        return { raw: clipRaw, ready: clipReady, unknown: false, label: t('clipboard.source.clipboardNow') };
      case 'row':
      case 'rownext': {
        const key = head.column.trim().toLowerCase();
        // LAST duplicate header wins, mirroring the backend's BuildRowDict.
        let idx = -1;
        dataTable.headers.forEach((h, i) => { if (h.trim().toLowerCase() === key) idx = i; });
        if (idx < 0) return { raw: '', ready: true, unknown: true, label: t('clipboard.source.cell') };
        return { raw: dataTable.rows[0]?.[idx] ?? '', ready: true, unknown: false, label: t('clipboard.source.cell') };
      }
      case 'clip': {
        const v = lookupRunState(runState.slots, head.name);
        return v === undefined
          ? { raw: '', ready: true, unknown: true, label: t('clipboard.source.slotText') }
          : { raw: v, ready: true, unknown: false, label: t('clipboard.source.slotText') };
      }
      case 'var': {
        const v = lookupRunState(runState.variables, head.name);
        return v === undefined
          ? { raw: '', ready: true, unknown: true, label: t('clipboard.source.variableValue') }
          // Variables are cleared at the start of every run, so anything here came from the LAST
          // one. Saying that is the difference between a useful preview and a misleading one.
          : { raw: v, ready: true, unknown: false, label: t('clipboard.source.variableValue'), note: t('clipboard.source.lastRun') };
      }
      case 'winclip':
        // The Windows clipboard history lives in the engine only — nothing to preview against.
        // Labelled "Item text", not "History item": that name already belongs to the field above
        // that picks WHICH item, and the same words over both boxes read as one repeated thing.
        return { raw: '', ready: true, unknown: true, label: t('clipboard.source.itemText') };
      case 'counter':
      case 'loop':
      case 'datarow':
        // A run counter exists only inside a run — previewing a chain against "" would claim the
        // chain yields nothing, a statement about the user's work rather than about the source.
        return { raw: '', ready: true, unknown: true, label: t('clipboard.source.value') };
      case 'uuid':
        // Drawn at replay, a new one per use; a sample here would be an id the run never pastes.
        return { raw: '', ready: true, unknown: true, label: t('clipboard.source.value') };
      case 'env':
        // The machine has it; a WebView does not.
        return { raw: '', ready: true, unknown: true, label: t('clipboard.source.variableValue') };
      case 'timestamp': {
        // The one source this surface DOES know: the clock. Read when the head changes (opening
        // the surface, switching the unit) — a ticking preview would redraw the ladder every second.
        const now = Date.now();
        return { raw: String(head.ms ? now : Math.floor(now / 1000)), ready: true, unknown: false, label: t('clipboard.source.now'), note: t('clipboard.source.previewTime') };
      }
    }
  }, [head, clipRaw, clipReady, dataTable, runState]);

  const preview = useMemo(() => applyTransformPreview(source.raw, state), [source.raw, state]);
  // A reference argument has no value until the macro runs — never fabricate one in the preview.
  const runtimeDependent = previewIsRuntimeDependent(state);
  // A half-typed "@" is neither a reference nor a number to the backend: the modifier is skipped
  // and the caller gets everything. Say that, rather than a preview built from a number the user
  // is no longer using.
  const refUnfinished = argRefIsUnfinished(state);
  const refTip = t('clipboard.arg.refTip');
  const numTip = t('clipboard.arg.numTip');

  const set = (patch: Partial<TransformState>) => onStateChange((s) => ({ ...s, ...patch }));

  // The three multi-field step predicates are hoisted into clipboardModifiers so the compact
  // popover ladder lights the same badges from the same rules.
  const linesActive = linesStepActive(state);

  // A split with no delimiter emits nothing and does nothing, so the badge must not claim
  // the step is doing work.
  const splitActive = splitStepActive(state);

  // Same rule for dropnum: an empty suffix is never emitted, so the badge stays dark.
  const dropNumActive = dropNumStepActive(state);
  // And for the three 2.37.0 steps, from the same predicates the popover ladder lights.
  const replaceActive = replaceStepActive(state);
  const shapeActive = shapeStepActive(state);
  const defaultActive = defaultStepActive(state);

  // `next` is clipboard-only: the other heads have no cursor, so offering the control would
  // promise a behaviour their runtime never performs (the same rule ClipboardModifierBody's
  // `showNext` encodes). The ladder then has to RENUMBER rather than start at 2 — the numbers
  // exist to communicate pipeline order, and a gap at the top says nothing true.
  const showSequence = head.kind === 'clipboard';
  const sn = (clipboardStep: number) => (showSequence ? clipboardStep : clipboardStep - 1);

  // Same read-only rule as the chip popover: this surface rebuilds the whole token from state,
  // so a chain carrying an unrepresentable modifier must not be edited here.
  if (state.unmodeled) {
    return (
      <div data-clip-surface className="absolute inset-0 z-20 bg-bg-elevated flex flex-col">
        <div className="h-9 px-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
          <button type="button" onClick={onBack}
            className="flex items-center gap-1 h-6 px-1.5 text-caption rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors">
            <ChevronLeft size={13} />
            {t('clipboard.back')}
          </button>
          <div className="w-px h-4 bg-border-subtle" />
          <Wand2 size={13} className="text-accent-hover shrink-0" />
          <div className="text-minor font-semibold text-text-primary flex-1">{HEAD_TITLES[head.kind]}</div>
        </div>
        <div className="flex-1 p-4 space-y-3">
          {/* A warning, not an error: the token runs — only the builder declines to rebuild it.
              The same Callout the popover body shows, so read-only has one look. */}
          <Callout tone="warn" still role="status">
            {state.unmodeledRefArg
              ? t('clipboard.readOnly.refArgSurface')
              : t('clipboard.readOnly.unknownSurface')}
          </Callout>
          <div className="label-micro text-text-tertiary">{t('clipboard.token')}</div>
          <div className="font-mono text-minor px-2 py-1 rounded break-all"
            style={{
              color: 'var(--color-action-sendtext-fg)',
              background: 'color-mix(in srgb, var(--color-action-sendtext-fg) 10%, transparent)',
            }}>
            {token}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-clip-surface className="absolute inset-0 z-20 bg-bg-elevated flex flex-col">
      {/* Sub-header — local back affordance, ThemeEditor sub-surface style. */}
      <div className="h-9 px-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 h-6 px-1.5 text-caption rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors"
          data-tip={backTip ?? t('clipboard.backTip')}
        >
          <ChevronLeft size={13} />
          {t('clipboard.back')}
        </button>
        <div className="w-px h-4 bg-border-subtle" />
        <Wand2 size={13} className="text-accent-hover shrink-0" />
        <div className="text-minor font-semibold text-text-primary flex-1">{HEAD_TITLES[head.kind]}</div>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 h-6 px-1.5 text-caption rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors"
        >
          <RotateCcw size={12} />
          {t('common.actions.reset')}
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Config column — single column, backend pipeline order. Capped: its widest row
            is a segmented control plus two number inputs, so past ~560px it just grows
            whitespace. Everything left over goes to the preview rail, which is the part
            that actually benefits from width (long clipboard lines wrap less). */}
        <div className="min-w-0 flex-1 max-w-[560px] overflow-y-auto p-4 space-y-3">
          {/* Identity, NOT a pipeline step — which slot, which variable, which column, which
              history item, which unit. Unnumbered on purpose: the ladder's numbers mean "order
              the backend applies these in", and this is not one of them. The head-only kinds have
              none: the head is the value, so nothing is drawn above their ladder. */}
          {!HEAD_ONLY.has(head.kind) && (
            <div className="rounded border border-border-subtle bg-bg-card px-3 py-1.5">
              <div className="label-micro text-text-tertiary mb-1">{IDENTITY_LABELS[head.kind]}</div>
              {head.kind === 'winclip' ? (
                <div className="flex items-center gap-2">
                  <NumberInput
                    value={head.index}
                    onChange={(n) => onHeadChange({ kind: 'winclip', index: n < 1 ? 1 : n })}
                    min={1}
                    inputWidth="w-16"
                    inputHeight="h-8"
                    ariaLabel={t('clipboard.identity.historyItem')}
                  />
                  <span className="text-caption text-text-tertiary">{t('clipboard.identity.mostRecent')}</span>
                </div>
              ) : head.kind === 'timestamp' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <SegmentedControl<'s' | 'ms'>
                    ariaLabel={t('clipboard.identity.unit')}
                    options={[
                      { value: 's', label: t('clipboard.identity.seconds') },
                      { value: 'ms', label: t('clipboard.identity.milliseconds') },
                    ]}
                    value={head.ms ? 'ms' : 's'}
                    onChange={(v) => onHeadChange({ kind: 'timestamp', ms: v === 'ms' })}
                  />
                </div>
              ) : head.kind === 'row' || head.kind === 'rownext' ? (
                <input
                  type="text"
                  value={head.column}
                  // A column is any header (RowDataTokenRegex, 2.37.0) — only the token grammar's
                  // own { } : are out, since they would end the token or start the chain.
                  onChange={(e) => onHeadChange({ kind: head.kind, column: e.target.value.replace(/[{}:]/g, '') })}
                  autoFocus
                  spellCheck={false}
                  placeholder={t('clipboard.identity.columnPlaceholder')}
                  className="input-field font-mono"
                />
              ) : head.kind === 'var' || head.kind === 'clip' || head.kind === 'env' ? (
                <input
                  type="text"
                  value={head.name}
                  // The same charset, plus the parentheses an environment variable name can carry
                  // (ProgramFiles(x86)) — EnvTokenRegex's charset, so the token round-trips.
                  onChange={(e) => {
                    const clean = e.target.value.replace(head.kind === 'env' ? /[^A-Za-z0-9_()]/g : /[^A-Za-z0-9_]/g, '');
                    onHeadChange({ kind: head.kind, name: clean });
                  }}
                  autoFocus
                  spellCheck={false}
                  placeholder={head.kind === 'env' ? t('clipboard.identity.envPlaceholder') : t('clipboard.identity.namePlaceholder')}
                  className="input-field font-mono"
                />
              ) : null /* the head-only kinds never reach this card (HEAD_ONLY above) */}
              <div className="text-caption text-text-tertiary mt-1 leading-snug">
                {IDENTITY_HINTS[head.kind]}
              </div>
              {/* Reserved validation line — ALWAYS mounted, so emptying the field cannot grow the
                  identity block. An empty name builds a broken token ({clip:}), which the footer's
                  Insert already refuses; this is what says WHY. winclip never shows it —
                  chainHeadIsUsable is true for it. */}
              <FieldError
                show={!chainHeadIsUsable(head)}
                className="text-caption mt-1"
                style={{ color: 'var(--color-recording-fg)' }}
              >
                {head.kind === 'row' || head.kind === 'rownext'
                  ? t('clipboard.identity.nameColumn')
                  : t('clipboard.identity.nameIt')}
              </FieldError>
            </div>
          )}

          {/* Step 1 because the backend applies it first — it picks WHICH text the rest of the
              ladder then transforms. The steps below shifted up by one to keep the numbering
              honest about pipeline order, which is what the ladder exists to communicate. */}
          {showSequence && (
          <Step n={1} title={t('clipboard.steps.sequence')} active={state.next}>
            <CheckRow
              checked={state.next}
              onChange={() => set({ next: !state.next })}
              label={t('clipboard.sequence.onePerUse')}
            />
            {/* The ON state is the one that needs a sentence; "Off: pastes the whole clipboard"
                only repeated the unchecked box, and the three Off lines together cost the ladder
                a step's worth of height. */}
            {state.next && (
              <div className="text-caption text-text-tertiary leading-snug mt-1">
                {t('clipboard.sequence.onHint')}
              </div>
            )}
          </Step>
          )}

          <Step n={sn(2)} title={t('clipboard.steps.trim')} active={state.trim}>
            <CheckRow
              checked={state.trim}
              onChange={() => set({ trim: !state.trim })}
              label={t('clipboard.trim.whitespace')}
            />
          </Step>

          {/* Replace runs right after trim in the emitted chain — on the raw text, before any cut.
              Two raw arguments like the join separator: no colon in either, and an EMPTY "with"
              deletes every match. */}
          <Step n={sn(3)} title={t('clipboard.steps.replace')} active={replaceActive}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={state.replaceFrom}
                  onChange={(e) => set({ replaceFrom: e.target.value.replace(/[{}:]/g, '') })}
                  placeholder={t('clipboard.replace.findPlaceholder')}
                  aria-label={t('clipboard.replace.find')}
                  data-tip={t('clipboard.replace.findTip')}
                  className="input-field font-mono w-28"
                />
                <span className="text-caption text-text-tertiary">→</span>
                <input
                  type="text"
                  value={state.replaceTo}
                  onChange={(e) => set({ replaceTo: e.target.value.replace(/[{}:]/g, '') })}
                  disabled={state.replaceFrom.length === 0}
                  placeholder={t('clipboard.replace.withPlaceholder')}
                  aria-label={t('clipboard.replace.with')}
                  data-tip={t('clipboard.replace.withTip')}
                  className="input-field font-mono w-28"
                />
              </div>
            </div>
          </Step>

          {/* Every step with arguments is ONE wrapping row: the mode, then its arguments — ALWAYS
              mounted and inert while the mode does not use them (Join with already worked this way,
              and so does the popover ladder). The column keeps its shape when a mode changes, and
              the user sees what each mode asks for before choosing it. */}
          <Step n={sn(4)} title={t('clipboard.steps.splitAt')} active={splitActive}>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl<Split>
                  ariaLabel={t('clipboard.split.label')}
                  options={[
                    { value: 'none', label: t('clipboard.split.off') },
                    { value: 'before', label: t('clipboard.split.before') },
                    { value: 'after', label: t('clipboard.split.after') },
                  ]}
                  value={state.split}
                  onChange={(v) => set({ split: v })}
                />
                <input
                  type="text"
                  value={state.splitDelim}
                  // A SPACE is deliberately allowed — " - " is the delimiter this control
                  // exists for. So is a COLON: buildModifierParts doubles it into "::" on
                  // the way out. Only the braces are unrepresentable, since they end the
                  // token itself.
                  onChange={(e) => set({ splitDelim: e.target.value.replace(/[{}]/g, '') })}
                  disabled={state.split === 'none'}
                  placeholder=" - "
                  aria-label={t('clipboard.split.delimiter')}
                  data-tip={t('clipboard.split.delimiterTip')}
                  className="input-field font-mono w-28"
                />
                <CheckRow
                  checked={state.splitLast}
                  onChange={() => set({ splitLast: !state.splitLast })}
                  label={t('clipboard.split.lastMatch')}
                  disabled={state.split === 'none'}
                />
              </div>
              {state.split !== 'none' && (
                <div className="text-caption text-text-tertiary leading-snug">
                  {t('clipboard.split.absentHint')}
                </div>
              )}
            </div>
          </Step>

          <Step n={sn(5)} title={t('clipboard.steps.dropCount')} active={dropNumActive}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={state.dropNumSuffix}
                  onChange={(e) => set({ dropNumSuffix: e.target.value.replace(/[{}]/g, '') })}
                  placeholder="x "
                  aria-label={t('clipboard.dropCount.suffix')}
                  data-tip={t('clipboard.dropCount.suffixTip')}
                  className="input-field font-mono w-28"
                />
              </div>
              {state.dropNumSuffix.length > 0 && (
                <div className="text-caption text-text-tertiary leading-snug">
                  {t('clipboard.dropCount.hint')}
                </div>
              )}
            </div>
          </Step>

          <Step n={sn(6)} title={t('clipboard.steps.lines')} active={linesActive}>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl<ListPick>
                  ariaLabel={t('clipboard.steps.lines')}
                  options={[
                    { value: 'none', label: t('clipboard.lines.all') },
                    { value: 'range', label: t('clipboard.lines.range') },
                    { value: 'lines', label: t('clipboard.lines.pick') },
                  ]}
                  value={state.listPick}
                  onChange={(v) => set({ listPick: v })}
                />
                {/* Range pair, then the Pick #s spec — the same order as the segments. */}
                <span className="flex items-center gap-1">
                  <NumberInput
                    value={state.rangeFrom}
                    onChange={(n) => set({ rangeFrom: Math.max(1, n) })}
                    onClear={() => set({ rangeFrom: null })}
                    disabled={state.listPick !== 'range'}
                    min={1}
                    placeholder="1"
                    ariaLabel={t('clipboard.lines.firstLine')}
                    inputWidth="w-14"
                    inputHeight="h-8"
                  />
                  <span className="text-caption text-text-tertiary">–</span>
                  <NumberInput
                    value={state.rangeTo}
                    onChange={(n) => set({ rangeTo: Math.max(1, n) })}
                    onClear={() => set({ rangeTo: null })}
                    disabled={state.listPick !== 'range'}
                    min={1}
                    placeholder={t('clipboard.openEnd')}
                    ariaLabel={t('clipboard.lines.lastLine')}
                    inputWidth="w-14"
                    inputHeight="h-8"
                  />
                </span>
                <input
                  type="text"
                  value={state.linesSpec}
                  onChange={(e) => set({ linesSpec: e.target.value.replace(/[^0-9,]/g, '') })}
                  disabled={state.listPick !== 'lines'}
                  placeholder="3,1,2"
                  aria-label={t('clipboard.lines.numbers')}
                  data-tip={t('clipboard.lines.numbersTip')}
                  className="input-field font-mono w-24"
                />
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <CheckRow checked={state.sort} onChange={() => set({ sort: !state.sort })} label={t('clipboard.lines.sort')} />
                <CheckRow checked={state.dedupe} onChange={() => set({ dedupe: !state.dedupe })} label={t('clipboard.lines.dedupe')} />
                <CheckRow checked={state.reverse} onChange={() => set({ reverse: !state.reverse })} label={t('clipboard.lines.reverse')} />
              </div>
              <div className="flex items-center gap-2">
                <CheckRow checked={state.join} onChange={() => set({ join: !state.join })} label={t('clipboard.lines.joinWith')} />
                <input
                  type="text"
                  value={state.joinSep}
                  // Unlike the split delimiter above, a colon CANNOT be escaped here: an empty
                  // separator is meaningful for join and is emitted as an explicit empty part,
                  // so "::" already means "glue with nothing" in tokens that exist on disk.
                  onChange={(e) => set({ joinSep: e.target.value.replace(/[{}:]/g, '') })}
                  disabled={!state.join}
                  placeholder=","
                  data-tip={t('clipboard.lines.joinTip')}
                  className="input-field font-mono w-24"
                />
              </div>
            </div>
          </Step>

          <Step n={sn(7)} title={t('clipboard.steps.extract')} active={state.extract !== 'none'}>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl<Extract>
                  ariaLabel={t('clipboard.steps.extract')}
                  options={[
                    { value: 'none', label: t('clipboard.extract.everything') },
                    { value: 'line', label: t('clipboard.extract.line') },
                    { value: 'word', label: t('clipboard.extract.word') },
                    { value: 'words', label: t('clipboard.extract.words') },
                  ]}
                  value={state.extract}
                  onChange={(v) => set({ extract: v })}
                />
                {/* The # for Line/Word, then the Words span — the same order as the segments. */}
                <ArgInput
                  value={state.extractN}
                  onChange={(n) => set({ extractN: Math.max(1, n) })}
                  refValue={state.extractRef}
                  onRefChange={(r) => set({ extractRef: r })}
                  disabled={state.extract !== 'line' && state.extract !== 'word'}
                  min={1}
                  refTip={refTip}
                  numTip={numTip}
                />
                <span
                  className="flex items-center gap-1"
                  data-tip={t('clipboard.extract.wordsTip')}
                >
                  <NumberInput
                    value={state.wordsFrom}
                    onChange={(n) => set({ wordsFrom: Math.max(1, n) })}
                    onClear={() => set({ wordsFrom: null })}
                    disabled={state.extract !== 'words'}
                    min={1}
                    placeholder="1"
                    ariaLabel={t('clipboard.extract.firstWord')}
                    inputWidth="w-14"
                    inputHeight="h-8"
                  />
                  <span className="text-caption text-text-tertiary">–</span>
                  <NumberInput
                    value={state.wordsTo}
                    onChange={(n) => set({ wordsTo: Math.max(1, n) })}
                    onClear={() => set({ wordsTo: null })}
                    disabled={state.extract !== 'words'}
                    min={1}
                    placeholder={t('clipboard.openEnd')}
                    ariaLabel={t('clipboard.extract.lastWord')}
                    inputWidth="w-14"
                    inputHeight="h-8"
                  />
                </span>
              </div>
            </div>
          </Step>

          <Step n={sn(8)} title={t('clipboard.steps.limit')} active={state.limit !== 'none'}>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl<Limit>
                  ariaLabel={t('clipboard.steps.limit')}
                  options={[
                    { value: 'none', label: t('clipboard.limit.none') },
                    { value: 'first', label: t('clipboard.limit.first') },
                    { value: 'last', label: t('clipboard.limit.last') },
                  ]}
                  value={state.limit}
                  onChange={(v) => set({ limit: v })}
                />
                <ArgInput
                  value={state.limitN}
                  onChange={(n) => set({ limitN: Math.max(0, n) })}
                  refValue={state.limitRef}
                  onRefChange={(r) => set({ limitRef: r })}
                  disabled={state.limit === 'none'}
                  min={0}
                  refTip={refTip}
                  numTip={numTip}
                />
              </div>
            </div>
          </Step>

          <Step n={sn(9)} title={t('clipboard.steps.cleanUp')} active={state.noAccents || state.digitsOnly}>
            {/* Character-class filters over the value at THIS point of the chain — the
                builder emits them after the slice/limit steps and before Case (slice,
                then clean, then case), which is why the step sits here in the ladder. */}
            <div className="flex items-center gap-4 flex-wrap">
              <CheckRow
                checked={state.noAccents}
                onChange={() => set({ noAccents: !state.noAccents })}
                label={t('clipboard.cleanUp.noAccents')}
              />
              <CheckRow
                checked={state.digitsOnly}
                onChange={() => set({ digitsOnly: !state.digitsOnly })}
                label={t('clipboard.cleanUp.digitsOnly')}
              />
            </div>
          </Step>

          {/* count → pad, then case, then default: the number of lines is what gets padded. */}
          <Step n={sn(10)} title={t('clipboard.steps.countPad')} active={shapeActive}>
            <div className="flex items-center gap-4 flex-wrap">
              <CheckRow
                checked={state.count}
                onChange={() => set({ count: !state.count })}
                label={t('clipboard.countPad.countLines')}
              />
              <CheckRow
                checked={state.pad}
                onChange={() => set({ pad: !state.pad })}
                label={t('clipboard.countPad.zeroPad')}
              />
              <ArgInput
                value={state.padN}
                onChange={(n) => set({ padN: Math.min(Math.max(0, n), MAX_PAD_WIDTH) })}
                refValue={state.padRef}
                onRefChange={(r) => set({ padRef: r })}
                disabled={!state.pad}
                min={0}
                max={MAX_PAD_WIDTH}
                refTip={refTip}
                numTip={numTip}
              />
            </div>
          </Step>

          <Step n={sn(11)} title={t('clipboard.steps.textCase')} active={state.case !== 'none'}>
            {/* Wrap like Steps 2-4 so the block-level SegmentedControl track hugs its
                buttons instead of stretching to the full config-column width (which left
                a wide empty pill after the last "Title" segment). */}
            <div className="flex items-center gap-2 flex-wrap">
              <SegmentedControl<CaseTransform>
                ariaLabel={t('clipboard.steps.textCase')}
                options={[
                  { value: 'none', label: t('clipboard.textCase.none') },
                  { value: 'upper', label: t('clipboard.textCase.upper') },
                  { value: 'lower', label: t('clipboard.textCase.lower') },
                  { value: 'sentence', label: t('clipboard.textCase.sentence') },
                  { value: 'title', label: t('clipboard.textCase.title') },
                ]}
                value={state.case}
                onChange={(v) => set({ case: v })}
              />
            </div>
          </Step>

          {/* LAST: the fallback sees the FINAL value, and only an empty one. */}
          <Step n={sn(12)} title={t('clipboard.steps.fallback')} active={defaultActive}>
            <div className="space-y-2">
              <input
                type="text"
                value={state.defaultText}
                onChange={(e) => set({ defaultText: e.target.value.replace(/[{}]/g, '') })}
                placeholder={t('clipboard.fallback.placeholder')}
                aria-label={t('clipboard.fallback.label')}
                data-tip={t('clipboard.fallback.tip')}
                className="input-field font-mono"
              />
              {state.defaultText.length > 0 && (
                <div className="text-caption text-text-tertiary leading-snug">
                  {t('clipboard.fallback.hint')}
                </div>
              )}
            </div>
          </Step>
        </div>

        {/* Preview rail — permanent, unlike the old popover's cramped strip. Takes all the
            width the capped config column leaves (was a fixed 320px with ~400px sitting
            empty beside it); min-w keeps it readable if the dialog is ever narrow.
            Source, Result and Token stack at the TOP and size to their content: the Result used
            to be flex-1, which turned "(empty)" into a green panel the height of the dialog with
            the Token pinned to the footer — the loudest thing on the screen, saying nothing. Now
            it grows with the text up to ~40 % of the viewport and scrolls inside, the way the
            rail's Preview tab already does. */}
        <div className="flex-1 min-w-[320px] border-l border-border-subtle bg-bg-surface p-3 flex flex-col gap-2 min-h-0 overflow-y-auto">
          <div className="shrink-0">
            <div className="flex items-center justify-between mb-1">
              <div className="label-micro text-text-tertiary">
                {source.label}
                {source.note && <span className="normal-case opacity-70"> · {source.note}</span>}
              </div>
              {/* Labelled, not a bare icon: the surface has no other refresh affordance,
                  so the action names itself instead of hiding behind a tooltip. Only the
                  clipboard is re-readable from here — the rest arrive by push. */}
              {head.kind === 'clipboard' && (
                <button
                  type="button"
                  onClick={refresh}
                  className="h-5 px-1.5 inline-flex items-center gap-1 rounded label-micro text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors"
                >
                  <RefreshCw size={11} className="shrink-0" />
                  {t('clipboard.refresh')}
                </button>
              )}
            </div>
            <div
              className="font-mono text-caption text-text-secondary bg-bg-input border border-border-subtle px-2 py-1 rounded whitespace-pre-wrap break-all max-h-24 overflow-auto"
              style={{ lineHeight: 1.35 }}
            >
              {source.unknown ? (
                <span className="italic text-text-disabled">{UNKNOWN_SOURCE_COPY[head.kind]}</span>
              ) : source.ready ? (
                source.raw === '' ? <span className="italic text-text-disabled">{t('clipboard.empty')}</span> : source.raw
              ) : (
                <span className="italic text-text-disabled">{t('clipboard.reading')}</span>
              )}
            </div>
          </div>

          <div className="shrink-0 flex flex-col">
            <div className="label-micro text-text-tertiary mb-1 shrink-0">{t('clipboard.result')}</div>
            <div
              className="min-h-[64px] max-h-[calc(40vh/var(--ui-zoom))] font-mono text-caption px-2 py-1 rounded border whitespace-pre-wrap break-all overflow-auto"
              style={{
                background: 'color-mix(in srgb, var(--color-replay) 8%, transparent)',
                borderColor: 'color-mix(in srgb, var(--color-replay) 40%, transparent)',
                color: 'var(--color-replay-fg)',
              }}
            >
              {/* No source, no honest result — this outranks everything below, because those
                  messages are about the CHAIN and this one is about there being nothing to run
                  it on. Unfinished then FIRST among the rest — see ClipboardModifierBody. */}
              {source.unknown
                ? <span className="italic text-text-disabled">
                    {t('clipboard.noPreview.noSource')}
                  </span>
                : refUnfinished
                ? <span className="italic" style={{ color: 'var(--color-recording-fg)' }}>
                    {t('clipboard.noPreview.refUnfinished')}
                  </span>
                : runtimeDependent
                  ? <span className="italic text-text-disabled">
                      {t('clipboard.noPreview.fromVariable')}
                    </span>
                  : preview === '' ? <span className="italic text-text-disabled">{t('clipboard.empty')}</span> : preview}
            </div>
          </div>

          <div className="shrink-0">
            <div className="label-micro text-text-tertiary mb-1">{t('clipboard.token')}</div>
            <div
              className="font-mono text-minor px-2 py-1 rounded break-all"
              style={{
                color: 'var(--color-action-sendtext-fg)',
                background: 'color-mix(in srgb, var(--color-action-sendtext-fg) 10%, transparent)',
              }}
            >
              {token}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Section shell: step badge + micro title, badge lit while the step is active.
function Step({
  n,
  title,
  active,
  children,
}: {
  n: number;
  title: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`w-4 h-4 rounded-full text-caption font-semibold flex items-center justify-center border transition-colors ${
            active
              ? 'text-accent-hover bg-accent-solid/15 border-accent-solid/40'
              : 'text-text-tertiary bg-bg-surface border-border-subtle'
          }`}
        >
          {n}
        </span>
        <span className="label-micro text-text-tertiary">{title}</span>
      </div>
      <div className="pl-6">{children}</div>
    </div>
  );
}

