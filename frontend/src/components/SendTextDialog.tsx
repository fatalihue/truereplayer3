import React, { useState, useRef, useEffect, useCallback, useMemo, useLayoutEffect } from 'react';
import ReactDOM from 'react-dom';
import { AlertTriangle, Smile, Braces, BookmarkPlus, Trash2, ChevronRight, Wand2, Pencil, Search, Check, X, Type,
  TriangleAlert, Eye, Download, Upload, } from 'lucide-react';
import { iconButtonClass } from './common/IconButton';
import EmojiPicker, { Theme } from 'emoji-picker-react';
import type { EmojiClickData } from 'emoji-picker-react';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { useDialogLayer } from './common/dialogLayer';
import { Button } from './common/Button';
import { SegmentedControl } from './common/SegmentedControl';
import { useTt } from '../state/LanguageContext';
import {
  LexicalTokenEditor,
  countKnownTokens,
  type LexicalEditorHandle,
} from './lexical/LexicalTokenEditor';
import type { ClipboardChipEditRequest } from './lexical/TokenChip';
import { normalizeToken, parseSendTextSegments, richFlavorSurvives, splitTokenSegments } from './lexical/tokenNormalize';
import { tokenTip } from './lexical/tokenDescriptions';
import {
  type PaletteChip, paletteToken,
  VALUE_CHIPS, MORE_VALUE_CHIPS, KEY_CHIPS, MORE_KEY_CHIPS, CLIPBOARD_CHIPS, MORE_CLIPBOARD_CHIPS, RUN_STATE_CHIPS, MORE_ROW_CHIPS,
} from './lexical/tokenCatalog';
import { PopoverHeader, Section } from './lexical/popoverAtoms';
import { FieldError } from './common/FieldError';
import { describeDelivery, pickStatusNote } from '../utils/sendTextStatus';
import type { SendMode, SendMethod } from '../utils/sendTextTypes';
import { NumberInput } from './common/NumberInput';
import { tokenChipClass } from './common/chipStyles';
import { ClipboardSurface } from './lexical/ClipboardSurface';
import { MessagePreviewPanel } from './lexical/MessagePreviewPanel';
import {
  buildSnippetExport,
  parseSnippetImport,
  mergeSnippets,
  snippetExportFilename,
} from './lexical/snippetTransfer';
import {
  buildChainToken,
  parseChainToken,
  chainHeadIsUsable,
  DEFAULT_TRANSFORM,
  type ChainHead,
  type TransformState,
} from './lexical/clipboardModifiers';
import { uiZoom, rectToLayout, viewportInLayout } from '../utils/zoomSpace';

interface SendTextDialogProps {
  mode: 'add' | 'edit';
  initialText?: string;
  /** Saved rich flavor (KeyHtml) — rebuilds the formatted doc on reopen. */
  initialHtml?: string | null;
  /** Saved delivery mode (SendMode); 'rich' default. */
  initialMode?: SendMode;
  /** Saved transport (SendMethod); paste is the default. */
  initialMethod?: SendMethod;
  /** Saved per-character pause for the typed transport; null/0 = unpaced. */
  initialCharDelayMs?: number | null;
  /**
   * Edit mode: 0-based row of the action being edited, shown as "Action #N" beside the title —
   * the pairing the sheet header uses. The add path has no row yet and passes nothing.
   */
  actionIndex?: number | null;
  /**
   * html/markdown are null when the doc carries no formatting → the action stays plain.
   * A RESULT OBJECT, not positional args: six of them, three nullable strings among them, is
   * past the point where a caller can get the order right by reading — and the neighbouring
   * KeystrokeCaptureDialog already confirms this way.
   */
  onConfirm: (r: {
    text: string;
    html: string | null;
    markdown: string | null;
    mode: SendMode;
    method: SendMethod;
    charDelayMs: number | null;
  }) => void;
  onClose: () => void;
}

// Insert (the token palette + snippets) | Emoji | Preview (the resolved message).
type RailTab = 'insert' | 'emoji' | 'preview';

interface Snippet {
  id: string;
  name: string;
  text: string;
  /** Rich flavor — pre-rich snippets simply lack the field and insert as plain. */
  html?: string;
}

const SNIPPETS_KEY = 'trueplayer_snippets';

// Key name follows the app's `tr-` prefix for small UI prefs ('tr-language', 'tr-livevars').
// SNIPPETS_KEY above and themes.ts's 'truereplay-*' are older spellings — do not copy those.
const MORE_OPEN_KEY = 'tr-sendtext-more';

/** The three palette disclosures. One key, one JSON blob — three keys would be three writes
 *  per toggle for state that is always read together. */
type MoreOpen = { keys: boolean; values: boolean; clipboard: boolean; rows: boolean };
const MORE_OPEN_DEFAULT: MoreOpen = { keys: false, values: false, clipboard: false, rows: false };

function loadMoreOpen(): MoreOpen {
  try {
    const raw = localStorage.getItem(MORE_OPEN_KEY);
    if (!raw) return MORE_OPEN_DEFAULT;
    const parsed = JSON.parse(raw);
    // Same corrupt-value guard as loadSnippets: a hand-edited or legacy value that is not a
    // plain object would feed `undefined` into three booleans and render the chevrons from
    // undefined state. Null and arrays are objects to typeof, so both are excluded explicitly.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return MORE_OPEN_DEFAULT;
    // `=== true`, not truthiness: a stored "yes"/1 must read as closed, not as open.
    return {
      keys: parsed.keys === true,
      values: parsed.values === true,
      clipboard: parsed.clipboard === true,
      rows: parsed.rows === true,
    };
  } catch {
    return MORE_OPEN_DEFAULT;
  }
}

function saveMoreOpen(next: MoreOpen) {
  // QuotaExceededError guard, exactly as saveSnippets: swallow + log so the palette stays
  // usable; the disclosure just won't survive the next restart.
  try {
    localStorage.setItem(MORE_OPEN_KEY, JSON.stringify(next));
  } catch (err) {
    console.warn('[SendTextDialog] Failed to save palette disclosures:', err);
  }
}

// Relative luminance (WCAG) of a #rgb/#rrggbb hex, 0 = black … 1 = white.
// Inlined because themes.ts doesn't export a helper; used to pick the emoji
// picker's light/dark variant from the active theme's base surface. Returns 0
// (→ dark, the previous hardcoded behavior) on anything unparseable.
function hexLuminance(hex: string): number {
  const h = hex.trim().replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (!/^[0-9a-fA-F]{6}/.test(full)) return 0;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function loadSnippets(): Snippet[] {
  try {
    const raw = localStorage.getItem(SNIPPETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Guard against a non-array (corrupt/hand-edited localStorage) — otherwise every
    // .map/.filter over snippets downstream would throw and break the dialog.
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveSnippets(snippets: Snippet[]) {
  // QuotaExceededError guard — large snippet libraries (or storage shared with
  // other features) could fill the quota. Swallow + log so the dialog stays usable;
  // the snippet just won't persist across reloads.
  try {
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(snippets));
  } catch (err) {
    console.warn('[SendTextDialog] Failed to save snippets:', err);
  }
}

/** The snippet search: name or text, case-insensitive. One predicate for the list and for the
 *  search box's own check of which rows a new query hides. */
function snippetMatches(s: Snippet, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || s.name.toLowerCase().includes(q) || s.text.toLowerCase().includes(q);
}

// Inline edit form for an existing snippet — rendered in place of the row so
// the user can adjust name and text without leaving the panel.
function SnippetEditForm({
  snippet,
  onSave,
  onCancel,
}: {
  snippet: Snippet;
  onSave: (name: string, text: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(snippet.name);
  const [text, setText] = useState(snippet.text);
  const canSave = name.trim().length > 0 && text.trim().length > 0;

  return (
    <div className="px-3 py-3 bg-bg-card border-b border-border-subtle space-y-2">
      <div className="label-micro text-text-tertiary">
        Edit snippet
      </div>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
        }}
        placeholder="Snippet name…"
        aria-label="Snippet name"
        autoFocus
        // The field recipe, not a copy on border-subtle (the value that vanished on light
        // presets). A name is prose: sans.
        className="input-inline font-sans"
      />
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Let Ctrl+Enter still confirm the parent dialog; Escape cancels the edit.
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
        }}
        placeholder="Snippet text…"
        aria-label="Snippet text"
        rows={5}
        // The field recipe's multi-line sibling, as the input above; the font stays this site's own.
        className="textarea-field text-caption font-mono"
      />
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => canSave && onSave(name, text)}
          disabled={!canSave}
        >
          Save snippet
        </Button>
      </div>
    </div>
  );
}

// Snippet rows read their text through the same walker as the grid preview and the Preview tab,
// so a token is a chip here too — this list was the one surface in the window that still showed
// `{clipboard}` raw. The chips are the muted kind the Preview tab uses for a not-yet-resolved
// token, not the pink editor chips: nothing in a row is live, and pink at 11 px across a
// two-line clamp would out-shout the snippet names. Unknown `{words}` stay text, as at replay.
function SnippetText({ text }: { text: string }) {
  const segments = useMemo(() => splitTokenSegments(text), [text]);
  return (
    <>
      {segments.map((segment, idx) =>
        segment.kind === 'token' ? (
          <span
            key={idx}
            className="inline-flex items-center px-1 mx-[1px] rounded text-caption font-mono align-baseline select-none border text-text-secondary bg-bg-input border-border-default"
          >
            {/* Normalised like the editor's chips, so an imported `{enter}` reads "Enter" here too. */}
            {normalizeToken(segment.value).slice(1, -1)}
          </span>
        ) : (
          <span key={idx}>{segment.value}</span>
        ),
      )}
    </>
  );
}

// ── Insert palette data ─────────────────────────────────────────────────────
//
// Four real sections (no breakAfter hacks), ordered by how often they get used:
// KEYS & TIMING, VALUES, CLIPBOARD (chip + Advanced…), RUN STATE (the 2.8.0
// tokens). Each section keeps its everyday chips inline and parks the rare ones
// behind a collapsed "More …" row; VALUES is one line either way, so it has none
// and sits second where a fixed-height section costs nothing.
// Direct chips insert their seed string; prompt chips ({Variable…}/{Row
// column…}) open a name prompt first — never insert a literal placeholder.

// The chips themselves live in lexical/tokenCatalog, shared with the editor autocomplete (typing {),
// so the two surfaces offer ONE list: a second copy is how the palette and the menu would drift.

// One chip recipe everywhere — tokenChipClass in common/chipStyles (shared with the Data panel).
const CHIP_CLASS = tokenChipClass;

// ── Name prompt popover ({Variable…} / {Row column…}) ──────────────────────
//
// Anchored 260px prompt reusing the TokenChipPopover shell conventions. Enter
// or Insert commits `{var:NAME}` / `{row:NAME}` through insertToken (chips
// regardless of the typing grammar); Esc is owned by the dialog's Esc router.
function NamePromptPopover({
  kind,
  anchor,
  onInsert,
  onAdvanced,
  onClose,
}: {
  kind: 'var' | 'row' | 'rownext' | 'clip' | 'input' | 'env';
  anchor: HTMLElement;
  onInsert: (token: string) => void;
  /** Skip the bare token and go straight to the chain builder with this head. */
  onAdvanced?: (head: ChainHead) => void;
  onClose: () => void;
}) {
  const tt = useTt();
  const dialogLayer = useDialogLayer();
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  // Focus AFTER positioning — the popover mounts visibility:hidden until the
  // layout pass places it, and hidden elements silently refuse focus (a bare
  // autoFocus would leave the keyboard in the editor behind the prompt).
  useEffect(() => {
    if (pos) inputRef.current?.focus();
  }, [pos]);

  useLayoutEffect(() => {
    if (!anchor || !popRef.current) return;
    const place = () => {
      // Visual reads (rect, viewport) converted to the LAYOUT space that left/top are written
      // in; offsetHeight/offsetWidth are layout already. See utils/zoomSpace.
      const zoom = uiZoom();
      const r = rectToLayout(anchor.getBoundingClientRect(), zoom);
      const vp = viewportInLayout(zoom);
      const popH = popRef.current!.offsetHeight;
      const popW = popRef.current!.offsetWidth;
      let left = r.left;
      let top = r.bottom + 6;
      if (top + popH > vp.height - 8) top = Math.max(8, r.top - popH - 6);
      if (left + popW > vp.width - 8) left = vp.width - popW - 8;
      if (left < 8) left = 8;
      setPos({ left, top });
    };
    place();
    // Coalesced to one placement per frame: place() does three forced layout reads plus a setState,
    // and the capture-phase scroll listener fires for every scrollable ancestor. The direct place()
    // above keeps the first paint unchanged.
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
  }, [anchor]);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (anchor.contains(t)) return;
      onClose();
    };
    // CAPTURE, like the autocomplete's own listener (LexicalTokenEditor): a chip stops the event
    // on its way UP, so a bubble-phase listener never heard the click that opened another popover.
    // The name prompt stayed floating over the chain builder, and the click that should have
    // dismissed it could swap an editing session for an insertion one instead.
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [anchor, onClose]);

  const commit = () => {
    // Trim so an input label of only spaces never emits a blank {input:   } (var/row names
    // can't contain spaces, so trim is a no-op for them) — matches InputEditor's guard.
    const n = name.trim();
    if (!n) return;
    onInsert(`{${kind}:${n}}`);
    onClose();
  };

  // The four chain-bearing prompt kinds ({var:}, {clip:}, {row:}, {rownext:}) can go straight to
  // the chain builder instead of inserting a bare token and then discovering, from a tooltip,
  // that clicking the chip is how you add transforms. 'input' is not chain-bearing —
  // chainHeadKind() returns null for it and ChainHead has no such member — so it gets no button.
  const advanced = () => {
    const n = name.trim();
    if (!n || !onAdvanced) return;
    onAdvanced(kind === 'row' || kind === 'rownext' ? { kind, column: n } : { kind: kind as 'var' | 'clip' | 'env', name: n });
    onClose();
  };

  const visibilityStyle: React.CSSProperties = pos
    ? { visibility: 'visible', left: pos.left, top: pos.top }
    : { visibility: 'hidden', left: 0, top: 0 };

  // The header shows the token the way it will land in the editor — normalizeToken's casing,
  // growing as the name is typed; "…" stands in for the name until there is one. The description
  // is the one the chip popover shows for the same token, so the prompt and the chip read as two
  // moments of one thing; the section below only adds what the CONTROL needs.
  const shown = normalizeToken(`{${kind}:${name || 'x'}}`);
  const headerToken = name ? shown : shown.replace(/x\}$/, '…}');
  const description = tokenTip(`{${kind}:x}`, (en) => en, { withRaw: false });
  // One string for the Section caption AND the input's accessible name: the caption is a plain
  // div (popoverAtoms' Section), so without the aria-label the field was named by its placeholder.
  const fieldLabel = kind === 'var' ? 'Variable name' : kind === 'input' ? 'Prompt label' : kind === 'clip' ? 'Slot name' : kind === 'env' ? 'Environment variable' : 'Data column';
  const hint = kind === 'input'
    ? 'Click the chip afterwards to add dropdown options.'
    : kind === 'clip'
      ? 'The capture hotkey fills slots 1–9.'
      : kind === 'env'
        ? 'Read from this machine when the macro runs — USERNAME, USERPROFILE, TEMP…'
        : '';

  return ReactDOM.createPortal(
    <div
      ref={popRef}
      onMouseDown={(e) => e.stopPropagation()}
      // Part of the dialog's Tab ring, though it is a portal outside the card (DialogShell).
      data-dialog-layer={dialogLayer}
      // menu-surface + the gated pop-in like every other floating surface; the accent-tinted
      // border stays as the token popover's own signature.
      style={{ position: 'fixed', ...visibilityStyle, zIndex: 100, width: 260, borderColor: 'color-mix(in srgb, var(--color-accent-solid) 35%, transparent)' }}
      className="menu-surface pop-in overflow-hidden"
    >
      {/* Same skeleton as TokenChipPopover: header (wand · token · ✕) → Section → footer. */}
      <PopoverHeader token={headerToken} description={description} onClose={onClose} />
      <Section label={fieldLabel}>
        <div className="py-1">
          <input
            ref={inputRef}
            type="text"
            aria-label={fieldLabel}
            value={name}
            // Input labels allow spaces (only the token-breaking { } | are stripped); a column name
            // is any header — only { } : are out (RowDataTokenRegex, 2.37.0); var/clip names are the
            // tight [A-Za-z0-9_] of their regexes; an environment variable name adds the parentheses
            // of ProgramFiles(x86) (EnvTokenRegex's charset).
            onChange={(e) => setName(e.target.value.replace(kind === 'input' ? /[{}|]/g : kind === 'row' || kind === 'rownext' ? /[{}:]/g : kind === 'env' ? /[^A-Za-z0-9_()]/g : /[^A-Za-z0-9_]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); commit(); }
            }}
            spellCheck={false}
            placeholder={kind === 'var' ? 'name' : kind === 'input' ? 'What to ask' : kind === 'clip' ? '1' : kind === 'env' ? 'USERNAME' : 'column'}
            // input-inline (h-7) like every input in the chip popovers — the popover scale; h-8 is
            // the surface's. Mono for the identifiers; a prompt label is prose, so sans.
            className={`input-inline ${kind === 'input' ? 'font-sans' : ''}`}
          />
        </div>
        {hint && (
          <div className="text-caption text-text-tertiary mt-1 leading-relaxed">{hint}</div>
        )}
      </Section>
      {/* Two buttons, no fifth palette section: the chain builder gets an entry point for the
          other heads right where their identity is already being typed. The `<span />` keeps
          justify-between pinning Insert to the right when there is no Advanced button, so the
          footer never shifts between kinds. */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-bg-card border-t border-border-subtle">
        {kind !== 'input' && onAdvanced ? (
          // The Button primitive, not a hand-rolled ghost: this one carries a data-tip and goes
          // disabled, and index.css restores pointer-events on [data-tip][disabled] — its ungated
          // hover lit the disabled button up like a live one. Button gates every hover on enabled:.
          <Button
            variant="ghost"
            size="xs"
            onClick={advanced}
            disabled={!name.trim()}
            data-tip={tt('Transforms: trim, split, lines, case…', 'Transformações: trim, corte, linhas, maiúsculas…')}
          >
            <Wand2 size={12} className="shrink-0" />
            Advanced…
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" size="sm" onClick={commit} disabled={!name.trim()}>
          Insert
        </Button>
      </div>
    </div>,
    document.body,
  );
}

// Clipboard-surface session: insert (from the palette) or edit (from a chip).
type SurfaceSession =
  // startHead: where Reset goes back to. An insert session opened from the name prompt starts
  // on THAT head (Variable, Data column…), so resetting to {clipboard} silently retargeted the
  // token the Insert button would write — the title, the identity card and the inserted chip
  // all changed under the user, who had only asked to clear the chain.
  | { mode: 'insert'; startHead: ChainHead }
  | { mode: 'edit'; token: string; commit: (next: string) => void; remove: () => void };

/**
 * Hand the keyboard to the clipboard surface that just opened, the way closeSurface hands it back.
 * The surface mounts in this render, so the lookup waits a frame. A head with an identity field
 * (Variable, Data column…) autofocuses that field on mount — the focus is already inside and is
 * left there. A head-only token ({Clipboard}, {Counter}, {UUID}…) has no field, and the focus
 * stayed BEHIND the overlay on whatever opened it: a chip, or the palette's Advanced… chip, where
 * the next Space re-opened the builder and reset the chain being built.
 */
function focusClipSurface() {
  requestAnimationFrame(() => {
    const root = document.querySelector<HTMLElement>('[data-clip-surface]');
    if (!root || root.contains(document.activeElement)) return;
    const first = root.querySelector<HTMLElement>('button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
    (first ?? root).focus();
  });
}

export function SendTextDialog({ mode, initialText = '', initialHtml = null, initialMode = 'rich', initialMethod = 'paste', initialCharDelayMs = null, actionIndex = null, onConfirm, onClose }: SendTextDialogProps) {
  const tt = useTt();
  const [text, setText] = useState(initialText);
  // Delivery mode: Rich (HTML where accepted) · Markdown (*bold* as plain text, for
  // WhatsApp/chat) · Plain. Formatting stays authored regardless; the mode picks the flavor.
  const [sendMode, setSendMode] = useState<SendMode>(initialMode);
  // Delivery METHOD — the orthogonal axis: Paste (clipboard + Ctrl+V) or Type (keystrokes, no
  // clipboard). It never rewrites sendMode: flip to Type and back and the Rich choice must
  // survive, so the incompatible cell is WARNED about, never forced away.
  const [sendMethod, setSendMethod] = useState<SendMethod>(initialMethod);
  // 0, never null. NumberInput hides its inside-unit while the field is BLANK (so a field whose
  // empty state means "auto" reads cleanly), and here empty means nothing — 0 IS the default, and
  // a bare "0" with no unit does not say what it is. Seeding 0 and clearing back to 0 keeps the
  // field non-blank, so it always reads "0 ms". Persistence is unaffected: 0 is falsy and
  // handleConfirm already maps it to null, which keeps it out of the JSON.
  const [charDelay, setCharDelay] = useState<number>(initialCharDelayMs ?? 0);
  // "Does the doc carry deliberate formatting?" — pushed by the editor on every non-selection
  // change (onFormattingChange). The seed is REQUIRED, not defensive: OnChangePlugin skips its
  // callback while `prevEditorState.isEmpty()`, so InitialContentPlugin's seeding update does
  // NOT reach us and a reopened rich action would read as unformatted until the first edit.
  const [hasFormatting, setHasFormatting] = useState<boolean>(() => initialHtml != null);
  // Rail: Insert (palette + snippets) is the default tab; Emoji is the other.
  const [railTab, setRailTab] = useState<RailTab>('insert');
  const [snippets, setSnippets] = useState<Snippet[]>(loadSnippets);
  const [snippetName, setSnippetName] = useState('');
  const [savingSnippet, setSavingSnippet] = useState(false);
  const [editingSnippetId, setEditingSnippetId] = useState<string | null>(null);
  const [deletingSnippetId, setDeletingSnippetId] = useState<string | null>(null);
  const [snippetFilter, setSnippetFilter] = useState('');
  // One-line outcome for the last export/import, in a reserved slot so it cannot push the list.
  const [snippetTransferNote, setSnippetTransferNote] = useState('');
  const snippetFileRef = useRef<HTMLInputElement>(null);
  // The three "More …" disclosures persist across opens and restarts. They used to reset to
  // collapsed every time, which cost two clicks per dialog to anyone who reaches for the arrow
  // keys or {winclip:N} daily. Lazy initializer — pass the FUNCTION, so localStorage is read
  // once and not on every render (same shape as useState(loadSnippets) above).
  const [moreOpen, setMoreOpen] = useState<MoreOpen>(loadMoreOpen);
  // Clipboard Surface (full-body overlay). TransformState is lifted HERE so the
  // DialogShell footer (swapped while the surface is open) can build the token.
  const [surface, setSurface] = useState<SurfaceSession | null>(null);
  const [clipState, setClipState] = useState<TransformState>(DEFAULT_TRANSFORM);
  // Which token the chain belongs to. Insert always starts on {clipboard}; a chip edit adopts
  // whatever the chip is, so one surface serves all six heads.
  const [clipHead, setClipHead] = useState<ChainHead>({ kind: 'clipboard' });
  // Dirty flag — Apply only commits real edits: parse→build round-trips are NOT
  // byte-identical for hand-typed edge cases, so open+Apply must not rewrite.
  const [clipDirty, setClipDirty] = useState(false);
  // {Variable…}/{Row column…} name prompt.
  const [namePrompt, setNamePrompt] = useState<{ kind: 'var' | 'row' | 'rownext' | 'clip' | 'input' | 'env'; anchor: HTMLElement } | null>(null);
  const lexicalApiRef = useRef<LexicalEditorHandle | null>(null);

  /**
   * Put the keyboard back in the editor after a sub-layer that held it has gone.
   *
   * The layer's control holds the focus; removing it leaves document.activeElement on <body>, and
   * from there the card is deaf — Esc, Ctrl+Enter and typing all stop working until the user
   * clicks something. Restoring UNCONDITIONALLY would be worse: the name prompt's close also runs
   * when "Advanced…" hands over to the surface (the editor is under an overlay by then) and from
   * the outside-mousedown handler, which fires BEFORE the click sets focus on whatever was clicked.
   * So: only when the focus actually fell to the body, and on the next frame, after React has
   * removed the layer.
   */
  const refocusEditorIfLost = useCallback(() => {
    requestAnimationFrame(() => {
      if (document.activeElement === document.body) lexicalApiRef.current?.focus();
    });
  }, []);
  // Close the name prompt and put the keyboard back where it belongs.
  const closeNamePrompt = useCallback(() => {
    setNamePrompt(null);
    refocusEditorIfLost();
  }, [refocusEditorIfLost]);

  // The snippet sub-layers (save-as form, inline edit, delete confirm) close by unmounting the
  // control that held the focus — Save, Cancel, ✓, ✕ and Esc all do — and Chromium parks it on
  // <body>. DialogShell would bring it back to the card (a 30 ms timer; this frame lands first);
  // the editor is the better landing, since what comes next is almost always typing. Keyed on the
  // layer CLOSING, so every exit is covered without each handler having to remember. It also runs
  // once at mount, where the body check declines: the editor already has the focus.
  const snippetLayerOpen = savingSnippet || deletingSnippetId !== null || editingSnippetId !== null;
  useEffect(() => {
    if (!snippetLayerOpen) refocusEditorIfLost();
  }, [snippetLayerOpen, refocusEditorIfLost]);
  // Unsaved-work gate. Rendered as a SIBLING of DialogShell (see the end of this file) and
  // reached ONLY through DialogShell.canClose — never through onClose, which the shell calls
  // after it has already committed to leaving.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  // Dirty baseline. Compared against what the editor EXPORTS, never against the incoming props:
  // initialHtml is re-imported and re-serialized by Lexical ($generateNodesFromDOM →
  // $generateHtmlFromNodes) and rich mode serializes plain text through $serializePlainForSend,
  // so neither round-trip is guaranteed byte-identical — comparing to the props would report a
  // freshly opened Edit dialog as dirty and prompt on every Esc. Same reasoning as clipDirty.
  const baselineRef = useRef<{ text: string; html: string | null } | null>(null);

  // Pick the emoji picker's built-in LIGHT/DARK variant from the ACTIVE theme's
  // base surface — NOT Theme.AUTO (the app theme is user-picked, not OS-driven).
  const emojiTheme = useMemo(() => {
    const base = getComputedStyle(document.documentElement).getPropertyValue('--color-bg-base');
    return hexLuminance(base) > 0.5 ? Theme.LIGHT : Theme.DARK;
  }, []);

  useEffect(() => {
    lexicalApiRef.current?.focus();
    // Baseline on the NEXT frame, not synchronously: InitialContentPlugin seeds the document
    // inside editor.update() and Lexical commits the pending editor state in a microtask, so a
    // same-tick getHtml() can still read the empty document. rAF runs after microtasks, so the
    // snapshot is always of the seeded doc. Reading `initialText` (a prop) rather than the
    // `text` state keeps this suppression-free — closing over the state would put it in the dep
    // array and re-snapshot the baseline on every keystroke, which would make the guard never
    // fire. Both call sites mount this dialog fresh, so the prop is stable for its lifetime.
    const raf = requestAnimationFrame(() => {
      const api = lexicalApiRef.current;
      if (!api) return;
      // BOTH legs come from the editor's own export. Using the initialText PROP for the text leg
      // compared a prop against an export: LexicalComposer seeds a paragraph before
      // InitialContentPlugin runs, so a doc whose payload ends in a newline (or any case where
      // $serializePlainForSend does not round-trip the prop byte for byte) reported a freshly
      // opened Edit dialog as dirty and prompted on every Esc.
      baselineRef.current = { text: api.getText(), html: api.getHtml() };
    });
    return () => cancelAnimationFrame(raf);
  }, [initialText]);

  const insertAtCursor = useCallback((insertText: string) => {
    lexicalApiRef.current?.insertText(insertText);
  }, []);

  const handleEmojiClick = useCallback((emojiData: EmojiClickData) => {
    insertAtCursor(emojiData.emoji);
  }, [insertAtCursor]);

  // ── Clipboard Surface session ──
  const openInsertSurface = useCallback(() => {
    setClipState(DEFAULT_TRANSFORM); // fresh every time, as the old popover did
    setClipHead({ kind: 'clipboard' });
    setClipDirty(false);
    setSurface({ mode: 'insert', startHead: { kind: 'clipboard' } });
    focusClipSurface();
  }, []);

  // Same insert session, arbitrary head. Reached from the name prompt's Advanced… button, so the
  // identity is already non-empty and chainHeadIsUsable(head) holds on arrival; the surface still
  // renders its own identity field and it can be emptied there, which is what the disabled
  // Insert and the reserved error line inside the surface cover.
  const openInsertSurfaceForHead = useCallback((head: ChainHead) => {
    setClipState(DEFAULT_TRANSFORM);
    setClipHead(head);
    setClipDirty(false);
    setSurface({ mode: 'insert', startHead: head });
  }, []);

  // Chip click → edit session (routed here by ClipboardChipEditContext; the
  // SheetPanel consumer has no provider and keeps the legacy popover). The chip may be any of
  // the six chain-bearing heads, so the session adopts the token's head as well as its chain.
  const handleClipboardChipEdit = useCallback((req: ClipboardChipEditRequest) => {
    const parsed = parseChainToken(req.token);
    if (!parsed) return;   // routing already refused non-chain chips; belt and braces
    setClipState(parsed.state);
    setClipHead(parsed.head);
    setClipDirty(false);
    setSurface({ mode: 'edit', token: req.token, commit: req.commit, remove: req.remove });
    // A chip with no identity of its own opens the builder over the editor; without this the next
    // keystroke went into an editor the user could not see, under the overlay.
    focusClipSurface();
  }, []);

  const closeSurface = useCallback(() => {
    setSurface(null);
    lexicalApiRef.current?.focus();
  }, []);

  // The writes happen OUTSIDE setSurface's updater. They used to run inside it, and React may call
  // an updater twice — StrictMode does, in dev — so one Insert put two identical chips in the
  // editor. `surface` comes from the closure instead: each interaction re-renders before the next,
  // so it is the current one (TokenChipPopover's update() carries the same fix).
  const handleSurfaceConfirm = useCallback(() => {
    const cur = surface;
    if (!cur) return;
    // An empty column/slot/variable name would build a broken token ({clip:}), so the same
    // rule the popover editors follow applies here: refuse to write it — and keep the surface,
    // and the keyboard, where they are.
    if (!chainHeadIsUsable(clipHead)) return;
    const token = buildChainToken(clipHead, clipState);
    if (cur.mode === 'insert') {
      // insertToken (not insertText): a surface-built token always becomes a
      // chip even when its join separator defeats the typing grammar.
      lexicalApiRef.current?.insertToken(token);
    } else if (clipDirty && !clipState.unmodeled) {
      // Never commit a rebuild of a chain we could not fully parse — that write is where the
      // unrepresented modifier vanishes. The surface renders read-only in that case, so this
      // only guards the path where the state was seeded from such a token.
      cur.commit(token);
    }
    setSurface(null);
    lexicalApiRef.current?.focus();
  }, [surface, clipState, clipHead, clipDirty]);

  const handleSurfaceReset = useCallback(() => {
    const parsed = surface?.mode === 'edit' ? parseChainToken(surface.token) : null;
    setClipState(parsed ? parsed.state : DEFAULT_TRANSFORM);
    // The head resets too — a renamed slot is an edit like any other, and leaving it behind
    // would make Reset restore the chain onto the WRONG token.
    setClipHead(surface?.mode === 'insert' ? surface.startHead : (parsed ? parsed.head : { kind: 'clipboard' }));
    setClipDirty(false); // back to the session's starting point = nothing to apply
  }, [surface]);

  // ── Snippets (persistence + guards unchanged from 2.7.x) ──
  const handleSaveSnippet = useCallback(() => {
    const trimmedName = snippetName.trim();
    // The TEXT is stored as typed: trim only decides emptiness, as in handleConfirm, where
    // leading/trailing spaces are intentional ("oi " ≠ "oi"). Trimmed, a snippet saved as "Oi "
    // re-inserted as "Oi", and its html flavor (never trimmed) disagreed with its own text.
    if (!trimmedName || !text.trim()) return;

    // Capture the rich flavor too (undefined when the doc has no formatting) so a
    // formatted snippet re-inserts formatted. Pre-rich snippets simply lack the field.
    const snippetHtml = lexicalApiRef.current?.getHtml() ?? undefined;
    const newSnippet: Snippet = {
      // crypto.randomUUID (secure-context, available in WebView2) avoids the
      // same-millisecond collision a bare timestamp had; fall back to timestamp+random.
      id: (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: trimmedName,
      text,
      ...(snippetHtml ? { html: snippetHtml } : {}),
    };
    const updated = [...snippets, newSnippet];
    setSnippets(updated);
    saveSnippets(updated);
    setSnippetName('');
    setSavingSnippet(false);
  }, [snippetName, text, snippets]);

  const handleDeleteSnippet = useCallback((id: string) => {
    const updated = snippets.filter(s => s.id !== id);
    setSnippets(updated);
    saveSnippets(updated);
    if (editingSnippetId === id) setEditingSnippetId(null);
    setDeletingSnippetId(null);
  }, [snippets, editingSnippetId]);

  const handleUpdateSnippet = useCallback((id: string, newName: string, newText: string) => {
    const trimmedName = newName.trim();
    // The text is stored as typed, exactly as handleSaveSnippet stores it: trim only decides
    // emptiness. Trimmed here, editing a snippet saved as "Oi " silently rewrote it to "Oi".
    if (!trimmedName || !newText.trim()) return;
    const updated = snippets.map(s => {
      if (s.id !== id) return s;
      // A plain-text edit invalidates the rich flavor (same contract as actions:edit on key) —
      // keeping stale html would make insert ignore the text change entirely. A RENAME does not:
      // the form always hands the text back, so dropping html unconditionally stripped the
      // formatting from a rich snippet whose name was all that changed.
      return newText === s.text
        ? { ...s, name: trimmedName }
        : { id: s.id, name: trimmedName, text: newText };
    });
    setSnippets(updated);
    saveSnippets(updated);
    setEditingSnippetId(null);
  }, [snippets]);

  const filteredSnippets = useMemo(() => {
    if (!snippetFilter.trim()) return snippets;
    return snippets.filter(s => snippetMatches(s, snippetFilter));
  }, [snippets, snippetFilter]);

  // ── Snippet export / import ──
  // Browser mechanism, matching ThemeEditor: a Blob + a.download to save, a hidden file input +
  // FileReader to load. WebView2 handles downloads through its own DownloadStarting flow, which
  // the app's deny-all permission handler deliberately does not touch.
  const handleExportSnippets = useCallback(() => {
    if (snippets.length === 0) return;
    const blob = new Blob([JSON.stringify(buildSnippetExport(snippets), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = snippetExportFilename(new Date());
    a.click();
    URL.revokeObjectURL(url);
    setSnippetTransferNote(`Saved ${snippets.length} snippet${snippets.length === 1 ? '' : 's'}`);
  }, [snippets]);

  const handleImportSnippets = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset the input straight away so picking the SAME file twice still fires onChange.
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setSnippetTransferNote('Could not read that file');
    reader.onload = () => {
      const result = parseSnippetImport(String(reader.result ?? ''));
      if (!result.ok) {
        // Each reason is a DIFFERENT statement — "not a snippet file" is fixable by picking
        // another file, "unsupported version" is not.
        const REASONS: Record<typeof result.reason, string> = {
          'not-json': 'That file is not valid JSON',
          'not-a-snippet-file': 'That is not a snippets file',
          'unsupported-version': 'That file is from a newer version',
          'no-snippets': 'No usable snippets in that file',
        };
        setSnippetTransferNote(REASONS[result.reason]);
        return;
      }
      // ADD, never replace: the file is one library and what is on screen is another, and there
      // is no undo here. Ids that collide are re-minted by mergeSnippets.
      const merged = mergeSnippets(snippets, result.snippets);
      setSnippets(merged);
      saveSnippets(merged);
      const n = result.snippets.length;
      setSnippetTransferNote(result.skipped > 0
        ? `Added ${n}, skipped ${result.skipped} incomplete`
        : `Added ${n} snippet${n === 1 ? '' : 's'}`);
    };
    reader.readAsText(file);
  }, [snippets]);

  const handleInsertSnippet = useCallback((snippet: Snippet) => {
    // Rich snippets re-enter as formatted nodes; pre-rich ones as plain text+chips.
    if (snippet.html && lexicalApiRef.current) lexicalApiRef.current.insertHtml(snippet.html);
    else insertAtCursor(snippet.text);
  }, [insertAtCursor]);

  const handleConfirm = () => {
    // Don't trim — leading/trailing spaces are intentional ("oi " ≠ "oi"). Only
    // block submit when the field is entirely whitespace (trim used as emptiness check).
    if (!text.trim()) return;
    // Flavors exported on demand at confirm (not per keystroke); null = no formatting
    // in the doc → the action persists as a plain SendText, exactly as pre-rich.
    // The flavors are exported under Type too: it suppresses DELIVERY, never AUTHORSHIP, so
    // switching back to Paste brings the formatting back intact.
    onConfirm({
      text,
      html: lexicalApiRef.current?.getHtml() ?? null,
      markdown: lexicalApiRef.current?.getMarkdown(sendMode === 'discord' ? 'discord' : 'whatsapp') ?? null,
      mode: sendMode,
      method: sendMethod,
      // 0 is the default; null keeps it out of the JSON. Paste rows never send a delay.
      charDelayMs: sendMethod === 'type' && charDelay ? charDelay : null,
    });
  };

  // Is there work a close would destroy? Evaluated LAZILY — only on a dismissal attempt —
  // because getHtml() walks the whole document through the serializer, which is exactly why the
  // flavors are exported at confirm time and not per keystroke (see handleConfirm above).
  // A plain function, not a useCallback: no dependency array, no exhaustive-deps surface.
  const isDirty = (): boolean => {
    if (sendMode !== initialMode) return true;
    // Both transport axes count as work: without these a lone Paste→Type flip would close with
    // no discard prompt and the choice would be gone silently.
    if (sendMethod !== initialMethod) return true;
    // Compare what CONFIRM WOULD WRITE, not what the control holds. Under Paste the delay is
    // discarded (handleConfirm sends null), so flipping to Type, typing 50, and flipping back is a
    // no-op on disk — and prompting there accuses the user of unsaved work over a field that is by
    // then not even on screen.
    if ((sendMethod === 'type' && charDelay ? charDelay : null) !== (initialCharDelayMs || null)) return true;
    const base = baselineRef.current;
    if (!base) {
      // Baseline never taken (the rAF has not run yet — no user input is possible in that
      // window). Fall back to the props: never worse than the previous no-guard behaviour.
      return text !== initialText;
    }
    if (text !== base.text) return true;
    // Formatting-only edits (bold applied to existing words) do not move the plain text at all,
    // so the HTML flavor is the only witness for them.
    return (lexicalApiRef.current?.getHtml() ?? null) !== base.html;
  };

  // Status strip counts. "Lines" is what the PAYLOAD produces at the target, not the newlines
  // in the string. A paragraph break is '\n' once the doc has been edited, but until the first
  // keystroke `text` is the SAVED key, and a saved key can spell the same break as `{enter}`
  // (hand-typed rows, pre-rich actions) — and an Enter chip anywhere is a line break at replay
  // too. A bare split('\n') saw neither and read a two-line row as "1 line". The engine's own
  // segment grammar decides what is an Enter and how many times `{enter:N}` presses it.
  const tokenCount = useMemo(() => countKnownTokens(text), [text]);
  const lineCount = useMemo(() => {
    if (text.length === 0) return 0;
    let enters = 0;
    for (const seg of parseSendTextSegments(text)) {
      if (seg.kind === 'key' && seg.name === 'enter') enters += seg.count;
    }
    return text.split('\n').length + enters;
  }, [text]);
  // The one reason the text-gated controls (Add/Save, save-as-snippet) can be off. index.css
  // keeps [data-tip][disabled] hoverable for exactly this: a disabled control that explains
  // itself. undefined while there is text, so the live button carries no stale reason.
  const needsTextTip = text.trim() ? undefined : tt('Type something first', 'Digite algo primeiro');

  // Rich degradation: the engine attaches the HTML flavor only when the resolved payload is
  // EXACTLY ONE text run (ActionExecution.cs:7163), so an {Enter}/{Tab}/{Delay:N} with text on
  // both sides makes this action paste plain. Fires only when all three legs hold: there IS a
  // rich flavor to lose, rich is the chosen delivery, and the payload is not one run.
  // Markdown/Discord are deliberately excluded — they send KeyMarkdown as PLAIN text with
  // sendHtml = null (ActionExecution.cs:3603-3609), so the ==1 gate never touches them.
  // `sendMode === 'rich'` is a safe strict test because every caller normalises before us:
  // ActionTable.tsx:930 passes `rowAction.sendMode ?? 'rich'`, and the Toolbar's add path takes
  // the prop default. A null never reaches this state.
  const richWillDegrade = useMemo(
    () => hasFormatting && sendMode === 'rich' && !richFlavorSurvives(text),
    [hasFormatting, sendMode, text],
  );

  // The Preview tab's Delivery block: the ladder's inputs plus the pause, all four rows, the WHY
  // in full. Same charDelay rule as handleConfirm/isDirty: it only exists under Type.
  const deliveryFacts = useMemo(
    () => describeDelivery({
      sendMode, sendMethod, hasFormatting, tokenCount, richWillDegrade,
      charDelayMs: sendMethod === 'type' && charDelay ? charDelay : null,
    }),
    [sendMode, sendMethod, hasFormatting, tokenCount, richWillDegrade, charDelay],
  );

  // Parked on the right of the formatting toolbar (LexicalTokenEditor's toolbarExtra), beside the
  // B/I/U buttons whose fate it decides. No "Delivery" caption: the names are self-describing
  // and the toolbar is a narrow row that also has to fit the link URL input.
  //
  // TWO axes, TWO controls, one toolbarExtra slot. Transport goes LEFTMOST because it gates
  // whether the flavor matters at all. Segmented and not a Toggle: Paste and Type are PEERS, not
  // an enable ("Type: off" is not a thing a user thinks, "Paste" is). A segmented control also
  // satisfies the two-channel rule intrinsically — the lit segment is a tint AND a position — and
  // keeps both names readable at all times, which a toggle only manages by adding a label that
  // costs MORE width than the second segment.
  //
  // NOT a fifth flavor segment: it is a 2×4, not a 1×5 — "typed Markdown" and "typed Discord" are
  // the LOSSLESS cells and the ones the warning copy points at, and a 1×5 cannot express them.
  //
  // The ms field renders only while Type is lit, so the Paste toolbar is byte-identical to 2.32.0.
  const deliveryControl = (
    <div className="flex items-center gap-1">
      <SegmentedControl<SendMethod>
        dense
        ariaLabel="Send method"
        value={sendMethod}
        onChange={setSendMethod}
        options={[
          // One short sentence each, and they contrast: what it does, and the one fact that
          // decides between them. The rest (no clipboard write, line breaks becoming Enter)
          // lives in the status rung and the manual, which is where a reader who needs it looks.
          { value: 'paste', label: 'Paste', tip: tt(
            'Ctrl+V — the only mode that sends formatting',
            'Ctrl+V — único modo que envia formatação') },
          { value: 'type', label: 'Type', tip: tt(
            'Key by key — for targets that ignore Ctrl+V',
            'Tecla a tecla — para alvos que ignoram Ctrl+V') },
        ]}
      />
      {sendMethod === 'type' && (
        <NumberInput
          value={charDelay}
          onChange={setCharDelay}
          // Clearing the text lands on 0, not blank — see the state's comment: blank would drop
          // the "ms" and leave an unlabelled empty box where the default should be readable.
          onClear={() => setCharDelay(0)}
          min={0}
          max={200}
          suffix="ms"
          suffixInside
          inputWidth="w-14"
          inputHeight="h-6"
          ariaLabel="Per-character delay in milliseconds"
          className="shrink-0"
        />
      )}
      {/* The toolbar's own divider recipe, so six segments never read as one control. */}
      <div className="w-px h-4 mx-0.5 bg-border-default" />
    <SegmentedControl<SendMode>
      dense
      ariaLabel="Delivery mode"
      value={sendMode}
      onChange={setSendMode}
      options={[
        { value: 'rich', label: 'Rich', tip: tt('Real formatting (Gmail, Crisp, Word)', 'Formatação real (Gmail, Crisp, Word)') },
        { value: 'markdown', label: 'Markdown', tip: tt('*bold* / _italic_ as text — for WhatsApp.', '*negrito* / _itálico_ como texto — para WhatsApp.') },
        { value: 'discord', label: 'Discord', tip: tt('**bold** / ~~strike~~ as text — for Discord.', '**negrito** / ~~tachado~~ como texto — para Discord.') },
        { value: 'plain', label: 'Plain' },
      ]}
    />
    </div>
  );

  // Right slot of the status strip — one line, first match wins. See utils/sendTextStatus.
  // `tt` IS a dep: useTt returns a useCallback keyed on the language, so this recomputes when
  // the user switches PT-BR/EN and exhaustive-deps stays satisfied.
  const statusNote = useMemo(
    () => pickStatusNote({ sendMode, sendMethod, hasFormatting, tokenCount, richWillDegrade }, tt),
    [sendMode, sendMethod, hasFormatting, tokenCount, richWillDegrade, tt],
  );

  // ── Esc router — ONE capture-phase priority ladder for every sub-layer:
  // confirm prompt → name prompt → clipboard surface → snippet sub-form. DialogShell's card
  // handler (dialog close) only sees Esc when no layer is open. Chip popovers
  // (TokenChipPopover) own their Esc via their own capture listener — when one
  // is open (data-token-popover marker) this router stands down entirely.
  // The confirm prompt is the TOP rung because it is the visually topmost layer (z-(--z-submenu) over
  // the shell's z-50) and it can legitimately be open at the same time as a snippet sub-form.
  const escLayerActive =
    confirmDiscard || namePrompt !== null || surface !== null ||
    savingSnippet || deletingSnippetId !== null || editingSnippetId !== null;
  useEffect(() => {
    if (!escLayerActive) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[data-token-popover]')) return;
      e.preventDefault();
      e.stopPropagation();
      if (confirmDiscard) { setConfirmDiscard(false); lexicalApiRef.current?.focus(); }
      else if (namePrompt) closeNamePrompt();
      else if (surface) closeSurface();
      else if (savingSnippet) setSavingSnippet(false);
      else if (deletingSnippetId !== null) setDeletingSnippetId(null);
      else if (editingSnippetId !== null) setEditingSnippetId(null);
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [escLayerActive, confirmDiscard, namePrompt, surface, savingSnippet, deletingSnippetId, editingSnippetId, closeSurface, closeNamePrompt]);

  // ── Palette chip renderer ──
  const renderChip = (chip: PaletteChip, extraClass = '') => (
    <button
      key={chip.label}
      type="button"
      onClick={(e) => {
        if (chip.prompt) setNamePrompt({ kind: chip.prompt, anchor: e.currentTarget });
        else if (chip.insert) insertAtCursor(chip.insert);
      }}
      className={`${CHIP_CLASS} ${extraClass}`}
      // From the shared table, in its PALETTE voice (the "click the chip after inserting"
      // advice that would be nonsense on the chip itself) and without the raw token, because a
      // palette chip is a generic SEED and not the user's token.
      data-tip={tokenTip(paletteToken(chip), tt, { palette: true, withRaw: false, skipKeys: true })}
    >
      {chip.label}
    </button>
  );

  const sectionLabel = (label: string) => (
    <div className="label-micro text-text-tertiary px-3 pt-2.5 pb-1">{label}</div>
  );

  // Persist on the toggle itself, not in an effect — an effect would rewrite storage on every
  // mount for a user who never touched a disclosure. A plain function, deliberately not a
  // useCallback: no dependency array means it cannot produce an exhaustive-deps finding, and
  // the lint gate's baseline is zero.
  const toggleMore = (k: keyof MoreOpen) => {
    setMoreOpen((prev) => {
      const next = { ...prev, [k]: !prev[k] };
      saveMoreOpen(next);
      return next;
    });
  };

  // Disclosure row for a section's rare chips. Reads like a section label so an
  // unopened one is quiet, and the chevron is the only affordance that moves.
  const moreRow = (label: string, open: boolean, toggle: () => void) => (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      className="w-full flex items-center gap-1 px-3 py-1 label-micro text-text-tertiary hover:text-text-primary transition-colors"
    >
      <ChevronRight size={12} aria-hidden="true" className={`motion-ok:transition-transform ${open ? 'rotate-90' : ''}`} />
      {label}
    </button>
  );

  return (
    <>
    <DialogShell
      icon={<Type size={14} style={{ color: 'var(--color-action-sendtext-fg)' }} />}
      title={mode === 'add' ? 'Insert text' : 'Edit text'}
      titleMeta={mode === 'edit' && actionIndex != null ? `Action #${actionIndex + 1}` : undefined}
      size="full"
      onClose={onClose}
      // Text-entry dialog: a stray scrim click must not discard typed text —
      // dismissal is Esc or Cancel only.
      closeOnBackdrop={false}
      // Pre-close VETO, not an onClose that declines: DialogShell's onClose runs after the shell
      // has committed to leaving (leaving=true plus a fallback timer), so refusing there fades
      // the dialog out and leaves it mounted — an invisible modal over the whole app. Same shape
      // as AutomationPanel's.
      // No sub-layer check is needed: every sub-layer owns Esc on a capture-phase listener that
      // stopPropagation()s (the router above; TokenChipPopover's own), so the shell can only
      // reach here when nothing else owns the key — and the only other route in is the footer
      // Cancel, which is rendered only while the clipboard surface is CLOSED.
      canClose={() => {
        if (confirmDiscard) return false;  // the prompt already up owns the decision
        if (!isDirty()) return true;
        // The name prompt goes first. It floats at z-100, above the z-60 "Unsaved text" prompt, so
        // left open it sat on top of the question with a live text field in it.
        if (namePrompt) setNamePrompt(null);
        setConfirmDiscard(true);
        return false;
      }}
      footerHint={
        surface ? (
          <span className="flex items-center gap-3">
            {surface.mode === 'edit' && (
              // Red text, no fill: removing the token is the secondary action here (the primary is
              // Apply) — Button's destructiveText rule, not a hand-mixed copy of it.
              <Button variant="destructiveText" size="xs" onClick={() => { surface.remove(); closeSurface(); }}>
                <Trash2 size={12} />
                Delete token
              </Button>
            )}
            <span>{'Steps apply in the order shown'}</span>
          </span>
        ) : (
          <>{'Ctrl+Enter confirms · Esc cancels'}</>
        )
      }
      footer={(requestClose) => (
        // Keyed fragments so the two footers never reconcile against each other. Unkeyed,
        // React matched them by position: child[1] is the PRIMARY "Insert" here and the
        // SECONDARY "Cancel" below, both <Button>, so the same node was reused and its
        // transition-colors cross-faded accent → grey — the Insert button appearing to melt
        // into Cancel when the Advanced Clipboard surface closed.
        surface ? (
          <React.Fragment key="surface">
            <Button variant="secondary" size="md" onClick={closeSurface}>Cancel</Button>
            <Button
              variant="primary"
              size="md"
              onClick={handleSurfaceConfirm}
              // Mirrors the guard that actually runs inside handleSurfaceConfirm, so an unusable
              // head reads as blocked instead of as a button that does nothing. The guard itself
              // stays: Ctrl+Enter routes through onCardKeyDown and never consults `disabled`.
              disabled={!chainHeadIsUsable(clipHead) || (surface.mode === 'edit' && !clipDirty)}
            >
              {surface.mode === 'insert' ? 'Insert' : 'Apply'}
            </Button>
          </React.Fragment>
        ) : (
          <React.Fragment key="main">
            {/* Delivery used to live here, between the two buttons that CLOSE the dialog. It is a
                property of the message, not an exit, and it governs a toolbar three hundred pixels
                away — so it moved up into that toolbar (deliveryControl). The keyed fragments stay:
                they exist because React reconciled the primary "Insert" here against the secondary
                "Cancel" in the surface footer and cross-faded accent into grey. */}
            <Button variant="secondary" size="md" onClick={requestClose}>Cancel</Button>
            <Button variant="primary" size="md" onClick={handleConfirm} disabled={!text.trim()} data-tip={needsTextTip}>
              {mode === 'add' ? 'Add text' : 'Save text'}
            </Button>
          </React.Fragment>
        )
      )}
      onCardKeyDown={(e) => {
        // Ctrl+Enter routes by surface: clipboard surface open → Insert/Apply;
        // otherwise confirm the dialog (incl. from inside the editor, whose
        // SubmitPlugin can only fire while the editor is visible/focused).
        // The rule behind the routing: a layer that edits the MESSAGE takes Ctrl+Enter first, so
        // a confirm can never drop an edit still in flight — the clipboard surface here, a chip
        // popover and the link field in their own handlers (they stop the key before it arrives).
        // The snippet forms hold no message edit, so the key passes through them to the dialog.
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          if (namePrompt) return; // prompt owns Enter; Ctrl+Enter is a no-op there
          if (surface) handleSurfaceConfirm();
          else handleConfirm();
        }
      }}
    >
      {/* Body — `relative` is load-bearing: the Clipboard Surface mounts
          absolute inset-0 INSIDE this wrapper (an overlay, so the Lexical
          editor underneath never unmounts and undo/caret survive). */}
      <div className="relative flex flex-1 min-h-0">
        {/* ── Editor column: full-bleed writing surface + status strip ── */}
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="relative flex-1 min-h-0 bg-bg-input sendtext-editor">
            <LexicalTokenEditor
              initialText={initialText}
              initialHtml={initialHtml}
              richMode
              // Plain is the ONLY mode that delivers nothing of the formatting; markdown and
              // discord bake it into the text as literal markers (ActionExecution.cs:3603-3609).
              // Read it as a rule, not an exception list: formatting is delivered unless the MODE
              // drops it (Plain) or the TRANSPORT cannot carry it (Type + Rich — no clipboard, so
              // no CF_HTML). Markdown/Discord under Type still count: their marks are characters.
              formattingDelivered={sendMode !== 'plain' && !(sendMethod === 'type' && sendMode === 'rich')}
              toolbarExtra={deliveryControl}
              onChange={setText}
              onFormattingChange={setHasFormatting}
              onSubmit={handleConfirm}
              apiRef={lexicalApiRef}
              density="dialog"
              onClipboardChipEdit={handleClipboardChipEdit}
              // The keyboard door to the palette: `{` opens the same catalog the Insert panel draws.
              tokenAutocomplete
              // Two lines, only here: the empty state of this window is ninety percent of the
              // screen with one line in it, and the panel on the right cannot say the one thing
              // a newcomer needs — that a brace word is a token, filled in at replay. Placeholder
              // ink throughout (it is not content) and gone at the first character, so it costs
              // the writing surface nothing. The sheet keeps the one-line default.
              placeholder={
                <>
                  Type the text to send…
                  <span className="block mt-1.5 text-minor leading-relaxed">
                    Tokens like <span className="font-mono">{'{clipboard}'}</span>, <span className="font-mono">{'{date}'}</span> and <span className="font-mono">{'{enter}'}</span> are filled in at replay · pick them in the Insert panel, or type <span className="font-mono">{'{'}</span> to search them here
                  </span>
                </>
              }
            />
          </div>
          <div className="h-7 shrink-0 px-4 flex items-center justify-between gap-3 bg-bg-card border-t border-border-subtle">
            <span className="text-caption text-text-tertiary tabular-nums whitespace-nowrap">
              {text.length} chars · {tokenCount} token{tokenCount === 1 ? '' : 's'} · {lineCount} line{lineCount === 1 ? '' : 's'}
            </span>
            {/* Right slot — ONE line, always mounted, message chosen by the ladder in
                utils/sendTextStatus. FieldError gives the reserve (&nbsp; at rest), the truncate,
                the aria-live=polite and the portal tip in one component; its className is fully
                overridden because the default carries mt-2 + the recording ink, which belong to
                form validation, not to a status strip. `min-w-0` is load-bearing: a flex child
                will not shrink below its content, so without it the truncate never fires and the
                counts on the left get pushed out instead.
                warning-ink is LEGAL here and only here: this strip paints on bg-bg-card, one of
                the three surfaces --color-warning-ink is resolved against. Do NOT lift this ink
                into the editor body, which paints on bg-bg-input and is not in that list. */}
            <FieldError
              show={statusNote !== null}
              className={`min-w-0 text-right text-caption ${statusNote?.tone === 'warn' ? 'text-warning-ink' : 'text-text-tertiary'}`}
              tip={statusNote?.tip}
            >
              {statusNote?.tone === 'warn' && (
                <TriangleAlert size={11} className="inline-block align-[-1px] mr-1 shrink-0" />
              )}
              {statusNote?.text}
            </FieldError>
          </div>
        </div>

        {/* ── Rail: Insert (palette + snippets) | Emoji | Preview ── */}
        <div className="w-[30%] min-w-[300px] max-w-[440px] shrink-0 border-l border-border-subtle flex flex-col min-h-0">
          <div className="p-2 pb-1.5 shrink-0">
            <SegmentedControl<RailTab>
              grow
              ariaLabel="Insert panel"
              options={[
                { value: 'insert', label: 'Insert', icon: <Braces size={12} /> },
                { value: 'emoji', label: 'Emoji', icon: <Smile size={12} /> },
                { value: 'preview', label: 'Preview', icon: <Eye size={12} /> },
              ]}
              value={railTab}
              onChange={setRailTab}
            />
          </div>

          {railTab === 'preview' ? (
            <MessagePreviewPanel
              text={text}
              method={sendMethod}
              marksAdded={(sendMode === 'markdown' || sendMode === 'discord') && hasFormatting}
              delivery={deliveryFacts}
            />
          ) : railTab === 'emoji' ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <EmojiPicker
                onEmojiClick={handleEmojiClick}
                theme={emojiTheme}
                width="100%"
                height="100%"
                searchPlaceholder="Search emoji…"
                previewConfig={{ showPreview: false }}
                skinTonesDisabled
                style={{
                  '--epr-bg-color': 'var(--color-bg-card)',
                  '--epr-category-label-bg-color': 'var(--color-bg-card)',
                  '--epr-hover-bg-color': 'var(--color-bg-elevated)',
                  '--epr-search-input-bg-color': 'var(--color-bg-input)',
                  '--epr-search-border-color': 'var(--color-border-default)',
                  '--epr-text-color': 'var(--color-text-primary)',
                  '--epr-category-icon-active-color': 'var(--color-accent-solid)',
                  '--epr-highlight-color': 'var(--color-accent-solid)',
                } as React.CSSProperties}
              />
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Palette — four real sections, most-used first. Values carries no
                  disclosure, so the two fixed-height sections sit above the two that
                  can grow and expanding one never displaces a chip you were aiming at.
                  Scrolls only when it has to: natural height while there is room, and it is
                  the side that gives ground when there isn't. It used to be `shrink-0` with
                  no max-height, which made its own overflow-y-auto unreachable — a box sized
                  to its own content never overflows — so the squeeze landed on the snippets
                  list below instead, and with all three "More …" rows open in a short window
                  that list collapsed to nothing. */}
              <div className="min-h-0 overflow-y-auto pb-1">
                {sectionLabel('Keys & timing')}
                <div className="flex flex-wrap gap-1 px-3 pb-1">
                  {KEY_CHIPS.map((c) => renderChip(c))}
                </div>
                {moreRow('More keys', moreOpen.keys, () => toggleMore('keys'))}
                {moreOpen.keys && (
                  <div className="grid grid-cols-3 gap-1 px-3 pb-2">
                    {MORE_KEY_CHIPS.map((c) => renderChip(c, 'justify-center'))}
                  </div>
                )}

                {sectionLabel('Values')}
                <div className="flex flex-wrap gap-1 px-3 pb-1">
                  {VALUE_CHIPS.map((c) => renderChip(c))}
                </div>
                {moreRow('More values', moreOpen.values, () => toggleMore('values'))}
                {moreOpen.values && (
                  <div className="flex flex-wrap gap-1 px-3 pb-2">
                    {MORE_VALUE_CHIPS.map((c) => renderChip(c))}
                  </div>
                )}

                {sectionLabel('Clipboard')}
                <div className="flex flex-wrap gap-1 px-3 pb-1">
                  {renderChip({
                    label: 'Clipboard',
                    insert: '{clipboard}',
                  })}
                  <button
                    type="button"
                    onClick={openInsertSurface}
                    className={`${CHIP_CLASS} gap-1`}
                    data-tip={tt('Build a {clipboard:...} transform', 'Crie uma transformação {clipboard:...}')}
                  >
                    <Wand2 size={11} className="shrink-0" />
                    Advanced…
                  </button>
                  {CLIPBOARD_CHIPS.map((c) => renderChip(c))}
                </div>
                {moreRow('More clipboard', moreOpen.clipboard, () => toggleMore('clipboard'))}
                {moreOpen.clipboard && (
                  <div className="flex flex-wrap gap-1 px-3 pb-2">
                    {MORE_CLIPBOARD_CHIPS.map((c) => renderChip(c))}
                  </div>
                )}

                {sectionLabel('Run state')}
                <div className="flex flex-wrap gap-1 px-3 pb-1">
                  {RUN_STATE_CHIPS.map((c) => renderChip(c))}
                </div>
                {moreRow('More rows', moreOpen.rows, () => toggleMore('rows'))}
                {moreOpen.rows && (
                  <div className="flex flex-wrap gap-1 px-3 pb-2">
                    {MORE_ROW_CHIPS.map((c) => renderChip(c))}
                  </div>
                )}
              </div>

              {/* Snippets — permanently visible below the palette, and it keeps a FLOOR: the
                  palette above is the side that gives ground and scrolls. Without the floor,
                  `flex: 1 1 0%` here means basis 0 — it absorbs no shrink, it simply never
                  receives any growth once the palette is as tall as the column. 140px is the
                  header row + the search row + one full snippet row; px is safe in this subtree
                  because nothing here reads --ui-font-size (label-micro, the chips and the
                  snippet rows are all hardcoded 11-12px). */}
              <div className="flex-1 min-h-[140px] flex flex-col border-t border-border-subtle">
                <div className="px-3 py-2 flex items-center justify-between shrink-0">
                  <span className="label-micro text-text-tertiary">Snippets</span>
                  <div className="flex items-center gap-0.5">
                    {/* Export / import. The library lived in localStorage and nowhere else, so a
                        reinstall or cleared site data lost it silently — profiles and themes both
                        export, snippets did not. Same browser mechanism ThemeEditor uses. */}
                    <button
                      type="button"
                      onClick={handleExportSnippets}
                      disabled={snippets.length === 0}
                      className={iconButtonClass('sm')}
                      aria-label="Export snippets"
                      data-tip={tt('Export snippets', 'Exportar snippets')}
                    >
                      <Download size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => snippetFileRef.current?.click()}
                      className={iconButtonClass('sm')}
                      aria-label="Import snippets"
                      data-tip={tt('Import snippets (added to yours)', 'Importar snippets (somados aos seus)')}
                    >
                      <Upload size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSavingSnippet(true)}
                      disabled={!text.trim()}
                      // Off → the reason; on → what it does. Same rule as the footer button.
                      className={iconButtonClass('sm')}
                      aria-label="Save as snippet"
                      data-tip={needsTextTip ?? tt('Save as snippet', 'Salvar como snippet')}
                    >
                      <BookmarkPlus size={14} />
                    </button>
                  </div>
                </div>

                {/* Hidden picker — the file input is never shown; the Upload button clicks it. */}
                <input
                  ref={snippetFileRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={handleImportSnippets}
                />

                {/* Import outcome — reserved line, so a message appearing cannot push the list. */}
                <div className="px-3 shrink-0">
                  <FieldError
                    show={snippetTransferNote !== ''}
                    className="text-caption text-text-tertiary"
                  >
                    {snippetTransferNote}
                  </FieldError>
                </div>

                {savingSnippet && (
                  <div className="px-3 pb-2 shrink-0 flex flex-col gap-2">
                    <input
                      type="text"
                      value={snippetName}
                      onChange={(e) => setSnippetName(e.target.value)}
                      onKeyDown={(e) => {
                        // Plain Enter saves the snippet; Ctrl+Enter is the DIALOG's, as in
                        // SnippetEditForm. Handling both here also saved the snippet on the
                        // Ctrl+Enter that confirmed and closed the whole dialog.
                        if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); handleSaveSnippet(); }
                        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSavingSnippet(false); }
                      }}
                      placeholder="Snippet name…"
                      aria-label="Snippet name"
                      autoFocus
                      className="input-inline font-sans"
                    />
                    <div className="flex items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => setSavingSnippet(false)}>
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleSaveSnippet}
                        disabled={!snippetName.trim() || !text.trim()}
                      >
                        Save snippet
                      </Button>
                    </div>
                  </div>
                )}

                {snippets.length > 0 && (
                  <div className="px-3 pb-2 shrink-0">
                    <div className="relative">
                      <Search size={11} aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary pointer-events-none" />
                      <input
                        type="text"
                        value={snippetFilter}
                        onChange={(e) => {
                          const next = e.target.value;
                          setSnippetFilter(next);
                          // A query that hides the row with an armed delete or an open edit form
                          // disarms it. Left set, the hidden layer kept the Esc router armed: the
                          // next Esc was swallowed with nothing on screen changing. A row the new
                          // query still shows keeps its form — that may be an edit in progress.
                          const hidden = (id: string | null) =>
                            id !== null && !snippets.some((s) => s.id === id && snippetMatches(s, next));
                          if (hidden(deletingSnippetId)) setDeletingSnippetId(null);
                          if (hidden(editingSnippetId)) setEditingSnippetId(null);
                        }}
                        placeholder="Search snippets…"
                        aria-label="Search snippets"
                        className="input-inline font-sans pl-6"
                      />
                    </div>
                  </div>
                )}

                <div className="flex-1 min-h-0 overflow-y-auto border-t border-border-subtle">
                  {snippets.length === 0 ? (
                    <div className="px-3 py-4 flex flex-col items-center gap-2.5 text-center text-caption text-text-tertiary">
                      <span>No saved snippets yet</span>
                      {/* The empty state offers the one action that fills it — the same one the
                          bookmark icon above does, with a label this time. */}
                      <Button variant="secondary" size="xs" onClick={() => setSavingSnippet(true)} disabled={!text.trim()} data-tip={needsTextTip}>
                        <BookmarkPlus size={12} /> Save current text as a snippet
                      </Button>
                    </div>
                  ) : filteredSnippets.length === 0 ? (
                    <div className="px-3 py-4 text-center text-caption text-text-disabled">
                      {'No snippets match'} “{snippetFilter}”
                    </div>
                  ) : (
                    filteredSnippets.map((s) =>
                      editingSnippetId === s.id ? (
                        <SnippetEditForm
                          key={s.id}
                          snippet={s}
                          onSave={(name, snippetText) => handleUpdateSnippet(s.id, name, snippetText)}
                          onCancel={() => setEditingSnippetId(null)}
                        />
                      ) : (
                        <div
                          key={s.id}
                          className={`flex items-center gap-1 px-3 py-2 transition-colors group border-b border-border-subtle last:border-b-0 ${
                            deletingSnippetId === s.id ? 'bg-recording-bg' : 'hover:bg-bg-card'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleInsertSnippet(s)}
                            disabled={deletingSnippetId === s.id}
                            className="flex-1 text-left min-w-0 disabled:cursor-default"
                            // The row shows two clamped lines; the tip carries the whole snippet,
                            // which is the only way to tell two long ones apart before inserting.
                            data-tip={s.text}
                          >
                            <div className="text-minor font-medium text-text-primary truncate">{s.name}</div>
                            <div className="text-caption text-text-tertiary line-clamp-2 mt-0.5"><SnippetText text={s.text} /></div>
                          </button>
                          {/* Keyed fragments: unkeyed, child[1] is the Trash button in one
                              branch and the red confirm button in the other — both <button> —
                              so React reused the node. Its transition-colors faded the red
                              fill in while the glyph swapped instantly (a checkmark on a
                              still-transparent button), and autoFocus below never fired,
                              since autoFocus only acts on mount. */}
                          {deletingSnippetId === s.id ? (
                            <React.Fragment key="confirm">
                              <span className="text-caption text-recording-fg mr-1 shrink-0">Delete snippet?</span>
                              {/* The armed confirm keeps a red fill AT REST — iconButtonClass's danger
                                  tone is red only on hover, and an armed delete has to read as armed
                                  before the pointer gets there. Same sm rung (24 px), tokens only. */}
                              <button
                                type="button"
                                onClick={() => handleDeleteSnippet(s.id)}
                                aria-label="Delete snippet"
                                data-tip={tt('Delete', 'Excluir')}
                                className="inline-flex items-center justify-center h-6 min-w-6 px-1 shrink-0 rounded text-recording-fg bg-recording/20 hover:bg-recording/35 border border-recording/40 transition-colors"
                                autoFocus
                              >
                                <Check size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingSnippetId(null)}
                                aria-label="Cancel"
                                data-tip={tt('Cancel (Esc)', 'Cancelar (Esc)')}
                                className={iconButtonClass('sm')}
                              >
                                <X size={12} />
                              </button>
                            </React.Fragment>
                          ) : (
                            <React.Fragment key="actions">
                              {/* Hidden until the row is hovered or holds the focus — Tab onto
                                  either one sets focus-within and shows both. */}
                              <button
                                type="button"
                                onClick={() => setEditingSnippetId(s.id)}
                                aria-label="Edit snippet"
                                data-tip={tt('Edit snippet', 'Editar snippet')}
                                className={iconButtonClass('sm', { className: 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' })}
                              >
                                <Pencil size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingSnippetId(s.id)}
                                aria-label="Delete snippet"
                                data-tip={tt('Delete snippet', 'Excluir snippet')}
                                className={iconButtonClass('sm', { tone: 'danger', className: 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100' })}
                              >
                                <Trash2 size={12} />
                              </button>
                            </React.Fragment>
                          )}
                        </div>
                      ),
                    )
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Clipboard Surface — overlay INSIDE the relative body wrapper. ── */}
        {surface && (
          <ClipboardSurface
            state={clipState}
            onStateChange={(updater) => {
              setClipState(updater);
              setClipDirty(true);
            }}
            head={clipHead}
            onHeadChange={(next) => {
              setClipHead(next);
              setClipDirty(true);
            }}
            onBack={closeSurface}
            onReset={handleSurfaceReset}
            // What the user actually has, for the read-only panel to show. Without it that panel
            // rendered the REBUILT token — the loss displayed as done, under a warning that it would
            // happen. Only meaningful when editing an existing token.
            originalToken={surface.mode === 'edit' ? surface.token : undefined}
          />
        )}
      </div>

      {/* Name prompt for {Variable…}/{Row column…} (portal — sits above everything). */}
      {namePrompt && (
        <NamePromptPopover
          kind={namePrompt.kind}
          anchor={namePrompt.anchor}
          // Clear the prompt FIRST: the Esc router checks namePrompt before surface, so leaving
          // both open would make one Esc close a prompt that is already off screen.
          onAdvanced={(head) => { setNamePrompt(null); openInsertSurfaceForHead(head); }}
          onInsert={(token) => lexicalApiRef.current?.insertToken(token)}
          onClose={() => closeNamePrompt()}
        />
      )}
    </DialogShell>
    {/* Unsaved-text gate. A SIBLING of the shell, not a child: the card's Tab trap and its own
        Esc handler must not own a prompt that asks whether to leave that card. Reached only via
        canClose; "Discard" then calls onClose DIRECTLY, because by that point the decision is a
        completed user action. No native confirm() — window.confirm races the shell's Escape
        handling, which is why the in-panel overlay pattern exists. */}
    {confirmDiscard && (
      <DialogShell
        icon={<AlertTriangle size={14} style={{ color: 'var(--color-warning-ink)' }} />}
        title="Unsaved text"
        size="sm"
        zClass="z-(--z-submenu)"
        onClose={() => { setConfirmDiscard(false); lexicalApiRef.current?.focus(); }}
        footer={
          <DialogFooter
            secondary={{ label: 'Keep editing', onClick: () => { setConfirmDiscard(false); lexicalApiRef.current?.focus(); }, autoFocus: true }}
            extra={<Button variant="destructiveText" size="md" onClick={() => { setConfirmDiscard(false); onClose(); }}>Discard</Button>}
            /* Repeats the footer's own gate and label so it cannot fire handleConfirm's early-return
               branch on a whitespace-only payload. */
            primary={{ label: mode === 'add' ? 'Add text' : 'Save text', onClick: () => { setConfirmDiscard(false); handleConfirm(); }, disabled: !text.trim() }}
          />
        }
      >
        <p className="px-4 py-4 text-minor text-text-secondary leading-relaxed">
          Unapplied changes will be lost — text, formatting and delivery settings.
        </p>
      </DialogShell>
    )}
    </>
  );
}
