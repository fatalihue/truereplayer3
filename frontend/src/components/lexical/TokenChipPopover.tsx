import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { Trash2 } from 'lucide-react';
import { ClipboardModifierBody } from './ClipboardModifierBody';
import { useClipboardContent } from './useClipboardContent';
import {
  buildClipboardToken,
  buildRowToken,
  buildRowNextToken,
  buildNameToken,
  buildWinClipToken,
  parseClipboardToken,
  parseRowToken,
  parseRowNextToken,
  parseNameToken,
  parseWinClipToken,
  parseChainToken,
  buildChainToken,
  DEFAULT_TRANSFORM,
  type ChainHead,
  type TransformState,
} from './clipboardModifiers';
import { NumInput, PopoverHeader, RadioGroup, RadioRow, Section } from './popoverAtoms';
import { normalizeToken } from './tokenNormalize';
import { DEFAULT_DATE_FORMAT, parseDateTokenArgs, resolveDateToken, type DateHead, type DateUnit } from './dateFormat';
import { tokenTip } from './tokenDescriptions';
import { useAppState } from '../../state/AppStateContext';
import { uiZoom, rectToLayout, viewportInLayout } from '../../utils/zoomSpace';

// Tokens that accept a `:N` repeat count (e.g. {enter:5}).
const REPEATABLE_TOKEN_NAMES = new Set([
  'enter',
  'tab',
  'space',
  'backspace',
  'delete',
  'escape',
  'home',
  'end',
  'pageup',
  'pagedown',
  'up',
  'down',
  'left',
  'right',
]);

// The ceiling for that `:N`, ported from the parser that will actually run the token instead of
// restated from its intent. ActionExecution.ParseSendTextSegments, after `int.TryParse(...) && n > 0`
// has decided whether N is usable at all, does:
//     int count = hasValidParam ? Math.Min(paramValue, 100) : 1;
// It CLAMPS rather than rejects — {enter:500} presses a hundred times and says nothing — so a
// field that accepts 500 is showing the user a number the run will not honour. Both of the
// backend's gates are mirrored below, in parseRepeatable (what an existing token really means)
// and in the editor's update (what a new value may become).
const MAX_KEY_REPEAT = 100;
// Six digits is what the offset grammar accepts on BOTH sides (dateFormat.OFFSET_RE and
// ActionExecution.DateOffsetRegex, [+-]d{1,6}). A seventh digit stops matching as an offset and
// the segment is re-read as a FORMAT, so the token silently means something else.
const MAX_DATE_OFFSET = 999999;

type TokenKind = 'clipboard' | 'delay' | 'repeatable' | 'random' | 'var' | 'rowcol' | 'rownextcol' | 'clip' | 'winclip' | 'input' | 'pick' | 'date' | 'runstate' | 'env' | 'timestamp' | 'static';

function getTokenKind(token: string): TokenKind {
  const inner = token.slice(1, -1);
  const name = inner.split(':')[0].toLowerCase();
  if (name === 'clipboard') return 'clipboard';
  if (name === 'delay') return 'delay';
  if (name === 'random') return 'random';
  // {var:name} edits its variable name; bare {row} is a static counter while
  // {row:column} edits its data-table column name.
  if (name === 'var') return 'var';
  if (name === 'row' && inner.includes(':')) return 'rowcol';
  // {rownext:column} — like {row:column} but auto-advancing (next data row each use).
  if (name === 'rownext') return 'rownextcol';
  // {clip:name} — a captured clipboard slot (Copy to Slot / capture hotkey).
  if (name === 'clip') return 'clip';
  // {winclip:N} — item N of the Windows clipboard history (Win+V).
  if (name === 'winclip') return 'winclip';
  if (name === 'input') return 'input';
  // {pick:a|b|c} — random text choice among the options.
  if (name === 'pick') return 'pick';
  // {date} / {time} / {datetime} — an offset and a format (2.37.0).
  if (name === 'date' || name === 'time' || name === 'datetime') return 'date';
  // {counter} / {loop} / {datarow} — the run counters take the modifier chain (2.37.0); {uuid}
  // is the same head-only shape (a value plus a chain, nothing to name).
  if (name === 'counter' || name === 'loop' || name === 'datarow' || name === 'uuid') return 'runstate';
  // {env:NAME} — a name-first head like {var}; {timestamp[:ms]} — a unit and a chain.
  if (name === 'env') return 'env';
  if (name === 'timestamp') return 'timestamp';
  if (REPEATABLE_TOKEN_NAMES.has(name)) return 'repeatable';
  return 'static';
}

// The name arg of {var:...}/{clip:...} — verbatim (normalizeToken never touches it).
function parseNameArg(token: string): string {
  const inner = token.slice(1, -1);
  const idx = inner.indexOf(':');
  return idx >= 0 ? inner.slice(idx + 1) : '';
}

function parseRepeatable(token: string): { name: string; n: number } {
  const inner = token.slice(1, -1);
  // Split at the FIRST ':' and keep the whole remainder as the argument, the way the backend
  // does (`inner.Substring(colonIdx + 1)`) — splitting on every ':' would read {enter:5:junk}
  // as 5, while the parser that runs it hands "5:junk" to TryParse and presses once.
  const colonIdx = inner.indexOf(':');
  const name = colonIdx >= 0 ? inner.slice(0, colonIdx) : inner;
  const arg = colonIdx >= 0 ? inner.slice(colonIdx + 1) : undefined;
  // Gate 1 — `int.TryParse(...) && n > 0`. Whatever the backend cannot read as a positive int32
  // is ONE press there, so it has to read as 1 here: parseInt is looser than TryParse (it takes
  // "5abc" as 5 and has no int32 range), which would put a number in the field that the run
  // never sees. The regex is the gate; parseInt then does the conversion.
  const parsed = arg !== undefined && /^[+-]?\d+$/.test(arg.trim()) ? parseInt(arg, 10) : NaN;
  const usable = Number.isFinite(parsed) && parsed >= 1 && parsed <= 2147483647 ? parsed : 1;
  // Gate 2 — Math.Min(paramValue, 100): an existing {enter:500} already runs as 100, so that is
  // the honest number to show. Nothing is emitted from here, so this cannot rewrite the token.
  return { name, n: Math.min(usable, MAX_KEY_REPEAT) };
}

function parseDelay(token: string): { ms: number } {
  const inner = token.slice(1, -1);
  const parts = inner.split(':');
  const parsed = parts[1] !== undefined ? parseInt(parts[1], 10) : 500;
  return { ms: !Number.isFinite(parsed) || parsed < 0 ? 500 : parsed };
}

function parseRandom(token: string): { min: number; max: number } {
  const inner = token.slice(1, -1);
  const m = inner.match(/^random:(\d+)-(\d+)$/i);
  if (!m) return { min: 1, max: 10 };
  const a = parseInt(m[1], 10);
  const b = parseInt(m[2], 10);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { min: 1, max: 10 };
  return a <= b ? { min: a, max: b } : { min: b, max: a };
}

interface TokenChipPopoverProps {
  anchor: HTMLElement;
  token: string;
  onLiveChange: (newToken: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

// Visual shell for chip editing. The owning TokenChip holds the live token in
// a ref and decides whether to commit on close — this component is purely
// presentational + emits onLiveChange/onClose. That layout means every close
// path (Esc, outside click, ✕, clicking the chip again) funnels through the
// same TokenChip.handleClose, so no path can lose unsaved edits.
export function TokenChipPopover({
  anchor,
  token,
  onLiveChange,
  onDelete,
  onClose,
}: TokenChipPopoverProps) {
  const kind = getTokenKind(token);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  // Local state so the header can show the live token; mirror to onLiveChange
  // so the parent's commit-on-close has the latest value to apply. We normalise
  // here so the header preview matches the eventual chip display character-by-
  // character (the chip itself re-normalises on setToken — belt and suspenders).
  const [liveToken, setLiveToken] = useState(() => normalizeToken(token));
  const updateLive = useCallback(
    (next: string) => {
      const normalized = normalizeToken(next);
      setLiveToken(normalized);
      onLiveChange(normalized);
    },
    [onLiveChange],
  );

  // Position below the chip (above if it would overflow the viewport).
  useLayoutEffect(() => {
    if (!anchor || !popRef.current) return;
    const place = () => {
      // Visual reads (rect, viewport) converted to the LAYOUT space that left/top are written
      // in; offsetHeight/offsetWidth are layout already. See utils/zoomSpace.
      const zoom = uiZoom();
      const r = rectToLayout(anchor.getBoundingClientRect(), zoom);
      const popH = popRef.current!.offsetHeight;
      const popW = popRef.current!.offsetWidth;
      const { width: vw, height: vh } = viewportInLayout(zoom);
      let left = r.left;
      let top = r.bottom + 6;
      if (top + popH > vh - 8) top = Math.max(8, r.top - popH - 6);
      if (left + popW > vw - 8) left = vw - popW - 8;
      if (left < 8) left = 8;
      setPos({ left, top });
    };
    place();
    // Also reposition on scroll (capture phase so a scroll in ANY ancestor container counts) —
    // otherwise scrolling the editor leaves the popover detached from its chip. Coalesced to one
    // placement per frame: place() costs three forced layout reads plus a setState, and capture
    // phase means every scrollable ancestor feeds it. The direct place() above keeps the first
    // paint unchanged.
    let raf: number | null = null;
    const onReflow = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => { raf = null; place(); });
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [anchor, kind, token]);

  // Dismiss on outside click or Escape — both delegate to onClose, which the
  // parent maps to its commit-and-close handler.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchor.contains(t)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    // CAPTURE — see the note in LexicalTokenEditor: a chip stops the click on the way up.
    document.addEventListener('mousedown', onMouseDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [anchor, onClose]);

  const visibilityStyle: React.CSSProperties = pos
    ? { visibility: 'visible', left: pos.left, top: pos.top }
    : { visibility: 'hidden', left: 0, top: 0 };

  return ReactDOM.createPortal(
    <div
      ref={popRef}
      // Marker for host-level Esc routers (SendTextDialog): when a chip popover
      // is open, its own capture-phase Esc owns the key — routers must stand down.
      data-token-popover=""
      onMouseDown={(e) => e.stopPropagation()}
      // menu-surface + the gated pop-in (index.css) like every other floating surface — the inline
      // keyframes this used to inject ignored the animations toggle. The accent-tinted border
      // stays as the token popover's own signature.
      style={{
        position: 'fixed',
        ...visibilityStyle,
        zIndex: 100,
        width: kind === 'clipboard' || kind === 'rowcol' || kind === 'rownextcol' || kind === 'pick' || kind === 'date' || kind === 'runstate' || kind === 'timestamp' ? 300 : 260,
        borderColor: 'color-mix(in srgb, var(--color-accent-solid) 35%, transparent)',
        // Divided by --ui-zoom like every other viewport unit in the app: place() above already
        // measures in LAYOUT space (viewportInLayout(zoom)), and a raw 100vh here measures in
        // PAINTED space — the two halves of the same surface disagreeing. At 200 % the raw form
        // resolves to twice the real layout viewport, so it caps nothing and the popover runs off
        // the bottom of the window.
        maxHeight: 'calc(100vh / var(--ui-zoom) - 24px)',
      }}
      className="menu-surface pop-in overflow-hidden flex flex-col"
    >

      {/* The KEYBOARD-reachable copy of the chip's hover tip. TooltipLayer is hover-only — it
          listens on mouseover/mouseout with no focusin path — so a user who reached this popover
          with Enter/Space has no way to read the chip's data-tip. Unknown names fall back rather
          than collapsing the row. withRaw:false because the header already prints the raw token. */}
      <PopoverHeader
        token={liveToken}
        description={tokenTip(liveToken, (en) => en, { withRaw: false }) || 'Token substituted while replaying.'}
        onClose={onClose}
      />

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {kind === 'clipboard' && <ClipboardEditor token={token} onChange={updateLive} />}
        {kind === 'delay' && <DelayEditor token={token} onChange={updateLive} />}
        {kind === 'repeatable' && <RepeatableEditor token={token} onChange={updateLive} />}
        {kind === 'random' && <RandomEditor token={token} onChange={updateLive} />}
        {kind === 'var' && <NameEditor token={token} tokenName="var" onChange={updateLive} />}
        {kind === 'rowcol' && <RowColEditor token={token} onChange={updateLive} />}
        {kind === 'rownextcol' && <RowColEditor token={token} onChange={updateLive} head="rownext" />}
        {kind === 'clip' && <NameEditor token={token} tokenName="clip" onChange={updateLive} />}
        {kind === 'winclip' && <WinClipEditor token={token} onChange={updateLive} />}
        {kind === 'input' && <InputEditor token={token} onChange={updateLive} />}
        {kind === 'pick' && <PickEditor token={token} onChange={updateLive} />}
        {kind === 'date' && <DateEditor token={token} onChange={updateLive} />}
        {kind === 'runstate' && <HeadOnlyEditor token={token} onChange={updateLive} />}
        {kind === 'env' && <NameEditor token={token} tokenName="env" onChange={updateLive} />}
        {kind === 'timestamp' && <TimestampEditor token={token} onChange={updateLive} />}
        {kind === 'static' && <StaticInfo />}
      </div>

      <Footer onDelete={onDelete} />
    </div>,
    document.body,
  );
}

// Actions only — no notes. "No parameters" used to sit here for the static tokens, next to a body
// that already said "No editable parameters."; the body keeps the sentence.
function Footer({ onDelete }: { onDelete: () => void }) {
  return (
    <div className="flex items-center justify-between px-3.5 py-2 bg-bg-card border-t border-border-subtle shrink-0">
      <button
        type="button"
        onClick={onDelete}
        className="flex items-center gap-1 h-7 px-2 text-[11px] rounded text-[color:var(--color-recording-fg)] hover:bg-[color-mix(in_srgb,var(--color-recording)_15%,transparent)] border border-transparent hover:border-[color-mix(in_srgb,var(--color-recording)_30%,transparent)] transition-colors"
      >
        <Trash2 size={12} />
        Delete token
      </button>
    </div>
  );
}

// ── Editors per token kind ──────────────────────────────────────────────────
//
// Each editor manages its own local state and reports the latest token via
// onChange (synchronous). The popover lifts that into liveToken and the parent
// chip into liveTokenRef — neither triggers a chip update, so the controlled
// inputs are never re-rendered by an editor.update() round-trip mid-typing.

function ClipboardEditor({
  token,
  onChange,
}: {
  token: string;
  onChange: (t: string) => void;
}) {
  const [state, setState] = useState<TransformState>(() => parseClipboardToken(token));
  const { clipRaw, clipReady } = useClipboardContent();

  // Report changes only on real user input — NOT from a mount-time effect, matching every other
  // editor here. The effect this replaces fired on mount and emitted the REBUILT token, so merely
  // opening a chip and clicking away committed whatever the parser had failed to understand. That
  // was not theoretical: any modifier this module can't parse round-trips as a silent deletion.
  // Derived from the render-time `state` rather than inside the updater, so onChange stays out
  // of React's updater (which StrictMode invokes twice) — each interaction re-renders before the
  // next one, so the closure value is the current one.
  const update: React.Dispatch<React.SetStateAction<TransformState>> = (action) => {
    // The mount-time emit was fixed before; this is the OTHER half. When the chain carried
    // something the parser could not represent, rebuilding on an edit deletes it just as
    // silently — {clipboard:lines:sort} becomes {clipboard:sort} the moment any checkbox is
    // ticked. Refuse to emit; the body renders read-only and says why.
    if (state.unmodeled) return;
    const next = typeof action === 'function'
      ? (action as (prev: TransformState) => TransformState)(state)
      : action;
    setState(next);
    onChange(buildClipboardToken(next));
  };

  return (
    <ClipboardModifierBody
      state={state}
      setState={update}
      clipRaw={clipRaw}
      clipReady={clipReady}
      showNext
      // Only while read-only. The panel exists to say "rebuilding would drop part of this", and it
      // was rendering the REBUILT token underneath that sentence — showing the loss as if it had
      // already happened, next to a warning that it would. While editable the rebuilt token is the
      // right thing to show: it is what an edit will actually write.
      token={state.unmodeled ? token : undefined}
    />
  );
}

function DelayEditor({ token, onChange }: { token: string; onChange: (t: string) => void }) {
  const initial = parseDelay(token);
  const [ms, setMs] = useState(initial.ms);

  // Report changes only on real user input — NOT from a mount-time effect, which would emit a
  // canonicalized token (e.g. {delay} → {delay:500}) and make merely opening then closing the
  // chip silently rewrite it.
  // Clamp to the backend's 60000ms cap here since the local NumInput has no max prop.
  const update = (v: number) => { const c = Math.min(60000, v); setMs(c); onChange(`{delay:${c}}`); };

  return (
    <Section label="Delay">
      <div className="flex items-center gap-2 py-1">
        {/* width here is the TOTAL span (input + the two 24px steppers), unlike the dialogs'
            inputWidth which sizes the input alone — so it needs extra room to fit "60.000 ms". */}
        <NumInput value={ms} onChange={update} min={0} width={140} thousands suffix="ms" suffixInside />
      </div>
    </Section>
  );
}

function RepeatableEditor({
  token,
  onChange,
}: {
  token: string;
  onChange: (t: string) => void;
}) {
  const initial = parseRepeatable(token);
  const [n, setN] = useState(initial.n);

  // Report changes only on real user input — NOT from a mount-time effect, which would emit a
  // canonicalized token (e.g. {enter:1} → {enter}) and make opening then closing the chip rewrite it.
  // Clamp to MAX_KEY_REPEAT here since the local NumInput has no max prop (same as DelayEditor's
  // 60000 ms cap): the parent-side clamp flows back through NumberInput's value sync, so typing
  // 500 leaves 100 standing in the field rather than a number the engine will quietly cut down.
  const update = (v: number) => {
    const c = Math.min(MAX_KEY_REPEAT, v);
    setN(c);
    onChange(c > 1 ? `{${initial.name}:${c}}` : `{${initial.name}}`);
  };

  return (
    <Section label="Repeat">
      <div className="flex items-center gap-2 py-1">
        <NumInput value={n} onChange={update} min={1} width={70} />
        <span className="text-[11px] text-text-tertiary">
          time{n === 1 ? '' : 's'}
        </span>
      </div>
      {n >= MAX_KEY_REPEAT && (
        <div className="text-[10px] text-text-tertiary mt-1">
          {`${MAX_KEY_REPEAT} presses is the engine's limit for one token.`}
        </div>
      )}
    </Section>
  );
}

function RandomEditor({ token, onChange }: { token: string; onChange: (t: string) => void }) {
  const initial = parseRandom(token);
  const [min, setMin] = useState(initial.min);
  const [max, setMax] = useState(initial.max);

  // Report changes only on real user input (see DelayEditor note) — merely opening
  // the chip must not rewrite it. Reversed bounds are legal; the backend swaps.
  const update = (nextMin: number, nextMax: number) => {
    setMin(nextMin);
    setMax(nextMax);
    onChange(`{random:${nextMin}-${nextMax}}`);
  };

  return (
    <Section label="Random number">
      <div className="flex items-center gap-2 py-1">
        <NumInput value={min} onChange={(v) => update(v, max)} min={0} width={86} thousands />
        <span className="text-[11px] text-text-tertiary">to</span>
        <NumInput value={max} onChange={(v) => update(min, v)} min={0} width={86} thousands />
      </div>
      {/* The header already says "fresh each run"; the bounds are what the control needs
          explained — a plain range reads as exclusive at the top to many people. */}
      <div className="text-[10px] text-text-tertiary mt-1">
        Inclusive.
      </div>
    </Section>
  );
}

// {winclip:N} — pick which item of the Windows clipboard history (Win+V) to paste,
// newest first (1 = the last thing copied). Emits only on real input (same open-then-
// close guard as the others). The note carries the two things a user must know: the
// history has to be enabled, and it can hold anything recently copied — passwords too.
function WinClipEditor({ token, onChange }: { token: string; onChange: (t: string) => void }) {
  const [index, setIndex] = useState(() => parseWinClipToken(token).index);
  const [state, setState] = useState<TransformState>(() => parseWinClipToken(token).state);
  const [displayToken, setDisplayToken] = useState(() => normalizeToken(token));

  // Same emit discipline as RowColEditor: never on mount, never while the chain carries
  // something the parser could not represent. This editor used to rebuild `{winclip:N}` from the
  // index alone, so a hand-typed {winclip:2:trim} lost its chain the moment the chip was touched.
  const emit = (i: number, s: TransformState) => {
    if (s.unmodeled) return;
    const t = buildWinClipToken(i, s);
    setDisplayToken(t);
    onChange(t);
  };

  const update = (v: number) => {
    if (state.unmodeled) return;
    const c = v < 1 ? 1 : v;
    setIndex(c);
    emit(c, state);
  };

  const updateState: React.Dispatch<React.SetStateAction<TransformState>> = (action) => {
    const next = typeof action === 'function' ? action(state) : action;
    setState(next);
    emit(index, next);
  };

  return (
    <>
      <Section label="Clipboard history">
        <div className="flex items-center gap-2 py-1">
          <span className="text-[11px] text-text-tertiary">item</span>
          <NumInput value={index} onChange={update} min={1} width={70} disabled={state.unmodeled} />
          <span className="text-[11px] text-text-tertiary">1 = most recent</span>
        </div>
        {/* The header already says what the token is (Win+V history, 1 = most recent, must be
            enabled); the one fact the header does not carry — and the one the user must know
            before pasting an arbitrary history item — is this. Read-only is said once, by the
            body's Callout below. */}
        <div className="text-[10px] text-text-tertiary mt-1 leading-relaxed">
          May hold anything any app copied — passwords too.
        </div>
      </Section>
      <ClipboardModifierBody
        state={state}
        setState={updateState}
        clipRaw=""
        clipReady
        sourceUnknown
        token={displayToken}
        // "Item text", not "History item": that name belongs to the field above that picks WHICH
        // item — the same split ClipboardSurface makes.
        sourceLabel="Item text"
      />
    </>
  );
}

// Shared editor for the simple name-bearing tokens: {var:name} (runtime variable),
// {clip:name} (clipboard slot) and {env:NAME} (an environment variable of the machine).
// Emits only on real input with a non-empty name — clearing the field never emits a
// broken `{var:}`, and merely opening then closing the chip never rewrites it (same guard
// family as DelayEditor). {row:column} gets its own editor below (column + clipboard-style
// transforms).
function NameEditor({
  token,
  tokenName,
  onChange,
}: {
  token: string;
  tokenName: 'var' | 'clip' | 'env';
  onChange: (t: string) => void;
}) {
  const [name, setName] = useState(() => parseNameToken(token, tokenName).name);
  const [state, setState] = useState<TransformState>(() => parseNameToken(token, tokenName).state);
  const [displayToken, setDisplayToken] = useState(() => normalizeToken(token));
  const label = tokenName === 'var' ? 'Variable name' : tokenName === 'clip' ? 'Slot name' : 'Environment variable';
  // The typing grammar's [A-Za-z0-9_], plus the parentheses an environment variable name can
  // carry (ProgramFiles(x86)) — EnvTokenRegex's charset, so the token never un-chips on round-trip.
  const nameFilter = tokenName === 'env' ? /[^A-Za-z0-9_()]/g : /[^A-Za-z0-9_]/g;

  // The name used to be "everything after the first ':'", so a {clip:pedido:trim} arrived here as
  // the name "pedido:trim", got its colon stripped by the charset filter, and was committed as
  // {clip:pedidotrim} — a slot that does not exist. Parsing the chain properly and refusing to
  // rebuild what we could not represent is what closes that.
  const emit = (n: string, s: TransformState) => {
    if (!n || s.unmodeled) return;
    const t = buildNameToken(tokenName, n, s);
    setDisplayToken(t);
    onChange(t);
  };

  const update = (raw: string) => {
    if (state.unmodeled) return;
    // Anything outside the head's charset would produce a token the editor immediately
    // un-chips on round-trip.
    const clean = raw.replace(nameFilter, '');
    setName(clean);
    emit(clean, state);
  };

  const updateState: React.Dispatch<React.SetStateAction<TransformState>> = (action) => {
    const next = typeof action === 'function' ? action(state) : action;
    setState(next);
    emit(name, next);
  };

  return (
    <>
      <Section label={label}>
        <div className="py-1">
          <input
            type="text"
            value={name}
            onChange={(e) => update(e.target.value)}
            readOnly={state.unmodeled}
            autoFocus={!state.unmodeled}
            spellCheck={false}
            placeholder={tokenName === 'var' ? 'name' : tokenName === 'clip' ? '1' : 'USERNAME'}
            className={`h-7 w-full px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none placeholder:text-text-disabled ${
              state.unmodeled ? 'opacity-60 cursor-not-allowed' : 'focus:border-accent-solid'
            }`}
          />
        </div>
        {/* No hint: the header's description ("Value stored by a Set Variable action" /
            "Selection captured by Copy to Slot or the capture hotkey") already says it. */}
      </Section>
      <ClipboardModifierBody
        state={state}
        setState={updateState}
        clipRaw=""
        clipReady
        sourceUnknown
        token={displayToken}
        sourceLabel={tokenName === 'clip' ? 'Slot text' : 'Variable value'}
      />
    </>
  );
}

// {timestamp[:ms][:mods]} — Unix time. One identity (the unit) above the shared ladder, and a
// source the editor DOES know: the clock, read once when the chip opens, the way the date chip
// says "Resolves now to". Same emit discipline as the other chain editors.
function TimestampEditor({ token, onChange }: { token: string; onChange: (t: string) => void }) {
  const parsed = parseChainToken(token);
  const [ms, setMs] = useState(() => (parsed?.head.kind === 'timestamp' ? parsed.head.ms : false));
  const [state, setState] = useState<TransformState>(() => parsed?.state ?? { ...DEFAULT_TRANSFORM });
  const [displayToken, setDisplayToken] = useState(() => normalizeToken(token));
  const [openedAt] = useState(() => Date.now());
  const nowValue = ms ? String(openedAt) : String(Math.floor(openedAt / 1000));

  const emit = (unitMs: boolean, s: TransformState) => {
    if (s.unmodeled) return;
    const t = buildChainToken({ kind: 'timestamp', ms: unitMs }, s);
    setDisplayToken(t);
    onChange(t);
  };
  const setUnit = (unitMs: boolean) => {
    if (state.unmodeled) return;
    setMs(unitMs);
    emit(unitMs, state);
  };
  const updateState: React.Dispatch<React.SetStateAction<TransformState>> = (action) => {
    const next = typeof action === 'function' ? action(state) : action;
    setState(next);
    emit(ms, next);
  };

  return (
    <>
      <Section label="Unit">
        <RadioGroup label="Unit">
          <div className="grid grid-cols-2 gap-x-3">
            <RadioRow checked={!ms} onChange={() => setUnit(false)} label="Seconds" />
            <RadioRow checked={ms} onChange={() => setUnit(true)} label="Milliseconds" />
          </div>
        </RadioGroup>
      </Section>
      <ClipboardModifierBody
        state={state}
        setState={updateState}
        clipRaw={nowValue}
        clipReady
        token={displayToken}
        sourceLabel="Now"
      />
    </>
  );
}

// Editor for {row:column[:mods]} — the data-loop cell token. Column name on top,
// then the SAME transform sections as the clipboard chip (one backend pipeline,
// one UI). The source box previews the FIRST data row's cell for the column so
// transform effects are visible while editing; header match is case-insensitive
// + trimmed, mirroring the backend BuildRowDict lookup. Emits only with a
// non-empty column (clearing the field never emits a broken `{row:}`).
function RowColEditor({ token, onChange, head = 'row' }: { token: string; onChange: (t: string) => void; head?: 'row' | 'rownext' }) {
  const isNext = head === 'rownext';
  const parse = isNext ? parseRowNextToken : parseRowToken;
  const build = isNext ? buildRowNextToken : buildRowToken;
  const [column, setColumn] = useState(() => parse(token).column);
  const [state, setState] = useState<TransformState>(() => parse(token).state);
  // The token box always shows what will actually be committed: the original
  // (normalized) token until the first real edit, then the latest build. Never
  // blanks while the column field is cleared mid-edit.
  const [displayToken, setDisplayToken] = useState(() => normalizeToken(token));
  const { dataTable } = useAppState();

  const cellRaw = useMemo(() => {
    const key = column.trim().toLowerCase();
    // LAST duplicate header wins — BuildRowDict assigns columns in order into a
    // dictionary, so at runtime a later duplicate overwrites an earlier one.
    let idx = -1;
    dataTable.headers.forEach((h, i) => {
      if (h.trim().toLowerCase() === key) idx = i;
    });
    return idx >= 0 ? (dataTable.rows[0]?.[idx] ?? '') : '';
  }, [dataTable, column]);

  // Emit ONLY on real user input — NOT from a mount-time effect. The builder's
  // state model always re-emits the canonical pipeline order, so a mount-time
  // emit would silently rewrite a hand-typed order-sensitive or duplicate mod
  // chain ({row:a:line:2:trim}, {row:a:first:5:first:3}) on mere open+close,
  // changing runtime output (same guard family as DelayEditor/NameEditor).
  // After a real edit the canonical rebuild IS the intent — the token box shows
  // exactly what will run. Clearing the column never emits a broken `{row:}`.
  const emit = (col: string, s: TransformState) => {
    // …and a column of nothing but spaces is the same as empty: the engine trims at lookup,
    // so it would resolve to nothing. Same shape as InputEditor.emit below.
    if (!col.trim()) return;
    // Same refusal as the clipboard editor: a chain carrying something the parser could not
    // represent must never be rebuilt, because the rebuild is where the unrepresented part
    // disappears — and it disappears into the saved profile.
    if (s.unmodeled) return;
    const t = build(col, s);
    setDisplayToken(t);
    onChange(t);
  };

  const updateColumn = (raw: string) => {
    // The refusal above covers the column too, and this is where it used to leak: `emit` drops an
    // unmodeled token, but the field stayed editable, so a typed column moved on screen and then
    // evaporated on commit. The column is not separable from the refusal — writing it means
    // rebuilding the whole token, which is exactly where the modifier the parser could not
    // represent disappears. The input is readOnly in that case; this guard is the state's own
    // copy of that rule, so re-enabling the field can never silently resurrect the discard.
    if (state.unmodeled) return;
    // A column is any header (RowDataTokenRegex, 2.37.0) — only the token grammar's own { } :
    // are out, since they would end the token or start the chain.
    const clean = raw.replace(/[{}:]/g, '');
    setColumn(clean);
    emit(clean, state);
  };

  // Wraps setState so every transform interaction from the shared body also
  // emits. Functional updates compute from the CURRENT render's state, which is
  // fresh here — each interaction re-renders before the next can happen.
  const updateState: React.Dispatch<React.SetStateAction<TransformState>> = (action) => {
    const next = typeof action === 'function' ? action(state) : action;
    setState(next);
    emit(column, next);
  };

  return (
    <>
      <Section label="Data column">
        <div className="py-1">
          <input
            type="text"
            value={column}
            onChange={(e) => updateColumn(e.target.value)}
            // Read-only for a token this editor refuses to rebuild, matching the body below —
            // an editable field whose edits are thrown away is worse than no field. Not
            // autofocused then either: focus invites the typing that cannot land.
            readOnly={state.unmodeled}
            autoFocus={!state.unmodeled}
            spellCheck={false}
            placeholder="column"
            className={`h-7 w-full px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none placeholder:text-text-disabled ${
              state.unmodeled ? 'opacity-60 cursor-not-allowed' : 'focus:border-accent-solid'
            }`}
          />
        </div>
        {/* No hint: the header's description ("Data table column of the current row" / "Each use
            pulls the NEXT data row. Resets each run.") already says it. */}
      </Section>
      <ClipboardModifierBody
        state={state}
        setState={updateState}
        clipRaw={cellRaw}
        clipReady
        token={displayToken}
        sourceLabel="Cell (first row)"
      />
    </>
  );
}

// Splits an {input:Label|menu:a,b,c} token into its label and (raw) menu CSV. The label may
// itself contain ':' — everything up to the FIRST "|menu:" is the label (the backend's regex
// and normalizeToken agree: label = [^}|]+, menu after |menu:).
function parseInputArg(token: string): { label: string; menu: string } {
  const arg = parseNameArg(token); // everything after the first ':'
  const mi = arg.indexOf('|menu:');
  return mi >= 0 ? { label: arg.slice(0, mi), menu: arg.slice(mi + 6) } : { label: arg, menu: '' };
}

// Editor for {input:Label} / {input:Label|menu:a,b,c} — the Ask-Input token. The label allows
// spaces (unlike variable/column names); a non-empty menu CSV turns the runtime prompt into a
// dropdown. '{', '}' and '|' are stripped from both fields since they'd break the token grammar.
// An empty label never emits (would produce a broken {input:}).
function InputEditor({ token, onChange }: { token: string; onChange: (t: string) => void }) {
  const parsed = parseInputArg(token);
  const [label, setLabel] = useState(parsed.label);
  const [menu, setMenu] = useState(parsed.menu);

  const emit = (l: string, m: string) => {
    const lc = l.trim();
    if (lc.length === 0) return;
    const mc = m.trim();
    onChange(mc.length > 0 ? `{input:${lc}|menu:${mc}}` : `{input:${lc}}`);
  };
  const onLabel = (raw: string) => {
    const clean = raw.replace(/[{}|]/g, '');
    setLabel(clean);
    emit(clean, menu);
  };
  const onMenu = (raw: string) => {
    const clean = raw.replace(/[{}|]/g, '');
    setMenu(clean);
    emit(label, clean);
  };

  return (
    <>
      <Section label="Prompt label">
        <div className="py-1">
          <input
            type="text"
            value={label}
            onChange={(e) => onLabel(e.target.value)}
            autoFocus
            spellCheck={false}
            placeholder="What to ask"
            className="h-7 w-full px-2 text-xs bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid placeholder:text-text-disabled"
          />
        </div>
        {/* "Replay pauses and asks" is the header's line; what the control needs is where the
            answer goes afterwards. */}
        <div className="text-[10px] text-text-tertiary mt-1">
          Answer also readable as {'{var:label}'}.
        </div>
      </Section>
      <Section label="Menu options (optional)">
        <div className="py-1">
          <input
            type="text"
            value={menu}
            onChange={(e) => onMenu(e.target.value)}
            spellCheck={false}
            placeholder="Yes,No,Maybe"
            className="h-7 w-full px-2 text-xs bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid placeholder:text-text-disabled"
          />
        </div>
        <div className="text-[10px] text-text-tertiary mt-1">
          Comma-separated → shown as a dropdown.
        </div>
      </Section>
    </>
  );
}

// Editor for {pick:a|b|c} — the random-choice token. One option per LINE in the textarea; the
// token joins them with '|' (an implementation detail the user never types). '{', '}' and '|'
// are stripped per line: braces end the token, and a '|' inside a line would silently split it
// into two options. Empty lines are dropped; zero non-empty options never emits (InputEditor's
// empty-label rule — a broken {pick:} must not be written).
function PickEditor({ token, onChange }: { token: string; onChange: (t: string) => void }) {
  const [text, setText] = useState(() => parseNameArg(token).split('|').join('\n'));

  const onEdit = (raw: string) => {
    setText(raw);
    const options = raw
      .split('\n')
      .map((l) => l.replace(/[{}|]/g, ''))
      .filter((l) => l.length > 0);
    if (options.length > 0) onChange(`{Pick:${options.join('|')}}`);
  };

  return (
    // The label names the thing; the instruction lives in the hint line like every other
    // Section — "Options — one per line" was the one label carrying a sentence.
    <Section label="Options">
      <div className="py-1">
        <textarea
          value={text}
          onChange={(e) => onEdit(e.target.value)}
          autoFocus
          spellCheck={false}
          rows={5}
          placeholder={'Olá! Tudo bem?\nOi, como posso ajudar?\nBom dia!'}
          className="w-full px-2 py-1.5 text-xs bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid placeholder:text-text-disabled resize-none font-mono leading-relaxed"
        />
      </div>
      {/* The header says "types ONE of the options, drawn each run"; the instruction is all that
          is left for the control. */}
      <div className="text-[10px] text-text-tertiary mt-1">
        One per line.
      </div>
    </Section>
  );
}

// ── {date} / {time} / {datetime}: shift + format ─────────────────────────────
// The token keeps the engine's grammar (ActionExecution.ResolveDateTimeTokens): offset segments
// like "+7" / "-1mo" and the format as whatever segments remain. The UI models ONE offset; a
// hand-typed chain with several goes read-only rather than being collapsed into one on the first
// click (the assertRebuildable posture of the chain editors). The preview runs the same port the
// Preview tab uses (lexical/dateFormat), with the machine's locale for names. Emits only on real
// input, the DelayEditor rule.
const DATE_UNITS: { unit: DateUnit; label: string }[] = [
  { unit: 'd', label: 'days' },
  { unit: 'w', label: 'weeks' },
  { unit: 'mo', label: 'months' },
  { unit: 'y', label: 'years' },
  { unit: 'h', label: 'hours' },
  { unit: 'min', label: 'minutes' },
];
const DATE_PRESETS: Record<DateHead, { label: string; format: string }[]> = {
  date: [{ label: 'Default', format: '' }, { label: 'ISO', format: 'yyyy-MM-dd' }, { label: 'Long', format: 'D' }],
  time: [{ label: 'Default', format: '' }, { label: 'HH:mm', format: 'HH:mm' }, { label: '12-hour', format: 'h:mm tt' }],
  datetime: [{ label: 'Default', format: '' }, { label: 'ISO', format: 'yyyy-MM-dd HH:mm' }, { label: 'Long', format: 'F' }],
};
// Two channels for the chosen option (fill and ink), never a hue alone.
const PILL = 'h-6 px-1.5 text-[10px] rounded border transition-colors disabled:opacity-40';
const PILL_ON = 'text-text-primary bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]';
const PILL_OFF = 'text-text-secondary border-border-default hover:text-text-primary hover:bg-bg-elevated';

function buildDateToken(head: DateHead, n: number, unit: DateUnit, format: string): string {
  const parts: string[] = [head];
  if (n !== 0) parts.push(`${n > 0 ? '+' : ''}${n}${unit === 'd' ? '' : unit}`);
  if (format.trim().length > 0) parts.push(format);
  return `{${parts.join(':')}}`;
}

function DateEditor({ token, onChange }: { token: string; onChange: (t: string) => void }) {
  const inner = token.slice(1, -1);
  const head = inner.split(':')[0].toLowerCase() as DateHead;
  const args = parseDateTokenArgs(inner.split(':').slice(1));
  const several = args.offsets.length > 1;
  const first = args.offsets[0];
  const [magnitude, setMagnitude] = useState(first ? Math.abs(first.n) : 0);
  const [back, setBack] = useState(first ? first.n < 0 : false);
  const [unit, setUnit] = useState<DateUnit>(first ? first.unit : 'd');
  const [format, setFormat] = useState(args.format ?? '');
  const [live, setLive] = useState(token);

  const emit = (mag: number, isBack: boolean, u: DateUnit, f: string) => {
    if (several) return;
    const t = buildDateToken(head, isBack ? -mag : mag, u, f);
    setLive(t);
    onChange(t);
  };
  const preview = resolveDateToken(live, new Date(), typeof navigator !== 'undefined' ? navigator.language : 'en-US');

  return (
    <>
      <Section label="Shift">
        {several ? (
          <div className="text-[10px] text-text-tertiary py-1">Several offsets in this token — edit it by hand.</div>
        ) : (
          <>
            <div className="flex items-center gap-2 py-1">
              <NumInput value={magnitude} onChange={(v) => { setMagnitude(v); emit(v, back, unit, format); }} min={0} max={MAX_DATE_OFFSET} width={70} />
              <div className="flex gap-1">
                <button type="button" onClick={() => { setBack(true); emit(magnitude, true, unit, format); }} className={`${PILL} ${back ? PILL_ON : PILL_OFF}`}>back</button>
                <button type="button" onClick={() => { setBack(false); emit(magnitude, false, unit, format); }} className={`${PILL} ${!back ? PILL_ON : PILL_OFF}`}>ahead</button>
              </div>
              {magnitude === 0 && <span className="text-[11px] text-text-tertiary">now</span>}
            </div>
            {magnitude >= MAX_DATE_OFFSET && (
              <div className="text-[10px] text-text-tertiary">
                {`${MAX_DATE_OFFSET} is the engine's limit for one shift.`}
              </div>
            )}
            <div className="flex flex-wrap gap-1 py-1">
              {DATE_UNITS.map((u) => (
                <button key={u.unit} type="button" onClick={() => { setUnit(u.unit); emit(magnitude, back, u.unit, format); }} className={`${PILL} ${unit === u.unit ? PILL_ON : PILL_OFF}`}>
                  {u.label}
                </button>
              ))}
            </div>
          </>
        )}
      </Section>
      <Section label="Format">
        <div className="flex flex-wrap gap-1 py-1">
          {DATE_PRESETS[head].map((p) => (
            <button key={p.label} type="button" disabled={several} onClick={() => { setFormat(p.format); emit(magnitude, back, unit, p.format); }} className={`${PILL} ${format === p.format ? PILL_ON : PILL_OFF}`}>
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={format}
          disabled={several}
          onChange={(e) => { setFormat(e.target.value); emit(magnitude, back, unit, e.target.value); }}
          placeholder={DEFAULT_DATE_FORMAT[head]}
          spellCheck={false}
          className="h-7 w-full px-2 text-xs font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid placeholder:text-text-disabled disabled:opacity-40"
        />
        <div className="text-[10px] text-text-tertiary mt-1">.NET pattern. MM = month, mm = minutes.</div>
      </Section>
      <Section label="Resolves now to">
        <div className="py-1">
          {preview === null ? (
            <div className="text-xs text-warning-ink">Invalid format — the token is typed as text.</div>
          ) : (
            <div className="text-xs font-mono text-text-primary bg-bg-input border border-border-subtle rounded px-2 py-1 break-all">{preview}</div>
          )}
        </div>
      </Section>
    </>
  );
}

// {counter} / {loop} / {datarow} / {uuid} with a chain ({counter:pad:3}). No identity to edit —
// the head IS the value — so this is the shared body alone, with the source marked unknown: a run
// counter exists only inside a run and an id is drawn there, and previewing a chain against ""
// would claim it yields nothing. Same emit discipline as ClipboardEditor: only on real input,
// never for a chain the parser could not represent.
function HeadOnlyEditor({ token, onChange }: { token: string; onChange: (t: string) => void }) {
  const parsed = parseChainToken(token);
  const head: ChainHead = parsed?.head ?? { kind: 'counter' };
  const [state, setState] = useState<TransformState>(() => parsed?.state ?? { ...DEFAULT_TRANSFORM });
  const [displayToken, setDisplayToken] = useState(() => normalizeToken(token));

  const update: React.Dispatch<React.SetStateAction<TransformState>> = (action) => {
    if (state.unmodeled) return;
    const next = typeof action === 'function'
      ? (action as (prev: TransformState) => TransformState)(state)
      : action;
    setState(next);
    const t = buildChainToken(head, next);
    setDisplayToken(t);
    onChange(t);
  };

  return (
    <ClipboardModifierBody
      state={state}
      setState={update}
      clipRaw=""
      clipReady
      token={displayToken}
      sourceLabel="Value"
      sourceUnknown
    />
  );
}

// {row}: nothing to set. The header is the one place that says what a token is, so the body only
// says that there is nothing to edit.
function StaticInfo() {
  return (
    <div className="px-3.5 py-3 text-[11px] text-text-tertiary">
      No editable parameters.
    </div>
  );
}

