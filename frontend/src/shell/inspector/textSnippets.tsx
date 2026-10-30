import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MutableRefObject } from 'react';
import type { LexicalEditorHandle } from '../../components/lexical/LexicalTokenEditor';
import {
  buildSnippetExport, mergeSnippets, newSnippetId, parseSnippetImport, snippetExportFilename, type Snippet,
} from '../../components/lexical/snippetTransfer';
import { normalizeToken, splitTokenSegments } from '../../components/lexical/tokenNormalize';
import { useEditorTools } from '../../logic/useEditorTools';
import { useTt } from '../../state/LanguageContext';
import { useAsk } from './probes';

// The library of today, in the same place (send-text-106): the snippets survive the swap. A
// snippet's `html` is its rich flavour, when the text had formatting: it goes back in formatted.
const SNIPPETS_KEY = 'trueplayer_snippets';

function loadSnippets(): Snippet[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SNIPPETS_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveSnippets(list: Snippet[]) {
  try { localStorage.setItem(SNIPPETS_KEY, JSON.stringify(list)); } catch { /* storage full or off: the list lasts the session */ }
}
const matches = (s: Snippet, query: string) => {
  const q = query.trim().toLowerCase();
  return !q || s.name.toLowerCase().includes(q) || s.text.toLowerCase().includes(q);
};

const IMPORT_ERRORS = {
  'not-json': 'That file is not valid JSON',
  'not-a-snippet-file': 'That is not a snippets file',
  'unsupported-version': 'That file is from a newer version',
  'no-snippets': 'No usable snippets in that file',
} as const;

/**
 * Insert › Snippets: texts kept to use again, in this machine's library (the same as today's). A
 * press on one puts it at the caret, formatted when it was saved formatted; Save as snippet keeps
 * the message as it stands. Each row edits and deletes in place (the delete asks on the row
 * itself, and has no undo); the list exports to a file and imports one, adding to it, never
 * replacing it. Esc closes the form on top.
 */
export function SnippetsTab({ api, hasText, locked }: {
  api: MutableRefObject<LexicalEditorHandle | null>;
  hasText: boolean;
  locked: boolean;
}) {
  const tt = useTt();
  const [snippets, setSnippets] = useState<Snippet[]>(loadSnippets);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const needsText = hasText ? undefined : tt('Type something first', 'Digite algo primeiro');

  const store = (next: Snippet[]) => { setSnippets(next); saveSnippets(next); };
  // A form or the delete's question that closes gives the keyboard back to the message, with its
  // caret where it was (the editor's own focus), as today's dialog did: the focus would drop to the
  // page, and the next Esc would not reach the Inspector.
  const back = () => api.current?.focus();
  const closeSaving = () => { setSaving(false); back(); };
  const closeEditing = () => { setEditing(null); back(); };
  const closeDeleting = () => { setDeleting(null); back(); };
  const save = () => {
    const n = name.trim();
    const text = api.current?.getText() ?? '';
    // The text is kept as typed: the trim only decides whether there is one.
    if (!n || !text.trim()) return;
    const html = api.current?.getHtml() ?? undefined;
    store([...snippets, { id: newSnippetId(), name: n, text, ...(html ? { html } : {}) }]);
    setName('');
    closeSaving();
  };
  const update = (id: string, nextName: string, nextText: string) => {
    const n = nextName.trim();
    if (!n || !nextText.trim()) return;
    // A new text drops the formatting it no longer matches; a new name alone keeps it.
    store(snippets.map(s => (s.id !== id ? s : nextText === s.text ? { ...s, name: n } : { id: s.id, name: n, text: nextText })));
    closeEditing();
  };
  const remove = (id: string) => {
    store(snippets.filter(s => s.id !== id));
    if (editing === id) setEditing(null);
    closeDeleting();
  };
  const insert = (s: Snippet) => {
    if (s.html) api.current?.insertHtml(s.html);
    else api.current?.insertText(s.text);
  };
  // Export goes through the system's Save dialog: a download from the page went to Downloads
  // without asking where. The count is said once the file is written; a cancel says nothing.
  const tools = useEditorTools();
  const exported = useRef(0);
  const exporting = useAsk('dialog:saveFileResult', (r) => {
    if (r.error) setNote('Could not save the file');
    else if (r.path) setNote(`Saved ${exported.current} snippet${exported.current === 1 ? '' : 's'}`);
  });
  const exportAll = () => {
    if (snippets.length === 0) return;
    exported.current = snippets.length;
    const text = JSON.stringify(buildSnippetExport(snippets), null, 2);
    exporting.ask(requestId => tools.saveFile({ requestId, name: snippetExportFilename(new Date()), text, title: 'Export snippets' }));
  };
  const importFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared at once, so picking the same file again still counts.
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setNote('Could not read that file');
    reader.onload = () => {
      const result = parseSnippetImport(String(reader.result ?? ''));
      if (!result.ok) { setNote(IMPORT_ERRORS[result.reason]); return; }
      // Onto the list as it is now, not as it was when the file was asked for. Saving twice (a
      // development re-run of the updater) writes the same list twice.
      setSnippets(prev => {
        const merged = mergeSnippets(prev, result.snippets);
        saveSnippets(merged);
        return merged;
      });
      const n = result.snippets.length;
      setNote(result.skipped > 0 ? `Added ${n}, skipped ${result.skipped} incomplete` : `Added ${n} snippet${n === 1 ? '' : 's'}`);
    };
    reader.readAsText(file);
  };

  const shown = snippets.filter(s => matches(s, filter));
  // A search that hides the row being edited or asked about closes that, so no form is left open
  // where it cannot be seen (its Esc would answer for nothing on screen).
  const onFilter = (next: string) => {
    setFilter(next);
    const hidden = (id: string | null) => id !== null && !snippets.some(s => s.id === id && matches(s, next));
    if (hidden(deleting)) setDeleting(null);
    if (hidden(editing)) setEditing(null);
  };
  const escTo = (close: () => void) => (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };

  return (
    <div className="stx-snippets">
      <div className="stx-snippets-bar">
        {snippets.length > 0 ? (
          <input
            className="stx-search"
            type="search"
            aria-label="Search snippets"
            placeholder="Search snippets…"
            value={filter}
            spellCheck={false}
            onChange={(e) => onFilter(e.target.value)}
          />
        ) : <span className="stx-snippets-title">Snippets</span>}
        <button type="button" className="insp-icon-button" aria-label="Export snippets" data-tip={tt('Export snippets', 'Exportar snippets')} disabled={snippets.length === 0 || exporting.waiting} onClick={exportAll}>
          <span className="step-icon" data-icon="download" />
        </button>
        <button type="button" className="insp-icon-button" aria-label="Import snippets" data-tip={tt('Import snippets (added to yours)', 'Importar snippets (somados aos seus)')} onClick={() => fileRef.current?.click()}>
          <span className="step-icon" data-icon="upload" />
        </button>
        <button type="button" className="insp-icon-button" aria-label="Save as snippet" data-tip={needsText ?? tt('Save as snippet', 'Salvar como snippet')} disabled={!hasText} onClick={() => setSaving(true)}>
          <span className="step-icon" data-icon="bookmark-plus" />
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={importFile} />
      </div>
      {/* The last export's or import's outcome, in a line kept for it, so it never pushes the list. */}
      <span className="stx-note" role="status">{note}</span>
      {saving && (
        <div className="stx-form">
          <input
            className="stx-input"
            type="text"
            aria-label="Snippet name"
            placeholder="Snippet name…"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              // Ctrl+Enter is the Inspector's (back to the list); Enter alone saves.
              if (e.key === 'Enter' && !e.ctrlKey) { e.preventDefault(); save(); return; }
              escTo(closeSaving)(e);
            }}
          />
          <div className="stx-form-actions">
            <button type="button" className="insp-button" onClick={closeSaving}>Cancel</button>
            <button type="button" className="insp-primary" disabled={!name.trim() || !hasText} onClick={save}>Save snippet</button>
          </div>
        </div>
      )}
      <div className="stx-snippet-list">
        {snippets.length === 0 ? (
          <div className="stx-empty">
            <span>No saved snippets yet</span>
            <button type="button" className="insp-button" disabled={!hasText} data-tip={needsText} onClick={() => setSaving(true)}>
              <span className="step-icon" data-icon="bookmark-plus" />
              Save current text as a snippet
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="stx-empty">No snippets match “{filter}”</div>
        ) : shown.map(s => editing === s.id ? (
          <SnippetForm key={s.id} snippet={s} onSave={(n, t) => update(s.id, n, t)} onCancel={closeEditing} />
        ) : (
          <div key={s.id} className="stx-snippet" data-deleting={deleting === s.id || undefined}>
            <button type="button" className="stx-snippet-insert" disabled={locked || deleting === s.id} data-tip={s.text} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(s)}>
              <span className="stx-snippet-name">{s.name}</span>
              <span className="stx-snippet-text"><SnippetText text={s.text} /></span>
            </button>
            {deleting === s.id ? (
              <span className="stx-snippet-ask" onKeyDown={escTo(closeDeleting)}>
                <span>Delete snippet?</span>
                <button type="button" className="insp-icon-button" data-danger="" aria-label="Delete snippet" data-tip={tt('Delete', 'Excluir')} autoFocus onClick={() => remove(s.id)}>
                  <span className="step-icon" data-icon="check" />
                </button>
                <button type="button" className="insp-icon-button" aria-label="Cancel" data-tip={tt('Cancel (Esc)', 'Cancelar (Esc)')} onClick={closeDeleting}>
                  <span className="step-icon" data-icon="x" />
                </button>
              </span>
            ) : (
              <span className="stx-snippet-tools">
                <button type="button" className="insp-icon-button" aria-label="Edit snippet" data-tip={tt('Edit snippet', 'Editar snippet')} onClick={() => setEditing(s.id)}>
                  <span className="step-icon" data-icon="pencil" />
                </button>
                <button type="button" className="insp-icon-button" aria-label="Delete snippet" data-tip={tt('Delete snippet', 'Excluir snippet')} onClick={() => setDeleting(s.id)}>
                  <span className="step-icon" data-icon="trash-2" />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A snippet's text in its row: the tokens as quiet chips (nothing in a row is live), two lines. */
function SnippetText({ text }: { text: string }) {
  return (
    <>
      {splitTokenSegments(text).map((seg, i) => (seg.kind === 'token'
        ? <span key={i} className="stx-snippet-token">{normalizeToken(seg.value).slice(1, -1)}</span>
        : <span key={i}>{seg.value}</span>))}
    </>
  );
}

/** A snippet edited in its row: the name and the text. Esc cancels. */
function SnippetForm({ snippet, onSave, onCancel }: { snippet: Snippet; onSave: (name: string, text: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(snippet.name);
  const [text, setText] = useState(snippet.text);
  const ok = name.trim() !== '' && text.trim() !== '';
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { nameRef.current?.focus(); }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    onCancel();
  };
  return (
    <div className="stx-form" data-edit="" onKeyDown={onKeyDown}>
      <span className="stx-form-title">Edit snippet</span>
      <input ref={nameRef} className="stx-input" type="text" aria-label="Snippet name" placeholder="Snippet name…" value={name} onChange={(e) => setName(e.target.value)} />
      <textarea className="stx-input" aria-label="Snippet text" placeholder="Snippet text…" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="stx-form-actions">
        <button type="button" className="insp-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="insp-primary" disabled={!ok} onClick={() => { if (ok) onSave(name, text); }}>Save snippet</button>
      </div>
    </div>
  );
}
