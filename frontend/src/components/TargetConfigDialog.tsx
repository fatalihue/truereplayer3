import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppWindow, Check, X } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { useAppState } from '../state/AppStateContext';
import { useTt } from '../state/LanguageContext';
import { Toggle } from './common/Toggle';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { Button } from './common/Button';
import { WindowTargetFields, type WindowTargetFieldsHandle } from './WindowTargetFields';

type Scope = 'profile' | 'folder';

// Covers the OS double-click interval (Windows' default GetDoubleClickTime) — see raiseClickShield.
const CLICK_SHIELD_MS = 500;

export type TargetSubmitPayload = {
  processName: string;
  windowTitle: string;
  titleMatchMode: 'contains' | 'regex';
  relativeCoordinates: boolean;
  bringToFocus: boolean;
  // Profile-only fields. Folder submits leave these undefined.
  restorePosition?: boolean;
  restoreSize?: boolean;
  // Profile-only: when true and the target fields were not edited, the backend keeps the
  // folder-inherited target and only persists the flags. Folder submits leave undefined.
  keepInheritedTarget?: boolean;
  // Profile-only: when set, the backend runs ExecuteConvertCoordinates AFTER the target
  // save completes. Used by the "Apply target & convert" path in the migration hint so
  // a single click can both persist the new target and migrate stored action coords
  // against the freshly-saved window geometry. Two-step (separate save + convert
  // messages) would race the async setWindowTarget against the sync conversion lookup.
  convertDirection?: 'toRelative' | 'toAbsolute';
};

interface TargetConfigDialogProps {
  scope: Scope;
  targetLabel: string;            // Profile or folder name shown in the header
  hasOwnTarget: boolean;          // Controls visibility of the Remove button
  // Profile-only — when true, the dialog opened over a profile that inherits its target
  // from its folder. Set Target without touching target fields keeps the inheritance.
  inheritedFromFolder?: boolean;
  initial: {
    processName: string;
    windowTitle: string;
    titleMatchMode: 'contains' | 'regex';
    relativeCoordinates: boolean;
    bringToFocus: boolean;
    restorePosition?: boolean;
    restoreSize?: boolean;
  };
  // The optional `opts.keepOpen` lets the dialog request that the parent NOT close it on
  // submit. Used by the "Apply target & convert" flow so the toast confirmation lands
  // while the user is still looking at the same dialog (instead of vanishing along with
  // it). Parent ignores the opts when undefined and closes as usual.
  onSubmit: (payload: TargetSubmitPayload, opts?: { keepOpen?: boolean }) => void;
  onRemove?: () => void;
  onCancel: () => void;
  // Profile-only callbacks. When omitted the dialog hides the corresponding UI.
  onUpdateGeometry?: (fields: { processName: string; windowTitle: string; titleMatchMode: 'contains' | 'regex' }) => void;
  onConvertCoordinates?: (direction: 'toRelative' | 'toAbsolute') => void;
  // Profile-only — count of actions whose stored coordinates would benefit from a coord-space
  // conversion when the user toggles Relative Coordinates. Triggers the inline hint that
  // suggests running "Convert to Relative/Absolute" so existing actions stay anchored to
  // the right window position. Folder scope (where actions don't live on the folder itself)
  // leaves this undefined → no hint; it gets inheritingMemberCount's warning instead.
  convertibleActionCount?: number;
  // Folder-only — how many member profiles read their X/Y in the space this folder sets (the ones
  // with no target of their own). A Relative Coordinates flip reinterprets every point they hold,
  // and a folder has no actions of its own to convert, so the dialog says so and holds Set Target
  // until it has been read. 0/undefined → no warning.
  inheritingMemberCount?: number;
}

export function TargetConfigDialog({
  scope,
  targetLabel,
  hasOwnTarget,
  inheritedFromFolder = false,
  initial,
  onSubmit,
  onRemove,
  onCancel,
  onUpdateGeometry,
  onConvertCoordinates,
  convertibleActionCount = 0,
  inheritingMemberCount = 0,
}: TargetConfigDialogProps) {
  const { send, subscribe } = useBridge();
  const tt = useTt();
  const { buttonStates } = useAppState();
  // Convert rewrites X/Y in place on the actions a live run is replaying, and the replayer froze
  // the coordinate space when it started — the rest of the run clicks in the wrong space. The
  // palette's Convert items were gated on this; this dialog's were not. The backend refuses too.
  const runActive = buttonStates.recordingActive || buttonStates.replayActive;

  const [processName, setProcessName] = useState(initial.processName);
  const [windowTitle, setWindowTitle] = useState(initial.windowTitle);
  const [titleMatchMode, setTitleMatchMode] = useState<'contains' | 'regex'>(initial.titleMatchMode);
  const [relativeCoordinates, setRelativeCoordinates] = useState(initial.relativeCoordinates);
  // Migration hint state. Fires only on the user-initiated toggle transition (off→on or
  // on→off), not on dialog open. `dismissed` mutes the hint after the user either runs the
  // convert or explicitly dismisses, so re-toggling doesn't keep nagging within one session.
  const [convertHint, setConvertHint] = useState<'toRelative' | 'toAbsolute' | null>(null);
  const [convertHintDismissed, setConvertHintDismissed] = useState(false);
  // The folder twin of the hint (see inheritingMemberCount). Nothing can be converted from here —
  // the actions live on the members — so it is a note with one answer, raised on the same
  // divergence-from-saved rule and muted once read. Saving the flip used to reinterpret every
  // inheriting member's clicks in silence: absolute points read as window-relative, off by the
  // window's origin, with nothing on screen to say why.
  const [memberSpaceWarn, setMemberSpaceWarn] = useState(false);
  const [memberSpaceWarnRead, setMemberSpaceWarnRead] = useState(false);

  const handleToggleRelativeCoordinates = (next: boolean) => {
    setRelativeCoordinates(next);
    if (scope === 'folder' && inheritingMemberCount > 0 && !memberSpaceWarnRead) {
      setMemberSpaceWarn(next !== initial.relativeCoordinates);
    }
    if (convertHintDismissed) return;
    if (convertibleActionCount === 0) return;
    if (!onConvertCoordinates) return;
    // Only show hint when state actually changed from the user's previous saved value —
    // re-toggling without saving doesn't accumulate hints, and opening the dialog with
    // rel coords already on doesn't fire it spuriously.
    if (next && !initial.relativeCoordinates) setConvertHint('toRelative');
    else if (!next && initial.relativeCoordinates) setConvertHint('toAbsolute');
    else setConvertHint(null);
  };
  const [bringToFocus, setBringToFocus] = useState(initial.bringToFocus);
  const [restorePosition, setRestorePosition] = useState(initial.restorePosition ?? false);
  const [restoreSize, setRestoreSize] = useState(initial.restoreSize ?? false);

  // Tracks whether the user explicitly edited target fields (process/title/match mode or detected
  // a new window) since opening. When false on an inherited-target profile, "Set Target" keeps
  // the folder inheritance and only persists flags. Folder scope ignores this — it's always a
  // direct set/replace at the folder level.
  const [edited, setEdited] = useState(false);

  // Result of the most recent Test Match request. Cleared when the user edits fields so a stale
  // ✓/✗ can't be confused with a different config, and auto-cleared 3.5 s after it arrives so
  // the Test button returns to its idle label (the button itself doubles as the result chip —
  // see the auto-revert effect below).
  type TestResult = { matches: boolean; foregroundProcess: string; foregroundTitle: string; error?: string };
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  // Pending flag flipped on as soon as the Test button is clicked. Without it, a fast backend
  // response (sub-frame) would replace the previous colored chip with the new one before the
  // browser paints — user perceives "the button didn't change" and waits for the auto-revert
  // timer instead. The in-flight state forces a neutral "Testing…" render between clicks so
  // the visual reset is always perceivable.
  const [testInFlight, setTestInFlight] = useState(false);

  // The flag alone isn't enough on its own — when the backend round-trip is faster than a
  // single browser frame (~16 ms, common for the synchronous foreground-window check), the
  // setTestInFlight(true) on click and the setTestInFlight(false) on response can both land
  // before the paint and skip the intermediate state entirely. We track when the in-flight
  // started and enforce a minimum visible duration (200 ms) by deferring the result apply.
  // 200 ms is below the threshold where a click-response feels laggy yet long enough to be
  // clearly perceptible as a state transition.
  const testInFlightStartRef = useRef<number>(0);
  const MIN_TEST_INFLIGHT_MS = 200;

  // Auto-revert: 3.5 s after a result lands, drop it so the button returns to its neutral
  // "Test against foreground window" state. Re-runs cancel the prior timer via the cleanup
  // (testResult changes → effect re-runs → previous setTimeout cleared). Long enough to read
  // a wrapped process+title at a glance, short enough that a forgotten result doesn't masquerade
  // as a live verdict if the user comes back later.
  useEffect(() => {
    if (!testResult) return;
    const t = window.setTimeout(() => setTestResult(null), 3500);
    return () => window.clearTimeout(t);
  }, [testResult]);

  // Which Test click a result may answer. windowTarget:testResult carries no id (this dialog is its
  // only consumer), and a result could land AFTER the user had already corrected the fields:
  // markEdited cleared the chip, then the deferred apply below put the old verdict back over the
  // new fields — "✗ No match" on a config that matches. An edit bumps the sequence; a result that
  // arrives, or would be applied, under a newer sequence than its click is dropped.
  const testSeqRef = useRef(0);
  const awaitedTestSeqRef = useRef(-1);

  const markEdited = () => { testSeqRef.current += 1; setEdited(true); setTestResult(null); setTestInFlight(false); };

  // In flight between a convert click and the backend's answer (windowTarget:applyConvertCompleted,
  // ok or not — every exit answers). The button stayed live before, and "Apply target & convert"
  // crosses three awaits before converting: a double click converted twice, doubling the window
  // offset on every action under a success toast. The backend drops a duplicate as well.
  const [applying, setApplying] = useState(false);
  const applyingKindRef = useRef<'apply' | 'convert' | null>(null);

  // The two floating cards below sit OVER Restore Position/Size and "Update Window Size &
  // Position", and every way out of them removed the card at once — so the second click of a
  // double click (a trackpad habit) landed on whatever the card had covered: a toggle flipped
  // unseen, or an immediate profile:updateWindowSize overwrote the saved geometry. For one
  // double-click interval after a card goes, an invisible pad in its place takes that click.
  const floatingCardRef = useRef<HTMLDivElement>(null);
  const [clickShield, setClickShield] = useState<{ top: number; height: number } | null>(null);
  const shieldTimerRef = useRef<number | undefined>(undefined);
  const raiseClickShield = useCallback(() => {
    const el = floatingCardRef.current;
    if (!el) return;
    // Every caller is about to unmount the card, and a press on Convert / Skip / Got it left the
    // focus inside it. Hand it to the dialog card first, while the card still exists, rather than
    // letting it fall to <body> and be rescued from there.
    if (el.contains(document.activeElement)) el.closest<HTMLElement>('[role="dialog"]')?.focus();
    // offsetTop/offsetHeight are layout units, the same space the pad's style is written in.
    setClickShield({ top: el.offsetTop, height: el.offsetHeight });
    window.clearTimeout(shieldTimerRef.current);
    shieldTimerRef.current = window.setTimeout(() => setClickShield(null), CLICK_SHIELD_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(shieldTimerRef.current), []);
  // Lets handleSubmit cancel an in-flight detection on the keep-open convert path (see below).
  const wtfRef = useRef<WindowTargetFieldsHandle>(null);

  // Inline regex validation. We compile in the browser as a syntax check only — the backend
  // recompiles on its own (with timeout) for actual matching. Mirrors backend behavior: empty
  // pattern is valid (means "no title constraint"), invalid pattern blocks Set Target so the
  // user doesn't hit a generic alert after submitting.
  const regexError = useMemo(() => {
    if (titleMatchMode !== 'regex') return null;
    const trimmed = windowTitle.trim();
    if (trimmed.length === 0) return null;
    try {
      new RegExp(trimmed);
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'Invalid regex pattern';
    }
  }, [titleMatchMode, windowTitle]);

  // Subscribe to Test + convert events. Detection + the process list are owned by WindowTargetFields.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'windowTarget:testResult') {
        // Enforce a minimum visible duration for the "Testing…" state. When the backend
        // returns in less than MIN_TEST_INFLIGHT_MS, defer the apply so the user perceives
        // a clean state transition (colored → neutral testing → new colored) instead of
        // a single-frame re-render that visually looks like nothing happened.
        const result = msg.payload as TestResult;
        const seq = awaitedTestSeqRef.current;
        if (seq !== testSeqRef.current) return;
        const elapsed = Date.now() - testInFlightStartRef.current;
        const remaining = MIN_TEST_INFLIGHT_MS - elapsed;
        if (remaining <= 0) {
          setTestInFlight(false);
          setTestResult(result);
        } else {
          window.setTimeout(() => {
            if (seq !== testSeqRef.current) return;
            setTestInFlight(false);
            setTestResult(result);
          }, remaining);
        }
      } else if (msg.type === 'windowTarget:applyConvertCompleted') {
        const { ok } = msg.payload as { ok: boolean };
        const kind = applyingKindRef.current;
        applyingKindRef.current = null;
        setApplying(false);
        // A refusal already alerted; the hint stays so the conversion can still be done.
        if (!ok) return;
        // Dismiss the hint so a second click on the same button doesn't double-translate the
        // already-converted actions. After an APPLY, reset `edited` too: the typed fields are
        // now the persisted state. The toast (alert:show) is sent separately by the backend so
        // the user sees the confirmation regardless of whether the dialog stayed open or not.
        // The answer can beat the second click of a double click (the plain Convert answers in
        // milliseconds), so the card leaves behind the same pad as a Skip.
        raiseClickShield();
        setConvertHint(null);
        setConvertHintDismissed(true);
        if (kind === 'apply') setEdited(false);
      }
    });
  }, [subscribe, raiseClickShield]);

  // Detection lifecycle (the click-capture and its Esc-to-cancel) + the process picker now live
  // inside WindowTargetFields, which stops any active detection on unmount — so closing the dialog
  // via Cancel/Remove/Set Target no longer needs an explicit stopDetectionIfActive here.
  const handleCancel = () => {
    onCancel();
  };

  const handleRemove = () => {
    onRemove?.();
  };

  // `extras` lets the migration-hint Convert button piggyback `convertDirection` onto the
  // same save round-trip — without it, the conversion would either race a separate
  // message or run against the stale (pre-save) profile target. Default {} keeps every
  // other caller (Set Target button, Enter key) on the existing semantics.
  // True when the payload went out — the convert button's in-flight lock waits for an answer only then.
  const handleSubmit = (extras: { convertDirection?: 'toRelative' | 'toAbsolute' } = {}): boolean => {
    // Stop any in-flight window detection on submit. Matters for the keep-open "Apply target &
    // convert" path, which does NOT unmount the component (so the unmount cleanup can't fire); the
    // ordinary close paths self-heal via unmount. No-op when nothing is detecting.
    wtfRef.current?.stopDetection();
    // Defense in depth — submitDisabled already covers this, but a stray Enter press could
    // bypass the click handler's disabled check on some browsers.
    if (regexError !== null) return false;
    const keepInheritedTarget = scope === 'profile' && inheritedFromFolder && !edited;
    const targetEmpty = !processName.trim() && !windowTitle.trim();
    // Guard: when not keeping inheritance, target fields must have something.
    if (!keepInheritedTarget && targetEmpty) return false;

    const payload: TargetSubmitPayload = {
      processName: processName.trim(),
      windowTitle: windowTitle.trim(),
      titleMatchMode,
      relativeCoordinates,
      bringToFocus,
      // Restore Position/Size apply to both scopes now — folder targets carry their own copy
      // so they can be inherited by profiles in the folder without their own override.
      restorePosition,
      restoreSize,
    };
    if (scope === 'profile') {
      payload.keepInheritedTarget = keepInheritedTarget;
    }
    if (extras.convertDirection) {
      payload.convertDirection = extras.convertDirection;
    }
    // Keep the dialog open on the combined "Apply target & convert" path so the toast
    // confirmation is visible alongside it. The dialog's own success cleanup (dismissing
    // the hint, resetting `edited`) runs when the backend emits
    // `windowTarget:applyConvertCompleted` — see the subscribe handler.
    onSubmit(payload, extras.convertDirection ? { keepOpen: true } : undefined);
    return true;
  };

  const submitDisabled = (!processName.trim() && !windowTitle.trim()) || regexError !== null;

  // Hard-block the Relative Coordinates toggle from going OFF→ON without a target — rel
  // coords are by definition "relative to a window" so saving them while the dialog has
  // no process / title would lock the profile into a coord space anchored to nothing.
  // ON→OFF stays freely allowed (recovery path: profile somehow ended up with rel coords
  // but lost its target; user needs to be able to turn it off without first re-adding
  // a target). The toggle component itself styles disabled buttons with opacity-40 +
  // cursor-not-allowed; the wrapping row carries the title attr that explains why.
  const hasTargetInFields = processName.trim().length > 0 || windowTitle.trim().length > 0;
  // Same rule the backend applies when it saves: while the profile keeps its folder-inherited
  // target, the per-profile flags are NOT persisted, so flipping this toggle is a no-op the user
  // can't see. Worse, the migration hint it raises can only ever point the OPPOSITE way from the
  // folder — the hint fires on divergence from `initial`, and `initial` IS the folder's value for
  // an inheriting profile — so its Convert button asks for exactly the conversion the backend
  // refuses, after having already thrown the hint away. Disable the toggle instead of walking the
  // user into a guaranteed refusal: editing the process name or window title (markEdited) drops
  // keepInheritedTarget and unlocks it, which is the flow that actually works.
  const relativeCoordsAreDormant = scope === 'profile' && inheritedFromFolder && !edited;
  const relativeToggleDisabled = (!relativeCoordinates && !hasTargetInFields) || relativeCoordsAreDormant;

  // Will the Convert button in the migration hint also need to save the target? True when
  // the user has actually touched the target fields since opening (edited) AND the fields
  // are populated. When the fields are empty the conversion still falls back to the
  // currently-saved target via onConvertCoordinates — no apply step needed. When edited
  // is false the saved target hasn't changed, so a plain convert is enough.
  const convertAlsoApplies = edited && hasTargetInFields;
  // The count is the LOADED profile's, and zero whenever this dialog's profile is not the loaded
  // one. A hint raised while it was loaded outlives that — an automation or a profile hotkey can
  // swap the loaded profile under an open dialog — and its Convert then rewrote whoever was
  // loaded NOW. The hint stays (Set Target is still gated on it: the flag flip still needs an
  // answer) but only Skip is offered until the profile is loaded again. The backend refuses a
  // name that is not the loaded profile as well.
  const hintCanConvert = convertibleActionCount > 0;
  const isProfile = scope === 'profile';
  // Named after the menu item that opens it. It used to say "Target Configuration" while the
  // item said "Window target…" and the removal confirmations said "window target" — three names
  // for one thing. Title Case here, sentence case in the menu: that split is per-surface and
  // consistent across the app, and it does not change the NAME.
  const header = isProfile ? 'Window Target' : 'Folder Window Target';
  const description = isProfile
    ? <>Configure target window for <span className="text-text-primary font-medium">‘{targetLabel}’</span></>
    : <>Configure target for all profiles in <span className="text-text-primary font-medium">‘{targetLabel}’</span>. Profiles with their own target override this.</>;

  return (
    <DialogShell
      icon={<AppWindow size={14} className="shrink-0 text-text-tertiary" />}
      title={header}
      onClose={handleCancel}
      // Multi-field form — typed process name / window title, live detection + picker
      // state and five flags. A stray click on the scrim must not discard all that, so
      // closeOnBackdrop is FALSE; dismissal is Esc or Cancel only.
      closeOnBackdrop={false}
      // No onCardKeyDown: this dialog never had Enter-to-submit (Enter is ambiguous
      // across its many fields), and Esc is the shell's — plus the capture-phase
      // overlay handler above for the picker/detection states.
      //
      // Remove rides the shell's left-anchored footerStart slot. It is destructive-with-undo
      // (the parent shows a 10 s undo toast) and SECONDARY to Set Target, hence red text and
      // not a red fill — the fill is for dialogs whose PRIMARY action destroys (Delete Profile).
      footerStart={hasOwnTarget && onRemove ? (
        <Button variant="destructiveText" size="md" onClick={handleRemove}>Remove</Button>
      ) : undefined}
      // Set Target is gated while the coordinate-conversion prompt is pending: the old card's
      // toast physically covered the buttons to force a Convert-or-Skip choice; in the shell the
      // footer is a sibling the toast can't cover, so the gate is explicit. Saving a flipped
      // Relative-Coordinates flag without converting silently reinterprets every stored X/Y.
      // The folder's member-space note gates it the same way, for the same reason.
      footer={<DialogFooter secondary={{ label: 'Cancel', onClick: handleCancel }} primary={{ label: 'Set Target', onClick: () => handleSubmit(), disabled: submitDisabled || convertHint !== null || memberSpaceWarn,
        tip: convertHint ? tt('Resolve the conversion prompt first', 'Resolva o aviso de conversão primeiro')
          : memberSpaceWarn ? tt("Read the note about this folder's profiles first", 'Leia o aviso sobre os perfis desta pasta primeiro')
            : undefined }} />}
    >
      {/* `relative` replaces the old card's positioning context — the convert-hint toast
          below pins itself to this wrapper's bottom edge (just above the shell footer). */}
      <div className="relative px-4 py-4">
        <p className="text-minor text-text-secondary mb-4">{description}</p>

        <div className="space-y-3">
          <WindowTargetFields
            ref={wtfRef}
            value={{ processName, windowTitle, titleMatchMode }}
            onChange={(p) => {
              if (p.processName !== undefined) setProcessName(p.processName);
              if (p.windowTitle !== undefined) setWindowTitle(p.windowTitle);
              if (p.titleMatchMode !== undefined) setTitleMatchMode(p.titleMatchMode);
            }}
            onEdit={markEdited}
            titleError={regexError}
            processLabel="Process Name"
          />
        </div>

        {/* Test Match — checks current fields against whichever window the user has open behind
            the modal. The TR window itself is excluded server-side so the test reports against
            the "real" foreground. The button itself doubles as the result chip: idle = neutral
            border, success = green tint with a check and "Matches — chrome.exe", failure / error = red.
            Reverts to idle ~3.5 s after the result arrives (see the testResult useEffect).
            Keeps the row to a single 28 px line — no separate slot growing the dialog. */}
        <button
          data-tip={tt('Checks the window in FRONT right now against these fields.',
            'Confere a janela que está em PRIMEIRO PLANO agora contra estes campos.')}
          onClick={() => {
            // Stamp the start time BEFORE setting state so the response handler can compute
            // an accurate elapsed and decide whether to defer the apply (see the
            // windowTarget:testResult branch in the subscribe useEffect).
            testSeqRef.current += 1;
            awaitedTestSeqRef.current = testSeqRef.current;
            testInFlightStartRef.current = Date.now();
            setTestResult(null);
            setTestInFlight(true);
            send({
              type: 'profile:testWindowMatch',
              payload: {
                processName: processName.trim(),
                windowTitle: windowTitle.trim(),
                titleMatchMode,
              },
            });
          }}
          disabled={(!processName.trim() && !windowTitle.trim()) || regexError !== null}
          className={`mt-2 w-full h-7 px-2 text-caption border rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed overflow-hidden ${
            testInFlight
              ? 'text-text-tertiary border-border-default bg-bg-elevated/40'
              : testResult
                ? testResult.error || !testResult.matches
                  ? 'bg-recording/10 text-recording-fg border-recording/30 hover:bg-recording/15'
                  : 'bg-replay/10 text-replay-fg border-replay/30 hover:bg-replay/15'
                // Wash, not bg-bg-elevated: the dialog card IS bg-bg-elevated, so that hover
                // painted the button the colour it already had. `enabled:` because a data-tip
                // keeps pointer events alive on the disabled button.
                : 'text-text-secondary border-border-default enabled:hover:bg-wash-hover'
          }`}
        >
          {/* Live, because the verdict replaces the label in place: the keyboard stays on the
              button and nothing else would tell a screen reader the test came back. */}
          <div className="truncate" aria-live="polite">
            {testInFlight ? (
              'Testing…'
            ) : testResult ? (
              testResult.error ? (
                testResult.error
              ) : (
                <>
                  <span className="font-semibold">
                    {testResult.matches
                      ? <Check size={12} aria-hidden="true" className="inline align-middle mr-1" />
                      : <X size={12} aria-hidden="true" className="inline align-middle mr-1" />}
                    {testResult.matches ? 'Matches' : 'No match'}
                  </span>
                  {testResult.foregroundProcess && (
                    <>
                      {' — '}
                      <span className="font-mono">{testResult.foregroundProcess}</span>
                    </>
                  )}
                  {testResult.foregroundTitle && (
                    <span className="opacity-70"> / {testResult.foregroundTitle}</span>
                  )}
                </>
              )
            ) : (
              // Just "Test", like every other probe button in the app (the two window probes in
              // the sheet editors, "Test match" for image/pixel, "Test action" for a browser
              // step). "Test front window" was the one label that spelled out its mechanism —
              // and the result it prints right here says what it looked at anyway. The tip
              // carries the nuance this dialog does need: it reads what is in FRONT right now.
              'Test'
            )}
          </div>
        </button>

        {/* Options */}
        <div className="mt-3 pt-3 border-t border-border-subtle space-y-2">
          {/* Relative Coordinates — disabled when the dialog has no target in its fields
              and the flag is currently OFF (hard block on OFF→ON to prevent the user from
              saving a profile in a coord space that can't be anchored to anything). The
              data-tip on the row surfaces the reason (or, when enabled, what it does) via the
              body-portal tooltip on hover. */}
          <div
            className="flex items-center justify-between"
            data-tip={relativeCoordsAreDormant
              ? tt("Inherits the folder's window target. Set a process or title above for its own.", 'Herda a janela-alvo da pasta. Defina um processo ou título acima para ter a própria.')
              : undefined}
          >
            <span className={`text-minor ${relativeToggleDisabled ? 'text-text-disabled' : 'text-text-secondary'}`}>Relative Coordinates</span>
            <Toggle
              isOn={relativeCoordinates}
              onChange={handleToggleRelativeCoordinates}
              disabled={relativeToggleDisabled}
              ariaLabel="Relative Coordinates"
            />
          </div>
          {/* Migration hint — surfaced only when the user just toggled the flag AND there
              are existing actions whose stored coords are in the OLD coord space. Without
              this nudge, the toggle silently reinterprets every stored X/Y, breaking clicks,
              WaitImage regions, and WaitPixel coords against the wrong reference frame. */}
          {convertHint && (
            // Floating toast OVERLAID on the dialog body (absolute, pinned to the bottom
            // of the `relative` body wrapper → just above the shell footer; does NOT grow
            // the dialog — the inline hint used to push every row down and resize the
            // box). Opaque card + shadow so it reads as a layer on top. No timeout —
            // stays until the user converts or skips, same actions as the old hint.
            // role=status: the card appears because of a toggle the keyboard is still on, and it
            // holds Set Target until answered — a screen reader has to hear that it arrived.
            <div ref={floatingCardRef} role="status" className="absolute bottom-3 left-4 right-4 flex items-start gap-2 px-3 py-2 text-caption text-warning-ink bg-bg-card border border-warning-ink/35 rounded-overlay shadow-overlay z-20">
              <span className="flex-1 leading-snug">
                {hintCanConvert ? (
                  <>
                    {convertibleActionCount} action{convertibleActionCount === 1 ? '' : 's'} captured in {convertHint === 'toRelative' ? 'absolute' : 'relative'} coords.{' '}
                    {convertHint === 'toRelative'
                      ? 'Convert to relative so they follow this window when it moves.'
                      : 'Convert to absolute so they keep their current screen positions.'}
                  </>
                ) : (
                  <>
                    ‘{targetLabel}’ is no longer the loaded profile, so its actions can't be converted from here.
                    Load it to convert, or Skip to save the setting without converting.
                  </>
                )}
              </span>
              {/* The house Button at its 28 px tier: the hand-rolled pair was ~20 px tall, under the
                  24 px click floor, and a third recipe for the same primary/quiet split. */}
              <div className="flex gap-1 shrink-0">
                {/* Two effective modes for this button:
                    - convertAlsoApplies: target fields were edited AND non-empty → fold
                      the save and the conversion into one submit so the backend's lookup
                      uses the freshly-saved geometry instead of the stale profile state
                      (separate save + convert messages would race the async setWindowTarget
                      against the sync conversion). Closes the dialog like a normal Set
                      Target — same effect with the conversion bolted on.
                    - else: target already saved (or fields empty and only the flag
                      changed) → keep the legacy in-place convert via onConvertCoordinates
                      so the dialog stays open for further tweaks. */}
                {/* Both kinds now wait for the backend's windowTarget:applyConvertCompleted before the
                    hint goes: the plain Convert used to dismiss on SEND, so a refusal (window not
                    found, profile swapped out) took the hint away with nothing converted. */}
                <Button
                  variant="primary"
                  size="xs"
                  onClick={() => {
                    if (applying || !onConvertCoordinates) return;
                    applyingKindRef.current = convertAlsoApplies ? 'apply' : 'convert';
                    setApplying(true);
                    let sent = true;
                    if (convertAlsoApplies) sent = handleSubmit({ convertDirection: convertHint });
                    else onConvertCoordinates(convertHint);
                    if (!sent) { applyingKindRef.current = null; setApplying(false); }
                  }}
                  disabled={applying || runActive || !hintCanConvert}
                  data-tip={runActive ? tt('Not while a run is active', 'Não durante uma execução') : undefined}
                >
                  {convertAlsoApplies ? 'Apply target & convert' : 'Convert'}
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => { raiseClickShield(); setConvertHint(null); setConvertHintDismissed(true); }}
                >
                  Skip
                </Button>
              </div>
            </div>
          )}
          {memberSpaceWarn && (
            // Same floating card as the hint above (the two never meet: the hint needs
            // onConvertCoordinates, which only the profile scope passes).
            <div ref={floatingCardRef} role="status" className="absolute bottom-3 left-4 right-4 flex items-start gap-2 px-3 py-2 text-caption text-warning-ink bg-bg-card border border-warning-ink/35 rounded-overlay shadow-overlay z-20">
              <span className="flex-1 leading-snug">
                {inheritingMemberCount} profile{inheritingMemberCount === 1 ? '' : 's'} in this folder use{inheritingMemberCount === 1 ? 's' : ''} its target, with X/Y set for {initial.relativeCoordinates ? 'relative' : 'absolute'} coords.
                They are not converted — if a profile's clicks land in the wrong place, load it and run
                “Convert Coordinates to {initial.relativeCoordinates ? 'Absolute' : 'Relative'}” (Ctrl+K).
              </span>
              <Button
                variant="primary"
                size="xs"
                className="shrink-0"
                onClick={() => { raiseClickShield(); setMemberSpaceWarn(false); setMemberSpaceWarnRead(true); }}
              >
                Got it
              </Button>
            </div>
          )}
          {clickShield && (
            <div aria-hidden className="absolute left-4 right-4 z-20" style={{ top: clickShield.top, height: clickShield.height }} />
          )}
          <div className="flex items-center justify-between">
            <span className="text-minor text-text-secondary">Bring to Focus</span>
            <Toggle isOn={bringToFocus} onChange={setBringToFocus} ariaLabel="Bring to Focus" />
          </div>
          {/* Restore Position/Size + Update Geometry apply to both profile and folder scopes —
              folder targets inherit these to every profile inside (unless that profile overrides
              them with its own target). Convert Coordinates is profile-only because it rewrites
              the actions of the active profile, not a property of the target itself. */}
          <div className="flex items-center justify-between">
            <span className="text-minor text-text-secondary">Restore Position</span>
            <Toggle isOn={restorePosition} onChange={setRestorePosition} ariaLabel="Restore Position" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-minor text-text-secondary">Restore Size</span>
            <Toggle isOn={restoreSize} onChange={setRestoreSize} ariaLabel="Restore Size" />
          </div>
          {/* The secondary Button: its hover lifts to bg-surface. The hand-rolled one hovered to
              bg-bg-elevated — the colour of the dialog card it sits on, so it never visibly moved. */}
          {onUpdateGeometry && (
            <Button
              variant="secondary"
              size="xs"
              className="w-full"
              onClick={() => onUpdateGeometry({
                processName: processName.trim(),
                windowTitle: windowTitle.trim(),
                titleMatchMode,
              })}
              disabled={submitDisabled}
            >
              Update Window Size &amp; Position
            </Button>
          )}
        </div>

        {/* Coordinate conversion (To Relative / To Absolute) moved to the profile's
            right-click menu → More ("Convert coords → Relative/Absolute") — it's rarely
            used, so it lives in a less prominent place now. The relative-toggle migration
            toast above still offers a one-click convert at the moment it's most relevant. */}
      </div>
    </DialogShell>
  );
}
