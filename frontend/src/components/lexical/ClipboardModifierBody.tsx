import React, { useMemo } from 'react';
import { StepSection, CheckRow, RadioRow, RadioGroup, NumInput, ArgInput } from './popoverAtoms';
import { SegmentedControl } from '../common/SegmentedControl';
import { Callout } from '../common/Callout';
import { useTt } from '../../state/LanguageContext';
import {
  applyTransformPreview,
  previewIsRuntimeDependent,
  argRefIsUnfinished,
  buildClipboardToken,
  linesStepActive,
  splitStepActive,
  dropNumStepActive,
  type CaseTransform,
  type Extract,
  type Limit,
  type ListPick,
  type Split,
  type TransformState,
} from './clipboardModifiers';

interface ClipboardModifierBodyProps {
  state: TransformState;
  setState: React.Dispatch<React.SetStateAction<TransformState>>;
  clipRaw: string;
  clipReady: boolean;
  /** Override the displayed token — the row-cell chip passes its {row:col:mods}
   *  build; clipboard consumers omit it and get the {clipboard:mods} build. */
  token?: string;
  /** Label above the raw-source box (default "Clipboard now", the same words ClipboardSurface
   *  uses; the row-cell chip passes "Cell (first row)"). */
  sourceLabel?: string;
  /** The source text is not knowable while editing — {var:}, {clip:} and {winclip:} read run
   *  state that lives in the engine, not in this process. The source and preview boxes then say
   *  so instead of computing from an empty string: "(empty)" would read as "your chain produces
   *  nothing", which is a different claim and the same class of authoritative-looking lie as a
   *  preview built from a reference argument's imaginary value. */
  sourceUnknown?: boolean;
  /** Show the "One line per use" control. CLIPBOARD ONLY — {row:col} / {rownext:col}
   *  share this body but their heads have no 'next' modifier, so the control would
   *  promise a behaviour their runtime never performs. Off by default so a consumer
   *  has to opt in deliberately. */
  showNext?: boolean;
}

// The Transform / Extract / Limit + Source / Token / Preview sections.
// Stateless about UI shell (header, footer, positioning) — those are owned by
// each consumer popover. Keeps the editor markup identical between insert and
// edit flows so users see the same controls in both contexts.
export function ClipboardModifierBody({
  state,
  setState,
  clipRaw,
  clipReady,
  token: tokenOverride,
  sourceLabel = 'Clipboard now',
  sourceUnknown = false,
  showNext = false,
}: ClipboardModifierBodyProps) {
  const tt = useTt();
  const token = useMemo(
    () => tokenOverride ?? buildClipboardToken(state),
    [tokenOverride, state],
  );
  const preview = useMemo(() => applyTransformPreview(clipRaw, state), [clipRaw, state]);
  // A reference argument has no value until the macro runs — never fabricate one in the preview.
  const runtimeDependent = previewIsRuntimeDependent(state);
  // A half-typed "@" is neither a reference nor a number to the backend: the modifier is skipped
  // and the caller gets everything. Say that, rather than a preview built from a number the user
  // is no longer using.
  const refUnfinished = argRefIsUnfinished(state);

  // A real radio: one of five values, "None" included — the checkboxes that used to act as radios
  // here lied about what they were, and the surface's segmented control had a None the popover
  // did not.
  const setCase = (v: CaseTransform) => setState((s) => ({ ...s, case: v }));

  // Step-badge activity, from the same predicates ClipboardSurface lights its ladder with — the
  // two UIs must never disagree about which step is doing work.
  const linesActive = linesStepActive(state);
  const splitActive = splitStepActive(state);
  const dropNumActive = dropNumStepActive(state);

  // `next` is clipboard-only (see showNext), so five of the six heads have no step 1 and the
  // ladder has to RENUMBER rather than start at 2 — the numbers exist to communicate pipeline
  // order, and a gap at the top says nothing true. Identical rule and identical arithmetic to
  // ClipboardSurface's sn(); the two gates agree because ClipboardEditor is the only caller that
  // passes showNext, and it is the clipboard head.
  const sn = (clipboardStep: number) => (showNext ? clipboardStep : clipboardStep - 1);

  const setExtract = (v: Extract) => setState((s) => ({ ...s, extract: v }));
  const setLimit = (v: Limit) => setState((s) => ({ ...s, limit: v }));
  const setExtractN = (n: number) => setState((s) => ({ ...s, extractN: Math.max(1, n) }));
  const setLimitN = (n: number) => setState((s) => ({ ...s, limitN: Math.max(0, n) }));
  const setExtractRef = (r: string) => setState((s) => ({ ...s, extractRef: r }));
  const setLimitRef = (r: string) => setState((s) => ({ ...s, limitRef: r }));
  const refTip = tt('Use a variable instead — @name, @counter or @row', 'Usar uma variável — @nome, @counter ou @row');
  const numTip = tt('Back to a fixed number', 'Voltar para um número fixo');
  const setListPick = (v: ListPick) => setState((s) => ({ ...s, listPick: v }));
  // A span bound of null is an OPEN end ("word 6 onwards"), which is why these go through
  // onClear rather than clamping an empty field back to a number.
  const setSpan = (k: 'wordsFrom' | 'wordsTo' | 'rangeFrom' | 'rangeTo', n: number | null) =>
    setState((s) => ({ ...s, [k]: n === null ? null : Math.max(1, n) }));

  // The chain holds something this editor cannot model, so every control is inert: touching one
  // would rebuild the token and drop the part we did not understand. Say so instead of letting
  // the user poke at dead checkboxes, and point at the one place that CAN edit it losslessly.
  if (state.unmodeled) {
    return (
      <div className="px-3.5 py-2 space-y-2">
        {/* A warning, not an error: nothing is broken — the token runs; only THIS editor declines
            to rebuild it. The app's Callout, so read-only looks the same here and in the surface. */}
        <Callout tone="warn" still role="status">
          {state.unmodeledRefArg
            ? 'Read-only: the line argument comes from a variable, which these controls can’t show. It still runs; an invalid variable yields nothing.'
            : 'Read-only: a modifier here can’t be rebuilt as written (unknown, repeated or reordered).'}
        </Callout>
        <div className="label-micro text-text-tertiary">Token</div>
        <div className="font-mono text-[12px] px-2 py-0.5 rounded break-all"
          style={{
            color: 'var(--color-action-sendtext-fg)',
            background: 'color-mix(in srgb, var(--color-action-sendtext-fg) 10%, transparent)',
          }}>
          {token}
        </div>
        <div className="text-[10px] text-text-tertiary leading-snug">
          {'Edit the token text in the editor to change it.'}
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Step 1 because the backend applies it first — it picks WHICH text the rest of the
          ladder then transforms. Clipboard-only (showNext), which is why every step below
          renumbers through sn(). */}
      {showNext && (
        <StepSection n={1} label="Sequence" active={state.next}>
          <CheckRow
            checked={state.next}
            onChange={() => setState((s) => ({ ...s, next: !s.next }))}
            label="One line per use"
          />
          <div className="text-[10px] text-text-tertiary leading-snug mt-0.5">
            {state.next
              ? 'Each use takes the next line; a new copy starts over. The preview always shows line 1.'
              : 'Pastes the whole clipboard.'}
          </div>
        </StepSection>
      )}

      {/* Trim is its own step, at its own place in the pipeline. It used to be the first row of
          a lumped "Transform" group that also held the accent/digit filters and the whole case
          cluster — three different pipeline stages drawn as one, at the TOP, when case is the
          LAST thing the backend applies. */}
      <StepSection n={sn(2)} label="Trim" active={state.trim}>
        <CheckRow
          checked={state.trim}
          onChange={() => setState((s) => ({ ...s, trim: !s.trim }))}
          label="Trim whitespace"
        />
      </StepSection>

      {/* Cuts the RAW text at a delimiter — in the emitted chain it runs right after trim,
          ahead of every line op. */}
      <StepSection n={sn(3)} label="Split at" active={splitActive}>
        <div className="py-0.5">
          <SegmentedControl<Split>
            dense
            grow
            ariaLabel="Split at a delimiter"
            options={[
              { value: 'none', label: 'Off' },
              { value: 'before', label: 'Before' },
              { value: 'after', label: 'After' },
            ]}
            value={state.split}
            onChange={(v) => setState((s) => ({ ...s, split: v }))}
          />
        </div>
        <div className="flex items-center gap-2 py-0.5">
          <input
            type="text"
            value={state.splitDelim}
            // A SPACE is deliberately allowed: " - " is the delimiter this whole control exists
            // for. So is a COLON — buildModifierParts doubles it into "::" on the way out. Only
            // the braces are unrepresentable, since they end the token itself.
            onChange={(e) => setState((s) => ({ ...s, splitDelim: e.target.value.replace(/[{}]/g, '') }))}
            disabled={state.split === 'none'}
            placeholder=" - "
            aria-label="Delimiter"
            data-tip={tt(
              'Cut here — the delimiter is dropped. Spaces and : allowed, { } not. Absent = empty result.',
              'Corta aqui — o delimitador é descartado. Espaços e : podem, { } não. Ausente = resultado vazio.',
            )}
            className="h-7 w-[104px] px-1.5 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid disabled:opacity-50"
          />
          <CheckRow
            checked={state.splitLast}
            onChange={() => setState((s) => ({ ...s, splitLast: !s.splitLast }))}
            label="Last match"
            className=""
            disabled={state.split === 'none'}
          />
        </div>
      </StepSection>

      {/* Strip a leading "<digits><suffix>" — runs right after the split in the emitted chain. */}
      <StepSection n={sn(4)} label="Drop count" active={dropNumActive}>
        <div className="flex items-center gap-2 py-0.5">
          <input
            type="text"
            value={state.dropNumSuffix}
            onChange={(e) => setState((s) => ({ ...s, dropNumSuffix: e.target.value.replace(/[{}]/g, '') }))}
            placeholder="x "
            aria-label="Count suffix"
            data-tip={tt(
              'Strips leading digits + this text (e.g. "1x "). { } not allowed.',
              'Remove dígitos iniciais + este texto (ex.: "1x "). { } não podem.',
            )}
            className="h-7 w-[104px] px-1.5 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid disabled:opacity-50"
          />
        </div>
      </StepSection>

      {/* List ops — they operate on the content as LINES, and the backend applies them BEFORE
          the single-line Extract below. They used to be drawn after it. */}
      <StepSection n={sn(5)} label="Lines" active={linesActive}>
        <RadioGroup label="Lines">
          <RadioRow
            checked={state.listPick === 'none'}
            onChange={() => setListPick('none')}
            label="All lines"
          />
          <RadioRow
            checked={state.listPick === 'range'}
            onChange={() => setListPick('range')}
            label="Range"
            input={
              <span className="flex items-center gap-1">
                <NumInput
                  value={state.rangeFrom}
                  onChange={(n) => setSpan('rangeFrom', n)}
                  onClear={() => setSpan('rangeFrom', null)}
                  disabled={state.listPick !== 'range'}
                  min={1}
                  placeholder="1"
                  ariaLabel="First line"
                />
                <span className="text-[11px] text-text-tertiary">–</span>
                <NumInput
                  value={state.rangeTo}
                  onChange={(n) => setSpan('rangeTo', n)}
                  onClear={() => setSpan('rangeTo', null)}
                  disabled={state.listPick !== 'range'}
                  min={1}
                  placeholder="end"
                  ariaLabel="Last line"
                />
              </span>
            }
          />
          <RadioRow
            checked={state.listPick === 'lines'}
            onChange={() => setListPick('lines')}
            label="Pick #s"
            input={
              <input
                type="text"
                value={state.linesSpec}
                onChange={(e) => setState((s) => ({ ...s, linesSpec: e.target.value.replace(/[^0-9,]/g, '') }))}
                disabled={state.listPick !== 'lines'}
                placeholder="3,1,2"
                className="h-7 w-[70px] px-1.5 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid disabled:opacity-50"
              />
            }
          />
        </RadioGroup>
        <div className="grid grid-flow-col grid-rows-2 gap-x-3 mt-1">
          <CheckRow
            checked={state.sort}
            onChange={() => setState((s) => ({ ...s, sort: !s.sort }))}
            label="Sort A–Z"
          />
          <CheckRow
            checked={state.dedupe}
            onChange={() => setState((s) => ({ ...s, dedupe: !s.dedupe }))}
            label="Dedupe"
          />
          <CheckRow
            checked={state.reverse}
            onChange={() => setState((s) => ({ ...s, reverse: !s.reverse }))}
            label="Reverse"
          />
        </div>
        <div className="flex items-center gap-2 py-0.5">
          {/* className="" keeps the row inline so the separator input sits beside it. */}
          <CheckRow
            checked={state.join}
            onChange={() => setState((s) => ({ ...s, join: !s.join }))}
            label="Join with"
            className=""
          />
          <input
            type="text"
            value={state.joinSep}
            // Unlike the split delimiter above, a colon CANNOT be escaped here: an empty
            // separator is meaningful for join and is emitted as an explicit empty part, so
            // "::" already means "glue with nothing" in tokens that exist on disk.
            onChange={(e) => setState((s) => ({ ...s, joinSep: e.target.value.replace(/[{}:]/g, '') }))}
            disabled={!state.join}
            placeholder=","
            aria-label="Separator"
            data-tip={tt(
              'Joins lines with this — empty allowed. { } : not allowed.',
              'Une as linhas com isto — vazio permitido. { } : não podem.',
            )}
            className="h-7 w-[70px] px-1.5 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid disabled:opacity-50"
          />
        </div>
      </StepSection>

      <StepSection n={sn(6)} label="Extract" active={state.extract !== 'none'}>
        <RadioGroup label="Extract">
          <RadioRow
            checked={state.extract === 'none'}
            onChange={() => setExtract('none')}
            label="Everything"
          />
          <RadioRow
            checked={state.extract === 'line'}
            onChange={() => setExtract('line')}
            label="Line #"
            input={
              <ArgInput
                value={state.extractN}
                onChange={setExtractN}
                refValue={state.extractRef}
                onRefChange={setExtractRef}
                disabled={state.extract !== 'line'}
                min={1}
                refTip={refTip}
                numTip={numTip}
              />
            }
          />
          <RadioRow
            checked={state.extract === 'word'}
            onChange={() => setExtract('word')}
            label="Word #"
            input={
              <ArgInput
                value={state.extractN}
                onChange={setExtractN}
                refValue={state.extractRef}
                onRefChange={setExtractRef}
                disabled={state.extract !== 'word'}
                min={1}
                refTip={refTip}
                numTip={numTip}
              />
            }
          />
          <RadioRow
            checked={state.extract === 'words'}
            onChange={() => setExtract('words')}
            label="Words"
            input={
              <span
                className="flex items-center gap-1"
                data-tip={tt(
                  'Word range; a blank side is open-ended.',
                  'Intervalo de palavras; lado em branco = sem limite.',
                )}
              >
                <NumInput
                  value={state.wordsFrom}
                  onChange={(n) => setSpan('wordsFrom', n)}
                  onClear={() => setSpan('wordsFrom', null)}
                  disabled={state.extract !== 'words'}
                  min={1}
                  placeholder="1"
                  ariaLabel="First word"
                />
                <span className="text-[11px] text-text-tertiary">–</span>
                <NumInput
                  value={state.wordsTo}
                  onChange={(n) => setSpan('wordsTo', n)}
                  onClear={() => setSpan('wordsTo', null)}
                  disabled={state.extract !== 'words'}
                  min={1}
                  placeholder="end"
                  ariaLabel="Last word"
                />
              </span>
            }
          />
        </RadioGroup>
      </StepSection>

      <StepSection n={sn(7)} label="Limit length" active={state.limit !== 'none'}>
        <RadioGroup label="Limit length">
          <RadioRow
            checked={state.limit === 'none'}
            onChange={() => setLimit('none')}
            label="None"
          />
          <RadioRow
            checked={state.limit === 'first'}
            onChange={() => setLimit('first')}
            label="First N chars"
            input={
              <ArgInput
                value={state.limitN}
                onChange={setLimitN}
                refValue={state.limitRef}
                onRefChange={setLimitRef}
                refTip={refTip}
                numTip={numTip}
                disabled={state.limit !== 'first'}
                min={0}
              />
            }
          />
          <RadioRow
            checked={state.limit === 'last'}
            onChange={() => setLimit('last')}
            label="Last N chars"
            input={
              <ArgInput
                value={state.limitN}
                onChange={setLimitN}
                refValue={state.limitRef}
                onRefChange={setLimitRef}
                refTip={refTip}
                numTip={numTip}
                disabled={state.limit !== 'last'}
                min={0}
              />
            }
          />
        </RadioGroup>
      </StepSection>

      {/* Character-class filters over the value at THIS point of the chain — the builder emits
          them after the slice/limit steps and before Case. */}
      <StepSection n={sn(8)} label="Clean up" active={state.noAccents || state.digitsOnly}>
        <div className="grid grid-flow-col grid-rows-1 gap-x-3">
          <CheckRow
            checked={state.noAccents}
            onChange={() => setState((s) => ({ ...s, noAccents: !s.noAccents }))}
            label="Remove accents"
          />
          <CheckRow
            checked={state.digitsOnly}
            onChange={() => setState((s) => ({ ...s, digitsOnly: !s.digitsOnly }))}
            label="Digits only"
          />
        </div>
      </StepSection>

      {/* LAST, because the backend applies case last. The same five values and the same labels as
          the surface's segmented control (None / UPPER / lower / Sentence / Title), as a radio
          group in two columns so the step stays three rows in a popover this narrow. */}
      <StepSection n={sn(9)} label="Case" active={state.case !== 'none'}>
        <RadioGroup label="Case">
          <div className="grid grid-cols-2 gap-x-3">
            <RadioRow checked={state.case === 'none'} onChange={() => setCase('none')} label="None" />
            <RadioRow checked={state.case === 'upper'} onChange={() => setCase('upper')} label="UPPER" />
            <RadioRow checked={state.case === 'lower'} onChange={() => setCase('lower')} label="lower" />
            <RadioRow checked={state.case === 'sentence'} onChange={() => setCase('sentence')} label="Sentence" />
            <RadioRow checked={state.case === 'title'} onChange={() => setCase('title')} label="Title" />
          </div>
        </RadioGroup>
      </StepSection>

      <div className="px-3.5 py-1.5 bg-bg-surface border-b border-border-subtle">
        <div className="label-micro text-text-tertiary mb-0.5">{sourceLabel}</div>
        <div
          className="font-mono text-[11px] text-text-secondary bg-[color-mix(in_srgb,var(--color-text-primary)_3%,transparent)] border-l-2 border-border-subtle px-2 py-0.5 mb-1.5 rounded-r whitespace-pre-wrap break-all max-h-[36px] overflow-auto"
          style={{ lineHeight: 1.35 }}
        >
          {sourceUnknown ? (
            <span className="italic text-text-disabled">
              {'Known only while the macro runs'}
            </span>
          ) : clipReady ? (
            clipRaw === '' ? (
              <span className="italic text-text-disabled">(empty)</span>
            ) : (
              clipRaw
            )
          ) : (
            <span className="italic text-text-disabled">Reading...</span>
          )}
        </div>
        {/* Source → Result → Token, the order and the words ClipboardSurface uses: what goes in,
            what comes out, what gets written. It used to read Source → Token → Preview here. */}
        <div className="label-micro text-text-tertiary mb-0.5">Result</div>
        <div
          className="font-mono text-[11px] px-2 py-0.5 mb-1.5 rounded border-l-2 whitespace-pre-wrap break-all min-h-[20px] max-h-[72px] overflow-auto"
          style={{
            background: 'color-mix(in srgb, var(--color-replay) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--color-replay) 50%, transparent)',
            color: 'var(--color-replay-fg)',
          }}
        >
          {/* Unfinished FIRST: with one good reference and one half-typed "@", the actionable
              message is the one about the field still waiting on a name. */}
          {sourceUnknown
            ? <span className="italic text-text-disabled">
                {'No preview — this value is read when the macro runs.'}
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
        <div className="label-micro text-text-tertiary mb-0.5">Token</div>
        <div
          className="font-mono text-[12px] px-2 py-0.5 rounded break-all"
          style={{
            color: 'var(--color-action-sendtext-fg)',
            background: 'color-mix(in srgb, var(--color-action-sendtext-fg) 10%, transparent)',
          }}
        >
          {token}
        </div>
      </div>
    </>
  );
}
