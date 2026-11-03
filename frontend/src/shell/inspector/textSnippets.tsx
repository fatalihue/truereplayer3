import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MutableRefObject } from 'react';
import type { LexicalEditorHandle } from '../../components/lexical/LexicalTokenEditor';
import {
  buildSnippetExport, mergeSnippets, newSnippetId, parseSnippetImport, snippetExportFilename, type ImportFailure, type Snippet,
} from '../../components/lexical/snippetTransfer';
import { normalizeToken, splitTokenSegments } from '../../components/lexical/tokenNormalize';
import { fmtNum, t } from '../../i18n';
import { useEditorTools } from '../../logic/useEditorTools';
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

const IMPORT_ERRORS: Record<ImportFailure, string> = {
  'not-json': t('sendText.snippets.notJson'),
  'not-a-snippet-file': t('sendText.snippets.notSnippets'),
  'unsupported-version': t('sendText.snippets.newerVersion'),
  'no-snippets': t('sendText.snippets.noSnippets'),
};

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
  const [snippets, setSnippets] = useState<Snippet[]>(loadSnippets);
  const [filter, setFilter] = useState('');
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const needsText = hasText ? undefined : t('sendText.snippets.needsText');

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
    if (r.error) setNote(t('sendText.snippets.saveFailed'));
    else if (r.path) setNote(t('sendText.snippets.saved', { count: exported.current, n: fmtNum(exported.current) }));
  });
  const exportAll = () => {
    if (snippets.length === 0) return;
    exported.current = snippets.length;
    const text = JSON.stringify(buildSnippetExport(snippets), null, 2);
    exporting.ask(requestId => tools.saveFile({ requestId, name: snippetExportFilename(new Date()), text, title: t('sendText.snippets.export') }));
  };
  const importFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Cleared at once, so picking the same file again still counts.
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => setNote(t('sendText.snippets.readFailed'));
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
      setNote(result.skipped > 0
        ? t('sendText.snippets.addedSkipped', { n: fmtNum(n), skipped: fmtNum(result.skipped) })
        : t('sendText.snippets.added', { count: n, n: fmtNum(n) }));
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
            aria-label={t('sendText.snippets.search')}
            placeholder={t('sendText.snippets.searchHint')}
            value={filter}
            spellCheck={false}
            onChange={(e) => onFilter(e.target.value)}
          />
        ) : <span className="stx-snippets-title">{t('sendText.snippets.title')}</span>}
        <button type="button" className="insp-icon-button" aria-label={t('sendText.snippets.export')} data-tip={t('sendText.snippets.export')} disabled={snippets.length === 0 || exporting.waiting} onClick={exportAll}>
          <span className="step-icon" data-icon="download" />
        </button>
        <button type="button" className="insp-icon-button" aria-label={t('sendText.snippets.import')} data-tip={t('sendText.snippets.importTip')} onClick={() => fileRef.current?.click()}>
          <span className="step-icon" data-icon="upload" />
        </button>
        <button type="button" className="insp-icon-button" aria-label={t('sendText.snippets.saveAs')} data-tip={needsText ?? t('sendText.snippets.saveAs')} disabled={!hasText} onClick={() => setSaving(true)}>
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
            aria-label={t('sendText.snippets.name')}
            placeholder={t('sendText.snippets.nameHint')}
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
            <button type="button" className="insp-button" onClick={closeSaving}>{t('common.actions.cancel')}</button>
            <button type="button" className="insp-primary" disabled={!name.trim() || !hasText} onClick={save}>{t('sendText.snippets.save')}</button>
          </div>
        </div>
      )}
      <div className="stx-snippet-list">
        {snippets.length === 0 ? (
          <div className="stx-empty">
            <span>{t('sendText.snippets.none')}</span>
            <button type="button" className="insp-button" disabled={!hasText} data-tip={needsText} onClick={() => setSaving(true)}>
              <span className="step-icon" data-icon="bookmark-plus" />
              {t('sendText.snippets.saveCurrent')}
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="stx-empty">{t('sendText.snippets.noMatch', { query: filter })}</div>
        ) : shown.map(s => editing === s.id ? (
          <SnippetForm key={s.id} snippet={s} onSave={(nextName, nextText) => update(s.id, nextName, nextText)} onCancel={closeEditing} />
        ) : (
          <div key={s.id} className="stx-snippet" data-deleting={deleting === s.id || undefined}>
            <button type="button" className="stx-snippet-insert" disabled={locked || deleting === s.id} data-tip={s.text} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(s)}>
              <span className="stx-snippet-name">{s.name}</span>
              <span className="stx-snippet-text"><SnippetText text={s.text} /></span>
            </button>
            {deleting === s.id ? (
              <span className="stx-snippet-ask" onKeyDown={escTo(closeDeleting)}>
                <span>{t('sendText.snippets.confirmDelete')}</span>
                <button type="button" className="insp-icon-button" data-danger="" aria-label={t('sendText.snippets.delete')} data-tip={t('common.actions.delete')} autoFocus onClick={() => remove(s.id)}>
                  <span className="step-icon" data-icon="check" />
                </button>
                <button type="button" className="insp-icon-button" aria-label={t('common.actions.cancel')} data-tip={t('sendText.snippets.cancelTip')} onClick={closeDeleting}>
                  <span className="step-icon" data-icon="x" />
                </button>
              </span>
            ) : (
              <span className="stx-snippet-tools">
                <button type="button" className="insp-icon-button" aria-label={t('sendText.snippets.edit')} data-tip={t('sendText.snippets.edit')} onClick={() => setEditing(s.id)}>
                  <span className="step-icon" data-icon="pencil" />
                </button>
                <button type="button" className="insp-icon-button" aria-label={t('sendText.snippets.delete')} data-tip={t('sendText.snippets.delete')} onClick={() => setDeleting(s.id)}>
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
      <span className="stx-form-title">{t('sendText.snippets.edit')}</span>
      <input ref={nameRef} className="stx-input" type="text" aria-label={t('sendText.snippets.name')} placeholder={t('sendText.snippets.nameHint')} value={name} onChange={(e) => setName(e.target.value)} />
      <textarea className="stx-input" aria-label={t('sendText.snippets.text')} placeholder={t('sendText.snippets.textHint')} rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="stx-form-actions">
        <button type="button" className="insp-button" onClick={onCancel}>{t('common.actions.cancel')}</button>
        <button type="button" className="insp-primary" disabled={!ok} onClick={() => { if (ok) onSave(name, text); }}>{t('sendText.snippets.save')}</button>
      </div>
    </div>
  );
}
