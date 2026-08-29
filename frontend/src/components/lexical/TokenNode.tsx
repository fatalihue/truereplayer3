import { createElement, type ReactNode } from 'react';
import {
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { TokenChip } from './TokenChip';
import { normalizeToken } from './tokenNormalize';

type SerializedTokenNode = Spread<
  { token: string; verbatim?: boolean; type: 'token'; version: 1 },
  SerializedLexicalNode
>;

// Inline chip representation of a {variable[:mods]} token. The node serializes
// back to its raw text via getTextContent — that's how Lexical reconstructs the
// plain string the rest of the app stores.
export class TokenNode extends DecoratorNode<ReactNode> {
  __token: string;

  // VERBATIM: keep the token's bytes exactly as handed in, skipping normalizeToken.
  //
  // Set only by the LOAD path (LexicalTokenEditor.buildNodesFromText) for a token whose canonical
  // form would REWRITE it. Every token whose argument holds a space or a colon reaches the editor
  // with a lower-case head ({clipboard:after: - }, {row:First Name}) because that is what the
  // builders and the docs emit, and title-casing the head is a payload edit the user never made.
  // Two things that costs: an untouched action opens DIRTY (OnChangePlugin writes the editor's
  // serialisation straight back), and for a token the engine cannot resolve — {row:First Name},
  // {var:Ação}, whose regexes demand [A-Za-z0-9_] — the macro types the token out verbatim, so the
  // rewrite changes what it types.
  //
  // Preserving the bytes is what lets the load path chip those at all. The alternative that
  // shipped was to leave them as raw TEXT, which made the editor the only surface that forgot a
  // token was a token: the grid preview (SendTextPreview) and the engine both still read it as one.
  //
  // It must survive clone(), the JSON round-trip and the DOM round-trip, or the first edit anywhere
  // in the document re-normalises the node and the rewrite lands after all — Lexical re-runs
  // clone() on every mutation.
  __verbatim: boolean;

  constructor(token: string, key?: NodeKey, verbatim = false) {
    super(key);
    this.__verbatim = verbatim;
    this.__token = verbatim ? token : normalizeToken(token);
  }

  static getType(): string {
    return 'token';
  }

  static clone(node: TokenNode): TokenNode {
    return new TokenNode(node.__token, node.__key, node.__verbatim);
  }

  static importJSON(json: SerializedTokenNode): TokenNode {
    return new TokenNode(json.token, undefined, json.verbatim === true);
  }

  // The field is written only when set, so an ordinary chip serialises byte-identically to what it
  // did before the flag existed, and an older state that carries no field at all reads as false.
  exportJSON(): SerializedTokenNode {
    return this.__verbatim
      ? { type: 'token', version: 1, token: this.__token, verbatim: true }
      : { type: 'token', version: 1, token: this.__token };
  }

  // Mutates the node's token in place. Must be called inside editor.update().
  // Always a USER edit (the popover writing back a rebuilt token), so it drops verbatim: the
  // payload is being rewritten on purpose here, and the canonical form is the one to store.
  setToken(token: string): void {
    const writable = this.getWritable();
    writable.__token = normalizeToken(token);
    writable.__verbatim = false;
  }

  createDOM(): HTMLElement {
    const span = document.createElement('span');
    span.style.display = 'inline-block';
    span.style.verticalAlign = 'middle';
    return span;
  }

  // HTML round-trip for the rich-text payload (KeyHtml). Export: the raw token as
  // TEXT wrapped in a marker span — a paste target that renders the HTML shows the
  // literal "{var:name}" (the backend resolves tokens in the HTML flavor at send
  // time, so what actually pastes is the resolved value). Import: the marker span
  // re-chips when the dialog rebuilds the rich doc from a saved KeyHtml.
  exportDOM(): DOMExportOutput {
    const span = document.createElement('span');
    span.setAttribute('data-token', this.__token);
    if (this.__verbatim) span.setAttribute('data-token-verbatim', '1');
    span.textContent = this.__token;
    return { element: span };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute('data-token')) return null;
        return {
          conversion: (el: HTMLElement): DOMConversionOutput => ({
            // The marker attribute rides along so a rich (KeyHtml) payload rebuilds the same node
            // it exported. Without it the rich round-trip would be the one path that still
            // re-normalises a preserved token — exactly the rewrite the flag exists to stop.
            node: $createTokenNode(el.getAttribute('data-token') || '', el.hasAttribute('data-token-verbatim')),
          }),
          priority: 2,
        };
      },
    };
  }

  updateDOM(): boolean {
    return false;
  }

  // The raw `{...}` text — used by Lexical's $getRoot().getTextContent()
  // serializer so the parent component sees the same string format as today.
  getTextContent(): string {
    return this.__token;
  }

  isInline(): boolean {
    return true;
  }

  // isIsolated => caret cannot enter the chip; backspace deletes the whole node.
  isIsolated(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  decorate(): ReactNode {
    // createElement (rather than JSX) keeps this file free of TSX syntax so the
    // react-refresh rule doesn't flag the class export as a component leak.
    return createElement(TokenChip, { nodeKey: this.__key, token: this.__token });
  }
}

export function $createTokenNode(token: string, verbatim = false): TokenNode {
  return new TokenNode(token, undefined, verbatim);
}

export function $isTokenNode(node: LexicalNode | null | undefined): node is TokenNode {
  return node instanceof TokenNode;
}
