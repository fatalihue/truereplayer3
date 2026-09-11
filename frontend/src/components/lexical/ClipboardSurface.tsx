import React, { useMemo } from 'react';
import { ChevronLeft, RefreshCw, RotateCcw, Wand2 } from 'lucide-react';
import { SegmentedControl } from '../common/SegmentedControl';
import { NumberInput } from '../common/NumberInput';
import { FieldError } from '../common/FieldError';
import { Callout } from '../common/Callout';
import { useTt } from '../../state/LanguageContext';
import { ArgInput, CheckRow as PopoverCheckRow, type CheckRowProps } from './popoverAtoms';

// Inline (not full-width) so the Lines / Clean up rows keep wrapping side by side.
const CheckRow = (props: CheckRowProps) => <PopoverCheckRow {...props} className="" />;
import { useClipboardContent } from './useClipboardContent';
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
import { useRunStateSnapshot, lookupRunState } from './useRunStateSnapshot';
import { useAppState } from '../../state/AppStateContext';

// The surface is the ONE place a modifier chain is built, so its title names the SOURCE the
// token reads — "Clipboard" beside "Variable" and "Data column", not "Advanced Clipboard": no head
// is more advanced than the others, and "Advanced…" is the button that opens this, not its name.
const HEAD_TITLES: Record<ChainHead['kind'], string> = {
  clipboard: 'Clipboard',
  row: 'Data column',
  rownext: 'Data column (next row)',
  var: 'Variable',
  clip: 'Clipboard slot',
  winclip: 'Clipboard history',
  counter: 'Run repeat',
  loop: 'Loop iteration',
  datarow: 'Data row number',
  uuid: 'UUID',
  timestamp: 'Timestamp',
  env: 'Environment variable',
};

// The three counters and {uuid} have no identity: the head IS the value, so the card above the
// ladder is not drawn for them at all (see HEAD_ONLY and the render), and these entries exist to
// satisfy the Record.
const IDENTITY_LABELS: Record<ChainHead['kind'], string> = {
  clipboard: '',
  row: 'Data column',
  rownext: 'Data column',
  var: 'Variable name',
  clip: 'Slot name',
  winclip: 'History item',
  counter: '',
  loop: '',
  datarow: '',
  uuid: '',
  timestamp: 'Unit',
  env: 'Variable name',
};

// Heads with nothing above the ladder — the identity card is skipped for them.
const HEAD_ONLY: ReadonlySet<ChainHead['kind']> = new Set(['clipboard', 'counter', 'loop', 'datarow', 'uuid']);

const IDENTITY_HINTS: Record<ChainHead['kind'], string> = {
  clipboard: '',
  row: 'Cell of this column in the current data row.',
  rownext: 'Each use takes the next row (1st → row 1, 2nd → row 2…). Resets each run.',
  var: 'Value stored by Set Variable under this name.',
  clip: 'What Copy to Slot or the capture hotkey stored in this slot.',
  // One line at the column's width — the identity card is what pushes the ladder past the fold.
  winclip: 'Newest first. Needs Win+V history on; may hold anything any app copied — passwords too.',
  counter: '',
  loop: '',
  datarow: '',
  uuid: '',
  timestamp: 'Unix time: seconds since 1970-01-01 UTC, or milliseconds.',
  // The same caution as the history item, for the same reason: a variable set by an installer or
  // a shell profile can hold a key or a token, and nothing here can tell.
  env: 'Read from this machine when the macro runs. May hold anything the system or an app stored — keys too.',
};

// What to say when there is no source to preview against. Each reason is DIFFERENT, and saying
// the wrong one is worse than saying nothing: "nothing captured yet" is fixable by the user,
// "only the engine has it" is not.
const UNKNOWN_SOURCE_COPY: Record<ChainHead['kind'], string> = {
  clipboard: '',
  row: 'No column by that name in the data table',
  rownext: 'No column by that name in the data table',
  var: 'Not set — variables are cleared at the start of every run',
  clip: 'Nothing captured in this slot yet',
  winclip: 'Read from Windows when the macro runs',
  counter: 'Counted while the macro runs',
  loop: 'Counted while the macro runs',
  datarow: 'Counted while the macro runs',
  uuid: 'Generated when the macro runs',
  timestamp: '',
  env: 'Read from the machine when the macro runs',
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
export function ClipboardSurface({ state, onStateChange, head, onHeadChange, onBack, onReset, originalToken }: ClipboardSurfaceProps) {
  const tt = useTt();
  const { clipRaw, clipReady, refresh } = useClipboardContent();
  const runState = useRunStateSnapshot(head.kind === 'clip' || head.kind === 'var');
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
        return { raw: clipRaw, ready: clipReady, unknown: false, label: 'Clipboard now' };
      case 'row':
      case 'rownext': {
        const key = head.column.trim().toLowerCase();
        // LAST duplicate header wins, mirroring the backend's BuildRowDict.
        let idx = -1;
        dataTable.headers.forEach((h, i) => { if (h.trim().toLowerCase() === key) idx = i; });
        if (idx < 0) return { raw: '', ready: true, unknown: true, label: 'Cell (first row)' };
        return { raw: dataTable.rows[0]?.[idx] ?? '', ready: true, unknown: false, label: 'Cell (first row)' };
      }
      case 'clip': {
        const v = lookupRunState(runState.slots, head.name);
        return v === undefined
          ? { raw: '', ready: true, unknown: true, label: 'Slot text' }
          : { raw: v, ready: true, unknown: false, label: 'Slot text' };
      }
      case 'var': {
        const v = lookupRunState(runState.variables, head.name);
        return v === undefined
          ? { raw: '', ready: true, unknown: true, label: 'Variable value' }
          // Variables are cleared at the start of every run, so anything here came from the LAST
          // one. Saying that is the difference between a useful preview and a misleading one.
          : { raw: v, ready: true, unknown: false, label: 'Variable value', note: 'from the last run' };
      }
      case 'winclip':
        // The Windows clipboard history lives in the engine only — nothing to preview against.
        // Labelled "Item text", not "History item": that name already belongs to the field above
        // that picks WHICH item, and the same words over both boxes read as one repeated thing.
        return { raw: '', ready: true, unknown: true, label: 'Item text' };
      case 'counter':
      case 'loop':
      case 'datarow':
        // A run counter exists only inside a run — previewing a chain against "" would claim the
        // chain yields nothing, a statement about the user's work rather than about the source.
        return { raw: '', ready: true, unknown: true, label: 'Value' };
      case 'uuid':
        // Drawn at replay, a new one per use; a sample here would be an id the run never pastes.
        return { raw: '', ready: true, unknown: true, label: 'Value' };
      case 'env':
        // The machine has it; a WebView does not.
        return { raw: '', ready: true, unknown: true, label: 'Variable value' };
      case 'timestamp': {
        // The one source this surface DOES know: the clock. Read when the head changes (opening
        // the surface, switching the unit) — a ticking preview would redraw the ladder every second.
        const t = Date.now();
        return { raw: String(head.ms ? t : Math.floor(t / 1000)), ready: true, unknown: false, label: 'Now', note: 'preview time' };
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
  const refTip = tt('Take this number from a variable instead — @name, @counter, @loop, @row or @datarow',
                    'Pegar este número de uma variável — @nome, @counter, @loop, @row ou @datarow');
  const numTip = tt('Back to a fixed number', 'Voltar para um número fixo');

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
      <div className="absolute inset-0 z-20 bg-bg-elevated flex flex-col">
        <div className="h-9 px-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
          <button type="button" onClick={onBack}
            className="flex items-center gap-1 h-6 px-1.5 text-[11px] rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors">
            <ChevronLeft size={13} />
            Editor
          </button>
          <div className="w-px h-4 bg-border-subtle" />
          <Wand2 size={13} className="text-accent-light shrink-0" />
          <div className="text-xs font-semibold text-text-primary flex-1">{HEAD_TITLES[head.kind]}</div>
        </div>
        <div className="flex-1 p-4 space-y-3">
          {/* A warning, not an error: the token runs — only the builder declines to rebuild it.
              The same Callout the popover body shows, so read-only has one look. */}
          <Callout tone="warn" still role="status">
            {state.unmodeledRefArg
              ? 'Read-only: the line argument comes from a variable, which these controls can’t show. It still runs; an invalid variable yields nothing. Edit the token text in the editor to change it.'
              : 'Read-only: a modifier here can’t be rebuilt as written (unknown, repeated or reordered). Edit the token text in the editor instead.'}
          </Callout>
          <div className="label-micro text-text-tertiary">Token</div>
          <div className="font-mono text-[12px] px-2 py-1 rounded break-all"
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
    <div className="absolute inset-0 z-20 bg-bg-elevated flex flex-col">
      {/* Sub-header — local back affordance, ThemeEditor sub-surface style. */}
      <div className="h-9 px-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 h-6 px-1.5 text-[11px] rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors"
          data-tip={tt('Discards changes', 'Descarta as alterações')}
        >
          <ChevronLeft size={13} />
          Editor
        </button>
        <div className="w-px h-4 bg-border-subtle" />
        <Wand2 size={13} className="text-accent-light shrink-0" />
        <div className="text-xs font-semibold text-text-primary flex-1">{HEAD_TITLES[head.kind]}</div>
        <button
          type="button"
          onClick={onReset}
          className="flex items-center gap-1 h-6 px-1.5 text-[11px] rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors"
        >
          <RotateCcw size={12} />
          Reset
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
                    ariaLabel="History item"
                  />
                  <span className="text-[11px] text-text-tertiary">1 = most recent</span>
                </div>
              ) : head.kind === 'timestamp' ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <SegmentedControl<'s' | 'ms'>
                    ariaLabel="Unit"
                    options={[
                      { value: 's', label: 'Seconds' },
                      { value: 'ms', label: 'Milliseconds' },
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
                  placeholder="column"
                  className="h-8 w-full px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid placeholder:text-text-disabled"
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
                  placeholder={head.kind === 'env' ? 'USERNAME' : 'name'}
                  className="h-8 w-full px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid placeholder:text-text-disabled"
                />
              ) : null /* the head-only kinds never reach this card (HEAD_ONLY above) */}
              <div className="text-[11px] text-text-tertiary mt-1 leading-snug">
                {IDENTITY_HINTS[head.kind]}
              </div>
              {/* Reserved validation line — ALWAYS mounted, so emptying the field cannot grow the
                  identity block. An empty name builds a broken token ({clip:}), which the footer's
                  Insert already refuses; this is what says WHY. English, like every other
                  FieldError call site. winclip never shows it — chainHeadIsUsable is true for it. */}
              <FieldError
                show={!chainHeadIsUsable(head)}
                className="text-[11px] mt-1"
                style={{ color: 'var(--color-recording-fg)' }}
              >
                {head.kind === 'row' || head.kind === 'rownext'
                  ? 'Name the column to build this token'
                  : 'Name it to build this token'}
              </FieldError>
            </div>
          )}

          {/* Step 1 because the backend applies it first — it picks WHICH text the rest of the
              ladder then transforms. The steps below shifted up by one to keep the numbering
              honest about pipeline order, which is what the ladder exists to communicate. */}
          {showSequence && (
          <Step n={1} title="Sequence" active={state.next}>
            <CheckRow
              checked={state.next}
              onChange={() => set({ next: !state.next })}
              label="One line per use"
            />
            {/* The ON state is the one that needs a sentence; "Off: pastes the whole clipboard"
                only repeated the unchecked box, and the three Off lines together cost the ladder
                a step's worth of height. */}
            {state.next && (
              <div className="text-[11px] text-text-tertiary leading-snug mt-1">
                Each use takes the next line; a new copy starts over. The preview always shows line 1.
              </div>
            )}
          </Step>
          )}

          <Step n={sn(2)} title="Trim" active={state.trim}>
            <CheckRow
              checked={state.trim}
              onChange={() => set({ trim: !state.trim })}
              label="Trim whitespace"
            />
          </Step>

          {/* Replace runs right after trim in the emitted chain — on the raw text, before any cut.
              Two raw arguments like the join separator: no colon in either, and an EMPTY "with"
              deletes every match. */}
          <Step n={sn(3)} title="Replace" active={replaceActive}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={state.replaceFrom}
                  onChange={(e) => set({ replaceFrom: e.target.value.replace(/[{}:]/g, '') })}
                  placeholder="find"
                  aria-label="Find"
                  data-tip={tt('Every match, ignoring case. { } : not allowed.', 'Toda ocorrência, sem diferenciar maiúsculas. { } : não podem.')}
                  className="h-8 w-28 px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid placeholder:text-text-disabled"
                />
                <span className="text-[11px] text-text-tertiary">→</span>
                <input
                  type="text"
                  value={state.replaceTo}
                  onChange={(e) => set({ replaceTo: e.target.value.replace(/[{}:]/g, '') })}
                  disabled={state.replaceFrom.length === 0}
                  placeholder="(nothing)"
                  aria-label="Replace with"
                  data-tip={tt('Empty deletes the match. { } : not allowed.', 'Vazio apaga a ocorrência. { } : não podem.')}
                  className="h-8 w-28 px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid disabled:opacity-50 placeholder:text-text-disabled"
                />
              </div>
            </div>
          </Step>

          {/* Every step with arguments is ONE wrapping row: the mode, then its arguments — ALWAYS
              mounted and inert while the mode does not use them (Join with already worked this way,
              and so does the popover ladder). The column keeps its shape when a mode changes, and
              the user sees what each mode asks for before choosing it. */}
          <Step n={sn(4)} title="Split at" active={splitActive}>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl<Split>
                  ariaLabel="Split at a delimiter"
                  options={[
                    { value: 'none', label: 'Off' },
                    { value: 'before', label: 'Before' },
                    { value: 'after', label: 'After' },
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
                  aria-label="Delimiter"
                  data-tip={tt(
                    'Cut here — the delimiter is dropped. Spaces and : allowed, { } not.',
                    'Corta aqui — o delimitador é descartado. Espaços e : podem, { } não.',
                  )}
                  className="h-8 w-28 px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid disabled:opacity-50 placeholder:text-text-disabled"
                />
                <CheckRow
                  checked={state.splitLast}
                  onChange={() => set({ splitLast: !state.splitLast })}
                  label="Last match"
                  disabled={state.split === 'none'}
                />
              </div>
              {state.split !== 'none' && (
                <div className="text-[11px] text-text-tertiary leading-snug">
                  No delimiter in the text = nothing, not the whole text.
                </div>
              )}
            </div>
          </Step>

          <Step n={sn(5)} title="Drop count" active={dropNumActive}>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="text"
                  value={state.dropNumSuffix}
                  onChange={(e) => set({ dropNumSuffix: e.target.value.replace(/[{}]/g, '') })}
                  placeholder="x "
                  aria-label="Count suffix"
                  data-tip={tt(
                    'Strips leading digits + this text (e.g. "1x "). { } not allowed.',
                    'Remove dígitos iniciais + este texto (ex.: "1x "). { } não podem.',
                  )}
                  className="h-8 w-28 px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid placeholder:text-text-disabled"
                />
              </div>
              {state.dropNumSuffix.length > 0 && (
                <div className="text-[11px] text-text-tertiary leading-snug">
                  Strips only a leading count with this exact suffix: "1x Caixa" → "Caixa".
                </div>
              )}
            </div>
          </Step>

          <Step n={sn(6)} title="Lines" active={linesActive}>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl<ListPick>
                  ariaLabel="Lines"
                  options={[
                    { value: 'none', label: 'All lines' },
                    { value: 'range', label: 'Range' },
                    { value: 'lines', label: 'Pick #s' },
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
                    ariaLabel="First line"
                    inputWidth="w-14"
                    inputHeight="h-8"
                  />
                  <span className="text-[11px] text-text-tertiary">–</span>
                  <NumberInput
                    value={state.rangeTo}
                    onChange={(n) => set({ rangeTo: Math.max(1, n) })}
                    onClear={() => set({ rangeTo: null })}
                    disabled={state.listPick !== 'range'}
                    min={1}
                    placeholder="end"
                    ariaLabel="Last line"
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
                  aria-label="Line numbers"
                  data-tip={tt(
                    'Comma-separated line numbers; repeats allowed',
                    'Números de linha separados por vírgula; repetição permitida',
                  )}
                  className="h-8 w-24 px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid disabled:opacity-50 placeholder:text-text-disabled"
                />
              </div>
              <div className="flex items-center gap-4 flex-wrap">
                <CheckRow checked={state.sort} onChange={() => set({ sort: !state.sort })} label="Sort A–Z" />
                <CheckRow checked={state.dedupe} onChange={() => set({ dedupe: !state.dedupe })} label="Dedupe" />
                <CheckRow checked={state.reverse} onChange={() => set({ reverse: !state.reverse })} label="Reverse" />
              </div>
              <div className="flex items-center gap-2">
                <CheckRow checked={state.join} onChange={() => set({ join: !state.join })} label="Join with" />
                <input
                  type="text"
                  value={state.joinSep}
                  // Unlike the split delimiter above, a colon CANNOT be escaped here: an empty
                  // separator is meaningful for join and is emitted as an explicit empty part,
                  // so "::" already means "glue with nothing" in tokens that exist on disk.
                  onChange={(e) => set({ joinSep: e.target.value.replace(/[{}:]/g, '') })}
                  disabled={!state.join}
                  placeholder=","
                  data-tip={tt(
                    'Joins lines with this — empty allowed. { } : not allowed.',
                    'Une as linhas com isto — vazio permitido. { } : não podem.',
                  )}
                  className="h-8 w-24 px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid disabled:opacity-50 placeholder:text-text-disabled"
                />
              </div>
            </div>
          </Step>

          <Step n={sn(7)} title="Extract" active={state.extract !== 'none'}>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl<Extract>
                  ariaLabel="Extract"
                  options={[
                    { value: 'none', label: 'Everything' },
                    { value: 'line', label: 'Line #' },
                    { value: 'word', label: 'Word #' },
                    { value: 'words', label: 'Words' },
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
                  data-tip={tt(
                    'Word range; a blank side is open-ended.',
                    'Intervalo de palavras; lado em branco = sem limite.',
                  )}
                >
                  <NumberInput
                    value={state.wordsFrom}
                    onChange={(n) => set({ wordsFrom: Math.max(1, n) })}
                    onClear={() => set({ wordsFrom: null })}
                    disabled={state.extract !== 'words'}
                    min={1}
                    placeholder="1"
                    ariaLabel="First word"
                    inputWidth="w-14"
                    inputHeight="h-8"
                  />
                  <span className="text-[11px] text-text-tertiary">–</span>
                  <NumberInput
                    value={state.wordsTo}
                    onChange={(n) => set({ wordsTo: Math.max(1, n) })}
                    onClear={() => set({ wordsTo: null })}
                    disabled={state.extract !== 'words'}
                    min={1}
                    placeholder="end"
                    ariaLabel="Last word"
                    inputWidth="w-14"
                    inputHeight="h-8"
                  />
                </span>
              </div>
            </div>
          </Step>

          <Step n={sn(8)} title="Limit length" active={state.limit !== 'none'}>
            <div className="space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <SegmentedControl<Limit>
                  ariaLabel="Limit length"
                  options={[
                    { value: 'none', label: 'None' },
                    { value: 'first', label: 'First N chars' },
                    { value: 'last', label: 'Last N chars' },
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

          <Step n={sn(9)} title="Clean up" active={state.noAccents || state.digitsOnly}>
            {/* Character-class filters over the value at THIS point of the chain — the
                builder emits them after the slice/limit steps and before Case (slice,
                then clean, then case), which is why the step sits here in the ladder. */}
            <div className="flex items-center gap-4 flex-wrap">
              <CheckRow
                checked={state.noAccents}
                onChange={() => set({ noAccents: !state.noAccents })}
                label="Remove accents"
              />
              <CheckRow
                checked={state.digitsOnly}
                onChange={() => set({ digitsOnly: !state.digitsOnly })}
                label="Digits only"
              />
            </div>
          </Step>

          {/* count → pad, then case, then default: the number of lines is what gets padded. */}
          <Step n={sn(10)} title="Count & pad" active={shapeActive}>
            <div className="flex items-center gap-4 flex-wrap">
              <CheckRow
                checked={state.count}
                onChange={() => set({ count: !state.count })}
                label="Count lines"
              />
              <CheckRow
                checked={state.pad}
                onChange={() => set({ pad: !state.pad })}
                label="Zero-pad to"
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

          <Step n={sn(11)} title="Case" active={state.case !== 'none'}>
            {/* Wrap like Steps 2-4 so the block-level SegmentedControl track hugs its
                buttons instead of stretching to the full config-column width (which left
                a wide empty pill after the last "Title" segment). */}
            <div className="flex items-center gap-2 flex-wrap">
              <SegmentedControl<CaseTransform>
                ariaLabel="Case"
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'upper', label: 'UPPER' },
                  { value: 'lower', label: 'lower' },
                  { value: 'sentence', label: 'Sentence' },
                  { value: 'title', label: 'Title' },
                ]}
                value={state.case}
                onChange={(v) => set({ case: v })}
              />
            </div>
          </Step>

          {/* LAST: the fallback sees the FINAL value, and only an empty one. */}
          <Step n={sn(12)} title="Default" active={defaultActive}>
            <div className="space-y-2">
              <input
                type="text"
                value={state.defaultText}
                onChange={(e) => set({ defaultText: e.target.value.replace(/[{}]/g, '') })}
                placeholder="when empty"
                aria-label="Default text"
                data-tip={tt('Used when the result is empty. Spaces and : allowed, { } not.', 'Usado quando o resultado fica vazio. Espaços e : podem, { } não.')}
                className="h-8 w-full px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid placeholder:text-text-disabled"
              />
              {state.defaultText.length > 0 && (
                <div className="text-[11px] text-text-tertiary leading-snug">
                  An unset variable, a missing delimiter or a line past the end pastes this instead of nothing.
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
                  Refresh
                </button>
              )}
            </div>
            <div
              className="font-mono text-[11px] text-text-secondary bg-bg-input border border-border-subtle px-2 py-1 rounded whitespace-pre-wrap break-all max-h-24 overflow-auto"
              style={{ lineHeight: 1.35 }}
            >
              {source.unknown ? (
                <span className="italic text-text-disabled">{UNKNOWN_SOURCE_COPY[head.kind]}</span>
              ) : source.ready ? (
                source.raw === '' ? <span className="italic text-text-disabled">(empty)</span> : source.raw
              ) : (
                <span className="italic text-text-disabled">Reading...</span>
              )}
            </div>
          </div>

          <div className="shrink-0 flex flex-col">
            <div className="label-micro text-text-tertiary mb-1 shrink-0">Result</div>
            <div
              className="min-h-[64px] max-h-[40vh] font-mono text-[11px] px-2 py-1 rounded border-l-2 whitespace-pre-wrap break-all overflow-auto"
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
                    {'No preview until there is something to transform.'}
                  </span>
                : refUnfinished
                ? <span className="italic" style={{ color: 'var(--color-recording-fg)' }}>
                    {'Finish the name after @ — until then the token keeps the fixed number.'}
                  </span>
                : runtimeDependent
                  ? <span className="italic text-text-disabled">
                      {'Resolved when the macro runs — the index comes from a variable.'}
                    </span>
                  : preview === '' ? <span className="italic text-text-disabled">(empty)</span> : preview}
            </div>
          </div>

          <div className="shrink-0">
            <div className="label-micro text-text-tertiary mb-1">Token</div>
            <div
              className="font-mono text-[12px] px-2 py-1 rounded break-all"
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
          className={`w-4 h-4 rounded-full text-[10px] font-semibold flex items-center justify-center border transition-colors ${
            active
              ? 'text-accent-light bg-accent-solid/15 border-accent-solid/40'
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

