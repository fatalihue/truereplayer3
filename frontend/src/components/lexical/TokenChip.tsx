import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useLexicalNodeSelection } from '@lexical/react/useLexicalNodeSelection';
import {
  $getNodeByKey, $getSelection, $isNodeSelection, createCommand, COMMAND_PRIORITY_LOW,
  type LexicalCommand, type NodeKey,
} from 'lexical';
import { useTt } from '../../state/LanguageContext';
import { TokenNode } from './TokenNode';
import { TokenChipPopover } from './TokenChipPopover';
import { tokenTip } from './tokenDescriptions';
import { chainHeadKind } from './clipboardModifiers';
import type { TokenScope } from './tokenNormalize';

// Host-provided handler for editing a chain-bearing chip ({clipboard}, {row:col}, {rownext:col},
// {var:name}, {clip:name}, {winclip:N}) in a LARGER surface than the default 300px popover.
// SendTextDialog provides one (routing to its full-body chain builder); SheetPanel doesn't —
// chips there fall back to the popover, byte-identical to the old behavior. Defined here (not in
// LexicalTokenEditor) so the provider module can import it without a cycle.
export interface ClipboardChipEditRequest {
  /** The chip's current token text, e.g. `{Clipboard:trim:upper}`. */
  token: string;
  /** Commit a replacement token back onto the chip (no-ops if unchanged upstream). */
  commit: (next: string) => void;
  /** Remove the chip from the editor. */
  remove: () => void;
}
export const ClipboardChipEditContext =
  createContext<((req: ClipboardChipEditRequest) => void) | null>(null);

// Which engine(s) the surrounding editor edits for — TokenScope in tokenNormalize. Provided by
// LexicalTokenEditor (it flows through Lexical's decorator portals like the context above) and
// read by the chip so its popover can withhold a control the scope's engine ignores: a repeat
// count on an {Enter} chip in the browser field would write {Enter:3}, which the extension types
// out as text. Same home, same reason: no import cycle through LexicalTokenEditor.
export const TokenScopeContext = createContext<TokenScope>('desktop');

/**
 * Open a chip's parameter editor by node key. Dispatched by ChipActivationPlugin when the user
 * presses Enter or Space on a chip that Lexical has put under a NodeSelection (which ←/→ already
 * does — TokenNode.isKeyboardSelectable() is true). Each mounted chip listens and answers only
 * for its own key. This is the keyboard equivalent of handleClick and shares its body exactly.
 *
 * Lives here, next to ClipboardChipEditContext and for the same stated reason: the plugin module
 * can import it without a cycle, since LexicalTokenEditor already imports from './TokenChip'.
 */
export const OPEN_TOKEN_CHIP_COMMAND: LexicalCommand<NodeKey> = createCommand('OPEN_TOKEN_CHIP_COMMAND');

// React decorator content for a TokenNode. Owns the popover open state AND the
// commit logic — every close path (Esc, click outside, ✕, clicking the chip
// again) funnels through handleClose, so no path can drop the user's edits.
//
// The popover stores live edits in a ref (no re-renders), and only commits when
// the popover closes. That avoids re-rendering the chip mid-typing, which is
// what used to cause controlled inputs in the popover to lose characters.
export function TokenChip({ nodeKey, token }: { nodeKey: NodeKey; token: string }) {
  const [editor] = useLexicalComposerContext();
  const onClipboardChipEdit = useContext(ClipboardChipEditContext);
  const scope = useContext(TokenScopeContext);
  const [open, setOpen] = useState(false);
  // Use the state-setter as the ref callback so we never read a ref value
  // during render — the popover anchor lives in state and updates when the
  // span mounts/unmounts.
  const [anchorEl, setAnchorEl] = useState<HTMLSpanElement | null>(null);
  const liveTokenRef = useRef(token);
  const tt = useTt();
  // Lexical's own selection model IS the keyboard affordance — arrowing onto an inline, isolated,
  // keyboard-selectable decorator already builds a NodeSelection on it. All this does is mirror
  // that into a class, which is the half that was missing: the state existed and was invisible.
  //
  // Gated on a NODE selection, not on useLexicalNodeSelection alone. That hook answers
  // LexicalNode.isSelected(), which is true for ANY selection containing the node — so a
  // Ctrl+A or a drag across the text would light every chip in the document with the same
  // treatment that means "Enter opens this one", which Enter would then not do.
  const [isNodeSelected] = useLexicalNodeSelection(nodeKey);
  const [selectionIsNodeKind, setSelectionIsNodeKind] = useState(false);
  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    setSelectionIsNodeKind(editorState.read(() => $isNodeSelection($getSelection())));
  }), [editor]);
  const isSelected = isNodeSelected && selectionIsNodeKind;

  // Resync the live ref when the chip's token changes externally (other edits,
  // undo). Without this, opening the popover after such a change would commit
  // the stale liveTokenRef from the prior session.
  useEffect(() => {
    liveTokenRef.current = token;
  }, [token]);

  const handleLiveChange = useCallback((next: string) => {
    liveTokenRef.current = next;
  }, []);

  const handleClose = useCallback(() => {
    const next = liveTokenRef.current;
    if (next !== token) {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey);
        if (node instanceof TokenNode) node.setToken(next);
      });
    }
    setOpen(false);
  }, [editor, nodeKey, token]);

  const handleDelete = useCallback(() => {
    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (node) node.remove();
    });
    setOpen(false);
  }, [editor, nodeKey]);

  // Shared by the mouse (handleClick) and the keyboard (OPEN_TOKEN_CHIP_COMMAND), so the two
  // routes can never drift into doing different things.
  //
  // EVERY chain-bearing chip routes to the host's large edit surface when one is provided
  // (Insert Text dialog); otherwise (SheetPanel, which provides none) the popover below opens
  // exactly as before. It used to be {clipboard} alone, which made that one token the only
  // chip with a real builder while {row:}, {clip:}, {var:} and {winclip:} — carrying the very
  // same modifier chain — were stuck in 300px. Do NOT remove this dispatch as "dead": the
  // provider lives in a different tree (SendTextDialog via context).
  const activate = useCallback(() => {
    if (onClipboardChipEdit && chainHeadKind(token) !== null) {
      onClipboardChipEdit({
        token,
        commit: (next: string) => {
          if (next === token) return;
          editor.update(() => {
            const node = $getNodeByKey(nodeKey);
            if (node instanceof TokenNode) node.setToken(next);
          });
        },
        remove: handleDelete,
      });
      return;
    }
    if (open) handleClose();
    else setOpen(true);
  }, [editor, nodeKey, token, onClipboardChipEdit, open, handleClose, handleDelete]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    activate();
  };

  // Answer the activation command for THIS chip only. `activate` is reached through a ref rather
  // than listed as a dep so opening/closing the popover does not re-register the listener on
  // every chip in the document.
  const activateRef = useRef(activate);
  useEffect(() => { activateRef.current = activate; }, [activate]);
  useEffect(() => editor.registerCommand(
    OPEN_TOKEN_CHIP_COMMAND,
    (key: NodeKey) => {
      if (key !== nodeKey) return false;
      activateRef.current();
      return true;
    },
    COMMAND_PRIORITY_LOW,
  ), [editor, nodeKey]);

  return (
    <>
      <span
        ref={setAnchorEl}
        contentEditable={false}
        onClick={handleClick}
        onMouseDown={(e) => e.stopPropagation()}
        // The palette's per-token explanation, from the one shared table — it used to be lost the
        // moment a token BECAME a chip, so the longest-form help in the app (the ~300-character
        // {clipboard:next} note) was reachable only before you had a chip to read it about.
        // Hover-only, like every other data-tip; the keyboard path to the same words is the
        // popover header, which Enter/Space now opens.
        data-tip={tokenTip(token, tt, { skipKeys: true })}
        // DOM marker for the selected state so it can be asserted without a screenshot.
        data-chip-selected={isSelected ? '' : undefined}
        // Chip palette tracks the SendText action colour (--color-action-sendtext-fg).
        // Pairing the editor chip with the grid chip and the action-type badge gives the
        // user a single colour language for everything SendText-related — see also
        // SendTextPreview.tsx which uses the exact same opacity ramp.
        className={`inline-flex items-center px-1.5 py-[1px] mx-[1px] text-[12px] font-mono rounded text-[var(--color-action-sendtext-fg)] border select-none cursor-pointer transition-colors ${
          isSelected
            // TWO channels, per the toggle convention: a heavier fill AND an accent ring.
            // Colour alone does not survive 37 themes.
            ? 'bg-[var(--color-action-sendtext-fg)]/30 border-[var(--color-action-sendtext-fg)]/70 ring-2 ring-[var(--color-accent-solid)]'
            : open
              ? 'bg-[var(--color-action-sendtext-fg)]/15 border-[var(--color-action-sendtext-fg)]/40 ring-1 ring-[var(--color-action-sendtext-fg)]/60'
              : 'bg-[var(--color-action-sendtext-fg)]/15 border-[var(--color-action-sendtext-fg)]/40 hover:bg-[var(--color-action-sendtext-fg)]/25'
        }`}
      >
        {token.slice(1, -1)}
      </span>
      {open && anchorEl && (
        <TokenChipPopover
          anchor={anchorEl}
          token={token}
          scope={scope}
          onLiveChange={handleLiveChange}
          onClose={handleClose}
          onDelete={handleDelete}
        />
      )}
    </>
  );
}
