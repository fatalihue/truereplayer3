import { useEffect, useState, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import type { ChainHead } from '../../components/lexical/clipboardModifiers';
import { parseChainToken } from '../../components/lexical/clipboardModifiers';
import type { LexicalEditorHandle } from '../../components/lexical/LexicalTokenEditor';
import type { ClipboardChipEditRequest } from '../../components/lexical/TokenChip';
import type { SendMethod, SendMode } from '../../utils/sendTextTypes';
import { InsertPanel } from './textInsert';
import { TextPreview } from './textPreview';
import { TransformHost, type TransformSession } from './textTransform';
import './textExpanded.css';
import './textIcons.css';

let serial = 0;

/**
 * The expanded Send Text's own parts, from their chunk (Expand editor brings it): the preview,
 * drawn where the editor puts this, under the message; the Insert panel, in the column beside it;
 * and Transform…, over both. While this is up, a press on a token with a chain opens Transform…
 * on it (the editor routes the chips' edits here through `chipEdit`); collapsing closes them all.
 */
export function TextExpanded({ apiRef, chipEdit, seed, text, mode, method, delay, hasFormatting, tokens, richWillDegrade, locked, side, over }: {
  apiRef: MutableRefObject<LexicalEditorHandle | null>;
  chipEdit: MutableRefObject<((req: ClipboardChipEditRequest) => void) | null>;
  /** The editor's seeding: a new one is a new document, where the token being edited is gone. */
  seed: number;
  text: string;
  mode: SendMode;
  method: SendMethod;
  delay: number;
  hasFormatting: boolean;
  tokens: number;
  richWillDegrade: boolean;
  locked: boolean;
  side: HTMLElement;
  over: HTMLElement | null;
}) {
  const [session, setSession] = useState<(TransformSession & { seed: number }) | null>(null);
  // A chip edited from the message: only a chain the builder knows (the editor checks the head).
  useEffect(() => {
    chipEdit.current = (req) => {
      if (locked || !parseChainToken(req.token)) return;
      setSession({ serial: ++serial, seed, mode: 'edit', token: req.token, commit: req.commit, remove: req.remove });
    };
    return () => { chipEdit.current = null; };
  });
  // A run starting closes the builder (the message under it is read-only now), and so does the
  // message starting again from the step (a Ctrl+Z, a Redo).
  const shown = session && !locked && session.seed === seed ? session : null;
  const transform = (head: ChainHead) => setSession({ serial: ++serial, seed, mode: 'insert', startHead: head });
  const close = () => {
    setSession(null);
    apiRef.current?.focus();
  };

  return (
    <>
      <TextPreview text={text} mode={mode} method={method} delay={delay} hasFormatting={hasFormatting} tokens={tokens} richWillDegrade={richWillDegrade} />
      {createPortal(<InsertPanel api={apiRef} hasText={text.trim() !== ''} locked={locked} onTransform={transform} />, side)}
      {shown && over && createPortal(<TransformHost key={shown.serial} session={shown} api={apiRef} onClose={close} />, over)}
    </>
  );
}
