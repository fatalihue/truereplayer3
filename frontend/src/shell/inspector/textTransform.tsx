import { useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent, type MutableRefObject, type SetStateAction } from 'react';
import { ClipboardSurface } from '../../components/lexical/ClipboardSurface';
import {
  buildChainToken, chainHeadIsUsable, DEFAULT_TRANSFORM, parseChainToken, type ChainHead, type TransformState,
} from '../../components/lexical/clipboardModifiers';
import type { LexicalEditorHandle } from '../../components/lexical/LexicalTokenEditor';
import { useTt } from '../../state/LanguageContext';

/**
 * A Transform… session: building a new chain (from the Insert panel, or a name prompt's
 * Transform…), or editing the chain of a token already in the message (a press on its chip).
 */
export type TransformSession = { serial: number } & (
  | { mode: 'insert'; startHead: ChainHead }
  | { mode: 'edit'; token: string; commit: (next: string) => void; remove: () => void });

/**
 * Transform…: the chain builder of today (ClipboardSurface) over both columns of the expanded
 * Send Text, which stays mounted under it (its caret and its Ctrl+Z survive). Editing a token, each
 * change goes into the chip as it is made (D12) — Reset puts the token it opened with back, and
 * Ctrl+Z in the message undoes the rest; building one, Insert puts it at the caret. ‹ Editor, Esc
 * and Ctrl+Enter (which also inserts) go back to the message.
 */
export function TransformHost({ session, api, onClose }: {
  session: TransformSession;
  api: MutableRefObject<LexicalEditorHandle | null>;
  onClose: () => void;
}) {
  const tt = useTt();
  const [state, setState] = useState<TransformState>(() => (session.mode === 'edit' ? parseChainToken(session.token)?.state : null) ?? DEFAULT_TRANSFORM);
  const [head, setHead] = useState<ChainHead>(() => (session.mode === 'edit' ? parseChainToken(session.token)?.head : session.startHead) ?? { kind: 'clipboard' });
  const usable = chainHeadIsUsable(head);
  const root = useRef<HTMLDivElement>(null);

  // A chain the builder cannot rebuild as written is shown read-only, and never written back.
  const apply = (h: ChainHead, s: TransformState) => {
    if (session.mode !== 'edit' || s.unmodeled || !chainHeadIsUsable(h)) return;
    session.commit(buildChainToken(h, s));
  };
  // The surface hands an updater; the state it applies to is this render's (each change re-renders
  // before the next), so the chip gets the same value the controls show.
  const onStateChange: Dispatch<SetStateAction<TransformState>> = (update) => {
    const next = typeof update === 'function' ? update(state) : update;
    setState(next);
    apply(head, next);
  };
  const onHeadChange = (next: ChainHead) => {
    setHead(next);
    apply(next, state);
  };
  const reset = () => {
    if (session.mode === 'edit') {
      const parsed = parseChainToken(session.token);
      setState(parsed?.state ?? DEFAULT_TRANSFORM);
      setHead(parsed?.head ?? { kind: 'clipboard' });
      session.commit(session.token);
      return;
    }
    setState(DEFAULT_TRANSFORM);
    setHead(session.startHead);
  };
  const insert = () => {
    if (session.mode !== 'insert' || !usable) return;
    // insertToken, not insertText: a built token is always a chip, whatever its separators.
    api.current?.insertToken(buildChainToken(head, state));
    onClose();
  };

  // The keyboard goes to the builder as it appears, before a key can reach the message under it: a
  // source with a name to give takes it in that field (its autoFocus), the others in the first
  // control.
  useLayoutEffect(() => {
    const el = root.current;
    if (!el || el.contains(document.activeElement)) return;
    (el.querySelector<HTMLElement>('input, select, textarea, button') ?? el).focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.defaultPrevented) return;
    const done = e.key === 'Enter' && e.ctrlKey && !e.altKey && !e.shiftKey;
    if (e.key !== 'Escape' && !done) return;
    e.preventDefault();
    e.stopPropagation();
    if (done && session.mode === 'insert') insert();
    else onClose();
  };

  return (
    <div ref={root} className="stx-transform" role="dialog" aria-label="Transform" tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="stx-transform-body">
        <ClipboardSurface
          state={state}
          onStateChange={onStateChange}
          head={head}
          onHeadChange={onHeadChange}
          onBack={onClose}
          onReset={reset}
          originalToken={session.mode === 'edit' ? session.token : undefined}
          backTip={session.mode === 'edit'
            ? tt('Back to the message — the changes are in it already', 'Volta à mensagem — as mudanças já estão nela')
            : tt('Back to the message, inserting nothing', 'Volta à mensagem, sem inserir nada')}
        />
      </div>
      <div className="stx-transform-foot">
        {session.mode === 'edit' && (
          <button type="button" className="stx-danger" onClick={() => { session.remove(); onClose(); }}>
            <span className="step-icon" data-icon="trash-2" />
            Delete token
          </button>
        )}
        <span className="stx-transform-hint">
          {session.mode === 'insert' ? 'Steps apply in the order shown'
            : state.unmodeled ? 'The token stays as it is written'
            : 'Each change goes into the message · Ctrl+Z undoes'}
        </span>
        {session.mode === 'insert' && (
          <button
            type="button"
            className="insp-primary"
            disabled={!usable}
            data-tip={usable ? undefined : tt('Name it first', 'Dê um nome primeiro')}
            onClick={insert}
          >
            Insert
          </button>
        )}
      </div>
    </div>
  );
}
