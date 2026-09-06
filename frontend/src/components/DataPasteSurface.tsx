import { ChevronLeft, ClipboardPaste, TriangleAlert, Check } from 'lucide-react';
import { SegmentedControl } from './common/SegmentedControl';
import { CheckboxBox } from './Checkbox';
import { useTt } from '../state/LanguageContext';
import type { Grid } from '../lib/tsv';

export type PasteMode = 'replace' | 'append';

// Same rule as DataPanel: a header is a {row:…} token name unless it holds '{', '}' or ':'.
const VALID_HEADER = /^[^{}:]+$/;

interface DataPasteSurfaceProps {
  /** All state is lifted into DataPanel — the DialogShell footer (swapped while
   *  this surface is open) needs the same parse to label its Apply button. */
  text: string;
  onTextChange: (t: string) => void;
  mode: PasteMode;
  onModeChange: (m: PasteMode) => void;
  firstRowHeader: boolean;
  onFirstRowHeaderChange: (v: boolean) => void;
  /** Parsed (debounced) preview of `text` under the current firstRowHeader. */
  parsed: Grid;
  /** Whether the panel currently has a table (labels the Replace-mode copy). */
  hasExistingTable: boolean;
  onBack: () => void;
}

// Full-body "Paste table" sub-surface of the Data Loop panel — the ClipboardSurface
// pattern verbatim: absolute inset-0 OVERLAY inside the dialog's relative body
// wrapper, so the grid underneath never unmounts. Excel stays the heavy editor;
// this surface is the import/bulk-edit path (Replace mode opens PREFILLED with the
// current table, preserving the old paste-over-fix-apply workflow).
export function DataPasteSurface({
  text,
  onTextChange,
  mode,
  onModeChange,
  firstRowHeader,
  onFirstRowHeaderChange,
  parsed,
  hasExistingTable,
  onBack,
}: DataPasteSurfaceProps) {
  const tt = useTt();
  const invalidHeaders = parsed.headers.filter((h) => h && !VALID_HEADER.test(h.trim()));
  const ragged = parsed.rows.some((r) => r.length !== parsed.headers.length);

  return (
    <div className="absolute inset-0 z-20 bg-bg-elevated flex flex-col">
      {/* Sub-header — local back affordance (ClipboardSurface recipe). */}
      <div className="h-9 px-2 flex items-center gap-2 border-b border-border-subtle shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 h-6 px-1.5 text-[11px] rounded text-text-tertiary hover:text-text-primary hover:bg-bg-card transition-colors"
          data-tip={tt('Discards this paste', 'Descarta esta colagem')}
        >
          <ChevronLeft size={13} />
          Grid
        </button>
        <div className="w-px h-4 bg-border-subtle" />
        <ClipboardPaste size={13} className="text-accent-light shrink-0" />
        <div className="text-xs font-semibold text-text-primary flex-1">Paste table</div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Left: mode + textarea. */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="p-2 pb-1.5 shrink-0">
            <SegmentedControl<PasteMode>
              grow
              ariaLabel="Paste mode"
              options={[
                {
                  value: 'replace',
                  label: 'Replace table',
                },
                {
                  value: 'append',
                  label: 'Append rows',
                  tip: tt('Matches columns by name', 'Casa as colunas pelo nome'),
                },
              ]}
              value={mode}
              onChange={onModeChange}
            />
          </div>
          <div className="relative flex-1 min-h-0 dataloop-editor">
            <textarea
              value={text}
              onChange={(e) => onTextChange(e.target.value)}
              spellCheck={false}
              autoFocus
              placeholder={'cliente\tpedido\tvalor\nMaria\t1023\tR$ 89,90\nJoão\t1044\tR$ 149,00'}
              className="w-full h-full font-mono text-xs bg-bg-input p-4 outline-none resize-none whitespace-pre overflow-auto text-text-primary placeholder:text-text-disabled"
            />
          </div>
        </div>

        {/* Right: live parse preview rail. */}
        <div className="w-[320px] shrink-0 border-l border-border-subtle bg-bg-surface p-3 flex flex-col gap-3 min-h-0 overflow-y-auto">
          <button
            type="button"
            role="checkbox"
            aria-checked={firstRowHeader}
            onClick={() => onFirstRowHeaderChange(!firstRowHeader)}
            className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors"
            data-tip={tt(
              'Off: columns become col1…colN and every line is data',
              'Desligado: colunas viram col1…colN e toda linha é dado',
            )}
          >
            <CheckboxBox checked={firstRowHeader} />
            {'First row is the header'}
          </button>

          <div className="text-[11px] text-text-tertiary tabular-nums">
            {parsed.headers.length} {'columns'} · {parsed.rows.length} {'rows'}
          </div>

          {parsed.headers.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="label-micro text-text-tertiary">{'Columns'}</div>
              {parsed.headers.map((h, i) => {
                const name = h.trim();
                const ok = name !== '' && VALID_HEADER.test(name);
                return (
                  <div key={`${h}-${i}`} className="flex items-center gap-1.5 text-[11px] font-mono">
                    {ok ? (
                      <Check size={11} className="text-[color:var(--color-replay-fg)] shrink-0" />
                    ) : (
                      <TriangleAlert size={11} className="text-warning-ink shrink-0" />
                    )}
                    <span className={ok ? 'text-text-secondary' : 'text-warning-ink'}>
                      {name || <span className="italic text-text-disabled">({'empty'})</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {invalidHeaders.length > 0 && (
            <div className="text-[10px] text-text-tertiary leading-relaxed">
              {'⚠ headers holding { } or : can’t be {row:…} tokens, but still save.'}
            </div>
          )}

          {ragged && (
            <div className="text-[10px] text-text-tertiary leading-relaxed">
              {'Rows shorter than the header: missing cells read as empty.'}
            </div>
          )}

          {mode === 'replace' && hasExistingTable && (
            <div className="text-[10px] text-text-tertiary leading-relaxed mt-auto">
              {'Edit in place or paste over it.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
