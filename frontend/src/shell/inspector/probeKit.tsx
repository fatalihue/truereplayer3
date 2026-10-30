import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useBridge } from '../../bridge/BridgeContext';
import { useEditorTools } from '../../logic/useEditorTools';
import { useTt } from '../../state/LanguageContext';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { Popover } from '../Popover';
import { useCheckTarget } from './checkTarget';
import { DraftField, type DraftFieldProps } from './fields';
import { normalHex, useAsk, type Region } from './probes';

/** What a test answered: a line with ✓ or ×, and what follows from it under. */
export function ResultCard({ ok, title, children }: { ok: boolean; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="insp-result" data-ok={ok || undefined} role="status">
      <span className="insp-result-line">
        <span className="step-icon" data-icon={ok ? 'check' : 'x'} />
        <span>{title}</span>
      </span>
      {children && <span className="insp-result-more">{children}</span>}
    </div>
  );
}

/**
 * Where a probe looks: "320 × 120 at 1100, 790" with Redraw and the × that goes back to the whole
 * screen (D16), or "Whole screen" with Draw. Drawing is the engine's overlay; the region it answers
 * with is applied at once. A region that is `required` (an automation's screen read, D16) has no ×,
 * and is "Not drawn yet" until it is.
 */
export function RegionField({ label = 'Search region', region, onRegion, locked, wholeHint, drawTip, required = false }: {
  /** "Search region" for an image; a screen read says "Region to read". */
  label?: string;
  region: Region | null;
  onRegion: (r: Region | null) => void;
  locked: boolean;
  /** Why a region is worth drawing, said while there is none. */
  wholeHint: string;
  drawTip: string;
  required?: boolean;
}) {
  const tools = useEditorTools();
  const target = useCheckTarget();
  const tt = useTt();
  const draw = useAsk('waitimage:searchRegionSet', (p) => {
    if (!p.cancelled && p.w && p.h && p.w > 0 && p.h > 0) onRegion({ x: p.x ?? 0, y: p.y ?? 0, w: p.w, h: p.h });
  });
  return (
    <div className="insp-section">
      <span className="insp-label">{label}</span>
      <div className="insp-region">
        <span className="insp-region-text" data-whole={region ? undefined : ''}>
          {region ? `${region.w} × ${region.h} at ${region.x}, ${region.y}` : required ? 'Not drawn yet' : 'Whole screen'}
        </span>
        <button
          type="button"
          className="insp-button"
          disabled={locked || draw.waiting}
          data-tip={drawTip}
          onClick={() => draw.ask(requestId => tools.configureSearchRegion({ requestId, ...target?.tools, ...region }))}
        >
          <span className="step-icon" data-icon="square-dashed" />
          {draw.waiting ? 'Drawing…' : region ? 'Redraw' : 'Draw'}
        </button>
        {region && !required && (
          <button type="button" className="insp-icon-button" aria-label="Search the whole screen" data-tip={tt('Search the whole screen', 'Procurar na tela inteira')} disabled={locked} onClick={() => onRegion(null)}>
            <span className="step-icon" data-icon="x" />
          </button>
        )}
      </div>
      {!region && <span className="insp-hint">{wholeHint}</span>}
    </div>
  );
}

/** The arrows on a rail send once they stop, like typing in a field (rule 3). */
const RAIL_IDLE_MS = 600;

/**
 * A number on a rail (tolerances): the rail moves at once and sends when the pointer lets it go,
 * when the arrows stop or when it is left; the number sent stays shown until the step answers. The
 * box beside it takes the exact number, up to `max` even where the rail stops sooner.
 */
export function RailField({ stepId, field, label, value, min, max, railMax = max, step = 1, unit, toValue, disabled, onApply }: {
  stepId: string;
  field: string;
  label: string;
  value: number;
  min: number;
  max: number;
  railMax?: number;
  step?: number;
  unit?: string;
  /** The engine's form of the number (a confidence goes as 0.85). */
  toValue?: (n: number) => string;
  disabled?: boolean;
  onApply: (value: string) => void;
}) {
  const [moving, setMoving] = useState<number | null>(null);
  // The number just sent, over the value it was sent from: shown until the answer moves the value.
  const [sent, setSent] = useState<{ n: number; over: number } | null>(null);
  if (sent && sent.over !== value) setSent(null);
  const shown = moving ?? sent?.n ?? value;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const send = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (moving === null) return;
    if (moving !== value) {
      onApply(toValue ? toValue(moving) : String(moving));
      setSent({ n: moving, over: value });
    }
    setMoving(null);
  };
  const sendRef = useRef(send);
  useEffect(() => { sendRef.current = send; });
  // The step's editor going sends an arrow move still waiting.
  useEffect(() => () => flushRail(timer, sendRef), []);
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => setSent(null), 1000);
    return () => clearTimeout(id);
  }, [sent]);
  return (
    <div className="insp-rail">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={railMax}
        step={step}
        value={Math.min(railMax, shown)}
        disabled={disabled}
        onChange={(e) => setMoving(Number(e.target.value))}
        onPointerUp={send}
        onKeyUp={() => {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => sendRef.current(), RAIL_IDLE_MS);
        }}
        onBlur={send}
      />
      <DraftField
        stepId={stepId}
        field={field}
        label={`${label}, exact`}
        kind="int"
        min={min}
        max={max}
        empty="keep"
        unit={unit}
        stored={String(shown)}
        disabled={disabled}
        onApply={(v) => onApply(toValue ? toValue(Number(v)) : v)}
      />
    </div>
  );
}

function flushRail(timer: { current: ReturnType<typeof setTimeout> | null }, send: { current: () => void }) {
  if (!timer.current) return;
  clearTimeout(timer.current);
  timer.current = null;
  send.current();
}

/** A colour as #RRGGBB, with its swatch (dashed while there is none). Empty clears it where `clearable`. */
export function HexField({ clearable, placeholder = '#RRGGBB', ...props }: Omit<DraftFieldProps, 'kind' | 'parse' | 'prefix'> & { clearable?: boolean }) {
  const color = normalHex(props.stored);
  return (
    <div className="insp-hex">
      <span className="insp-swatch" data-none={color ? undefined : ''} style={color ? { background: color } : undefined} />
      <DraftField
        {...props}
        kind="mono"
        placeholder={placeholder}
        parse={(text) => (text.trim() === '' ? (clearable ? '' : null) : normalHex(text))}
      />
    </div>
  );
}

/**
 * The running processes to pick from (process:list), fetched when first opened: a filter by name
 * or title, and the list. Picking fills the field and gives the focus back to the button.
 */
export function ProcessPicker({ onPick, disabled }: { onPick: (name: string) => void; disabled?: boolean }) {
  const tools = useEditorTools();
  const tt = useTt();
  const { subscribe } = useBridge();
  const [open, setOpen] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const [list, setList] = useState<{ name: string; title: string }[] | null>(null);
  const [filter, setFilter] = useState('');
  useEffect(() => subscribe((message) => {
    if (message.type === 'process:list') setList(message.payload.processes);
  }), [subscribe]);
  const f = filter.trim().toLowerCase();
  const shown = (list ?? []).filter(p => !f || p.name.toLowerCase().includes(f) || p.title.toLowerCase().includes(f));
  return (
    <>
      <button
        type="button"
        className="insp-icon-button"
        aria-label="Pick a running process"
        aria-haspopup="dialog"
        aria-expanded={!!open}
        data-tip={tt('Pick a running process', 'Escolher um processo em execução')}
        disabled={disabled}
        onClick={(e) => {
          if (open) { setOpen(null); return; }
          if (list === null) tools.listProcesses({});
          setFilter('');
          setOpen({ anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget });
        }}
      >
        <span className="step-icon" data-icon="list" />
      </button>
      {open && (
        <Popover anchor={open.anchor} label="Running processes" toggle={open.button} focusFirst onClose={() => setOpen(null)}>
          <div className="insp-procs">
            <input
              className="insp-procs-filter"
              type="text"
              aria-label="Filter processes"
              placeholder="Filter…"
              value={filter}
              spellCheck={false}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="insp-procs-list" role="listbox" aria-label="Running processes">
              {list === null ? <span className="insp-procs-none">Loading…</span>
                : shown.length === 0 ? <span className="insp-procs-none">No processes match.</span>
                : shown.map(p => (
                  <button
                    key={`${p.name}\u0000${p.title}`}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => { onPick(p.name); open.button.focus(); setOpen(null); }}
                  >
                    <span className="insp-procs-name">{p.name}</span>
                    {p.title && <span className="insp-procs-title">{p.title}</span>}
                  </button>
                ))}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}
