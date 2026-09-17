import { useState, useRef, useEffect, useLayoutEffect, lazy, Suspense } from 'react';
import { Trash2, Undo2, Redo2, Type, Mouse, MoreHorizontal, ScanSearch, Pipette, Keyboard, Globe, Repeat2, Hourglass, X, GitBranch, ScanEye, Braces, AppWindow, Clipboard, ClipboardCopy, ChevronDown, Dice5, Cpu, FileCheck, Clock, Table2, ShieldCheck, CircleStop, CornerDownLeft, IterationCw, ArrowRightFromLine, SkipForward } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';
import { useBridge } from '../bridge/BridgeContext';
import { useSelectionRef } from '../state/SelectionContext';
import { useTt } from '../state/LanguageContext';
import { useToast } from '../state/ToastContext';
// Deferred — see the note on the same import in ActionTable: the Lexical stack plus
// emoji-picker-react are the bulk of the startup chunk, for a dialog opened on demand.
const SendTextDialog = lazy(() => import('./SendTextDialog').then(m => ({ default: m.SendTextDialog })));
import { RunProfileDialog } from './RunProfileDialog';
import { NavigateDialog } from './NavigateDialog';
import { KeystrokeCaptureDialog } from './KeystrokeCaptureDialog';
import { PauseDialog } from './PauseDialog';
import { ClickDialog } from './ClickDialog';
import { useFlyoutFlip } from '../hooks/useFlyoutFlip';
import { iconButtonClass } from './common/IconButton';
import { useDismissOnOutside } from '../hooks/useDismissOnOutside';
import { snapIndicesToBlocks, loopDepthAt } from '../utils/conditionalBlocks';

export interface ColumnVisibility {
  action: boolean;
  // Merged column: the old Key + X + Y trio collapsed into a single "Details"
  // column (key/text/combo for keyboard-ish actions, "x, y" for mouse actions,
  // condition payload for If rows). One toggle controls all of it.
  details: boolean;
  delay: boolean;
  notes: boolean;
}

export const defaultColumnVisibility: ColumnVisibility = {
  action: true,
  details: true,
  delay: true,
  notes: true,
};

// Default keystroke repeat-delay in ms. Mirrors KeystrokeCaptureDialog's
// DEFAULT_REPEAT_DELAY_MS (which matches the C# clamp). Used as the sentinel
// below: when the captured delay equals this default we omit repeatDelayMs from
// the insert payload so the C# side leaves RepeatDelayMs null (clean profile JSON).
const DEFAULT_REPEAT_DELAY_MS = 30;

// There is no Toggle Columns control. Two commented-out blocks (the dropdown state and its
// button) sat here waiting for one, and what settled the question was that the commented
// `columnDefinitions` still listed `key`, `x` and `y` — three fields ColumnVisibility lost when
// they merged into `details`. Uncommenting it would not have compiled, so it was not dormant
// code, it was stale code claiming to be dormant. ColumnVisibility itself stays: ActionTable
// renders from it and App supplies the all-visible default, which is the only value it has
// ever held. A real toggle would start from that type, not from the deleted markup.
type ToolbarProps = Record<string, never>;

/**
 * Profile-name display that gracefully degrades:
 * 1. fits at base size → text-base (16px)
 * 2. slightly too long  → text-sm (14px) — keeps the full name readable
 * 3. way too long       → text-sm + ellipsis truncation
 *
 * Width is measured via a hidden mirror element so we always know the
 * NATURAL width at base size, regardless of which class is currently
 * applied to the visible span.
 *
 * (The "· N actions" suffix was removed in Wave 4 — the StatusBar already
 * shows name + count, and repeating it here spent the centre column's
 * scarcest space on a duplicate.)
 */
function ResponsiveProfileName({ name }: { name: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState<'base' | 'sm'>('base');

  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const update = () => {
      const naturalWidth = measure.scrollWidth;
      const available = container.clientWidth;
      // 4px slack so we don't toggle for sub-pixel rounding
      setSize(naturalWidth > available + 4 ? 'sm' : 'base');
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [name]);

  return (
    <div ref={containerRef} className="flex-1 min-w-0 relative">
      <span
        className={`block font-semibold text-text-primary truncate ${size === 'sm' ? 'text-sm' : 'text-base'}`}
      >
        {name}
      </span>
      {/* Off-screen mirror used only to measure the unconstrained natural width
          at base size. Kept aria-hidden so screen readers don't see it twice. */}
      <span
        ref={measureRef}
        className="absolute -left-[9999px] top-0 font-semibold text-base whitespace-nowrap pointer-events-none"
        aria-hidden="true"
      >
        {name}
      </span>
    </div>
  );
}

// ── Overflow: the tail of the row collapses into a More ▾ menu when it runs out of room ──
// Four candidates, collapsed tail-first: Clear All, Data Loop, Activate Window, Run Profile.
// Four is not a taste call — at the narrowest layout the app still allows (minimum window with
// BOTH rails re-expanded by hand, centre column 473 px) three was measured short by 34 px, and
// a menu that leaves one button clipped has not done its job.
//
// The order below is the SOURCE, and both sides derive from it. They used to be eight
// hand-written literals — `overflowCount < 4` in the row against `overflowCount >= 3` in the
// menu — and two of the four pairs did not complement: Activate Window opened in the menu at
// count 2 while still painted in the row, and Run Profile did the same at count 3. Two
// affordances for the same control, firing a byte-identical payload, in two resting states a
// normal window reaches. `OVERFLOW_CANDIDATES` was no help: it was read by the clamp below and
// by nothing else, so the number and the gates could disagree forever without a compile error.
// Adding a fifth candidate, or reordering the tail, now rewrites both sides at once.
const OVERFLOW_ORDER = ['clearAll', 'dataLoop', 'activateWindow', 'runProfile'] as const;
type OverflowKey = (typeof OVERFLOW_ORDER)[number];
const OVERFLOW_CANDIDATES = OVERFLOW_ORDER.length;
// PURE, and at module scope on purpose: the two reset effects inside the component read it, and
// a predicate rebuilt every render would either be a missing dependency or re-run those effects
// on every render. The component wraps it in a `collapsed` closure for the JSX, where that is free.
const isCollapsed = (count: number, k: OverflowKey) => count > OVERFLOW_ORDER.indexOf(k);


export function Toolbar(_props: ToolbarProps) {
  const { toolbar, buttonStates, actions, activeProfile, settings, dataTable } = useAppState();
  const { send } = useBridge();
  const tt = useTt();
  const { showToast } = useToast();
  // Clicker-mode coherence: the macro action list is invisible in Clicker mode,
  // yet these buttons used to stay live and silently mutate it. Every mutating
  // toolbar control now shares one gate + one explanation. (ActionBar already
  // tells the same story for Save/Load.)
  const isClicker = settings.useCursorClick;
  const insertsDisabled = buttonStates.recordingActive || buttonStates.replayActive || isClicker;
  // One refusal for the five insert dialogs, which stay PARKED instead of closing (they hold typed
  // work, and the mode flip is a global hotkey that can land mid-sentence). Called from the top of
  // each onConfirm rather than driven by `disabled` on the button: the dialogs document that
  // Ctrl+Enter routes through onCardKeyDown and never consults `disabled`, so a button gate is
  // necessary but not sufficient — the refusal has to live where the send does.
  // The reason is split because the gate has three terms and one sentence cannot serve them all:
  // telling someone mid-RECORDING to "switch to Macro" is worse advice than saying nothing.
  // Throttled because error toasts last eight seconds and three Ctrl+Enters would stack three.
  const lastRefusalRef = useRef(0);
  const refuseInsert = () => {
    if (!insertsDisabled) return false;
    const now = Date.now();
    if (now - lastRefusalRef.current > 2000) {
      lastRefusalRef.current = now;
      showToast(isClicker
        ? tt('The action list is unavailable in Clicker mode — switch to Macro to add actions.',
             'A lista de ações está indisponível no modo Clicker — mude para Macro para adicionar ações.')
        : tt('The action list is locked while a run is active.',
             'A lista de ações está travada enquanto um run está ativo.'), 'error');
    }
    return true;
  };
  // Wraps each button's own bilingual hint: in Clicker mode the reason the
  // button is off matters more than what it would insert.
  const clickerTip = (en: string, ptBr: string) =>
    isClicker ? tt('Macro mode only', 'Só no modo Macro') : tt(en, ptBr);
  const toolsRowRef = useRef<HTMLDivElement>(null);
  // Latest fit(), so the listeners below can be wired ONCE and still call the current closure.
  const fitRef = useRef<(() => void) | null>(null);
  const [overflowCount, setOverflowCount] = useState(0);
  // A control is in the MENU exactly when it has left the row. One predicate, both uses — the
  // menu is the complement of the row by construction, not by two numbers that have to agree.
  const collapsed = (k: OverflowKey) => isCollapsed(overflowCount, k);
  const inRow = (k: OverflowKey) => !collapsed(k);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // Second step of Clear All while it lives in the menu. Reset whenever the menu closes, so
  // reopening never lands on a primed destructive button the user does not remember arming.
  const [clearArmed, setClearArmed] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = toolsRowRef.current;
    const bar = row?.parentElement;
    if (!row || !bar) return;
    const fit = () => {
      // Compare WIDTHS, not right edges. The profile name beside this row is flex-1, so it
      // swallows every spare pixel and leaves the row's right edge flush against the bar in
      // every state — an edge comparison can never read as "there is room again", and the menu
      // would appear once and never leave. What is actually available is the bar's content box
      // minus the gap, because the name's own minimum is zero (min-w-0) and it is the side the
      // layout is willing to squeeze first.
      const cs = getComputedStyle(bar);
      const pad = parseFloat(cs.paddingLeft || '0') + parseFloat(cs.paddingRight || '0');
      const available = bar.clientWidth - pad - parseFloat(cs.columnGap || '0');
      // offsetWidth, NOT scrollWidth: on an element with visible overflow scrollWidth adds the
      // right-hand spill of ABSOLUTE descendants, and every popover in this row (Browser,
      // Conditional, Wait, Assert, Loop, the Clear All confirm, the More panel itself) is
      // absolutely positioned inside a relative wrapper that IS a child of this row. So the
      // instant one opened, `needed` grew by the menu's own overhang and this effect — which runs
      // on every render, including the one that opened it — collapsed buttons to make room for a
      // menu. Worst case measured: opening Clear All in a tight window added 30 px, pushed the
      // count to 1, and the Clear All is gated on count < 1 — so it unmounted carrying the popover
      // it had just opened, the click produced no confirm at all, and the 2-unit restore
      // hysteresis meant it never came back until the window grew ~46 px. Browser ▾ added ~142 px
      // and took four buttons down with it.
      //
      // offsetWidth is the width the row NEEDS, not a width already squeezed: the row is shrink-0
      // next to a flex-1 min-w-0 sibling, so it is never compressed — it overflows the bar first.
      // Measured constant at 611 px while `available` swept 620..1131 and while a popover was open.
      // NOT getBoundingClientRect().width: under --ui-zoom that returns VISUAL px (550 vs 611 for
      // the same row) and `available` comes from clientWidth, which is layout px.
      const needed = row.offsetWidth;
      // One icon button is the unit. MEASURED, never hardcoded: row height and font size are
      // theme settings, so a pixel constant would be right at one preset and wrong at the rest.
      const unit = row.querySelector<HTMLElement>('[data-tb-unit]')?.offsetWidth ?? 0;
      if (unit <= 0 || available <= 0) return;
      if (needed > available) {
        // Collapse as many as the deficit calls for in one step: a half-measure would leave a
        // clipped button painted for a frame before the next pass caught it.
        setOverflowCount(c => Math.min(OVERFLOW_CANDIDATES, c + Math.ceil((needed - available) / unit)));
      } else if (available - needed >= unit * 2) {
        // Restore ONE per pass, and only with a whole spare button of slack beyond the one being
        // put back. Restoring greedily — or on exactly its own width — puts a button into a space
        // that then spills, which collapses it again on the next pass: a flicker that never
        // settles. The effect re-runs on overflowCount, so climbing back one at a time still
        // reaches the top in a few frames.
        setOverflowCount(c => Math.max(0, c - 1));
      }
    };
    fitRef.current = fit;
    // Deliberately NO dependency array. Every re-render re-measures, which is what covers the
    // resize this component cannot see: collapsing a side rail changes the bar's width without
    // touching the window, and the Toolbar has no prop or state that says so — but the tree does
    // re-render, and that is enough. It is also the loop that lets one collapse cascade into the
    // next: a state change that does not settle the fit re-enters here until it does, and
    // setState bails out when the count stops moving, so it terminates on its own.
    fit();
  });
  useEffect(() => {
    const onResize = () => fitRef.current?.();
    window.addEventListener('resize', onResize);
    const bar = toolsRowRef.current?.parentElement;
    // The observer is the precise signal (it catches a rail folding, which fires no window
    // resize); the listener is the one that survives an environment where ResizeObserver is
    // stubbed. Neither alone covers both, and running fit twice costs a handful of reads.
    const ro = bar ? new ResizeObserver(() => fitRef.current?.()) : null;
    if (bar && ro) ro.observe(bar);
    return () => { window.removeEventListener('resize', onResize); ro?.disconnect(); };
  }, []);
  const moreFlyout = useFlyoutFlip(showMoreMenu, 'below');
  useDismissOnOutside(showMoreMenu, moreMenuRef, setShowMoreMenu);
  useEffect(() => { if (!showMoreMenu) setClearArmed(false); }, [showMoreMenu]);

  const selectionRef = useSelectionRef();
  const [showSendTextDialog, setShowSendTextDialog] = useState(false);
  const [showBrowserMenu, setShowBrowserMenu] = useState(false);
  // Conditional logic dropdown — opens a picker with the supported probe families
  // (ImageFound / PixelColorMatch). Window-based probes were prototyped here under a
  // "soon" tag but removed before v2.3.0 release to avoid shipping disabled UI for
  // unbuilt features — they'll come back wired up when the engine gains the
  // ProbeWindowExists / ProbeWindowFocused helpers. Mirrors the Browser dropdown's
  // open/close lifecycle so the outside-click handler can dismiss it the same way.
  const [showConditionalMenu, setShowConditionalMenu] = useState(false);
  const conditionalMenuRef = useRef<HTMLDivElement>(null);
  // Wait dropdown — consolidates the previous standalone Wait Image + Wait Pixel
  // buttons into one entry. Both options share the "block-until-condition" probe
  // family, so a sub-picker mirrors how the Conditional button groups Image / Pixel
  // probes for IF rows. Same lifecycle (outside-click / Escape dismiss) as the other
  // toolbar menus; separate state so the menus close independently of each other.
  const [showWaitMenu, setShowWaitMenu] = useState(false);
  const waitMenuRef = useRef<HTMLDivElement>(null);
  // Assert ▾ — the Assert section extracted from Conditional ▾ (which was at 17 rows and
  // climbing) plus the run-ending leaves; the menu is the "things that end the run" family.
  const [showAssertMenu, setShowAssertMenu] = useState(false);
  const assertMenuRef = useRef<HTMLDivElement>(null);
  // Loop ▾ — the repetition family: While guards, For Each Data Row, and the two
  // in-loop jumps (Break / Next), which grey out when the insert point is outside a loop.
  const [showLoopMenu, setShowLoopMenu] = useState(false);
  const loopMenuRef = useRef<HTMLDivElement>(null);
  const [showNavigateDialog, setShowNavigateDialog] = useState(false);
  const [showRunProfileDialog, setShowRunProfileDialog] = useState(false);
  // Pause modal (Pattern B normalization) — was an insert-then-Sheet flow before;
  // now configures up-front like the other dialog-based inserts so Cancel leaves
  // the grid untouched. The ref captures the intended insertIndex at click time
  // because the user's selection may shift while they configure.
  const [showPauseDialog, setShowPauseDialog] = useState(false);
  const pauseDialogInsertIndex = useRef<number>(0);
  // Send Keystroke — unified dialog covers single press, press × N, and hold-key
  // flows via its Mode toggle. Legacy Send Key / Press Key × N / Hold Key state
  // collapsed into this one slot.
  const [showKeystrokeCapture, setShowKeystrokeCapture] = useState(false);
  const keystrokeCaptureInsertIndex = useRef<number>(0);
  // Insert Click — the mouse twin of Send Keystroke, and the ONLY insert in this toolbar that
  // produces a CLICK row (every other click in a profile comes from the recorder). Its own Mode
  // toggle covers tap and hold, so one button here stands in for what would be two.
  // Pattern B like Pause: the dialog owns the whole configuration, including the screen pick.
  const [showClickDialog, setShowClickDialog] = useState(false);
  const clickDialogInsertIndex = useRef<number>(0);
  const browserMenuRef = useRef<HTMLDivElement>(null);
  // Each toolbar dropdown opens downward (`top-full left-0`); flip it up/right near the
  // viewport bottom/right edge so it isn't clipped. Measured on open by useFlyoutFlip.
  const waitFlyout = useFlyoutFlip(showWaitMenu, 'below');
  const conditionalFlyout = useFlyoutFlip(showConditionalMenu, 'below');
  const assertFlyout = useFlyoutFlip(showAssertMenu, 'below');
  const loopFlyout = useFlyoutFlip(showLoopMenu, 'below');
  const browserFlyout = useFlyoutFlip(showBrowserMenu, 'below');
  // Clear All confirm popover — the only destructive toolbar action gets a
  // two-step confirm, anchored/dismissed exactly like the sibling flyouts.
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const clearMenuRef = useRef<HTMLDivElement>(null);
  const clearFlyout = useFlyoutFlip(showClearConfirm, 'below');
  // A control that collapses takes its popover with it, but NOT the flag that opened it. Without
  // these two resets the flag outlives the unmount and the popover comes back already open the
  // next time the width brings its trigger back — which for Clear All means a destructive confirm
  // appearing unprompted, pointing at a list the user has since changed. The dismiss-on-outside
  // handler cannot save it either: its ref is null while the trigger is gone, so the guard that
  // closes on an outside click can never be true.
  useEffect(() => { if (isCollapsed(overflowCount, 'clearAll')) setShowClearConfirm(false); }, [overflowCount]);
  useEffect(() => { if (!isCollapsed(overflowCount, 'clearAll')) setShowMoreMenu(false); }, [overflowCount]);

  // The five cmd:* listeners below are decoupled extension points, NOT dead code — the same
  // pattern and the same reasoning as cmd:togglesidebar in App.tsx, and worth saying here because
  // the name says "command palette" while the palette dispatches none of them. Their entries were
  // cut when the insert block left the palette (see the SCOPE note in CommandPalette.tsx: anything
  // a visible labelled control already does stays out), and the listeners were kept so restoring an
  // entry is a one-liner. Re-affirmed 2026-09-05 (board P10).
  // The exception is cmd:sendtext, which HAS a live dispatcher: MacroEmptyState.tsx fires it from
  // the empty-grid call to action, which is the one place with no toolbar button in reach.
  // If an entry is ever restored: gate it on the ITEM in the palette (that is where isClicker and
  // runActive are read), and re-check inside the listener the way cmd:clearactions does — the entry
  // and the listener can race a run that starts between them.
  useEffect(() => {
    const handler = () => setShowSendTextDialog(true);
    window.addEventListener('cmd:sendtext', handler);
    return () => window.removeEventListener('cmd:sendtext', handler);
  }, []);

  useEffect(() => {
    const handler = () => setShowRunProfileDialog(true);
    window.addEventListener('cmd:runprofile', handler);
    return () => window.removeEventListener('cmd:runprofile', handler);
  }, []);

  // Clear All from the command palette — opens the SAME confirm popover the
  // toolbar button uses (re-checking the gate here since the palette item and
  // this listener can race a run starting).
  useEffect(() => {
    const onClear = () => {
      if (buttonStates.recordingActive || buttonStates.replayActive) return;
      if (actions.length === 0) return;
      setShowClearConfirm(true);
    };
    window.addEventListener('cmd:clearactions', onClear);
    return () => window.removeEventListener('cmd:clearactions', onClear);
  }, [buttonStates.recordingActive, buttonStates.replayActive, actions.length]);

  // Pause from the command palette — same insertIndex-stash trick as the keystroke
  // path below so a race during dialog config doesn't lose the original target row.
  useEffect(() => {
    const onPause = () => {
      const sel = selectionRef.current;
      pauseDialogInsertIndex.current = sel.size > 0 ? Math.min(...sel) : actions.length;
      setShowPauseDialog(true);
    };
    window.addEventListener('cmd:pause', onPause);
    return () => window.removeEventListener('cmd:pause', onPause);
  }, [actions.length, selectionRef]);

  // Command-palette wrappers for the three keyboard inserts. Mirrors what the
  // "Add Action" dropdown does on click: compute the insertIndex from the
  // current selection (or end-of-list), stash it in the dialog's ref so a
  // race during capture doesn't lose it, and open the dialog. The dialog's
  // own Mode toggle picks Press vs Hold internally — no `mode` prop needed.
  useEffect(() => {
    const onSendKeystroke = () => {
      const sel = selectionRef.current;
      keystrokeCaptureInsertIndex.current = sel.size > 0 ? Math.min(...sel) : actions.length;
      setShowKeystrokeCapture(true);
    };
    window.addEventListener('cmd:sendkeystroke', onSendKeystroke);
    return () => {
      window.removeEventListener('cmd:sendkeystroke', onSendKeystroke);
    };
  }, [actions.length, selectionRef]);

  // Global keyboard shortcuts forwarded from App.tsx (which has no bridge access).
  // Undo/Redo share the buttons' gate via a ref (the listener stays bound once):
  // Ctrl+Z during a replay could reshape the list the engine is executing, and
  // in Clicker mode it would mutate the invisible macro list.
  const insertsDisabledRef = useRef(insertsDisabled);
  insertsDisabledRef.current = insertsDisabled;
  // Save takes its OWN ref, not insertsDisabledRef: that one also covers an active
  // replay/recording, and saving during a live macro run is deliberately allowed. Only
  // Clicker mode gates Save — the ActionBar's Save button disables on exactly this, and
  // until now Ctrl+S sailed straight past it, so the button was dead while the keyboard
  // saved fine. A toast rather than silence: Ctrl+S is muscle memory with an expectation
  // of durability, and silent no-op there reads as "saved".
  const isClickerRef = useRef(isClicker);
  isClickerRef.current = isClicker;
  useEffect(() => {
    const onSave = () => {
      if (isClickerRef.current) {
        showToast(tt('Profiles are unavailable in Clicker mode — switch to Macro to save.',
                     'Perfis estão indisponíveis no modo Clicker — mude para Macro para salvar.'), 'error');
        return;
      }
      send({ type: 'profile:save', payload: {} });
    };
    const onUndo = () => { if (!insertsDisabledRef.current) send({ type: 'actions:undo', payload: {} }); };
    const onRedo = () => { if (!insertsDisabledRef.current) send({ type: 'actions:redo', payload: {} }); };
    window.addEventListener('cmd:save', onSave);
    window.addEventListener('cmd:undo', onUndo);
    window.addEventListener('cmd:redo', onRedo);
    return () => {
      window.removeEventListener('cmd:save', onSave);
      window.removeEventListener('cmd:undo', onUndo);
      window.removeEventListener('cmd:redo', onRedo);
    };
  }, [send, showToast, tt]);

  // Outside-press + Escape dismissal for the five insert dropdowns. One CALL per
  // menu, not one call for all of them: each keeps its own pair of listeners, bound
  // only while that menu is open, which is what makes them close independently
  // (clicking inside Browser doesn't close Conditional, and vice versa). The
  // mousedown-not-click and capture-phase-Escape choices, and why they matter, are
  // documented on the hook. The columns + add-actions dropdowns that used to share
  // this handler are gone (columns moved to the grid header, individual inserts are
  // now direct toolbar buttons).
  useDismissOnOutside(showBrowserMenu, browserMenuRef, setShowBrowserMenu);
  useDismissOnOutside(showConditionalMenu, conditionalMenuRef, setShowConditionalMenu);
  useDismissOnOutside(showWaitMenu, waitMenuRef, setShowWaitMenu);
  useDismissOnOutside(showAssertMenu, assertMenuRef, setShowAssertMenu);
  useDismissOnOutside(showLoopMenu, loopMenuRef, setShowLoopMenu);

  // Belt to the braces of `&& !insertsDisabled` on each menu's render: that guard is what actually
  // CLOSES the race, because a render-phase condition lands in the DOM during the mutation phase,
  // before paint. An effect cannot do that job — the run/mode state arrives on the WebView2 message
  // handler, which is not a React event, so its commit skips the synchronous passive-effect flush
  // and the effect runs in a later task. There is a painted frame in between, and a click in that
  // frame would have reached a live menu item (none of them carry `disabled`). The effect stays for
  // the state: without it the flag would still say "open" when the mode flips back.
  //
  // Closes every overlay that holds NOTHING the user typed, whenever the grid stops accepting
  // writes — a run starting, or the mode flipping to Clicker. All three reasons are already
  // insertsDisabled, so they share one condition instead of drifting apart.
  // Why an effect at all: these arrive by GLOBAL HOTKEY (the replay key, ScrollLock) or from the
  // tray, none of which produce a mousedown, so useDismissOnOutside never fires — and the
  // trigger's disabled gate only guards OPENING a popover, not one that is already up.
  // The five INSERT DIALOGS are deliberately NOT in this list: they hold typed work (SendText
  // holds a whole editor), and the flip is a global hotkey that can land mid-sentence. They stay
  // parked and their onConfirm refuses instead — see the funnel at each mount below.
  useEffect(() => {
    if (!insertsDisabled) return;
    setShowBrowserMenu(false);
    setShowConditionalMenu(false);
    setShowWaitMenu(false);
    setShowAssertMenu(false);
    setShowLoopMenu(false);
    setShowClearConfirm(false);
    // The More menu belongs in this list for the same reason as its five siblings: it holds
    // nothing the user typed. It was the one overlay left out, and the only one that can hold an
    // ARMED destructive step. Its panel is render-gated on !insertsDisabled, which HIDES it
    // without closing it — so a Clear All armed in the menu survived a ScrLk to Clicker or a run
    // started by global hotkey, and the menu came back already open, already on "Clear all N
    // actions?", with the red button one click away and no memory of arming it. Closing here
    // cascades into the effect that clears clearArmed on close, so one line fixes both halves.
    setShowMoreMenu(false);
  }, [insertsDisabled]);

  // Clear All also closes when the list empties — there is nothing left to clear. Separate from
  // the effect above on purpose: that one is about the grid refusing writes, this one is about
  // this particular popover losing its subject. Folding them would hide both reasons.
  useEffect(() => {
    if (showClearConfirm && actions.length === 0) setShowClearConfirm(false);
  }, [showClearConfirm, actions.length]);

  // Same outside-press + Escape dismiss for the Clear All confirm popover. (The
  // effect above covers the case the pointer can't: a run started by a global
  // hotkey, which produces no mousedown at all.)
  useDismissOnOutside(showClearConfirm, clearMenuRef, setShowClearConfirm);

  // Toolbar-owned keyboard shortcuts: Ctrl+C copy, Ctrl+V paste, Alt+↑/↓ reorder.
  // (Undo/redo are intentionally NOT here — App.tsx owns Ctrl+Z/Ctrl+Y; see below.)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when the user is typing in a text field — INPUT/TEXTAREA OR a contentEditable
      // (the Insert Text / SendText Lexical editor is contentEditable, not a textarea). Without
      // the isContentEditable check, Ctrl+C/Ctrl+V inside that editor got hijacked: Ctrl+C copied
      // the selected grid action instead of the text, and Ctrl+V pasted grid actions instead of
      // letting the editor paste. Mirrors the editable-target guard in App.tsx / ActionTable.
      const t = e.target as HTMLElement;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
      // Undo/Redo (Ctrl+Z / Ctrl+Y / Shift+Ctrl+Z) are intentionally NOT handled here.
      // App.tsx owns those keystrokes globally — it preventDefaults and dispatches
      // cmd:undo / cmd:redo, which the cmd-listener effect above forwards to the bridge.
      // Handling them here too would fire undo/redo twice per keypress.
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        const sel = selectionRef.current;
        if (sel.size > 0) {
          e.preventDefault();
          send({ type: 'actions:copyInternal', payload: { indices: Array.from(sel) } });
        }
      }
      // Mutating shortcuts (paste, reorder) share the buttons' full gate —
      // record/replay AND Clicker mode (the Toolbar stays mounted there and a
      // stale selection survives ActionTable's unmount, so Ctrl+V / Alt+arrows
      // could silently reshape the invisible macro list). Ctrl+C above is
      // read-only, so it stays allowed (it returns before reaching here).
      if (insertsDisabledRef.current) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        const sel = selectionRef.current;
        const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
        send({ type: 'actions:paste', payload: { insertIndex } });
      }
      // Alt+↑/↓ to reorder the selected rows. Mirrors the Move Up/Move Down
      // toolbar buttons exactly — same payload, same selection update event.
      // Skipped during recording/replay so a stray Alt+arrow doesn't reshape
      // the actions list while data is being captured or executed.
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const sel = selectionRef.current;
        if (sel.size === 0) return;
        e.preventDefault();
        // Block-snap so moving a selection that touches an If/Else/EndIf marker carries the whole
        // block (never orphaning it); a pure body-row selection moves as-is. Shared with the grid's
        // delete/drag/bulk-Move paths via the same pure helper. minIdx/maxIdx come from the snapped
        // set, since snapping can pull in rows beyond the original selection's edges.
        const indices = snapIndicesToBlocks(Array.from(sel).sort((a, b) => a - b), actions);
        if (e.key === 'ArrowUp') {
          const minIdx = indices[0];
          if (minIdx <= 0) return;
          send({ type: 'actions:reorder', payload: { indices, targetIndex: minIdx - 1 } });
          // Backend reinserts the rows CONTIGUOUSLY at the adjusted target, so they land at
          // [minIdx-1 .. minIdx-1+count-1]. A per-index i-1 map mis-highlights non-contiguous
          // selections — emit the contiguous range (mirrors the bulk Move Up button fix).
          window.dispatchEvent(new CustomEvent('selection:set', { detail: indices.map((_, i) => minIdx - 1 + i) }));
        } else {
          const maxIdx = indices[indices.length - 1];
          if (maxIdx >= actions.length - 1) return;
          send({ type: 'actions:reorder', payload: { indices, targetIndex: maxIdx + 2 } });
          // adjustedTarget = maxIdx + 2 - count → rows land at [maxIdx+2-count .. maxIdx+1].
          const count = indices.length;
          window.dispatchEvent(new CustomEvent('selection:set', { detail: indices.map((_, i) => maxIdx + 2 - count + i) }));
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // selectionRef is a useRef result — stable identity across renders, so listing it
    // doesn't cause extra subscribes. Adding it just silences exhaustive-deps without
    // changing behaviour (handler always reads .current at the time it fires).
  }, [send, actions, selectionRef, buttonStates.recordingActive, buttonStates.replayActive]);

  return (
    <>
      {/* Explicit h-[47px] so the toolbar's bottom edge lines up with the right panel's
          Profile/Keys/App tab strip (also h-[47px]). Earlier the toolbar used py-2.5 which
          worked when the contents were flat (~46px), but the boxed-group containers
          added in the redesign bumped the row to ~52px and broke the alignment. */}
      <div className="flex items-center gap-3 px-4 h-[47px] border-b border-border-subtle shrink-0">
        {/* Left: deselect button + profile name with inline action count.
            The X only appears when a profile is actually active — at the
            "No Profile" baseline there's nothing to deselect. Status bar still
            shows the count too; having it next to the name reinforces context
            without making the user look down. Responsive font + truncation
            handle long names; the count drops first if the row gets cramped
            (mirror measures the full string with suffix). */}
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          {activeProfile && (
            // Deselect = sending profile:click with the currently-active name re-uses
            // the existing toggle path in the backend (HandleProfileClick line 2382:
            // "if CurrentProfileName == name → deselect"). No new bridge message needed,
            // and the unsaved-changes guard fires automatically through that path.
            // Disabled during record/replay so a stray click can't yank the profile
            // out from under an in-progress capture or playback.
            <button
              tabIndex={-1}
              onClick={() => send({ type: 'profile:click', payload: { name: activeProfile } })}
              disabled={insertsDisabled}
              // -ml-[13px] pulls the icon LEFT into the toolbar's own px-4 padding so the
              // X's vertical line matches the checkbox column center in the table below
              // (measured 12.7px gap before this fix). Purely cosmetic — the hover/click
              // hitbox still sits comfortably inside the toolbar; we're just escaping
              // the padding for one specific icon.
              className={iconButtonClass('sm', { className: '-ml-[13px]' })}
            >
              <X size={16} />
            </button>
          )}
          {/* Count suffix dropped (owner decision): the StatusBar already shows
              "name · N actions"; repeating it here spent the centre column's
              scarcest space on a duplicate. */}
          <ResponsiveProfileName name={toolbar.profileName} />
        </div>

        {/* Right: tools — prevent focus on click so Space/Enter can't re-trigger.
            A previous redesign wrapped these in 5 boxed-group containers; the
            visual feedback was that the extra borders/padding read as busier
            than the flat row + thin dividers, without buying meaningful
            scannability. The clarity wins (icon swaps, deselect X, paste
            badge, destructive Trash, tooltip pass) all stay; only the
            grouping containers were rolled back. */}
        <div ref={toolsRowRef} className="flex items-center gap-0.5 shrink-0" onMouseDown={(e) => e.preventDefault()}>
          {/* Undo / Redo */}
          <button
            tabIndex={-1}
            disabled={!buttonStates.canUndo || insertsDisabled}
            onClick={() => send({ type: 'actions:undo', payload: {} })}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Undo (Ctrl+Z)', 'Desfazer (Ctrl+Z)')}
          >
            <Undo2 size={16} />
          </button>
          <button
            tabIndex={-1}
            disabled={!buttonStates.canRedo || insertsDisabled}
            onClick={() => send({ type: 'actions:redo', payload: {} })}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Redo (Ctrl+Y)', 'Refazer (Ctrl+Y)')}
          >
            <Redo2 size={16} />
          </button>

          {/* History | inserts divider — renders the grouping the insert-order
              comment below describes instead of leaving it implicit. */}
          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* ── Insert actions ─────────────────────────────────────────────
              Direct buttons replace the previous "Add Actions" dropdown. Order
              groups input intent first (keystroke → text), then waits/checks
              ordered cheapest-first (Pause → Wait dropdown → Conditional), then
              the cross-surface helpers (Browser dropdown, sub-macro), ending
              with the destructive Clear All. Wait Image + Wait Pixel collapsed
              into a single Wait dropdown to match how the Conditional button
              groups the same Image/Pixel probe family. Move Up / Move Down moved
              to the BulkActionBar (only useful with a selection); click x3 /
              scroll inserts removed long ago because Recording does them
              better. */}

          {/* Send Keystroke — unified keyboard insert (Press 1×, Press N×, or
              Hold for X ms; mode toggle lives inside the dialog). */}
          <button
            tabIndex={-1}
            onClick={() => {
              const sel = selectionRef.current;
              keystrokeCaptureInsertIndex.current = sel.size > 0 ? Math.min(...sel) : actions.length;
              setShowKeystrokeCapture(true);
            }}
            disabled={insertsDisabled}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Send Keystroke', 'Enviar tecla')}
            data-tb-unit
          >
            <Keyboard size={16} />
          </button>

          {/* Insert Click — single/double/triple, or a held press. Sits next to Send Keystroke
              because the two are the same idea on the two input devices, and the toolbar's first
              group is "input intent". Until this button existed a hand-built profile could type,
              wait, branch and loop but not CLICK: the only sources of a click row were the
              recorder and "Pick from screen" on a row that already was one. */}
          <button
            tabIndex={-1}
            onClick={() => {
              const sel = selectionRef.current;
              clickDialogInsertIndex.current = sel.size > 0 ? Math.min(...sel) : actions.length;
              setShowClickDialog(true);
            }}
            disabled={insertsDisabled}
            className={iconButtonClass('md')}
            // Names what the dialog holds, like the Wait button's tip does for its two probes.
            // An icon-only button's tooltip is its ONLY label, and "Insert Click" undersold a
            // dialog that also writes a hold, a multi-click and — since the Form control — a drag.
            data-tip={clickerTip('Insert Click (single, double, hold, drag)', 'Inserir clique (simples, duplo, segurar, arrasto)')}
          >
            <Mouse size={16} />
          </button>

          {/* Send Text */}
          <button
            tabIndex={-1}
            onClick={() => setShowSendTextDialog(true)}
            disabled={insertsDisabled}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Send Text', 'Enviar texto')}
          >
            <Type size={16} />
          </button>

          {/* Set Variable — writes a name/value into the replay run's variable store,
              read back with {var:name} in Send Text / Type Text. Pattern A: inserts an
              empty row and auto-opens the Sheet (the backend sends sheet:openIndex). */}
          <button
            tabIndex={-1}
            onClick={() => {
              const sel = selectionRef.current;
              const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
              send({ type: 'actions:insertAction', payload: { actionType: 'SetVariable', insertIndex } });
            }}
            disabled={insertsDisabled}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Set Variable', 'Definir variável')}
          >
            <Braces size={16} />
          </button>

          {/* Copy to Slot — captures the focused app's selection (synthetic Ctrl+C) into a
              named clipboard slot, read back with {clip:name}. Same Pattern-A flow as
              Set Variable — they're sibling run-state writers, hence adjacent. */}
          <button
            tabIndex={-1}
            onClick={() => {
              const sel = selectionRef.current;
              const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
              send({ type: 'actions:insertAction', payload: { actionType: 'CopyToSlot', insertIndex } });
            }}
            disabled={insertsDisabled}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Copy to Slot', 'Copiar para slot')}
          >
            <ClipboardCopy size={16} />
          </button>

          {/* Pause — wait for a hotkey or a timeout before continuing replay. Now
              opens a config-first dialog (Pattern B) instead of the old "insert empty
              then auto-open Sheet" flow — Cancel here means no row is created at all. */}
          <button
            tabIndex={-1}
            onClick={() => {
              const sel = selectionRef.current;
              pauseDialogInsertIndex.current = sel.size > 0 ? Math.min(...sel) : actions.length;
              setShowPauseDialog(true);
            }}
            disabled={insertsDisabled}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Pause', 'Pausa')}
          >
            <Hourglass size={16} />
          </button>

          {/* Direct inserts | menu-based inserts divider. The five buttons after
              this line open flyout menus (Wait / Conditional / Loop / Assert /
              Browser) — the chevron each one carries is the "this opens a menu"
              affordance that separates them from the one-click inserts to the left. */}
          <div className="w-px h-4 bg-border-subtle mx-1" />

          {/* Wait — sub-picker for the two blocking-probe variants. Replaces the
              previous standalone Wait Image + Wait Pixel buttons; the consolidated
              entry mirrors how the Conditional button groups Image/Pixel probes for
              IF rows. Item order matches the Conditional menu (Image first, then
              Pixel) so a user who learned one picker reads the other the same way.
              Both menu items keep their original bridge messages — the row-insert
              UX (overlay opens immediately, row materializes only after a
              successful capture) is unchanged. */}
          <div className="relative" ref={waitMenuRef}>
            <button
              tabIndex={-1}
              onClick={() => setShowWaitMenu(!showWaitMenu)}
              disabled={insertsDisabled}
              className={iconButtonClass('md', { active: showWaitMenu })}
              data-tip={clickerTip('Wait (image, pixel, condition)', 'Aguardar (imagem, pixel, condição)')}
            >
              <ScanEye size={16} />
              <ChevronDown size={10} className="opacity-80" />
            </button>
            {showWaitMenu && !insertsDisabled && (
              <div ref={waitFlyout.ref} className={`absolute w-56 menu-surface z-50 py-1 ${waitFlyout.flipX ? 'right-0' : 'left-0'} ${waitFlyout.flipY ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                <div className="px-3 py-1 label-micro text-text-tertiary">
                  Insert Wait
                </div>
                <button
                  className="menu-item text-text-primary"
                  onClick={() => {
                    const sel = selectionRef.current;
                    const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                    send({ type: 'actions:insertAction', payload: { actionType: 'WaitImage', insertIndex } });
                    setShowWaitMenu(false);
                  }}
                >
                  <ScanSearch size={12} className="text-accent-light" />
                  Wait for Image
                </button>
                <button
                  className="menu-item text-text-primary"
                  onClick={() => {
                    const sel = selectionRef.current;
                    const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                    send({ type: 'actions:insertWaitPixelColor', payload: { insertIndex } });
                    setShowWaitMenu(false);
                  }}
                >
                  <Pipette size={12} className="text-accent-light" />
                  Wait for Pixel Color
                </button>
                {/* Wait-for-condition presets (D4): a pre-armed Assert — 10 s poll budget +
                    the quiet-stop policy — so "wait until the window opens, and if it never
                    does, just end the run with no error" is ONE click. Lives HERE and not in
                    Assert ▾: the intent a user arrives with is "wait for", and a full second
                    section there would push that menu past its height budget. The Sheet still
                    opens pre-filled, so everything stays editable. accent-light icons mark
                    these as wait-flavored, distinct from the If/Assert teal. */}
                <div className="my-1 border-t border-border-subtle" />
                <div className="px-3 py-1 label-micro text-text-tertiary">
                  Wait for condition — stop quietly on timeout
                </div>
                {/* "Until X", not "X": these insert the SAME Assert row the Assert ▾ menu
                    does, differing only in two invisible defaults (10 s budget + quiet
                    stop). Identical labels in two menus read as an accident and give the
                    user no way to tell afterwards which door they came through — the verb
                    is what makes this one say "wait", matching the header above. */}
                {([
                  { ct: 'WindowOpen', Icon: AppWindow, label: 'Until Window Open' },
                  { ct: 'ProcessRunning', Icon: Cpu, label: 'Until Process Running' },
                  { ct: 'ClipboardMatch', Icon: Clipboard, label: 'Until Clipboard' },
                  { ct: 'Variable', Icon: Braces, label: 'Until Variable' },
                  { ct: 'FileExists', Icon: FileCheck, label: 'Until File Exists' },
                  { ct: 'TimeWindow', Icon: Clock, label: 'Until Time' },
                ] as const).map(({ ct, Icon, label }) => (
                  <button
                    key={`waitcond-${ct}`}
                    className="menu-item text-text-primary"
                    onClick={() => {
                      const sel = selectionRef.current;
                      const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                      send({ type: 'actions:insertAssert', payload: { conditionType: ct, insertIndex, conditionTimeout: 10000, assertOnFail: 'StopReplay' } });
                      setShowWaitMenu(false);
                    }}
                  >
                    <Icon size={12} className="text-accent-light" />
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Conditional logic — sits with the probe-based insertors (Pause / Pixel /
              Image) because the active picker options reuse those probes as the IF
              condition. GitBranch is the universal "branch / decision" glyph. */}
          <div className="relative" ref={conditionalMenuRef}>
            <button
              tabIndex={-1}
              onClick={() => setShowConditionalMenu(!showConditionalMenu)}
              disabled={insertsDisabled}
              className={iconButtonClass('md', { active: showConditionalMenu })}
              data-tip={clickerTip('Conditional', 'Condicional')}
            >
              <GitBranch size={16} />
              <ChevronDown size={10} className="opacity-80" />
            </button>
            {showConditionalMenu && !insertsDisabled && (
              <div ref={conditionalFlyout.ref} className={`absolute w-56 menu-surface z-50 py-1 ${conditionalFlyout.flipX ? 'right-0' : 'left-0'} ${conditionalFlyout.flipY ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                <div className="px-3 py-1 label-micro text-text-tertiary">
                  Insert Conditional
                </div>
                {/* Active items — reuse the WaitImage / WaitPixelColor capture flows. */}
                <button
                  className="menu-item text-text-primary"
                  onClick={() => {
                    const sel = selectionRef.current;
                    const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                    send({ type: 'actions:insertConditional', payload: { conditionType: 'ImageFound', insertIndex } });
                    setShowConditionalMenu(false);
                  }}
                >
                  <ScanSearch size={12} style={{ color: 'var(--color-action-if-fg)' }} />
                  Image Found
                </button>
                <button
                  className="menu-item text-text-primary"
                  onClick={() => {
                    const sel = selectionRef.current;
                    const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                    send({ type: 'actions:insertConditional', payload: { conditionType: 'PixelColorMatch', insertIndex } });
                    setShowConditionalMenu(false);
                  }}
                >
                  <Pipette size={12} style={{ color: 'var(--color-action-if-fg)' }} />
                  Pixel Color Match
                </button>
                {/* Capture-less conditions — insert the If/EndIf pair immediately and
                    auto-open the Sheet (backend sends sheet:openIndex); no screen overlay. */}
                <button
                  className="menu-item text-text-primary"
                  onClick={() => {
                    const sel = selectionRef.current;
                    const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                    send({ type: 'actions:insertConditional', payload: { conditionType: 'WindowOpen', insertIndex } });
                    setShowConditionalMenu(false);
                  }}
                >
                  <AppWindow size={12} style={{ color: 'var(--color-action-if-fg)' }} />
                  Window Open
                </button>
                <button
                  className="menu-item text-text-primary"
                  onClick={() => {
                    const sel = selectionRef.current;
                    const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                    send({ type: 'actions:insertConditional', payload: { conditionType: 'ClipboardMatch', insertIndex } });
                    setShowConditionalMenu(false);
                  }}
                >
                  <Clipboard size={12} style={{ color: 'var(--color-action-if-fg)' }} />
                  Clipboard
                </button>
                <button
                  className="menu-item text-text-primary"
                  onClick={() => {
                    const sel = selectionRef.current;
                    const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                    send({ type: 'actions:insertConditional', payload: { conditionType: 'BrowserElementState', insertIndex } });
                    setShowConditionalMenu(false);
                  }}
                >
                  <Globe size={12} style={{ color: 'var(--color-action-if-fg)' }} />
                  Browser Element
                </button>
                {([
                  { ct: 'Random', Icon: Dice5, label: 'Random' },
                  { ct: 'Variable', Icon: Braces, label: 'Variable' },
                  { ct: 'ProcessRunning', Icon: Cpu, label: 'Process Running' },
                  { ct: 'FileExists', Icon: FileCheck, label: 'File Exists' },
                  { ct: 'TimeWindow', Icon: Clock, label: 'Time' },
                ] as const).map(({ ct, Icon, label }) => (
                  <button
                    key={ct}
                    className="menu-item text-text-primary"
                    onClick={() => {
                      const sel = selectionRef.current;
                      const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                      send({ type: 'actions:insertConditional', payload: { conditionType: ct, insertIndex } });
                      setShowConditionalMenu(false);
                    }}
                  >
                    <Icon size={12} style={{ color: 'var(--color-action-if-fg)' }} />
                    {label}
                  </button>
                ))}

              </div>
            )}
          </div>

          {/* Loop ▾ — the repetition family. While reuses the If condition machinery
              (Image/Pixel route through the SAME capture overlays; state families insert
              directly and open the Sheet) minus Random: a coin-flip loop guard has no
              stable ending, and offering it would be an infinite-loop trap. For Each Data
              Row is the configuration-free block (always enabled — the label carries the
              live row count as its own hint). Break/Next grey out when the insert point
              is outside a loop (loopDepthAt) — greyed, never hidden, so the feature stays
              discoverable. */}
          <div className="relative" ref={loopMenuRef}>
            <button
              tabIndex={-1}
              onClick={() => setShowLoopMenu(!showLoopMenu)}
              disabled={insertsDisabled}
              className={iconButtonClass('md', { active: showLoopMenu })}
              data-tip={clickerTip('Loop', 'Loop')}
            >
              <IterationCw size={16} />
              <ChevronDown size={10} className="opacity-80" />
            </button>
            {showLoopMenu && !insertsDisabled && (() => {
              // Selection is stable while the menu is open (clicking a row dismisses it),
              // so the insert point — and the Break/Next gate — is computed once per open.
              const loopSel = selectionRef.current;
              const loopInsertAt = loopSel.size > 0 ? Math.min(...loopSel) : actions.length;
              const loopDepth = loopDepthAt(actions, loopInsertAt);
              const rowsN = dataTable.rows.length;
              return (
              <div ref={loopFlyout.ref} className={`absolute w-60 menu-surface z-50 py-1 ${loopFlyout.flipX ? 'right-0' : 'left-0'} ${loopFlyout.flipY ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                <div className="px-3 py-1 label-micro text-text-tertiary">
                  Insert While — repeats while true
                </div>
                {([
                  { ct: 'ImageFound', Icon: ScanSearch, label: 'Image Found' },
                  { ct: 'PixelColorMatch', Icon: Pipette, label: 'Pixel Color Match' },
                  { ct: 'WindowOpen', Icon: AppWindow, label: 'Window Open' },
                  { ct: 'ClipboardMatch', Icon: Clipboard, label: 'Clipboard' },
                  { ct: 'BrowserElementState', Icon: Globe, label: 'Browser Element' },
                  { ct: 'Variable', Icon: Braces, label: 'Variable' },
                  { ct: 'ProcessRunning', Icon: Cpu, label: 'Process Running' },
                  { ct: 'FileExists', Icon: FileCheck, label: 'File Exists' },
                  { ct: 'TimeWindow', Icon: Clock, label: 'Time' },
                ] as const).map(({ ct, Icon, label }) => (
                  <button
                    key={`loop-${ct}`}
                    className="menu-item text-text-primary"
                    onClick={() => {
                      send({ type: 'actions:insertLoop', payload: { conditionType: ct, insertIndex: loopInsertAt } });
                      setShowLoopMenu(false);
                    }}
                  >
                    <Icon size={12} style={{ color: 'var(--color-action-loop-fg, var(--color-action-if-fg))' }} />
                    {label}
                  </button>
                ))}
                <div className="my-1 border-t border-border-subtle" />
                <button
                  className="menu-item text-text-primary"
                  onClick={() => {
                    send({ type: 'actions:insertLoop', payload: { kind: 'ForEachRow', insertIndex: loopInsertAt } });
                    setShowLoopMenu(false);
                  }}
                >
                  <Table2 size={12} style={{ color: 'var(--color-action-loop-fg, var(--color-action-if-fg))' }} />
                  For Each Data Row
                  <span className="ml-auto text-[10px] text-text-tertiary">{rowsN} row{rowsN === 1 ? '' : 's'}</span>
                </button>
                <div className="my-1 border-t border-border-subtle" />
                <div className="px-3 py-1 label-micro text-text-tertiary">
                  Loop control
                </div>
                {([
                  { at: 'BreakLoop', Icon: ArrowRightFromLine, label: 'Break loop' },
                  { at: 'ContinueLoop', Icon: SkipForward, label: 'Next iteration' },
                ] as const).map(({ at, Icon, label }) => (
                  <button
                    key={`loopctl-${at}`}
                    disabled={loopDepth === 0}
                    data-tip={loopDepth === 0
                      ? tt('Only inside a loop', 'Só dentro de um loop')
                      : undefined}
                    className="menu-item text-text-primary"
                    onClick={() => {
                      send({ type: 'actions:insertAction', payload: { actionType: at, insertIndex: loopInsertAt } });
                      setShowLoopMenu(false);
                    }}
                  >
                    <Icon size={12} style={{ color: loopDepth === 0 ? undefined : 'var(--color-action-loop-fg, var(--color-action-if-fg))' }} />
                    {label}
                  </button>
                ))}
              </div>
              );
            })()}
          </div>

          {/* Assert ▾ — the "things that end the run" family. The six state asserts moved
              here verbatim from Conditional ▾ (which was at 17 rows and climbing; an If
              BRANCHES on the answer, an Assert REQUIRES it — different intents, different
              menus). Below them, the flow leaves: Stop ends the whole run as a normal
              finish, Return ends only the current pass. Image/pixel asserts stay out on
              purpose (Wait Image / Wait Pixel Color already abort on timeout), and a page
              element has its own Assert Element under Browser Actions. */}
          <div className="relative" ref={assertMenuRef}>
            <button
              tabIndex={-1}
              onClick={() => setShowAssertMenu(!showAssertMenu)}
              disabled={insertsDisabled}
              className={iconButtonClass('md', { active: showAssertMenu })}
              data-tip={clickerTip('Assert / end the run', 'Assert / encerrar a execução')}
            >
              <ShieldCheck size={16} />
              <ChevronDown size={10} className="opacity-80" />
            </button>
            {showAssertMenu && !insertsDisabled && (
              <div ref={assertFlyout.ref} className={`absolute w-56 menu-surface z-50 py-1 ${assertFlyout.flipX ? 'right-0' : 'left-0'} ${assertFlyout.flipY ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                <div className="px-3 py-1 label-micro text-text-tertiary">
                  Insert Assert — must be true
                </div>
                {([
                  { ct: 'WindowOpen', Icon: AppWindow, label: 'Window Open' },
                  { ct: 'ProcessRunning', Icon: Cpu, label: 'Process Running' },
                  { ct: 'ClipboardMatch', Icon: Clipboard, label: 'Clipboard' },
                  { ct: 'Variable', Icon: Braces, label: 'Variable' },
                  { ct: 'FileExists', Icon: FileCheck, label: 'File Exists' },
                  { ct: 'TimeWindow', Icon: Clock, label: 'Time' },
                ] as const).map(({ ct, Icon, label }) => (
                  <button
                    key={`assert-${ct}`}
                    className="menu-item text-text-primary"
                    onClick={() => {
                      const sel = selectionRef.current;
                      const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                      send({ type: 'actions:insertAssert', payload: { conditionType: ct, insertIndex } });
                      setShowAssertMenu(false);
                    }}
                  >
                    <Icon size={12} style={{ color: 'var(--color-action-if-fg)' }} />
                    {label}
                  </button>
                ))}
                <div className="my-1 border-t border-border-subtle" />
                <div className="px-3 py-1 label-micro text-text-tertiary">
                  End the run
                </div>
                {([
                  { at: 'Stop', Icon: CircleStop, label: 'Stop', tip: 'ends the whole run — success' },
                  { at: 'Return', Icon: CornerDownLeft, label: 'Return', tip: 'ends this pass only' },
                ] as const).map(({ at, Icon, label, tip }) => (
                  <button
                    key={`flow-${at}`}
                    className="menu-item text-text-primary"
                    onClick={() => {
                      const sel = selectionRef.current;
                      const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                      send({ type: 'actions:insertAction', payload: { actionType: at, insertIndex } });
                      setShowAssertMenu(false);
                    }}
                  >
                    <Icon size={12} style={{ color: 'var(--color-action-flow-fg, var(--color-action-pause-fg))' }} />
                    {label}
                    <span className="ml-auto text-[10px] text-text-tertiary">{tip}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Browser Actions */}
          <div className="relative" ref={browserMenuRef}>
            <button
              tabIndex={-1}
              onClick={() => setShowBrowserMenu(!showBrowserMenu)}
              disabled={insertsDisabled}
              className={iconButtonClass('md', { active: showBrowserMenu })}
              data-tip={clickerTip('Browser Actions', 'Ações de navegador')}
            >
              <Globe size={16} />
              <ChevronDown size={10} className="opacity-80" />
            </button>
            {showBrowserMenu && !insertsDisabled && (
              <div ref={browserFlyout.ref} className={`absolute w-56 menu-surface z-50 py-1 ${browserFlyout.flipX ? 'right-0' : 'left-0'} ${browserFlyout.flipY ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                {/* Header pill matches the sibling Wait / Conditional dropdowns so the
                    three menus read as one family. Width also bumped 44 → 56 for the
                    same reason — long labels like "Navigate to URL" got close to the
                    edge at w-44, and the size discrepancy was visible when two menus
                    happened to open near each other during a UX sweep. */}
                <div className="px-3 py-1 label-micro text-text-tertiary">
                  Insert Browser Action
                </div>
                {([
                  { type: 'BrowserClick', label: 'Click Element' },
                  { type: 'BrowserRightClick', label: 'Right Click Element' },
                  { type: 'BrowserType', label: 'Type Text' },
                  { type: 'BrowserSelectOption', label: 'Select Option' },
                  { type: 'BrowserWaitElement', label: 'Wait Element' },
                  { type: 'BrowserAssert', label: 'Assert Element' },
                  { type: 'BrowserNavigate', label: 'Open URL' },
                ] as const).map((item) => (
                  <button
                    key={item.type}
                    className="menu-item text-text-primary"
                    onClick={() => {
                      if (item.type === 'BrowserNavigate') {
                        setShowBrowserMenu(false);
                        setShowNavigateDialog(true);
                      } else {
                        const sel = selectionRef.current;
                        const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                        send({ type: 'actions:addBrowserAction', payload: { actionType: item.type, selector: '', insertIndex } });
                        setShowBrowserMenu(false);
                      }
                    }}
                  >
                    <Globe size={12} className="text-accent-light" />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Everything above inserts a row that DECIDES or WAITS; everything below reaches
              for another surface — a second profile, another app's window, the data table.
              Eleven buttons ran together without this, which is a long stretch to scan for
              one icon. It also happens to mark where the row starts giving way: the three
              that follow, plus Clear All, are exactly the ones the More menu absorbs.
              Once all three have gone into the menu it divides nothing — the More button is
              itself the boundary by then — so it steps aside and gives the row back its 9 px,
              which at the narrowest layout is the difference between fitting and not. */}
          {inRow('activateWindow') && <div className="w-px h-4 bg-border-subtle mx-1" />}

          {/* Run Profile — sub-macro call (picker dialog). Sits next to Browser
              because both delegate work elsewhere (a profile / a browser tab). */}
          {inRow('runProfile') && (
          <button
            tabIndex={-1}
            onClick={() => setShowRunProfileDialog(true)}
            disabled={insertsDisabled}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Run Profile', 'Executar perfil')}
          >
            <Repeat2 size={16} />
          </button>
          )}

          {/* Activate Window — focus (and optionally launch) another app mid-macro.
              Sits with Run Profile: both are orchestration rows. Pattern A: inserts
              an empty row and auto-opens the Sheet (backend sends sheet:openIndex). */}
          {inRow('activateWindow') && (
          <button
            tabIndex={-1}
            onClick={() => {
              const sel = selectionRef.current;
              const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
              send({ type: 'actions:insertAction', payload: { actionType: 'ActivateWindow', insertIndex } });
            }}
            disabled={insertsDisabled}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Activate Window', 'Ativar janela')}
          >
            <AppWindow size={16} />
          </button>
          )}

          {/* Data Loop — open the data-table panel ({row:column} tokens + loop-over-data).
              A profile-level surface (App-level, opened via the shared cmd:dataeditor
              event) rather than an inserted row, which is why it used to stay live in
              Clicker mode. That was wrong: the table only feeds {row:column} tokens,
              which only macro rows read, and Clicker mode has no profile at all (see the
              Ctrl+S toast above). Opening it there edits data nothing can consume, so it
              takes the same gate as every other macro-facing control — insertsDisabled,
              which is the RUN as well as the mode. That claim was only half true while
              this read isClicker alone: the panel's Save sends data:save, and that is the
              very table a ForEachRow already in flight is iterating. The toolbar is its
              ONLY entry point — it is deliberately absent from the command palette — so
              this gate is the whole story. */}
          {inRow('dataLoop') && (
          <button
            tabIndex={-1}
            onClick={() => window.dispatchEvent(new CustomEvent('cmd:dataeditor'))}
            disabled={insertsDisabled}
            className={iconButtonClass('md')}
            data-tip={clickerTip('Data Loop', 'Data Loop')}
          >
            <Table2 size={16} />
          </button>
          )}

          {/* When the tail has collapsed, the More button IS the divider — a separator beside
              it would read as two gaps in a row. */}
          {inRow('clearAll') && <div className="w-px h-4 bg-border-subtle mx-1" />}

          {/* Clear All — destructive hover (red text + faint red bg) mirrors
              BulkActionBar's Delete. Two-step confirm popover + the same
              recording/replay disabled gate every sibling mutating button has
              (a mid-run clear used to be able to yank the list out from under
              the engine, with only Undo as the safety net). Copy/Paste removed
              from the toolbar (redundant with the Ctrl+C / Ctrl+V hotkeys and
              the BulkActionBar's buttons when a selection exists). */}
          {inRow('clearAll') && (
          <div className="relative" ref={clearMenuRef}>
            <button
              tabIndex={-1}
              onClick={() => setShowClearConfirm(prev => !prev)}
              disabled={insertsDisabled || actions.length === 0}
              className={iconButtonClass('md', { tone: 'danger' })}
              data-tip={clickerTip('Clear All', 'Limpar tudo')}
            >
              <Trash2 size={16} />
            </button>
            {showClearConfirm && (
              // -right-[30px] centers the destructive "Clear all" button directly
              // under the Trash trigger instead of leaving it 30px to the left (a
              // plain right-0 lines the trash icon up with the button's *right edge*,
              // not its centre). The popover always extends leftward from here, where
              // there's room in every panel state, so the horizontal flip the sibling
              // dropdowns use isn't needed — a right-0 popover never clips on the left.
              // 30px = half the fixed-width "Clear all" button (its English label is a
              // constant, so the offset is stable). Same kind of pixel nudge as the
              // deselect X's -ml-[13px]. flipY is kept for the (rare) short-window case.
              <div ref={clearFlyout.ref} className={`absolute w-60 menu-surface z-50 p-3 -right-[30px] ${clearFlyout.flipY ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                <div className="text-xs font-semibold text-text-primary">
                  Clear all {actions.length} action{actions.length === 1 ? '' : 's'}?
                </div>
                <div className="mt-1 text-[11px] text-text-tertiary leading-relaxed">
                  {'Ctrl+Z undoes it.'}
                </div>
                <div className="mt-2.5 flex justify-end gap-1.5">
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="px-2.5 py-1 rounded text-[11px] text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      send({ type: 'actions:clear', payload: {} });
                      setShowClearConfirm(false);
                    }}
                    // Same gate as the trigger — covers the render-tick race between
                    // the run-state push and a click on the already-open popover.
                    disabled={insertsDisabled}
                    className="px-2.5 py-1 rounded text-[11px] font-semibold bg-recording text-[color:var(--color-recording-ink)] hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}
          </div>
          )}

          {/* More ▾ — the tail the row could not fit. It is NOT a permanent home:
              overflowCount is measured, so at any width where the buttons fit they stay
              buttons, and this menu does not exist at all. What it buys beyond room is
              NAMES: every control in this row is icon-only, and the insert commands were
              deliberately cut from the command palette, so until now "Run Profile" was a
              word you could only reach by hovering the right icon. Items are listed
              row-order (Run Profile → Clear All), never collapse-order, or the menu would
              reshuffle itself as the window resized.
              Clear All opens its own confirm popover, which cannot be nested inside a menu
              that closes on click — so here it sends the user back to the button by
              widening the window, and stays disabled-looking rather than lying about a
              one-click destroy. */}
          {collapsed('clearAll') && (
            <div className="relative" ref={moreMenuRef}>
              <button
                tabIndex={-1}
                onClick={() => setShowMoreMenu(!showMoreMenu)}
                disabled={insertsDisabled}
                className={iconButtonClass('md', { active: showMoreMenu })}
                data-tip={clickerTip('More', 'Mais')}
              >
                <MoreHorizontal size={16} />
                <ChevronDown size={10} className="opacity-80" />
              </button>
              {showMoreMenu && !insertsDisabled && (
                <div ref={moreFlyout.ref} className={`absolute w-56 menu-surface z-50 py-1 ${moreFlyout.flipX ? 'right-0' : 'left-0'} ${moreFlyout.flipY ? 'bottom-full mb-1' : 'top-full mt-1'}`}>
                  <div className="px-3 py-1 label-micro text-text-tertiary">
                    More actions
                  </div>
                  {collapsed('runProfile') && (
                    <button
                      className="menu-item text-text-primary"
                      onClick={() => { setShowRunProfileDialog(true); setShowMoreMenu(false); }}
                    >
                      <Repeat2 size={13} className="text-text-tertiary" />
                      Run Profile
                    </button>
                  )}
                  {collapsed('activateWindow') && (
                    <button
                      className="menu-item text-text-primary"
                      onClick={() => {
                        const sel = selectionRef.current;
                        const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
                        send({ type: 'actions:insertAction', payload: { actionType: 'ActivateWindow', insertIndex } });
                        setShowMoreMenu(false);
                      }}
                    >
                      <AppWindow size={13} className="text-text-tertiary" />
                      Activate Window
                    </button>
                  )}
                  {collapsed('dataLoop') && (
                    <button
                      className="menu-item text-text-primary"
                      onClick={() => { window.dispatchEvent(new CustomEvent('cmd:dataeditor')); setShowMoreMenu(false); }}
                    >
                      <Table2 size={13} className="text-text-tertiary" />
                      Data Loop
                    </button>
                  )}
                  <div className="my-1 border-t border-border-subtle" />
                  {/* Clear All keeps its two steps in here rather than borrowing the button's
                      confirm popover: that popover is anchored to a trigger that does not exist
                      at this width. So the confirmation happens INSIDE the menu, which stays open
                      because clicks within it are not outside clicks. Same two decisions as the
                      popover — it names the count, and it says Ctrl+Z undoes it. */}
                  {clearArmed ? (
                    <div className="px-3 py-2">
                      <div className="text-xs font-semibold text-text-primary">
                        Clear all {actions.length} action{actions.length === 1 ? '' : 's'}?
                      </div>
                      <div className="mt-1 text-[11px] text-text-tertiary leading-relaxed">
                        {'Ctrl+Z undoes it.'}
                      </div>
                      <div className="mt-2.5 flex justify-end gap-1.5">
                        <button
                          onClick={() => setClearArmed(false)}
                          className="px-2.5 py-1 rounded text-[11px] text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => {
                            send({ type: 'actions:clear', payload: {} });
                            setClearArmed(false);
                            setShowMoreMenu(false);
                          }}
                          // Same two conditions as the TRIGGER that armed it. It carried only the
                          // run gate, so a menu armed before the list emptied offered to "Clear
                          // all 0 actions?" with the red button live — the popover sibling is held
                          // to both by an effect, and this one was held to one by hand.
                          disabled={insertsDisabled || actions.length === 0}
                          className="px-2.5 py-1 rounded text-[11px] font-semibold bg-recording text-[color:var(--color-recording-ink)] hover:opacity-85 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          Clear all
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      disabled={actions.length === 0}
                      className="menu-item text-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                      onClick={() => setClearArmed(true)}
                    >
                      <Trash2 size={13} className="text-recording" />
                      Clear All…
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {showSendTextDialog && (
        <Suspense fallback={null}>
          <SendTextDialog
            mode="add"
            // No initialMethod: the add path takes the dialog's 'paste' default, so a brand-new
            // row is byte-identical on disk to one authored before this feature.
            onConfirm={(r) => {
              if (refuseInsert()) return;
              const sel = selectionRef.current;
              const insertIndex = sel.size > 0 ? Math.min(...sel) : undefined;
              send({
                type: 'actions:addSendText',
                payload: {
                  text: r.text,
                  html: r.html ?? undefined,
                  markdown: r.markdown ?? undefined,
                  mode: r.mode,
                  method: r.method,
                  charDelayMs: r.charDelayMs,
                  insertIndex,
                },
              });
              setShowSendTextDialog(false);
            }}
            onClose={() => setShowSendTextDialog(false)}
          />
        </Suspense>
      )}

      {showRunProfileDialog && (
        <RunProfileDialog
          mode="add"
          excludeProfileName={activeProfile ?? undefined}
          onConfirm={(profileName, repeatCount, runOverData) => {
            if (refuseInsert()) return;
            const sel = selectionRef.current;
            const insertIndex = sel.size > 0 ? Math.min(...sel) : undefined;
            // runOverData must ride along: dropping it here silently discarded the
            // dialog's "Run once per data row" tick on the toolbar-add path, while
            // the grid's add/edit paths (ActionTable) carried it correctly.
            send({ type: 'actions:addRunProfile', payload: { profileName, repeatCount, runOverData, insertIndex } });
            setShowRunProfileDialog(false);
          }}
          onClose={() => setShowRunProfileDialog(false)}
        />
      )}

      {showNavigateDialog && (
        <NavigateDialog
          onConfirm={(url, newTab) => {
            if (refuseInsert()) return;
            const sel = selectionRef.current;
            const insertIndex = sel.size > 0 ? Math.min(...sel) : actions.length;
            send({ type: 'actions:addBrowserAction', payload: { actionType: 'BrowserNavigate', selector: url, newTab, insertIndex } });
            setShowNavigateDialog(false);
          }}
          onClose={() => setShowNavigateDialog(false)}
        />
      )}

      {showPauseDialog && (
        <PauseDialog
          onConfirm={(key, timeoutMs) => {
            if (refuseInsert()) return;
            send({
              type: 'actions:insertPause',
              payload: { key, timeoutMs: Math.max(0, Math.round(timeoutMs)), insertIndex: pauseDialogInsertIndex.current },
            });
            setShowPauseDialog(false);
          }}
          onClose={() => setShowPauseDialog(false)}
        />
      )}

      {/* Insert Click — Pattern B, same shape as Pause above: the dialog resolves the action
          type, the point and the timing, and this mount only forwards what it produced. The
          spread is deliberate: the dialog OMITS the fields that don't apply (x/y under
          at-cursor, holdDurationMs outside hold mode, the repeat pair for a single shot), and
          forwarding them as undefined is what lets the bridge handler tell "not asked for" from
          a real value — sending 0,0 for an unset point would be a click in the screen corner. */}
      {showClickDialog && (
        <ClickDialog
          onConfirm={(r) => {
            if (refuseInsert()) return;
            send({
              type: 'actions:insertClick',
              payload: { ...r, insertIndex: clickDialogInsertIndex.current },
            });
            setShowClickDialog(false);
          }}
          onClose={() => setShowClickDialog(false)}
        />
      )}

      {/* Send Keystroke — unified capture dialog. The user picks Press or Hold via
          the dialog's own Mode toggle; this mount stays agnostic and dispatches the
          appropriate bridge message based on the result.actionType the dialog returns.
          insertIndex is stashed in a ref at the moment the menu item was clicked
          because by the time the user presses a key the selection may have moved. */}
      {showKeystrokeCapture && (
        <KeystrokeCaptureDialog
          onConfirm={(result) => {
            if (refuseInsert()) return;
            const insertIndex = keystrokeCaptureInsertIndex.current;
            if (result.actionType === 'HoldKey') {
              send({
                type: 'actions:insertHoldKey',
                payload: { key: result.key, insertIndex, holdDurationMs: result.holdDurationMs },
              });
            } else {
              // Omit `repeat`/`repeatDelayMs` for the single-press default so the bridge
              // payload stays minimal and the C# side leaves RepeatDelayMs as null (clean
              // profile JSON). Mirrors the previous insertion convention.
              const payload: { keystroke: string; insertIndex: number; repeat?: number; repeatDelayMs?: number; repeatDelayJitterPct?: number } =
                { keystroke: result.key, insertIndex };
              if (result.repeat > 1) {
                payload.repeat = result.repeat;
                if (result.repeatDelayMs !== DEFAULT_REPEAT_DELAY_MS) payload.repeatDelayMs = result.repeatDelayMs;
                // Only carried when the user turned jitter on (0 = off, left out to keep the
                // payload + the persisted profile JSON minimal).
                if (result.repeatDelayJitterPct > 0) payload.repeatDelayJitterPct = result.repeatDelayJitterPct;
              }
              send({ type: 'actions:insertKeystroke', payload });
            }
            setShowKeystrokeCapture(false);
          }}
          onClose={() => setShowKeystrokeCapture(false)}
        />
      )}
    </>
  );
}
