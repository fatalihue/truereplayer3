import { useId, useState, type KeyboardEvent } from 'react';
import { Hash, X } from 'lucide-react';
import { fmtNum, t } from '../../../i18n';
import { useShell } from '../../store';
import { checkTag, MAX_SUGGESTIONS, MAX_TAGS, normalizeTag, parseTagsKey, TAG_MESSAGE, tagsInUseKey, TOP_TAGS, type TagReject } from './tags';

/**
 * Info › tags (biblioteca-147 to 154): the macro's #tags, which the library's #tag search finds.
 * Each tag applies when it is added (Enter, or leaving the field) or removed. The field folds what
 * is typed into the tag grammar and says why a tag cannot go; ↑ ↓ walk the suggestions, Enter,
 * comma and Tab add the one lit (or what is typed), Backspace on an empty field takes the last tag,
 * and Esc closes the suggestions. The most used tags of the other macros are a click away.
 */
export function TagEditor({ tags, onChange, disabled }: { tags: string[]; onChange: (tags: string[]) => void; disabled?: boolean }) {
  // The tags in use across the library, counted once per list of macros (a string: no new render
  // when a switch brings the library again with the same tags).
  const inUseKey = useShell(s => tagsInUseKey(s.app.profiles));
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<TagReject | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const listId = `${id}-tags`;
  const optionId = (i: number) => `${id}-tag-${i}`;

  const inUse = parseTagsKey(inUseKey).filter(u => !tags.includes(u.tag));
  const typed = normalizeTag(draft);
  const suggestions = inUse.filter(u => typed === '' || u.tag.includes(typed)).slice(0, MAX_SUGGESTIONS);
  const top = inUse.slice(0, TOP_TAGS);
  const listOpen = open && suggestions.length > 0;
  const full = tags.length >= MAX_TAGS;

  const add = (raw: string) => {
    const r = checkTag(raw, tags);
    if ('reject' in r) { setError(r.reject); return; }
    onChange([...tags, r.tag]);
    setDraft('');
    setError(null);
    setActive(-1);
  };
  const remove = (tag: string) => {
    onChange(tags.filter(other => other !== tag));
    setError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && listOpen) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      // With none lit, ↓ lights the first and ↑ the last (biblioteca-149).
      setActive(i => (i < 0 ? (step > 0 ? 0 : suggestions.length - 1) : (i + step + suggestions.length) % suggestions.length));
    } else if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      const picked = active >= 0 ? suggestions[active]?.tag : null;
      if (picked) { e.preventDefault(); add(picked); }
      else if (draft.trim()) { e.preventDefault(); add(draft); }
    } else if (e.key === 'Backspace' && draft === '' && tags.length > 0) {
      remove(tags[tags.length - 1]);
    } else if (e.key === 'Escape' && listOpen) {
      // Only the suggestions close; with them closed, Esc goes on to the Inspector (back to the list).
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    }
  };

  return (
    <div className="mset-tags">
      {tags.length > 0 && (
        <div className="mset-tag-chips">
          {tags.map(tag => (
            <span key={tag} className="mset-tag">
              #{tag}
              <button
                type="button"
                aria-label={t('macroSettings.tags.remove', { tag })}
                disabled={disabled}
                onClick={(e) => {
                  remove(tag);
                  e.currentTarget.closest('.mset-tags')?.querySelector<HTMLInputElement>('input')?.focus();
                }}
              >
                <X aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mset-tag-field">
        <label className="insp-box" data-disabled={disabled || full || undefined}>
          <Hash aria-hidden="true" className="mset-tag-hash" />
          <input
            type="text"
            role="combobox"
            aria-label={t('macroSettings.tags.add')}
            aria-expanded={listOpen}
            aria-controls={listId}
            aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
            aria-invalid={error ? true : undefined}
            placeholder={t('macroSettings.tags.addPlaceholder')}
            spellCheck={false}
            autoComplete="off"
            value={draft}
            disabled={disabled || full}
            onChange={(e) => { setDraft(e.target.value); setError(null); setActive(-1); setOpen(true); }}
            onFocus={() => setOpen(true)}
            // A tag typed and left goes in, as the Save of today took it (a field applies when it is
            // left, rule 3); one the rules refuse stays, with its message.
            onBlur={() => { setOpen(false); if (draft.trim()) add(draft); }}
            onKeyDown={onKeyDown}
          />
          <span className="insp-box-unit">{tags.length} / {MAX_TAGS}</span>
        </label>
        {listOpen && (
          <div id={listId} role="listbox" aria-label={t('macroSettings.tags.suggestions')} className="mset-tag-list menu-surface">
            {suggestions.map((s, i) => (
              <button
                key={s.tag}
                id={optionId(i)}
                type="button"
                role="option"
                tabIndex={-1}
                aria-selected={i === active}
                // The press would take the focus from the field, and its blur would close the list
                // before the click lands.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(-1)}
                onClick={() => add(s.tag)}
              >
                <span>#{s.tag}</span>
                <span className="mset-tag-count">{t('macroSettings.tags.used', { n: fmtNum(s.count) })}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* The field's rule at rest, and why a tag was refused in its place (biblioteca-147). */}
      <span className="insp-hint">
        {error ? <span data-error="">{TAG_MESSAGE[error]}</span> : t('macroSettings.tags.rule')}
      </span>
      {top.length > 0 && (
        <div className="mset-tag-top" role="group" aria-label={t('macroSettings.tags.mostUsedGroup')}>
          <span className="insp-hint">{t('macroSettings.tags.mostUsed')}</span>
          {top.map(u => (
            <button
              key={u.tag}
              type="button"
              className="mset-tag-chip"
              disabled={disabled || full}
              data-tip={t('macroSettings.tags.usedBy', { count: u.count, n: fmtNum(u.count) })}
              onClick={() => add(u.tag)}
            >
              #{u.tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
