import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { X, ChevronDown } from 'lucide-react';
import { useBridge } from '../bridge/BridgeContext';
import { useTt } from '../state/LanguageContext';
import { Field } from './sheet/Field';
import { SegmentedControl } from './common/SegmentedControl';
import { FieldError } from './common/FieldError';

export type WindowTargetValue = {
  processName: string;
  windowTitle: string;
  titleMatchMode: 'contains' | 'regex';
};

/**
 * The shared "which window" matcher trio — Process (with a running-process picker), Title, and a
 * Contains/Regex mode toggle — plus an optional "Detect window (click on target)" button. Extracted
 * from TargetConfigDialog so the ActivateWindow and If-Window sheet editors get the same picker +
 * Detect they used to lack, and all three sites stay in lockstep.
 *
 * OWNS the transient UI state (picker open/filter, the fetched process list, detecting) and self-wires
 * the bridge (process:list lazy fetch + subscription, profile:detectWindow send + windowTarget:detected/
 * detectState) plus the capture-phase Esc handler that dismisses the picker/detection BEFORE a host
 * modal's own Esc can fire. The PERSISTED values stay owned by the parent via value/onChange.
 *
 * The Test button is intentionally NOT here: the dialog's Test is a foreground-only
 * profile:testWindowMatch, while the sheet editors' Test is an exists-anywhere window:testProbe —
 * different semantics, so each site keeps its own.
 */
export type WindowTargetFieldsHandle = {
  /** Cancel an in-flight "Detect window" if one is active. The host calls this when it commits
   *  WITHOUT unmounting (the dialog's keep-open "Apply target & convert" path) so the global
   *  click-capture doesn't stay armed. Unmount already handles the ordinary close paths. */
  stopDetection: () => void;
};

export const WindowTargetFields = forwardRef<WindowTargetFieldsHandle, {
  value: WindowTargetValue;
  onChange: (patch: Partial<WindowTargetValue>) => void;
  /** Called on any user edit (typing, picker pick, a detected window — not the Detect click
   *  itself). Hosts use it to mark the form dirty and clear a stale test result. */
  onEdit?: () => void;
  showDetect?: boolean;
  /** Optional error rendered under the Title input (e.g. the dialog's live regex validation). */
  titleError?: string | null;
  processLabel?: string;
  processHint?: string;
  titleHint?: string;
}>(function WindowTargetFields({
  value,
  onChange,
  onEdit,
  showDetect = true,
  titleError = null,
  processLabel = 'Process',
  processHint,
  titleHint,
}, ref) {
  const { send, subscribe } = useBridge();
  const tt = useTt();

  // Regex-mode sanity check, computed HERE rather than left to each host.
  //
  // Three of the four hosts never passed titleError, so a title regex that does not compile was
  // accepted in silence — and in the automation panel that is unsupervised: the backend swallows
  // the compile failure into a null Regex, a null Regex in regex mode rejects every window, and
  // the watcher polls forever without matching. The component's own placeholder teaches a syntax
  // that is invalid halfway through typing it, which is the moment this needs to speak up.
  //
  // WARNING ONLY, never a gate. new RegExp is the JavaScript parser and the matcher is .NET: it
  // rejects .NET-valid patterns like (?>ab)+ and (?'name'x), and accepts C:\Users\Admin, which
  // .NET throws on. An explicit titleError from the host still wins — TargetConfigDialog gates its
  // Save on its own copy and must keep deciding for itself.
  const autoTitleError = useMemo(() => {
    if (value.titleMatchMode !== 'regex') return null;
    const pattern = (value.windowTitle ?? '').trim();
    if (!pattern) return null;
    try { new RegExp(pattern); return null; }
    catch { return 'This does not look like a valid regular expression.'; }
  }, [value.titleMatchMode, value.windowTitle]);
  const shownTitleError = titleError ?? autoTitleError;

  const [processList, setProcessList] = useState<{ name: string; title: string }[] | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [filter, setFilter] = useState('');
  const [isDetecting, setIsDetecting] = useState(false);

  // Where the keyboard goes when something it was on disappears: the picker's filter and rows
  // unmount when the picker closes, and each clear-× unmounts itself once its field is empty.
  // The host's shell would only rescue the focus to its card; these put it back on the control
  // the user was working with.
  const processInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);

  // The subscribe callback below must call the LATEST onChange/onEdit, not the ones captured on
  // first render (a host that passes inline callbacks re-creates them each render). Route through
  // refs so the subscription can depend only on [subscribe] and never go stale.
  const onChangeRef = useRef(onChange);
  const onEditRef = useRef(onEdit);
  onChangeRef.current = onChange;
  onEditRef.current = onEdit;
  const edit = (patch: Partial<WindowTargetValue>) => { onChangeRef.current(patch); onEditRef.current?.(); };

  // Which detection is ours. Two instances can be mounted at once — a Sheet row editor under the
  // Automations panel the tray opens on top of it — and the backend's replies used to be a bare
  // broadcast: the detected window was written into BOTH drafts, and one Esc reached both
  // instances and sent two TOGGLES that disarmed the hook and re-armed it. Every send names this
  // id now, every reply is checked against it, and start/stop are explicit.
  // Lazy-initialized: useRef's argument is evaluated on every render (see SettingsPanel's HotkeyInput).
  const requestIdRef = useRef<string | undefined>(undefined);
  if (requestIdRef.current === undefined) requestIdRef.current = `window-detect-${crypto.randomUUID()}`;

  // Detection is a global click-capture on the backend — if the host (a modal, or the sheet) closes
  // while we're still waiting for the target click, unmount stops it so it doesn't leak. Set on
  // the START, not on the backend's answer: a host that closes in between still owes the stop.
  const armedRef = useRef(false);
  const sendRef = useRef(send);
  sendRef.current = send;

  const startDetection = useCallback(() => {
    armedRef.current = true;
    sendRef.current({ type: 'profile:detectWindow', payload: { requestId: requestIdRef.current!, enabled: true } });
  }, []);
  // Cancel our detection NOW. A stop naming another instance's request is ignored by the backend,
  // so this can never end a detection someone else started.
  const stopDetection = useCallback(() => {
    if (!armedRef.current) return;
    armedRef.current = false;
    setIsDetecting(false);
    sendRef.current({ type: 'profile:detectWindow', payload: { requestId: requestIdRef.current!, enabled: false } });
  }, []);
  useImperativeHandle(ref, () => ({ stopDetection }), [stopDetection]);

  useEffect(() => () => {
    if (armedRef.current) {
      sendRef.current({ type: 'profile:detectWindow', payload: { requestId: requestIdRef.current!, enabled: false } });
    }
  }, []);

  useEffect(() => subscribe((msg) => {
    if (msg.type === 'windowTarget:detected') {
      const p = msg.payload as { requestId?: string; processName: string; windowTitle: string };
      if (p.requestId !== requestIdRef.current) return;
      armedRef.current = false;
      edit({ processName: p.processName, windowTitle: p.windowTitle });
      setIsDetecting(false);
    } else if (msg.type === 'windowTarget:detectState') {
      const p = msg.payload as { requestId?: string; detecting: boolean };
      if (p.requestId !== requestIdRef.current) return;
      // A refusal (a run in progress, a hook Windows would not give) and a takeover by another
      // instance both arrive here as detecting:false — the session is over either way.
      if (!p.detecting) armedRef.current = false;
      setIsDetecting(p.detecting);
    } else if (msg.type === 'process:list') {
      setProcessList((msg.payload as { processes: { name: string; title: string }[] }).processes);
    }
  }), [subscribe]);

  // Esc priority (most specific first): close the picker → cancel detection. Capture phase so we
  // win before a host modal's own Esc tears the whole thing down; when neither overlay is active we
  // leave the event alone so it falls through to the host. Only the instance that owns the
  // detection shows isDetecting, so only it answers the Esc.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showPicker) {
        e.stopPropagation();
        setShowPicker(false);
        pickerButtonRef.current?.focus();
      } else if (isDetecting) {
        e.stopPropagation();
        stopDetection();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [showPicker, isDetecting, stopDetection]);

  return (
    <>
      <Field label={processLabel} hint={processHint}>
        <div className="relative">
          {/* `input-field` is the recipe this used to spell out by hand; it stays mono, as both
              fields always were (D3 is still open). */}
          <input
            ref={processInputRef}
            type="text"
            value={value.processName}
            onChange={(e) => edit({ processName: e.target.value })}
            placeholder="notepad.exe"
            spellCheck={false}
            className="input-field font-mono pr-14"
          />
          <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {value.processName && (
              <button
                type="button"
                onClick={() => { edit({ processName: '' }); processInputRef.current?.focus(); }}
                aria-label="Clear process"
                className="p-1 text-text-disabled hover:text-text-secondary transition-colors"
              >
                <X size={12} />
              </button>
            )}
            <button
              ref={pickerButtonRef}
              type="button"
              onClick={() => {
                const next = !showPicker;
                setShowPicker(next);
                // Lazy fetch — first open enumerates. Re-opens reuse the cache.
                if (next && processList === null) send({ type: 'process:list', payload: {} });
              }}
              aria-label="Pick a running process"
              aria-expanded={showPicker}
              className={`p-1 transition-colors ${showPicker ? 'text-accent' : 'text-text-tertiary hover:text-text-secondary'}`}
            >
              <ChevronDown size={14} />
            </button>
          </div>
          {showPicker && (
            <div className="absolute top-full left-0 right-0 mt-1 menu-surface z-10 max-h-64 overflow-hidden flex flex-col">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                autoFocus
                placeholder={'Filter…'}
                aria-label="Filter processes"
                className="w-full h-7 px-2 text-caption text-text-primary bg-bg-input border-b border-border-subtle outline-none"
              />
              <div className="overflow-y-auto flex-1">
                {processList === null ? (
                  <div className="px-2 py-2 text-caption text-text-tertiary">{'Loading…'}</div>
                ) : (() => {
                  const f = filter.trim().toLowerCase();
                  const items = f.length === 0
                    ? processList
                    : processList.filter(p => p.name.toLowerCase().includes(f) || p.title.toLowerCase().includes(f));
                  if (items.length === 0) {
                    return <div className="px-2 py-2 text-caption text-text-tertiary">{'No processes match.'}</div>;
                  }
                  return items.map((p) => (
                    <button
                      type="button"
                      key={p.name}
                      onClick={() => {
                        edit({ processName: p.name });
                        setShowPicker(false);
                        setFilter('');
                        pickerButtonRef.current?.focus();
                      }}
                      className="w-full text-left px-2 py-1 text-caption hover:bg-bg-elevated transition-colors"
                    >
                      <span className="font-mono text-text-primary">{p.name}</span>
                      {p.title && <span className="text-text-tertiary"> — {p.title}</span>}
                    </button>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      </Field>

      <Field
        label="Title"
        labelAdornment={
          <div className="ml-auto">
            <SegmentedControl<'contains' | 'regex'>
              ariaLabel="Title match mode"
              value={value.titleMatchMode}
              onChange={(m) => edit({ titleMatchMode: m })}
              options={[
                { value: 'contains', label: 'Contains' },
                { value: 'regex', label: 'Regex', tip: tt('.NET regular expression', 'Expressão regular .NET') },
              ]}
            />
          </div>
        }
        hint={titleHint}
      >
        <div className="relative">
          <input
            ref={titleInputRef}
            type="text"
            value={value.windowTitle}
            onChange={(e) => edit({ windowTitle: e.target.value })}
            placeholder={value.titleMatchMode === 'regex' ? 'e.g. (Chrome|Firefox)' : ''}
            spellCheck={false}
            className={'input-field' + (value.windowTitle ? ' pr-7' : '') + (shownTitleError ? ' border-recording/60 focus:border-recording' : '')}
          />
          {value.windowTitle && (
            <button
              type="button"
              onClick={() => { edit({ windowTitle: '' }); titleInputRef.current?.focus(); }}
              aria-label="Clear title"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-disabled hover:text-text-secondary transition-colors"
            >
              <X size={12} />
            </button>
          )}
        </div>
        {/* Reserved slot: titleError is a regex-parser message recomputed on EVERY keystroke, so
            "(Chrome|Firefox)" is invalid until the closing paren and this line used to flash in and
            out per character — shifting everything below it, and re-centring the whole card in the
            dialog that hosts these fields. One line, truncated, full text on hover. */}
        <FieldError
          show={!!shownTitleError}
          className="text-caption text-recording-fg mt-1 leading-tight"
          tip={shownTitleError ?? undefined}
        >
          {shownTitleError}
        </FieldError>
      </Field>

      {showDetect && (
        <button
          type="button"
          // Not an edit: nothing changes until a window is actually detected, and that reply goes
          // through edit() above. Marking the form edited on the click alone detached a profile
          // from its folder's target when the user merely opened detection and cancelled it.
          onClick={() => { if (isDetecting) stopDetection(); else startDetection(); }}
          data-tip={isDetecting
            ? tt('Click the window to target. Click here or press Esc to cancel.',
              'Clique na janela-alvo. Clique aqui ou aperte Esc para cancelar.')
            : undefined}
          className={`w-full h-8 text-minor border rounded transition-colors ${
            isDetecting
              ? 'text-recording-fg border-recording/40 bg-recording/10 hover:bg-recording/20'
              : 'text-accent border-accent-solid/40 hover:bg-accent-solid/10'
          }`}
        >
          {isDetecting
            ? 'Click the target window…'
            : 'Detect window'}
        </button>
      )}
    </>
  );
});
