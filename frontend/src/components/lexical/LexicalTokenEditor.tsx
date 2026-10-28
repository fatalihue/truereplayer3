import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { AutoLinkPlugin } from '@lexical/react/LexicalAutoLinkPlugin';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getRoot,
  $getNodeByKey,
  $getSelection,
  $setSelection,
  $insertNodes,
  $isRangeSelection,
  $isNodeSelection,
  $isTextNode,
  $isElementNode,
  $createTextNode,
  $createParagraphNode,
  $getNearestNodeFromDOMNode,
  type BaseSelection,
  type ElementNode,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_HIGH,
  FORMAT_TEXT_COMMAND,
  PASTE_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_SPACE_COMMAND,
  KEY_DOWN_COMMAND,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_TAB_COMMAND,
  TextNode,
  type LexicalNode,
  type TextFormatType,
} from 'lexical';
import {
  ListNode,
  ListItemNode,
  $isListNode,
  $isListItemNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  REMOVE_LIST_COMMAND,
} from '@lexical/list';
import { LinkNode, AutoLinkNode, $isLinkNode, $isAutoLinkNode, $createLinkNode, $toggleLink, TOGGLE_LINK_COMMAND } from '@lexical/link';
import { $generateHtmlFromNodes, $generateNodesFromDOM } from '@lexical/html';
import { $dfs, mergeRegister } from '@lexical/utils';
import {
  Bold, Italic, Underline, Strikethrough, Code, List, ListOrdered, Link2, Check, X, RemoveFormatting,
} from 'lucide-react';
import { iconButtonClass } from '../common/IconButton';
import { useTt } from '../../state/LanguageContext';
import { TokenNode, $createTokenNode, $isTokenNode } from './TokenNode';
import { ClipboardChipEditContext, OPEN_TOKEN_CHIP_COMMAND, type ClipboardChipEditRequest } from './TokenChip';
// The whitelist of names the backend resolves, and the walker that finds them the way the
// ENGINE does, both live in tokenNormalize — see the "What the ENGINE calls a token" banner
// there. They are imported rather than restated because the grid's SendTextPreview needs the
// identical answer and a second copy of a list is how the two drifted in the first place.
import { splitTokenSegments, normalizeToken, tokenResolvesIn, type TokenScope } from './tokenNormalize';
// The TYPING grammar — what auto-chips as you type, deliberately narrower than what the engine
// resolves — lives in ./typingGrammar. Only TokenAutoTransformPlugin asks it; everything that
// reports on a FINISHED payload (the token count below, the grid preview, the load and paste
// paths) asks splitTokenSegments, whose grammar is the engine's.
import { TOKEN_REGEX_WHOLE, findTypedToken } from './typingGrammar';
import { TOKEN_CATALOG, type CatalogEntry } from './tokenCatalog';
import { uiZoom, rectToLayout, viewportInLayout, type Box } from '../../utils/zoomSpace';

// Counts the tokens a serialized payload contains — powers the "N tokens" figure in the
// Insert Text status strip. Asks splitTokenSegments, i.e. the engine's grammar, so the figure
// answers the question the user is actually asking ("how many of these will be substituted?")
// rather than "how many would auto-chip if I retyped them".
export function countKnownTokens(text: string): number {
  if (!text.includes('{') || !text.includes('}')) return 0;
  let count = 0;
  for (const segment of splitTokenSegments(text)) {
    if (segment.kind === 'token') count++;
  }
  return count;
}

export interface LexicalEditorHandle {
  /** Insert text at the current cursor; known `{...}` substrings become chips. */
  insertText: (text: string) => void;
  /**
   * Insert ONE pre-built token as a chip, bypassing the TOKEN_REGEX gate — for
   * popover-built tokens whose modifier args may contain characters the typing
   * grammar doesn't chip (e.g. a join separator of " " or "; "). Plain insertText
   * would drop those as raw text while visually identical configs became chips.
   */
  insertToken: (token: string) => void;
  /** Rich mode: insert an HTML fragment (a rich snippet) at the cursor —
   *  formatting preserved, `<span data-token>` markers re-chip on import. */
  insertHtml: (html: string) => void;
  focus: () => void;
  /**
   * Rich mode only: the document exported as an HTML fragment, or null when it
   * carries NO formatting (no format bits, lists or links) — a null keeps the
   * action a plain SendText, byte-identical to pre-rich behavior. Token chips
   * export as `<span data-token>{token}</span>` (resolved at send time).
   */
  getHtml: () => string | null;
  /**
   * Rich mode: the document as chat-style markdown, or null when unformatted. Delivered as PLAIN
   * text so a markdown-rendering target formats it itself. `variant` picks the marks: 'whatsapp'
   * (default: *bold* _italic_ ~strike~ `code`) or 'discord' (**bold** _italic_ ~~strike~~ `code`).
   */
  getMarkdown: (variant?: 'whatsapp' | 'discord') => string | null;
  /**
   * The plain payload exactly as onChange would report it. The dialog's unsaved-work baseline
   * needs this rather than the initialText prop: the seeding round-trip is not guaranteed
   * byte-identical (rich mode serializes through $serializePlainForSend, and a saved KeyHtml is
   * re-imported and re-exported), so a prop-vs-export comparison reports a freshly opened Edit
   * dialog as dirty and prompts on every Esc. Compare export against export.
   */
  getText: () => string;
}

interface LexicalTokenEditorProps {
  initialText: string;
  onChange: (text: string) => void;
  /**
   * Rich mode only: fires with the answer to "does the doc carry DELIBERATE formatting?"
   * on every non-selection change — i.e. the same bit getHtml()/getMarkdown() gate on
   * ($hasDeliberateFormatting). It is the GATE only: $generateHtmlFromNodes stays on demand
   * at confirm/snippet time, so the per-keystroke HTML export this component deliberately
   * avoids is NOT reintroduced. Omit the prop and nothing extra is computed.
   */
  onFormattingChange?: (hasFormatting: boolean) => void;
  onSubmit?: () => void;
  apiRef: React.MutableRefObject<LexicalEditorHandle | null>;
  /** ContentEditable classes. Default = the compact SheetPanel look; the Insert
   *  Text dialog passes its roomier full-bleed recipe. */
  /** Padding / type density: the dialog writing surface or the sheet field. */
  density?: EditorDensity;
  contentClassName?: string;
  /** Placeholder classes — must mirror contentClassName's padding. */
  placeholderClassName?: string;
  /**
   * What the empty document says. Default is the one line both surfaces always showed; the
   * Insert Text dialog passes a two-line version that also teaches what a token is, which the
   * 340 px sheet field has no room for. A slot, not a flag: the caller owns the words.
   */
  placeholder?: React.ReactNode;
  /** The text box's accessible name: "Text to send" by default, the payload of a Send Text. */
  ariaLabel?: string;
  /**
   * Typing `{` opens the token list (TokenAutocompletePlugin) — the keyboard door to the Insert
   * palette. Opt-in per surface: the Insert Text dialog and both sheet editors (Text to Type,
   * SendText payload) pass it. The sheet's document-level Esc handler is bubble-phase and honours
   * defaultPrevented, so the plugin's capture-phase Esc closes the list without arming the
   * sheet's discard guard.
   */
  tokenAutocomplete?: boolean;
  /**
   * Which engine(s) sit behind the payload — TokenScope in tokenNormalize. 'desktop' (the
   * default, SendText) is the C# resolver plus ParseSendTextSegments; 'browser' is the BrowserType
   * "Text to Type" field, where the C# side resolves the data tokens and the Chrome extension
   * presses the keys. Since extension 1.4.18 the two key grammars are the same (see the banner in
   * tokenNormalize), so both scopes chip the same tokens; the prop keeps naming the engine so a
   * future difference has a place to live.
   */
  tokenScope?: TokenScope;
  /** When provided, clicking a {clipboard...} chip routes HERE instead of the
   *  built-in 300px popover (see ClipboardChipEditContext). */
  onClipboardChipEdit?: (req: ClipboardChipEditRequest) => void;
  /** Rich-text authoring (Insert Text dialog only): RichTextPlugin + formatting
   *  toolbar + list/link nodes. The SheetPanel browserText surface stays plain. */
  richMode?: boolean;
  /**
   * Rich mode only: does the ACTIVE delivery mode carry the formatting to the target at all?
   * false = Plain (ActionExecution.cs:3608 nulls KeyHtml), and the toolbar renders its
   * "authored, not sent" treatment. markdown/discord pass TRUE — they drop the HTML too, but
   * they still deliver the formatting, as literal *bold* markers baked into the text.
   *
   * A separate prop, NOT a widening of richMode: richMode picks initialConfig.nodes and
   * RichTextPlugin-vs-PlainTextPlugin, which LexicalComposer reads once at build time, so
   * making it track the delivery mode would remount the editor and destroy the document the
   * user authored. Default true, so SheetPanel's plain call site stays byte-identical.
   */
  formattingDelivered?: boolean;
  /**
   * Rich mode only: a node parked on the RIGHT of the formatting toolbar. The Insert Text dialog
   * puts its Delivery control here so the switch that decides whether the formatting travels sits
   * beside the buttons that create it. A SLOT, not a coupling — SheetPanel passes nothing and its
   * toolbar is byte-identical.
   */
  toolbarExtra?: React.ReactNode;
  /** Rich mode: rebuild the document from a saved KeyHtml fragment instead of
   *  the plain initialText (token marker spans re-chip via TokenNode.importDOM). */
  initialHtml?: string | null;
}

// Splits `text` into alternating plain TextNodes and TokenNodes. Unknown tokens
// (matching the syntax but not resolved in `scope`) stay folded into the
// surrounding text run so the user sees their typo as plain text.
//
// Asks splitTokenSegments — the ENGINE's grammar — not the TYPING grammar, because this
// loads a FINISHED payload: reopening a saved action, or pasting one. That is the same rule the
// token count and the grid preview already follow (see the banner in typingGrammar.ts), and leaving
// this one site on the narrow regex is what made a chip built through the popover come back as
// RAW TEXT the next time the editor opened — the grid kept drawing it, the engine kept running
// it, and only the editor forgot what it was. Any delimiter the typing grammar rejects hit this:
// {clipboard:after: - } since 2.20.0, {clipboard:after: :: } since the colon escape.
//
// The live-typing plugin stays on the typing grammar on purpose — a half-typed token must not chip.
function buildNodesFromText(text: string, scope: TokenScope): LexicalNode[] {
  return splitTokenSegments(text, scope).map((seg) => {
    if (seg.kind !== 'token') return $createTextNode(seg.value);
    // EVERY token the engine resolves comes back as a chip. What differs is whether the node is
    // allowed to REWRITE it on the way in:
    //
    //   • the typing grammar accepted it, or it is already in canonical form → normal node.
    //     Those have always been head-normalised here ({enter} → {Enter}) and still are.
    //   • anything else → VERBATIM node, whose bytes are preserved exactly (TokenNode.__verbatim).
    //
    // The rewrite is the whole hazard, not the chipping: TokenNode normalises whatever it is
    // handed and OnChangePlugin writes the editor's serialisation straight back, so a rewritten
    // token marks an untouched action dirty. Preserving the bytes removes it, so the gate no
    // longer has to choose between rewriting the payload and forgetting that a token is a token.
    //
    // Measured: EVERY shape that reached this function and lost its chip differed from its
    // canonical form in the HEAD CASE ALONE — {clipboard:after: - }, {clipboard:join: - },
    // {clipboard:line:@i}, {rownext:Coluna: - }, {input:…}, {pick:…}. That is what the builders
    // emit (clipboardModifiers joins a lower-case head) and what the manual shows, so it is also
    // what a paste carries. They chipped in the grid preview and ran in the engine while the
    // editor alone drew them as raw text. ({row:First Name} and {var:Ação} were on that list too;
    // since the walker applies the engine's argument shapes they are text on every surface, which
    // is what the run makes of them.)
    const canonical = TOKEN_REGEX_WHOLE.test(seg.value) || normalizeToken(seg.value) === seg.value;
    return $createTokenNode(seg.value, !canonical);
  });
}

// Recursively emit one text line per list item, handling NESTED lists (a list Tab-indented inside
// an item is modelled by Lexical as a ListItemNode whose only child is a ListNode). Each level is
// indented 3 spaces and ordered numbering restarts per level; `inline` renders an item's own inline
// content (with or without markdown markers). Without this, a nested list fell through to
// getTextContent and lost its markers + indentation entirely.
function $serializeListLines(list: ListNode, inline: (p: ElementNode) => string, depth: number): string[] {
  const out: string[] = [];
  const ordered = list.getListType() === 'number';
  const indent = '   '.repeat(depth);
  // Honor a custom ordered-list start (e.g. an <ol start="5"> pasted/imported from external HTML)
  // so the plain/markdown flavors number 5. 6. 7. like the Rich flavor does, instead of 1. 2. 3.
  let n = ordered ? list.getStart() - 1 : 0;
  for (const item of list.getChildren()) {
    if (!$isListItemNode(item)) continue;
    const children = item.getChildren();
    const nested = children.find($isListNode) as ListNode | undefined;
    // A pure wrapper (only child is a nested list) carries no bullet of its own — just recurse.
    if (nested && children.length === 1) {
      out.push(...$serializeListLines(nested, inline, depth + 1));
      continue;
    }
    n++;
    out.push(indent + (ordered ? `${n}. ` : '- ') + inline(item));
    if (nested) out.push(...$serializeListLines(nested, inline, depth + 1));
  }
  return out;
}

// Canonical plain payload for RICH mode. root.getTextContent() is WRONG here: Lexical
// joins non-inline block siblings with a DOUBLE line break, and RichTextPlugin's Enter
// creates ParagraphNodes (plain mode created LineBreakNodes) — so a zero-formatting
// multi-line doc would save "line1\n\nline2" and every plain target would paste blank
// lines. Walk top-level blocks and join with a SINGLE '\n'; list items additionally get
// "- " / "N. " markers so the plain flavor of a formatted list reads as a list.
function $serializePlainForSend(): string {
  const lines: string[] = [];
  for (const block of $getRoot().getChildren()) {
    if ($isListNode(block)) {
      lines.push(...$serializeListLines(block, $inlinePlain, 0));
    } else if ($isElementNode(block)) {
      lines.push($inlinePlain(block));
    } else {
      lines.push(block.getTextContent());
    }
  }
  return lines.join('\n');
}

// Plain-flavor inline walk — mirrors $inlineMarkdown but WITHOUT the *_~` markers: raw text,
// token chips pass through (resolved at send), and a deliberate (toolbar) link degrades to
// "text (url)" so the plain flavor keeps the destination instead of a bare getTextContent()
// dropping it to label-only (a Rich-mode link pasted into a plain-only target would otherwise
// lose its URL silently). AutoLinks fall through as their bare URL text (no duplication).
// Nested lists are skipped here — $serializeListLines' recursion owns them.
function $inlinePlain(parent: ElementNode): string {
  let out = '';
  for (const child of parent.getChildren()) {
    if ($isListNode(child)) {
      continue; // a nested list is emitted by $serializeListLines' recursion, not inlined here
    } else if ($isTokenNode(child)) {
      out += child.getTextContent();
    } else if ($isLinkNode(child) && !$isAutoLinkNode(child)) {
      const linkText = child.getTextContent();
      const url = child.getURL();
      out += url && linkText !== url && !linkText.includes(url) ? `${linkText} (${url})` : linkText;
    } else if ($isTextNode(child)) {
      // Raw text passes through UNTOUCHED — mirrors $inlineMarkdown's TextNode branch.
      // A saved SendText with no formatting has no KeyHtml, so InitialContentPlugin
      // rebuilds it as ONE paragraph holding the whole payload: its deliberate blank
      // lines live INSIDE this TextNode. The \n\n collapse below targets Lexical's
      // block separators on nested non-text nodes and would eat them (reopening
      // "Olá,\n\nSegue" saved back "Olá,\nSegue").
      out += child.getTextContent();
    } else {
      out += child.getTextContent().replace(/\n\n/g, '\n');
    }
  }
  return out;
}

// WhatsApp/chat-style markdown serializer for the "Markdown" delivery mode. WhatsApp Web
// (and Discord-ish targets) render *bold* / _italic_ / ~strike~ / `code` typed as PLAIN text
// and auto-link bare URLs, so this produces those markers from the rich document. Markers
// are one config object → a Discord/standard variant later is a swap. Whitespace stays
// OUTSIDE the markers ("*hi* " not "*hi *") so WhatsApp still recognises the run; token chips
// pass through raw (resolved at send); a labelled link becomes "text (url)" since WhatsApp
// can't attach a URL to arbitrary text.
type MdMarks = { bold: string; italic: string; strikethrough: string; code: string };
// WhatsApp (default 'markdown' delivery) vs Discord: bold **, strikethrough ~~ (doubled) — the
// only structural differences; italic _ and code ` are shared. Marks may be multi-char.
const WA_MARKS: MdMarks = { bold: '*', italic: '_', strikethrough: '~', code: '`' };
const DISCORD_MARKS: MdMarks = { bold: '**', italic: '_', strikethrough: '~~', code: '`' };

// Line by line. A TextNode holds a '\n' only on the LOAD path: a SendText saved without KeyHtml is
// rebuilt as one paragraph whose line breaks live INSIDE the node (see $inlinePlain). Typed text
// never does — Enter makes a paragraph, Shift+Enter a LineBreakNode — so its formatted runs were
// always wrapped per line, while a loaded one got ONE pair of markers across the break
// ("*Olá,\n\nSegue*"), which WhatsApp and Discord do not read as emphasis. The same visual content
// now serializes the same way whichever door it came through.
function $wrapMarkdown(node: TextNode, marks: MdMarks): string {
  const value = node.getTextContent();
  if (!value.includes('\n')) return $wrapMarkdownRun(node, value, marks);
  return value.split('\n').map((line) => $wrapMarkdownRun(node, line, marks)).join('\n');
}

function $wrapMarkdownRun(node: TextNode, value: string, marks: MdMarks): string {
  if (value.trim() === '') return value;
  const lead = value.match(/^\s*/)![0];
  const trail = value.match(/\s*$/)![0];
  let core = value.slice(lead.length, value.length - trail.length);
  if (node.hasFormat('code')) core = marks.code + core + marks.code;
  if (node.hasFormat('strikethrough')) core = marks.strikethrough + core + marks.strikethrough;
  if (node.hasFormat('italic')) core = marks.italic + core + marks.italic;
  if (node.hasFormat('bold')) core = marks.bold + core + marks.bold;
  return lead + core + trail;
}

function $inlineMarkdown(parent: ElementNode, marks: MdMarks): string {
  let out = '';
  for (const child of parent.getChildren()) {
    if ($isListNode(child)) {
      continue; // nested list handled by $serializeListLines' recursion
    } else if ($isTokenNode(child)) {
      out += child.getTextContent();
    } else if ($isLinkNode(child) && !$isAutoLinkNode(child)) {
      // Deliberate (toolbar) link only. WhatsApp can't attach a URL to arbitrary text, so a
      // labelled link becomes "text (url)". AutoLinks (bare typed URLs) fall through to plain
      // text below — emitting the URL once — so WhatsApp doesn't double-link them.
      const linkText = child.getTextContent();
      const url = child.getURL();
      out += url && linkText !== url && !linkText.includes(url) ? `${linkText} (${url})` : linkText;
    } else if ($isTextNode(child)) {
      out += $wrapMarkdown(child, marks);
    } else {
      // Any other node (e.g. an AutoLinkNode) — collapse Lexical's double block
      // separators so nested content doesn't inject stray blank lines. (Nested lists
      // never reach here; they're skipped above and owned by $serializeListLines.)
      out += child.getTextContent().replace(/\n\n/g, '\n');
    }
  }
  return out;
}

// True when the doc carries DELIBERATE formatting (format bits, lists, or an explicit
// toolbar link) — AutoLinkNodes are excluded so merely typing a URL never turns the action
// rich (badge + compat pin + rich delivery). Shared by getHtml and getMarkdown; must run
// inside an editorState.read().
function $hasDeliberateFormatting(): boolean {
  return $dfs().some(({ node }) =>
    ($isTextNode(node) && node.getFormat() !== 0)
    || $isListNode(node)
    || ($isLinkNode(node) && !$isAutoLinkNode(node)));
}

function $serializeMarkdownForSend(marks: MdMarks): string {
  const inline = (p: ElementNode) => $inlineMarkdown(p, marks);
  const lines: string[] = [];
  for (const block of $getRoot().getChildren()) {
    if ($isListNode(block)) {
      lines.push(...$serializeListLines(block, inline, 0));
    } else if ($isElementNode(block)) {
      lines.push(inline(block));
    } else {
      lines.push(block.getTextContent());
    }
  }
  return lines.join('\n');
}

// One-shot population of the editor with the initial value (only runs first time).
// Rich mode with a saved KeyHtml rebuilds the formatted document from the HTML
// fragment (lists/links/format bits restored; `<span data-token>` re-chips via
// TokenNode.importDOM); otherwise the plain text is parsed into text+chip runs.
function InitialContentPlugin({ initialText, initialHtml, scope }: { initialText: string; initialHtml?: string | null; scope: TokenScope }) {
  const [editor] = useLexicalComposerContext();
  const didInit = useRef(false);

  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      if (initialHtml) {
        const dom = new DOMParser().parseFromString(initialHtml, 'text/html');
        const nodes = $generateNodesFromDOM(editor, dom);
        // $insertNodes (not root.append) — the fragment's top level may hold
        // inline nodes, which insertNodes wraps in paragraphs as needed.
        root.select();
        $insertNodes(nodes);
        return;
      }
      const para = $createParagraphNode();
      const nodes = buildNodesFromText(initialText, scope);
      if (nodes.length > 0) para.append(...nodes);
      root.append(para);
    });
  }, [editor, initialText, initialHtml, scope]);

  return null;
}

// Exposes imperative methods to the parent via apiRef.
function ImperativeAPIPlugin({
  apiRef,
  richMode,
  scope,
}: {
  apiRef: React.MutableRefObject<LexicalEditorHandle | null>;
  /** Picks the same serializer onChange uses, so getText() and the reported text agree. */
  richMode: boolean;
  scope: TokenScope;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // Shared insert plumbing: focus, resolve a usable range selection (falling
    // back to end-of-document when the editor was never focused), insert nodes.
    // Takes a FACTORY, not nodes: $create*Node calls are only legal inside
    // editor.update() — building the nodes outside it throws and the insert
    // silently no-ops (the palette-chip-does-nothing bug).
    const insertNodesAtCursor = (makeNodes: () => LexicalNode[]) => {
      editor.focus();
      editor.update(() => {
        const nodes = makeNodes();
        if (nodes.length === 0) return;
        let selection = $getSelection();
        // Editor never focused yet (e.g. inserting via side-panel button on a
        // fresh dialog) — fall back to the end of the document.
        if (!$isRangeSelection(selection)) {
          const last = $getRoot().getLastChild();
          if (last && $isElementNode(last)) {
            last.selectEnd();
            selection = $getSelection();
          }
        }
        if ($isRangeSelection(selection)) {
          selection.insertNodes(nodes);
        }
      });
    };

    apiRef.current = {
      insertText: (text: string) => insertNodesAtCursor(() => buildNodesFromText(text, scope)),
      // No regex gate: the caller vouches this is one well-formed token (the
      // Advanced popover builds it via buildClipboardToken).
      insertToken: (token: string) => insertNodesAtCursor(() => [$createTokenNode(token)]),
      insertHtml: (html: string) => insertNodesAtCursor(() => {
        const dom = new DOMParser().parseFromString(html, 'text/html');
        return $generateNodesFromDOM(editor, dom);
      }),
      focus: () => editor.focus(),
      // Exactly what OnChangePlugin reports, so a baseline taken here and a later `text` state
      // are the same kind of value.
      getText: () => {
        let out = '';
        editor.getEditorState().read(() => {
          out = richMode ? $serializePlainForSend() : $getRoot().getTextContent();
        });
        return out;
      },
      // On-demand HTML export (confirm-time, not per-keystroke). null when the doc
      // has no formatting, so unformatted actions stay plain on disk.
      getHtml: () => {
        let html: string | null = null;
        editor.getEditorState().read(() => {
          if ($hasDeliberateFormatting()) html = $generateHtmlFromNodes(editor, null);
        });
        return html;
      },
      getMarkdown: (variant) => {
        let md: string | null = null;
        editor.getEditorState().read(() => {
          // Same gate as getHtml — an unformatted doc's markdown equals its plain text,
          // so return null and let the action stay plain.
          if ($hasDeliberateFormatting()) md = $serializeMarkdownForSend(variant === 'discord' ? DISCORD_MARKS : WA_MARKS);
        });
        return md;
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [editor, apiRef, richMode, scope]);

  return null;
}

// Backspace/Delete next to a chip removes the chip atomically. Without this,
// the default cursor behaviour with isolated DecoratorNodes leaves the chip
// stranded — backspace just shifts the caret across it without deleting.
function ChipKeyboardPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    // A keydown that originates INSIDE a chip still reaches here. Lexical binds keydown on the
    // ROOT element and keydown bubbles, so anything focusable a decorator ever renders — a
    // popover trigger, a future inline control — dispatches KEY_BACKSPACE/KEY_DELETE while
    // $getSelection() is still the RangeSelection the caret had somewhere else. Acting on that
    // deletes the WRONG chip. @lexical/rich-text guards its own backspace/delete handlers with
    // the same test for exactly this; that guard cannot save us, because this plugin registers
    // at COMMAND_PRIORITY_LOW and the dispatch loop walks priorities 4 → 0, so we run BEFORE
    // rich-text's COMMAND_PRIORITY_EDITOR and would have already returned true.
    const targetIsInsideChip = (target: EventTarget | null): boolean =>
      target instanceof Node && $isTokenNode($getNearestNodeFromDOMNode(target));

    const removeBackward = (): boolean => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      const { anchor } = selection;
      const node = anchor.getNode();
      const offset = anchor.offset;
      if ($isTextNode(node) && offset === 0) {
        const prev = node.getPreviousSibling();
        if (prev && $isTokenNode(prev)) {
          prev.remove();
          return true;
        }
      } else if ($isElementNode(node) && offset > 0) {
        const prev = node.getChildAtIndex(offset - 1);
        if (prev && $isTokenNode(prev)) {
          prev.remove();
          return true;
        }
      }
      return false;
    };

    const removeForward = (): boolean => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
      const { anchor } = selection;
      const node = anchor.getNode();
      const offset = anchor.offset;
      if ($isTextNode(node) && offset === node.getTextContentSize()) {
        const next = node.getNextSibling();
        if (next && $isTokenNode(next)) {
          next.remove();
          return true;
        }
      } else if ($isElementNode(node)) {
        const next = node.getChildAtIndex(offset);
        if (next && $isTokenNode(next)) {
          next.remove();
          return true;
        }
      }
      return false;
    };

    const u1 = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      (event: KeyboardEvent) => {
        if (targetIsInsideChip(event.target)) return false;
        if (removeBackward()) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    const u2 = editor.registerCommand(
      KEY_DELETE_COMMAND,
      (event: KeyboardEvent) => {
        if (targetIsInsideChip(event.target)) return false;
        if (removeForward()) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    return () => {
      u1();
      u2();
    };
  }, [editor]);

  return null;
}

// Watches every TextNode mutation: when the text contains a complete token the typing grammar
// accepts and `scope` resolves (findTypedToken), splits the text node and inserts a chip in
// place. Mirrors the paste behaviour so live typing produces the same result. Unknown tokens —
// and, in the browser scope, the key tokens the extension does not press — stay as plain text.
function TokenAutoTransformPlugin({ scope }: { scope: TokenScope }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerNodeTransform(TextNode, (textNode: TextNode) => {
      const text = textNode.getTextContent();
      const match = findTypedToken(text, scope);
      if (!match) return;

      const start = match.index;
      const end = start + match.token.length;
      const before = text.slice(0, start);
      const after = text.slice(end);
      const chip = $createTokenNode(match.token);

      // Only steal the caret when it actually lived in the node being split —
      // re-chipping pasted/imported content must not yank the cursor around.
      const selection = $getSelection();
      const anchorWasHere =
        $isRangeSelection(selection) && selection.anchor.getNode().getKey() === textNode.getKey();

      if (before) {
        textNode.setTextContent(before);
        textNode.insertAfter(chip);
      } else {
        textNode.replace(chip);
      }
      // Always have a trailing TextNode so the caret has a place to land right
      // after the chip — otherwise it would clamp to before the (isolated) chip.
      // It inherits the split node's format/style, or chipping a token inside a
      // bold/italic run would silently reset the remainder to unformatted.
      const trailing = $createTextNode(after);
      trailing.setFormat(textNode.getFormat());
      trailing.setStyle(textNode.getStyle());
      chip.insertAfter(trailing);
      if (anchorWasHere) trailing.select(0, 0);
    });
  }, [editor, scope]);

  return null;
}

// Intercepts paste to convert pasted text containing known `{...}` tokens into
// chips (instead of leaving them as raw text). In rich mode a paste that CARRIES
// formatting (text/html flavor) is left to Lexical's rich clipboard pipeline —
// hijacking it here would silently strip the formatting; the TokenAutoTransform
// node transform re-chips any tokens in the imported text afterwards.
function TokenPastePlugin({ richMode, scope }: { richMode?: boolean; scope: TokenScope }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        if (richMode && event.clipboardData?.getData('text/html')) return false;
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;
        // Skip our handler if the pasted text has no token markers — let the
        // default plain-text handler deal with it (preserves IME / undo nuances).
        if (!text.includes('{')) return false;
        event.preventDefault();
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;
          const nodes = buildNodesFromText(text, scope);
          if (nodes.length > 0) selection.insertNodes(nodes);
        });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor, richMode, scope]);

  return null;
}

// ── `{` autocomplete ──────────────────────────────────────────────────────────
// The keyboard door to the Insert palette: typing `{` opens a floating list of the SAME catalog
// the palette draws (tokenCatalog — one list, so the two cannot drift), filtered by what follows
// the brace; ↑/↓ move, Enter or Tab insert, Esc closes and leaves the brace as typed. A direct
// entry becomes a chip on the spot; a prompt entry (Variable…, Clip slot…) inserts its open half
// — `{var:` — and leaves the caret there, and TokenAutoTransformPlugin chips the finished
// `{var:name}` on its closing brace exactly as it does for a hand-typed one. The palette itself
// is untouched: this is the second door, not a replacement.
//
// Detection is a SELECTION read on every update, not a keydown: that is what also closes the list
// when the caret leaves, when Backspace eats the brace, and when the transform chips a hand-typed
// token underneath it. The query stops at ':' (an argument is being typed, not a name) and at any
// character a name cannot contain, so `{var:` after a prompt pick does not reopen the list.
const TRIGGER_RE = /\{([A-Za-z0-9_-]*)$/;

interface TriggerMatch { query: string; nodeKey: string; end: number }

// The catalog as `scope` sees it: the Insert palette's list whole for SendText, and for the browser
// field only the entries whose token the extension presses or the C# side resolves —
// tokenResolvesIn, the same gate the transform and the load path apply, so the list can never
// offer a chip the field would then refuse to draw. A direct entry's `insert` is the whole token
// ({delay:500} has an argument, {enter} has none); a prompt entry's is the open half, and every
// prompt head is a data token, which resolves on both paths.
function catalogFor(scope: TokenScope): CatalogEntry[] {
  if (scope === 'desktop') return TOKEN_CATALOG;
  return TOKEN_CATALOG.filter((e) => tokenResolvesIn(e.name, e.insert.includes(':'), scope));
}

// Prefix matches first (label or token name), then substring matches, palette order within each.
function filterCatalog(catalog: CatalogEntry[], query: string): CatalogEntry[] {
  if (!query) return catalog;
  const q = query.toLowerCase();
  const starts = catalog.filter((e) => e.label.toLowerCase().startsWith(q) || e.name.startsWith(q));
  const within = catalog.filter((e) => !starts.includes(e) && (e.label.toLowerCase().includes(q) || e.name.includes(q)));
  return [...starts, ...within];
}

function TokenAutocompletePlugin({ scope }: { scope: TokenScope }) {
  const [editor] = useLexicalComposerContext();
  const catalog = useMemo(() => catalogFor(scope), [scope]);
  const [match, setMatch] = useState<TriggerMatch | null>(null);
  const [caret, setCaret] = useState<Box | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Esc closes the list but the brace stays, and so does the caret right after it — remember
  // WHICH brace was dismissed so the next keystroke does not simply reopen the same list. Cleared
  // the moment the caret leaves that brace.
  const dismissedRef = useRef<{ nodeKey: string; brace: number } | null>(null);

  useEffect(() => editor.registerUpdateListener(({ editorState }) => {
    const found = editorState.read((): TriggerMatch | null => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel) || !sel.isCollapsed()) return null;
      const node = sel.anchor.getNode();
      if (!$isTextNode(node)) return null;
      const end = sel.anchor.offset;
      const m = TRIGGER_RE.exec(node.getTextContent().slice(0, end));
      return m ? { query: m[1], nodeKey: node.getKey(), end } : null;
    });
    if (!found) {
      dismissedRef.current = null;
      setMatch(null);
      return;
    }
    const brace = found.end - found.query.length - 1;
    const dismissed = dismissedRef.current;
    if (dismissed && dismissed.nodeKey === found.nodeKey && dismissed.brace === brace) {
      setMatch(null);
      return;
    }
    dismissedRef.current = null;
    // Caret rect: a visual read converted to the LAYOUT space `left/top` are written in, like
    // every floating surface here (utils/zoomSpace). A collapsed range still reports its line box.
    const domSel = window.getSelection();
    const raw = domSel && domSel.rangeCount > 0 ? domSel.getRangeAt(0).getBoundingClientRect() : null;
    const rect = raw && (raw.width > 0 || raw.height > 0) ? raw : editor.getRootElement()?.getBoundingClientRect() ?? null;
    if (rect) setCaret(rectToLayout(rect, uiZoom()));
    setMatch((prev) => (prev && prev.query === found.query && prev.nodeKey === found.nodeKey && prev.end === found.end ? prev : found));
  }), [editor]);

  // The sheet scrolls under an open list, and the window can resize: re-read the caret and follow
  // it, one placement per frame — the chip popover's rule, with a capture-phase scroll listener so
  // a scroll in ANY ancestor counts.
  useEffect(() => {
    if (!match) return;
    let raf: number | null = null;
    const onReflow = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const domSel = window.getSelection();
        const raw = domSel && domSel.rangeCount > 0 ? domSel.getRangeAt(0).getBoundingClientRect() : null;
        if (raw && (raw.width > 0 || raw.height > 0)) setCaret(rectToLayout(raw, uiZoom()));
      });
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      if (raf !== null) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [match]);

  const options = useMemo(() => (match ? filterCatalog(catalog, match.query) : []), [match, catalog]);
  const open = match !== null && options.length > 0;
  // Back to the top for a new query AND for a different brace: moving the caret straight from one
  // `{` to another with the same query (two empty ones) kept the old highlight, past the end of a
  // shorter list — nothing lit, and Enter committed options[0], not the row the arrows had chosen.
  const braceAt = match ? match.end - match.query.length : null;
  useEffect(() => { setActive(0); }, [match?.query, match?.nodeKey, braceAt]);

  // Below the caret, above it when the bottom would leave the viewport, clamped to the sides.
  useLayoutEffect(() => {
    if (!open || !caret || !menuRef.current) { setPos(null); return; }
    const zoom = uiZoom();
    const { width: vw, height: vh } = viewportInLayout(zoom);
    const el = menuRef.current;
    let left = caret.left;
    let top = caret.bottom + 4;
    if (top + el.offsetHeight > vh - 8) top = Math.max(8, caret.top - el.offsetHeight - 4);
    if (left + el.offsetWidth > vw - 8) left = vw - el.offsetWidth - 8;
    if (left < 8) left = 8;
    setPos({ left, top });
  }, [open, caret, options.length]);

  useEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, options]);

  const commit = useCallback((entry: CatalogEntry, m: TriggerMatch) => {
    editor.update(() => {
      const node = $getNodeByKey(m.nodeKey);
      if (!$isTextNode(node)) return;
      const text = node.getTextContent();
      const start = m.end - m.query.length - 1;
      if (start < 0 || text.slice(start, m.end) !== `{${m.query}`) return;   // the document moved on
      const format = node.getFormat();
      const style = node.getStyle();
      // splitText returns only the non-empty pieces, in order: the trigger is the first when it
      // opens the run, the second otherwise.
      const pieces = node.splitText(start, m.end);
      const trigger = pieces[start === 0 ? 0 : 1] ?? node;
      if (entry.kind === 'direct') {
        const chip = $createTokenNode(entry.insert);
        trigger.replace(chip);
        // A text node after the chip for the caret to land in (TokenNode is isolated), carrying
        // the run's format so typing on inside a bold run stays bold — the trailing-node rule
        // TokenAutoTransformPlugin follows.
        const next = chip.getNextSibling();
        let landing: TextNode;
        if ($isTextNode(next)) {
          landing = next;
        } else {
          landing = $createTextNode('');
          landing.setFormat(format);
          landing.setStyle(style);
          chip.insertAfter(landing);
        }
        landing.select(0, 0);
      } else {
        // The open half only: the name is the user's to type, and the finished `{var:name}` chips
        // through the transform on its closing brace, exactly as a hand-typed token does.
        trigger.setTextContent(entry.insert);
        trigger.select(entry.insert.length, entry.insert.length);
      }
    });
    setMatch(null);
  }, [editor]);

  // Keys, while open: ↑/↓ move, Enter/Tab take the highlighted entry. HIGH priority so the
  // editor's own Enter (paragraph) and Tab (indent) never fire underneath; Ctrl+Enter is the
  // dialog's confirm and passes through untouched. Read through a ref so the handlers see the
  // current highlight without re-registering on every arrow press.
  const liveRef = useRef<{ match: TriggerMatch; options: CatalogEntry[]; active: number } | null>(null);
  liveRef.current = open && match ? { match, options, active } : null;
  useEffect(() => {
    if (!open) return;
    const step = (delta: number) => (e: KeyboardEvent | null) => {
      e?.preventDefault();
      setActive((i) => (i + delta + options.length) % options.length);
      return true;
    };
    const pick = (e: KeyboardEvent | null) => {
      if (e && (e.ctrlKey || e.metaKey || e.altKey)) return false;
      // Shift+Tab is focus navigation (the sheet is a form), not "insert the highlighted item".
      // Lexical dispatches KEY_TAB_COMMAND for Tab with OR without Shift, so the list used to
      // swallow it and insert a chip. Closing the list here matters as much as returning false:
      // the menu is a fixed portal cleared only by a selection update, Esc, an outside mousedown
      // or a commit — none of which a keyboard focus move produces, so it would be left floating.
      if (e && e.shiftKey && e.key === 'Tab') { setMatch(null); return false; }
      e?.preventDefault();
      const live = liveRef.current;
      if (live) commit(live.options[live.active] ?? live.options[0], live.match);
      return true;
    };
    return mergeRegister(
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, step(1), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, step(-1), COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_ENTER_COMMAND, pick, COMMAND_PRIORITY_HIGH),
      editor.registerCommand(KEY_TAB_COMMAND, pick, COMMAND_PRIORITY_HIGH),
    );
  }, [editor, open, options.length, commit]);

  // Esc and outside clicks. Esc on a capture-phase document listener, the way TokenChipPopover
  // owns its key: it must never reach the dialog's card handler (which would read it as "close
  // the dialog") nor Lexical. The dialog's own Esc router stands down for the data-token-popover
  // marker the menu carries.
  useEffect(() => {
    if (!open || !match) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      dismissedRef.current = { nodeKey: match.nodeKey, brace: match.end - match.query.length - 1 };
      setMatch(null);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMatch(null);
    };
    document.addEventListener('keydown', onKey, true);
    // Capture, like the Esc above and for the same reason: TokenChip stops propagation on its
    // own mousedown, which in React 18 also stops the native event at the React root — below
    // document — so a bubble-phase listener here never fired and clicking a chip left the list
    // open on top of the popover it had just opened.
    document.addEventListener('mousedown', onMouseDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onMouseDown, true);
    };
  }, [open, match]);

  if (!open || !match) return null;
  const grouped = match.query === '';
  return createPortal(
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Tokens"
      data-token-popover=""
      // Keeps the editor's focus and selection while an entry is clicked, as the toolbar does.
      onMouseDown={(e) => e.preventDefault()}
      className="menu-surface pop-in fixed w-64 max-h-72 overflow-y-auto py-1"
      style={{ zIndex: 100, left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      {options.map((entry, i) => (
        <Fragment key={entry.label}>
          {grouped && (i === 0 || options[i - 1].group !== entry.group) && (
            <div className="label-micro text-text-tertiary px-3 pt-1.5 pb-0.5">{entry.group}</div>
          )}
          <button
            type="button"
            role="option"
            aria-selected={i === active}
            tabIndex={-1}
            // The highlight is a fill AND brighter text (two channels), never a hue alone.
            className={`menu-item ${i === active ? 'bg-bg-elevated text-text-primary' : 'text-text-secondary'}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => commit(entry, match)}
          >
            <span className="flex-1 truncate">{entry.label}</span>
            <span className="font-mono text-caption text-text-tertiary shrink-0">
              {entry.kind === 'direct' ? entry.insert : `${entry.insert}…}`}
            </span>
          </button>
        </Fragment>
      ))}
      <div className="mt-1 px-3 pt-1 pb-0.5 border-t border-border-subtle text-caption text-text-tertiary">
        Enter inserts · Esc keeps the brace
      </div>
    </div>,
    document.body,
  );
}

// URL matcher for AutoLink — a typed/pasted URL becomes a live link node. The
// pattern requires a dot-separated host, so it can never collide with the token
// grammar (tokens contain no dots).
const URL_MATCHER =
  /((https?:\/\/(www\.)?)|(www\.))[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&//=]*)/;
const AUTO_LINK_MATCHERS = [
  (text: string) => {
    const match = URL_MATCHER.exec(text);
    if (match === null) return null;
    return {
      index: match.index,
      length: match[0].length,
      text: match[0],
      url: match[0].startsWith('http') ? match[0] : `https://${match[0]}`,
    };
  },
];

// Formatting toolbar (rich mode only): B/I/U/S, inline code, bullet/numbered
// list, link. Buttons use onMouseDown preventDefault so clicking them never
// collapses the editor selection they act on. Active states track the selection
// via an update listener. The link flow is a tiny inline URL input — apply on
// Enter, cancel on Esc; '{' is rejected (tokens inside link URLs are unsupported).
// A DELIBERATE link (toolbar / Ctrl+K), not the AutoLinkNode a bare typed URL becomes — the
// eraser and its enabled-state ask the same question, so they share the answer.
function $insideDeliberateLink(node: LexicalNode): boolean {
  return ($isLinkNode(node) && !$isAutoLinkNode(node))
    || node.getParents().some((p) => $isLinkNode(p) && !$isAutoLinkNode(p));
}

// The eraser. Pasted text arrives with bold, inline styles and links, and until now the only way
// out was to select and switch each button off in turn. selection.extract() splits the boundary
// text nodes so only the SELECTED range loses its formatting and hands back exactly the selected
// nodes; format bits and pasted inline styles reset, deliberate links in the range unwrap. Lists
// stay: they are structure, and their own buttons toggle them. A collapsed caret clears what the
// next keystroke would inherit, so "clear, then keep typing" works the way it does in Docs.
function $clearFormatting(): void {
  const sel = $getSelection();
  if (!$isRangeSelection(sel)) return;
  if (sel.isCollapsed()) {
    sel.format = 0;
    sel.style = '';
    if ($insideDeliberateLink(sel.anchor.getNode())) $toggleLink(null);
    return;
  }
  const hadLink = sel.getNodes().some($insideDeliberateLink);
  for (const node of sel.extract()) {
    // Only the LEAVES the selection actually covers. RangeSelection.getNodes() also returns the
    // ELEMENTS it crosses — the first and last paragraph, a ListNode on the way out of a list, a
    // partially covered link — and extract() keeps them; calling getAllTextNodes() on those
    // cleared formatting from text the user never selected, so erasing across a paragraph
    // boundary wiped the bold off the whole of both paragraphs.
    if (!$isTextNode(node)) continue;
    if (node.getFormat() !== 0) node.setFormat(0);
    if (node.getStyle() !== '') node.setStyle('');
  }
  if (hadLink) $toggleLink(null);
}

function RichToolbarPlugin({ formattingDelivered, toolbarExtra }: { formattingDelivered: boolean; toolbarExtra?: React.ReactNode }) {
  const [editor] = useLexicalComposerContext();
  const tt = useTt();
  const [formats, setFormats] = useState({
    bold: false, italic: false, underline: false, strikethrough: false, code: false,
    link: false, ul: false, ol: false,
    // Would the eraser remove anything? Drives its enabled state.
    clearable: false,
  });
  const [linkInputOpen, setLinkInputOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  // The editor loses its DOM selection the moment focus moves into the URL <input>,
  // so snapshot the RangeSelection when the input opens and restore it on apply —
  // otherwise TOGGLE_LINK_COMMAND has nothing to wrap and inserts nothing.
  const savedSelection = useRef<BaseSelection | null>(null);

  const openLinkInput = () => {
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      savedSelection.current = sel ? sel.clone() : null;
    });
    setLinkInputOpen(true);
  };

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const sel = $getSelection();
        if (!$isRangeSelection(sel)) return;
        const anchorNode = sel.anchor.getNode();
        const parents = anchorNode.getParents();
        const listParent = parents.find($isListNode);
        // Collapsed caret: the formats the next keystroke inherits, or a link around it. Range:
        // any text node in it with a format/style bit, or a deliberate link in or above it. A
        // selection-sized walk — the same cost as the B/I/U reads beside it. hasFormat() alone
        // would not do: it answers for the ANCHOR, so a mixed selection whose anchor sits in plain
        // text would show the eraser off with bold two words away.
        const clearable = sel.isCollapsed()
          ? sel.format !== 0 || $insideDeliberateLink(anchorNode)
          : sel.getNodes().some((n) => ($isTextNode(n) && (n.getFormat() !== 0 || n.getStyle() !== '')) || $insideDeliberateLink(n));
        setFormats({
          bold: sel.hasFormat('bold'),
          italic: sel.hasFormat('italic'),
          underline: sel.hasFormat('underline'),
          strikethrough: sel.hasFormat('strikethrough'),
          code: sel.hasFormat('code'),
          link: parents.some($isLinkNode),
          ul: !!listParent && listParent.getListType() === 'bullet',
          ol: !!listParent && listParent.getListType() === 'number',
          clearable,
        });
      });
    });
  }, [editor]);

  // Ctrl+\ — Docs' shortcut for the same eraser. `key`, not `code`: ABNT2 keeps the backslash on
  // IntlBackslash and US on Backslash, and both report '\' as the key. Module-level $clearFormatting
  // so the button and the key share one implementation with no closure to list as a dep.
  useEffect(() => editor.registerCommand(
    KEY_DOWN_COMMAND,
    (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== '\\') return false;
      event.preventDefault();
      editor.update($clearFormatting);
      return true;
    },
    COMMAND_PRIORITY_LOW,
  ), [editor]);

  const applyLink = () => {
    const url = linkUrl.trim();
    if (!url || url.includes('{')) return;   // tokens in URLs are unsupported
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) ? url : `https://${url}`;
    editor.update(() => {
      // Restore the selection the editor had before focus went to the URL input.
      const saved = savedSelection.current;
      if (saved) $setSelection(saved.clone());
      const sel = $getSelection();
      if ($isRangeSelection(sel) && !sel.isCollapsed()) {
        // Text is selected → wrap it in a link (the plain TOGGLE_LINK_COMMAND case).
        $toggleLink(withScheme);
      } else {
        // No selection → insert a NEW link whose visible text is the URL itself, so
        // the button always produces something (the reported "inserts nothing" bug).
        const linkNode = $createLinkNode(withScheme);
        linkNode.append($createTextNode(url));
        if ($isRangeSelection(sel)) sel.insertNodes([linkNode]);
        else $insertNodes([linkNode]);
      }
    });
    savedSelection.current = null;
    setLinkInputOpen(false);
    setLinkUrl('');
    editor.focus();
  };

  // The app's icon button (24 px, 14 px glyph, elevated hover). Active formatting keeps the accent
  // tint — that is "this is ON", not the IconButton's "a menu is open" state.
  const btnClass = (active: boolean) =>
    iconButtonClass('sm', { className: active ? 'text-accent bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] enabled:hover:text-accent' : '' });

  // Icon-only, so each one is NAMED (English, like every name — the tip is the localised text) and
  // says whether its format is ON: the accent tint was that state's only channel.
  const fmtBtn = (fmt: TextFormatType, active: boolean, Icon: typeof Bold, tip: string, name: string) => (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, fmt)}
      aria-label={name}
      aria-pressed={active}
      className={btnClass(active)}
      data-tip={tip}
    >
      <Icon size={14} />
    </button>
  );

  return (
    // flex-wrap is load-bearing now that the row carries a slot on the right. Measured at an
    // 800px window: the buttons plus the delivery control fit with ZERO slack, and opening the
    // link URL input overflowed the row by 249px. Wrapping drops the slot to a second line
    // instead of pushing it out of sight; gap-y keeps the two lines from touching.
    <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 px-1.5 py-1 border-b border-border-subtle shrink-0">
      {/* CHANNEL 1 of 2 — the whole control group dims. The buttons stay ENABLED and fully
          functional: the formatting is still authored, still exported by getHtml(), and comes
          straight back the moment the user leaves Plain. Disabling them would make the dialog
          lie in the other direction. Hover lifts the group so it never reads as dead. */}
      <div className={`flex flex-wrap items-center gap-x-0.5 gap-y-1 min-w-0 transition-opacity ${
        formattingDelivered ? '' : 'opacity-45 hover:opacity-75'
      }`}>
      {fmtBtn('bold', formats.bold, Bold, tt('Bold (Ctrl+B)', 'Negrito (Ctrl+B)'), 'Bold')}
      {fmtBtn('italic', formats.italic, Italic, tt('Italic (Ctrl+I)', 'Itálico (Ctrl+I)'), 'Italic')}
      {fmtBtn('underline', formats.underline, Underline, tt('Underline (Ctrl+U)', 'Sublinhado (Ctrl+U)'), 'Underline')}
      {fmtBtn('strikethrough', formats.strikethrough, Strikethrough, tt('Strikethrough', 'Tachado'), 'Strikethrough')}
      {fmtBtn('code', formats.code, Code, tt('Inline code', 'Código inline'), 'Inline code')}
      {/* The eraser closes the inline-format cluster. Measured before adding it (2026-09-05, the
          rule from 08-31): at the minimum window the group had 133 px of slack with the link input
          closed, so these 24 px keep the row on one line; with the input open the delivery control
          already dropped to a second line and still does. Off → the reason (index.css keeps
          [data-tip][disabled] hoverable); on → the action and its key. */}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.update($clearFormatting)}
        disabled={!formats.clearable}
        aria-label="Clear formatting"
        className={btnClass(false)}
        data-tip={formats.clearable
          ? tt('Clear formatting (Ctrl+\\)', 'Limpar formatação (Ctrl+\\)')
          : tt('Select formatted text to clear it', 'Selecione texto formatado para limpar')}
      >
        <RemoveFormatting size={14} />
      </button>
      <div className="w-px h-4 mx-1 bg-border-default" />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.dispatchCommand(formats.ul ? REMOVE_LIST_COMMAND : INSERT_UNORDERED_LIST_COMMAND, undefined)}
        aria-label="Bullet list"
        aria-pressed={formats.ul}
        className={btnClass(formats.ul)}
        data-tip={tt('Bullet list', 'Lista com marcadores')}
      >
        <List size={14} />
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.dispatchCommand(formats.ol ? REMOVE_LIST_COMMAND : INSERT_ORDERED_LIST_COMMAND, undefined)}
        aria-label="Numbered list"
        aria-pressed={formats.ol}
        className={btnClass(formats.ol)}
        data-tip={tt('Numbered list', 'Lista numerada')}
      >
        <ListOrdered size={14} />
      </button>
      <div className="w-px h-4 mx-1 bg-border-default" />
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (formats.link) {
            editor.dispatchCommand(TOGGLE_LINK_COMMAND, null);   // unlink
          } else if (linkInputOpen) {
            // Cleared like the other two ways out (Esc, the ✕), or the next Link reopened with
            // the URL this attempt abandoned.
            setLinkInputOpen(false);
            setLinkUrl('');
          } else {
            openLinkInput();   // snapshots the selection BEFORE the input steals focus
          }
        }}
        className={btnClass(formats.link || linkInputOpen)}
        aria-label={formats.link ? 'Remove link' : 'Link'}
        aria-expanded={formats.link ? undefined : linkInputOpen}
        data-tip={formats.link ? tt('Remove link', 'Remover link') : tt('Link', 'Inserir link')}
      >
        <Link2 size={14} />
      </button>
      {linkInputOpen && (
        <div className="flex items-center gap-1 ml-1">
          <input
            type="text"
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl+Enter applies the link and goes no further. It is also the host dialog's
              // confirm, which read the document before applyLink's update had committed: the
              // message was saved without the link the same keystroke had just applied.
              if (e.key === 'Enter') { e.preventDefault(); if (e.ctrlKey) e.stopPropagation(); applyLink(); }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLinkInputOpen(false); setLinkUrl(''); editor.focus(); }
            }}
            placeholder="https://…"
            aria-label="Link URL"
            autoFocus
            spellCheck={false}
            className="h-6 w-52 min-w-[7rem] shrink px-1.5 text-caption font-mono bg-bg-input border border-border-default rounded text-text-primary outline-none focus:border-accent-solid"
          />
          <button type="button" onClick={applyLink} aria-label="Apply link" className={btnClass(false)} data-tip={tt('Apply link', 'Aplicar link')}>
            <Check size={14} />
          </button>
          <button
            type="button"
            onClick={() => { setLinkInputOpen(false); setLinkUrl(''); editor.focus(); }}
            aria-label="Cancel link"
            className={btnClass(false)}
            data-tip={tt('Cancel', 'Cancelar')}
          >
            <X size={14} />
          </button>
        </div>
      )}
      </div>

      {/* CHANNEL 2 of 2 — the delivery control itself, sitting right next to the buttons it
          governs. A dim alone is not a signal (the accent-vs-tertiary gap falls under 3:1 in a
          large share of the presets), and this app's locked rule is that an on/off state gets ink
          AND a second channel. That second channel used to be a "Not sent in Plain" pill: a label
          bridging the distance to a control in the FOOTER. With the control here, the lit "Plain"
          segment beside the dimmed buttons is the second channel, and the pill is one less thing
          on screen saying what a control already shows. */}
      {toolbarExtra && <div className="ml-auto shrink-0">{toolbarExtra}</div>}
    </div>
  );
}

// Enter / Space on a selected chip opens its parameter editor — the keyboard equivalent of
// clicking it. Nothing here creates the selection: Lexical already does. TokenNode is inline,
// isolated and isKeyboardSelectable, so arrowing ←/→ onto it makes a NodeSelection on the chip.
// Until now that selection had no visual and no action, which is why the chips read as
// keyboard-inert — the state existed and did nothing. TokenChip paints the selection and
// answers OPEN_TOKEN_CHIP_COMMAND for its own key.
//
// COMMAND_PRIORITY_LOW puts this ahead of @lexical/rich-text's COMMAND_PRIORITY_EDITOR handlers
// (the dispatch loop runs 4 → 0). Both of those bail on a non-RangeSelection anyway, so returning
// true here takes nothing away.
function ChipActivationPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const openSelectedChip = (event: KeyboardEvent | null): boolean => {
      const selection = $getSelection();
      if (!$isNodeSelection(selection)) return false;
      const nodes = selection.getNodes();
      if (nodes.length !== 1 || !$isTokenNode(nodes[0])) return false;
      // Space would otherwise scroll the editor; Enter would fall through to the paragraph split.
      event?.preventDefault();
      editor.dispatchCommand(OPEN_TOKEN_CHIP_COMMAND, nodes[0].getKey());
      return true;
    };
    return mergeRegister(
      editor.registerCommand(KEY_ENTER_COMMAND, openSelectedChip, COMMAND_PRIORITY_LOW),
      editor.registerCommand(KEY_SPACE_COMMAND, openSelectedChip, COMMAND_PRIORITY_LOW),
    );
  }, [editor]);

  return null;
}

// Ctrl+Enter submit forwarded to parent so the same shortcut behaves the same.
//
// A KEY_ENTER_COMMAND handler, not a raw keydown listener on the root. Lexical dispatches that
// command for Ctrl+Enter too (isParagraph takes ctrlKey 'any'), and rich-text's handler checks
// shiftKey, never ctrlKey — while its own keydown listener is attached first (ContentEditable sets
// the root in a layout effect, before this effect ran). So every Ctrl+Enter split the paragraph at
// the caret BEFORE the raw listener submitted: a line the user never typed. At
// COMMAND_PRIORITY_HIGH this runs ahead of that handler (EDITOR) and of the chip activation
// (LOW), and returning true ends the dispatch.
//
// It also STOPS the key. The host's card handler answers Ctrl+Enter too (SendTextDialog confirms
// from anywhere in the card), and this key is on its way up to it: two routes to one confirm. That
// the second found the dialog already gone was a matter of React flushing the close between two
// listeners — true for a key the browser dispatches, false for one dispatched from script, where
// the confirm ran twice and inserted the text twice. One key, one confirm, by construction.
function SubmitPlugin({ onSubmit }: { onSubmit?: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!onSubmit) return;
    return editor.registerCommand(KEY_ENTER_COMMAND, (event: KeyboardEvent | null) => {
      if (!event?.ctrlKey) return false;
      event.preventDefault();
      event.stopPropagation();
      onSubmit();
      return true;
    }, COMMAND_PRIORITY_HIGH);
  }, [editor, onSubmit]);
  return null;
}

/**
 * Two editor densities, declared once. Before this the Insert Text dialog, the sheet's Send Text
 * editor and the component default each wrote their own padding / size / line-height (16-12 /
 * 8-6 / 12-8 px) — three densities for one editor (2026-09-04 sweep). `dialog` is the
 * full-height writing surface; `sheet` is the compact field inside the 340 px panel.
 */
export type EditorDensity = 'dialog' | 'sheet';
const EDITOR_DENSITY: Record<EditorDensity, { content: string; placeholder: string }> = {
  dialog: {
    content: 'w-full h-full px-4 py-3 text-sm leading-[1.6] outline-none whitespace-pre-wrap break-words text-text-primary overflow-auto',
    // `right-*` mirrors the left padding so a placeholder longer than one line wraps inside
    // the writing surface instead of running past its right edge.
    placeholder: 'absolute top-3 left-4 right-4 text-sm text-text-disabled pointer-events-none select-none',
  },
  sheet: {
    content: 'w-full min-h-[3.25rem] px-2 py-1.5 text-ui leading-[1.5] outline-none whitespace-pre-wrap break-words text-text-primary overflow-auto',
    placeholder: 'absolute top-1.5 left-2 right-2 text-ui text-text-disabled pointer-events-none select-none',
  },
};

export function LexicalTokenEditor({
  initialText,
  onChange,
  onSubmit,
  apiRef,
  density = 'dialog',
  contentClassName = EDITOR_DENSITY[density].content,
  placeholderClassName = EDITOR_DENSITY[density].placeholder,
  placeholder: placeholderContent = 'Type the text to send…',
  ariaLabel = 'Text to send',
  tokenAutocomplete = false,
  tokenScope = 'desktop',
  onClipboardChipEdit,
  onFormattingChange,
  richMode = false,
  formattingDelivered = true,
  toolbarExtra,
  initialHtml = null,
}: LexicalTokenEditorProps) {
  const initialConfig = {
    namespace: 'SendText',
    // List/link nodes register only in rich mode, so the plain surfaces
    // (SheetPanel browserText) can never acquire rich content by accident.
    // ⚠ SECURITY LOCKSTEP: this node set + the `theme` below define exactly the markup getHtml()
    // can emit, and Source/HtmlSanitizer.cs whitelists precisely that set. Add a node here
    // (HeadingNode/QuoteNode/ImageNode/a new mark) and its output is SILENTLY STRIPPED at paste
    // until you add the matching element/attr to HtmlSanitizer — update both together.
    nodes: richMode ? [TokenNode, ListNode, ListItemNode, LinkNode, AutoLinkNode] : [TokenNode],
    onError: (error: Error) => {
      console.error('[Lexical]', error);
    },
    theme: {
      paragraph: 'm-0',
      // Formatting renders through theme tokens (never hardcoded hex — 48 themes).
      text: {
        bold: 'font-semibold',
        italic: 'italic',
        underline: 'underline',
        strikethrough: 'line-through',
        underlineStrikethrough: '[text-decoration:underline_line-through]',
        code: 'font-mono text-[0.9em] bg-bg-input border border-border-subtle rounded px-1',
      },
      list: {
        ul: 'list-disc ml-5',
        ol: 'list-decimal ml-5',
        listitem: 'my-0.5',
      },
      link: 'text-accent underline',
    },
  };

  // Shared shape between the plain and rich root plugins.
  const contentEditable = (
    <ContentEditable
      className={contentClassName}
      aria-label={ariaLabel}
      spellCheck={false}
    />
  );
  const placeholder = (
    <div className={placeholderClassName}>
      {placeholderContent}
    </div>
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {/* Context flows through Lexical's decorator portals, so TokenChip sees it. */}
      <ClipboardChipEditContext.Provider value={onClipboardChipEdit ?? null}>
      <div className={richMode ? 'w-full h-full flex flex-col' : 'relative w-full h-full'}>
        {richMode && <RichToolbarPlugin formattingDelivered={formattingDelivered} toolbarExtra={toolbarExtra} />}
        <div className="relative flex-1 min-h-0">
          {richMode ? (
            <RichTextPlugin
              contentEditable={contentEditable}
              placeholder={placeholder}
              ErrorBoundary={LexicalErrorBoundary}
            />
          ) : (
            <PlainTextPlugin
              contentEditable={contentEditable}
              placeholder={placeholder}
              ErrorBoundary={LexicalErrorBoundary}
            />
          )}
        </div>
        <HistoryPlugin />
        {richMode && <ListPlugin />}
        {richMode && <LinkPlugin />}
        {richMode && <AutoLinkPlugin matchers={AUTO_LINK_MATCHERS} />}
        {tokenAutocomplete && <TokenAutocompletePlugin scope={tokenScope} />}
        <OnChangePlugin
          // ignoreSelectionChange: without it (the default is false) this fires on every
          // selection-only change too — arrow keys, clicks, focus — and each fire walks the whole
          // document through the serializer and then re-renders the parent panel. Both consumers
          // want text and never selection, so skipping those is exactly behaviour-preserving.
          ignoreSelectionChange
          onChange={(state) => {
            state.read(() => {
              // Rich mode uses the single-newline block serializer (see
              // $serializePlainForSend); plain mode stays byte-identical to 2.8.0.
              onChange(richMode ? $serializePlainForSend() : $getRoot().getTextContent());
              // Same read, one more walk: $hasDeliberateFormatting is a $dfs().some() with an
              // early exit on the first formatted node, against a $serializePlainForSend that
              // already walks the whole tree on this very tick. What is NOT added here is
              // $generateHtmlFromNodes — the HTML export stays on demand (getHtml, above).
              // A format-only toggle still reaches us: OnChangePlugin fires whenever
              // dirtyElements/dirtyLeaves is non-empty, and toggling bold dirties the TextNode.
              if (richMode && onFormattingChange) onFormattingChange($hasDeliberateFormatting());
            });
          }}
        />
        <InitialContentPlugin initialText={initialText} initialHtml={richMode ? initialHtml : null} scope={tokenScope} />
        <ImperativeAPIPlugin apiRef={apiRef} richMode={richMode} scope={tokenScope} />
        <TokenPastePlugin richMode={richMode} scope={tokenScope} />
        <TokenAutoTransformPlugin scope={tokenScope} />
        <ChipKeyboardPlugin />
        <ChipActivationPlugin />
        <SubmitPlugin onSubmit={onSubmit} />
      </div>
      </ClipboardChipEditContext.Provider>
    </LexicalComposer>
  );
}
