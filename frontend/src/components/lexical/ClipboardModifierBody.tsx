import React, { useMemo } from 'react';
import { StepSection, CheckRow, RadioRow, RadioGroup, NumInput, ArgInput } from './popoverAtoms';
import { SegmentedControl } from '../common/SegmentedControl';
import { Callout } from '../common/Callout';
import { t } from '../../i18n';
import {
  applyTransformPreview,
  previewIsRuntimeDependent,
  argRefIsUnfinished,
  buildClipboardToken,
  linesStepActive,
  splitStepActive,
  dropNumStepActive,
  replaceStepActive,
  shapeStepActive,
  defaultStepActive,
  MAX_PAD_WIDTH,
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
   *  uses; the row-cell chip passes "Cell (first row)"). The surface's labels are the catalog's
   *  clipboard.source.* keys, for a caller that wants the same words. */
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
  sourceLabel = t('clipboard.source.clipboardNow'),
  sourceUnknown = false,
  showNext = false,
}: ClipboardModifierBodyProps) {
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
  const replaceActive = replaceStepActive(state);
  const shapeActive = shapeStepActive(state);
  const defaultActive = defaultStepActive(state);

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
  const refTip = t('clipboard.arg.refTipShort');
  const numTip = t('clipboard.arg.numTip');
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
            ? t('clipboard.readOnly.refArg')
            : t('clipboard.readOnly.unknown')}
        </Callout>
        <div className="label-micro text-text-tertiary">{t('clipboard.token')}</div>
        <div className="font-mono text-minor px-2 py-0.5 rounded break-all"
          style={{
            color: 'var(--color-action-sendtext-fg)',
            background: 'color-mix(in srgb, var(--color-action-sendtext-fg) 10%, transparent)',
          }}>
          {token}
        </div>
        <div className="text-caption text-text-tertiary leading-snug">
          {t('clipboard.readOnly.editToChange')}
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
        <StepSection n={1} label={t('clipboard.steps.sequence')} active={state.next}>
          <CheckRow
            checked={state.next}
            onChange={() => setState((s) => ({ ...s, next: !s.next }))}
            label={t('clipboard.sequence.onePerUse')}
          />
          <div className="text-caption text-text-tertiary leading-snug mt-0.5">
            {state.next
              ? t('clipboard.sequence.onHint')
              : t('clipboard.sequence.offHint')}
          </div>
        </StepSection>
      )}

      {/* Trim is its own step, at its own place in the pipeline. It used to be the first row of
          a lumped "Transform" group that also held the accent/digit filters and the whole case
          cluster — three different pipeline stages drawn as one, at the TOP, when case is the
          LAST thing the backend applies. */}
      <StepSection n={sn(2)} label={t('clipboard.steps.trim')} active={state.trim}>
        <CheckRow
          checked={state.trim}
          onChange={() => setState((s) => ({ ...s, trim: !s.trim }))}
          label={t('clipboard.trim.whitespace')}
        />
      </StepSection>

      {/* Replace runs right after trim in the emitted chain — on the raw text, before any cut.
          Two raw arguments like the join separator: no colon in either, and an EMPTY "with"
          deletes every match. */}
      <StepSection n={sn(3)} label={t('clipboard.steps.replace')} active={replaceActive}>
        <div className="flex items-center gap-2 py-0.5">
          <input
            type="text"
            value={state.replaceFrom}
            onChange={(e) => setState((s) => ({ ...s, replaceFrom: e.target.value.replace(/[{}:]/g, '') }))}
            placeholder={t('clipboard.replace.findPlaceholder')}
            aria-label={t('clipboard.replace.find')}
            data-tip={t('clipboard.replace.findTip')}
            className="input-inline font-mono w-[92px]"
          />
          <span className="text-caption text-text-tertiary">→</span>
          <input
            type="text"
            value={state.replaceTo}
            onChange={(e) => setState((s) => ({ ...s, replaceTo: e.target.value.replace(/[{}:]/g, '') }))}
            disabled={state.replaceFrom.length === 0}
            placeholder={t('clipboard.replace.withPlaceholder')}
            aria-label={t('clipboard.replace.with')}
            data-tip={t('clipboard.replace.withTip')}
            className="input-inline font-mono w-[92px]"
          />
        </div>
      </StepSection>

      {/* Cuts the RAW text at a delimiter — in the emitted chain it runs right after replace,
          ahead of every line op. */}
      <StepSection n={sn(4)} label={t('clipboard.steps.splitAt')} active={splitActive}>
        <div className="py-0.5">
          <SegmentedControl<Split>
            dense
            grow
            ariaLabel={t('clipboard.split.label')}
            options={[
              { value: 'none', label: t('clipboard.split.off') },
              { value: 'before', label: t('clipboard.split.before') },
              { value: 'after', label: t('clipboard.split.after') },
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
            aria-label={t('clipboard.split.delimiter')}
            data-tip={t('clipboard.split.delimiterTipAbsent')}
            className="input-inline font-mono w-[104px]"
          />
          <CheckRow
            checked={state.splitLast}
            onChange={() => setState((s) => ({ ...s, splitLast: !s.splitLast }))}
            label={t('clipboard.split.lastMatch')}
            className=""
            disabled={state.split === 'none'}
          />
        </div>
      </StepSection>

      {/* Strip a leading "<digits><suffix>" — runs right after the split in the emitted chain. */}
      <StepSection n={sn(5)} label={t('clipboard.steps.dropCount')} active={dropNumActive}>
        <div className="flex items-center gap-2 py-0.5">
          <input
            type="text"
            value={state.dropNumSuffix}
            onChange={(e) => setState((s) => ({ ...s, dropNumSuffix: e.target.value.replace(/[{}]/g, '') }))}
            placeholder="x "
            aria-label={t('clipboard.dropCount.suffix')}
            data-tip={t('clipboard.dropCount.suffixTip')}
            className="input-inline font-mono w-[104px]"
          />
        </div>
      </StepSection>

      {/* List ops — they operate on the content as LINES, and the backend applies them BEFORE
          the single-line Extract below. They used to be drawn after it. */}
      <StepSection n={sn(6)} label={t('clipboard.steps.lines')} active={linesActive}>
        <RadioGroup label={t('clipboard.steps.lines')}>
          <RadioRow
            checked={state.listPick === 'none'}
            onChange={() => setListPick('none')}
            label={t('clipboard.lines.all')}
          />
          <RadioRow
            checked={state.listPick === 'range'}
            onChange={() => setListPick('range')}
            label={t('clipboard.lines.range')}
            input={
              <span className="flex items-center gap-1">
                <NumInput
                  value={state.rangeFrom}
                  onChange={(n) => setSpan('rangeFrom', n)}
                  onClear={() => setSpan('rangeFrom', null)}
                  disabled={state.listPick !== 'range'}
                  min={1}
                  placeholder="1"
                  ariaLabel={t('clipboard.lines.firstLine')}
                />
                <span className="text-caption text-text-tertiary">–</span>
                <NumInput
                  value={state.rangeTo}
                  onChange={(n) => setSpan('rangeTo', n)}
                  onClear={() => setSpan('rangeTo', null)}
                  disabled={state.listPick !== 'range'}
                  min={1}
                  placeholder={t('clipboard.openEnd')}
                  ariaLabel={t('clipboard.lines.lastLine')}
                />
              </span>
            }
          />
          <RadioRow
            checked={state.listPick === 'lines'}
            onChange={() => setListPick('lines')}
            label={t('clipboard.lines.pick')}
            input={
              <input
                type="text"
                value={state.linesSpec}
                onChange={(e) => setState((s) => ({ ...s, linesSpec: e.target.value.replace(/[^0-9,]/g, '') }))}
                disabled={state.listPick !== 'lines'}
                placeholder="3,1,2"
                className="input-inline font-mono w-[70px]"
              />
            }
          />
        </RadioGroup>
        {/* Row-major: Sort, Dedupe / Reverse. The column-major grid this used to be put Reverse
            beside Sort and Dedupe under it — read left to right it was a zigzag. */}
        <div className="grid grid-cols-2 gap-x-3 mt-1">
          <CheckRow
            checked={state.sort}
            onChange={() => setState((s) => ({ ...s, sort: !s.sort }))}
            label={t('clipboard.lines.sort')}
          />
          <CheckRow
            checked={state.dedupe}
            onChange={() => setState((s) => ({ ...s, dedupe: !s.dedupe }))}
            label={t('clipboard.lines.dedupe')}
          />
          <CheckRow
            checked={state.reverse}
            onChange={() => setState((s) => ({ ...s, reverse: !s.reverse }))}
            label={t('clipboard.lines.reverse')}
          />
        </div>
        <div className="flex items-center gap-2 py-0.5">
          {/* className="" keeps the row inline so the separator input sits beside it. */}
          <CheckRow
            checked={state.join}
            onChange={() => setState((s) => ({ ...s, join: !s.join }))}
            label={t('clipboard.lines.joinWith')}
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
            aria-label={t('clipboard.lines.separator')}
            data-tip={t('clipboard.lines.joinTip')}
            className="input-inline font-mono w-[70px]"
          />
        </div>
      </StepSection>

      <StepSection n={sn(7)} label={t('clipboard.steps.extract')} active={state.extract !== 'none'}>
        <RadioGroup label={t('clipboard.steps.extract')}>
          <RadioRow
            checked={state.extract === 'none'}
            onChange={() => setExtract('none')}
            label={t('clipboard.extract.everything')}
          />
          <RadioRow
            checked={state.extract === 'line'}
            onChange={() => setExtract('line')}
            label={t('clipboard.extract.line')}
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
            label={t('clipboard.extract.word')}
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
            label={t('clipboard.extract.words')}
            input={
              <span
                className="flex items-center gap-1"
                data-tip={t('clipboard.extract.wordsTip')}
              >
                <NumInput
                  value={state.wordsFrom}
                  onChange={(n) => setSpan('wordsFrom', n)}
                  onClear={() => setSpan('wordsFrom', null)}
                  disabled={state.extract !== 'words'}
                  min={1}
                  placeholder="1"
                  ariaLabel={t('clipboard.extract.firstWord')}
                />
                <span className="text-caption text-text-tertiary">–</span>
                <NumInput
                  value={state.wordsTo}
                  onChange={(n) => setSpan('wordsTo', n)}
                  onClear={() => setSpan('wordsTo', null)}
                  disabled={state.extract !== 'words'}
                  min={1}
                  placeholder={t('clipboard.openEnd')}
                  ariaLabel={t('clipboard.extract.lastWord')}
                />
              </span>
            }
          />
        </RadioGroup>
      </StepSection>

      <StepSection n={sn(8)} label={t('clipboard.steps.limit')} active={state.limit !== 'none'}>
        <RadioGroup label={t('clipboard.steps.limit')}>
          <RadioRow
            checked={state.limit === 'none'}
            onChange={() => setLimit('none')}
            label={t('clipboard.limit.none')}
          />
          <RadioRow
            checked={state.limit === 'first'}
            onChange={() => setLimit('first')}
            label={t('clipboard.limit.first')}
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
            label={t('clipboard.limit.last')}
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
      <StepSection n={sn(9)} label={t('clipboard.steps.cleanUp')} active={state.noAccents || state.digitsOnly}>
        <div className="grid grid-cols-2 gap-x-3">
          <CheckRow
            checked={state.noAccents}
            onChange={() => setState((s) => ({ ...s, noAccents: !s.noAccents }))}
            label={t('clipboard.cleanUp.noAccents')}
          />
          <CheckRow
            checked={state.digitsOnly}
            onChange={() => setState((s) => ({ ...s, digitsOnly: !s.digitsOnly }))}
            label={t('clipboard.cleanUp.digitsOnly')}
          />
        </div>
      </StepSection>

      {/* count → pad, then case, then default: the number of lines is what gets padded. */}
      <StepSection n={sn(10)} label={t('clipboard.steps.countPad')} active={shapeActive}>
        <CheckRow
          checked={state.count}
          onChange={() => setState((s) => ({ ...s, count: !s.count }))}
          label={t('clipboard.countPad.countLines')}
        />
        <div className="flex items-center gap-2 py-0.5">
          <CheckRow
            checked={state.pad}
            onChange={() => setState((s) => ({ ...s, pad: !s.pad }))}
            label={t('clipboard.countPad.zeroPad')}
            className=""
          />
          <ArgInput
            value={state.padN}
            onChange={(n) => setState((s) => ({ ...s, padN: Math.min(Math.max(0, n), MAX_PAD_WIDTH) }))}
            refValue={state.padRef}
            onRefChange={(r) => setState((s) => ({ ...s, padRef: r }))}
            disabled={!state.pad}
            min={0}
            max={MAX_PAD_WIDTH}
            refTip={refTip}
            numTip={numTip}
          />
        </div>
      </StepSection>

      {/* The same five values and the same labels as the surface's segmented control (None / UPPER
          / lower / Sentence / Title), as a radio group in two columns so the step stays three rows
          in a popover this narrow. */}
      <StepSection n={sn(11)} label={t('clipboard.steps.textCase')} active={state.case !== 'none'}>
        <RadioGroup label={t('clipboard.steps.textCase')}>
          <div className="grid grid-cols-2 gap-x-3">
            <RadioRow checked={state.case === 'none'} onChange={() => setCase('none')} label={t('clipboard.textCase.none')} />
            <RadioRow checked={state.case === 'upper'} onChange={() => setCase('upper')} label={t('clipboard.textCase.upper')} />
            <RadioRow checked={state.case === 'lower'} onChange={() => setCase('lower')} label={t('clipboard.textCase.lower')} />
            <RadioRow checked={state.case === 'sentence'} onChange={() => setCase('sentence')} label={t('clipboard.textCase.sentence')} />
            <RadioRow checked={state.case === 'title'} onChange={() => setCase('title')} label={t('clipboard.textCase.title')} />
          </div>
        </RadioGroup>
      </StepSection>

      {/* LAST: the fallback sees the FINAL value, and only an empty one. */}
      <StepSection n={sn(12)} label={t('clipboard.steps.fallback')} active={defaultActive}>
        <div className="py-0.5">
          <input
            type="text"
            value={state.defaultText}
            onChange={(e) => setState((s) => ({ ...s, defaultText: e.target.value.replace(/[{}]/g, '') }))}
            placeholder={t('clipboard.fallback.placeholder')}
            aria-label={t('clipboard.fallback.label')}
            data-tip={t('clipboard.fallback.tip')}
            className="input-inline font-mono"
          />
        </div>
      </StepSection>

      <div className="px-3.5 py-1.5 bg-bg-surface border-b border-border-subtle">
        <div className="label-micro text-text-tertiary mb-0.5">{sourceLabel}</div>
        <div
          className="font-mono text-caption text-text-secondary bg-[color-mix(in_srgb,var(--color-text-primary)_3%,transparent)] border-l-2 border-border-subtle px-2 py-0.5 mb-1.5 rounded-r whitespace-pre-wrap break-all max-h-[36px] overflow-auto"
          style={{ lineHeight: 1.35 }}
        >
          {sourceUnknown ? (
            <span className="italic text-text-disabled">
              {t('clipboard.unknown.duringRun')}
            </span>
          ) : clipReady ? (
            clipRaw === '' ? (
              <span className="italic text-text-disabled">{t('clipboard.empty')}</span>
            ) : (
              clipRaw
            )
          ) : (
            <span className="italic text-text-disabled">{t('clipboard.reading')}</span>
          )}
        </div>
        {/* Source → Result → Token, the order and the words ClipboardSurface uses: what goes in,
            what comes out, what gets written. It used to read Source → Token → Preview here. */}
        <div className="label-micro text-text-tertiary mb-0.5">{t('clipboard.result')}</div>
        <div
          className="font-mono text-caption px-2 py-0.5 mb-1.5 rounded border whitespace-pre-wrap break-all min-h-[20px] max-h-[72px] overflow-auto"
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
                {t('clipboard.noPreview.readAtRun')}
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
        <div className="label-micro text-text-tertiary mb-0.5">{t('clipboard.token')}</div>
        <div
          className="font-mono text-minor px-2 py-0.5 rounded break-all"
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
