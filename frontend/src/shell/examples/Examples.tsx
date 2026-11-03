import { useEffect, useRef, useState } from 'react';
import { BookOpen, Search, X } from 'lucide-react';
import { useBridge } from '../../bridge/BridgeContext';
import type { ExampleInfo } from '../../bridge/messageTypes';
import { Button } from '../../components/common/Button';
import { DialogShell } from '../../components/common/DialogShell';
import { t } from '../../i18n';
import { useExamples } from '../../logic/useExamples';
import { useMacro } from '../../logic/useMacro';
import { useToast } from '../../state/ToastContext';
import { useApp } from '../store';
import { setLibraryPeek, useUi } from '../ui';
import './examples.css';

// The examples' second tag says what they teach; the package is the manual's, in Portuguese (the
// examples stay in Portuguese in both languages: only the gallery around them is translated).
const GROUPS: { tag: string; title: string }[] = [
  { tag: 'tokens', title: t('examples.groups.tokens') },
  { tag: 'variáveis', title: t('examples.groups.variables') },
  { tag: 'condicionais', title: t('examples.groups.conditions') },
  { tag: 'completo', title: t('examples.groups.together') },
];

// Accents and case aside, as the library's own search.
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * The 19 examples inside the app (decision 4), from the first use, New ▾ › From an example…, Ctrl+K
 * and a search that found nothing. Read-only: "Use this example" copies one — with the examples it
 * runs, as 18 runs 18b — into the library's Examples folder and opens it; nothing comes in on its
 * own. One the library already has opens instead. Each one types into Notepad, so a run can be
 * watched.
 */
export default function Examples() {
  const initial = useUi(s => s.examples) ?? '';
  const [query, setQuery] = useState(initial);
  const [copying, setCopying] = useState<string | null>(null);
  // The example being copied, for the engine's answer to be matched against.
  const asked = useRef<string | null>(null);
  const busy = useApp(a => a.status !== 'ready');
  const { examples, use } = useExamples(true);
  const { subscribe } = useBridge();
  const macro = useMacro();
  const { showToast } = useToast();
  const close = () => useUi.setState({ examples: null });

  // The copy's answer: open the example where it landed, or say why it did not.
  useEffect(() => subscribe((m) => {
    if (m.type !== 'examples:useResult' || m.payload.requested !== asked.current) return;
    asked.current = null;
    setCopying(null);
    const r = m.payload;
    if (r.ok && r.name) {
      macro.open(r.name);
      setLibraryPeek(false);
      useUi.setState({ examples: null });
      showToast(t('examples.copied', { name: r.name }), 'success');
    } else {
      showToast(r.error ?? t('examples.copyFailed'), 'error');
    }
  }), [subscribe, macro, showToast]);

  const words = fold(query).split(/\s+/).filter(Boolean);
  const matches = (e: ExampleInfo) => {
    const text = fold(`${e.name} ${e.description ?? ''} ${e.tags.join(' ')}`);
    return words.every(w => text.includes(w));
  };
  const shown = (examples ?? []).filter(matches);
  const runBy = new Map<string, string>();
  for (const e of examples ?? []) for (const r of e.runs) runBy.set(r, e.name);
  const groups = GROUPS.map(g => ({ ...g, items: shown.filter(e => e.tags.includes(g.tag)) }));
  const other = shown.filter(e => !GROUPS.some(g => e.tags.includes(g.tag)));
  if (other.length > 0) groups.push({ tag: '', title: t('examples.groups.more'), items: other });

  const row = (e: ExampleInfo) => (
    <li key={e.name} className="ex-row">
      <span className="ex-icon" aria-hidden="true">{e.iconEmoji || '📄'}</span>
      <span className="ex-text">
        <span className="ex-head">
          <span className="ex-name" lang="pt-BR">{e.name}</span>
          <span className="ex-meta">{t('examples.steps', { count: e.actionCount })}</span>
        </span>
        {e.description && <span className="ex-desc" lang="pt-BR">{e.description}</span>}
        {e.runs.length > 0 && <span className="ex-note">{t('examples.runs', { names: e.runs.join(', ') })}</span>}
        {runBy.has(e.name) && <span className="ex-note">{t('examples.runBy', { name: runBy.get(e.name) ?? '' })}</span>}
      </span>
      {e.inLibrary ? (
        <span className="ex-action">
          <span className="ex-have">{t('examples.inLibrary')}</span>
          <Button variant="secondary" size="sm" onClick={() => { macro.open(e.name); setLibraryPeek(false); close(); }}>{t('common.actions.open')}</Button>
        </span>
      ) : (
        <Button
          variant="secondary"
          size="sm"
          className="ex-action"
          disabled={busy || copying !== null}
          data-tip={busy ? t('shell.busy') : undefined}
          aria-label={t('examples.useName', { name: e.name })}
          onClick={() => { asked.current = e.name; setCopying(e.name); use(e.name); }}
        >
          {copying === e.name ? t('examples.copying') : t('examples.use')}
        </Button>
      )}
    </li>
  );

  return (
    <DialogShell
      icon={<BookOpen size={14} style={{ color: 'var(--color-accent)' }} />}
      title={t('examples.title')}
      size="xl"
      zClass="z-(--z-dialog-raised)"
      cardClassName="max-h-[calc(90vh/var(--ui-zoom))]"
      onClose={close}
      footerHint={examples ? t('examples.count', { count: examples.length }) : null}
      footer={<Button variant="secondary" size="md" className="min-w-[5.25rem]" onClick={close}>{t('common.actions.close')}</Button>}
    >
      <div className="px-4 pt-3 flex flex-col gap-2">
        <p className="text-minor text-text-secondary">{t('examples.intro')}</p>
        <div className="relative w-full">
          <Search size={13} aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('examples.search')}
            aria-label={t('examples.search')}
            className="input-field font-sans text-minor pl-7 pr-7"
          />
          {query && (
            <button type="button" aria-label={t('common.actions.clearSearch')} onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 flex text-text-disabled hover:text-text-secondary">
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="ex-list flex-1 overflow-y-auto px-4 py-2 min-h-[12rem]" aria-busy={!examples || undefined}>
        {examples && shown.length === 0 && (
          <div className="py-6 flex flex-col items-center gap-2 text-minor text-text-tertiary">
            <span>{t('examples.noMatch', { query: query.trim() })}</span>
            <Button variant="ghost" onClick={() => setQuery('')}>{t('common.actions.clearSearch')}</Button>
          </div>
        )}
        {groups.filter(g => g.items.length > 0).map(g => (
          <section key={g.title} aria-label={g.title} className="ex-group">
            <h3 className="ex-group-title">{g.title}</h3>
            <ul className="ex-items">{g.items.map(row)}</ul>
          </section>
        ))}
      </div>
    </DialogShell>
  );
}
