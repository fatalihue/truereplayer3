import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { t } from '../../i18n';
import { Clear } from './fields';

// The list shows at least this many rows (room for "No macro matches") and at most this many, then it
// scrolls; each row is this tall.
const ROWS_MIN = 3;
const ROWS_MAX = 7;
const ROW_REM = 1.875;

/**
 * The macros to choose from, by a search (biblioteca-164 to 169, dialogos-068): typing narrows the
 * list to the names that have it, whatever the case; ↑ ↓ move the highlight, round, and Enter or a
 * click takes it. The pointer moves the highlight without scrolling the list under it, and the
 * chosen macro has its ✓. The list keeps the whole list's height while it narrows, so nothing under
 * it moves. Esc is the Inspector's: it leaves the field.
 */
export function MacroPicker({ names, value, onPick, autoFocus = false, disabled, label }: {
  names: string[];
  /** The chosen macro, or null. */
  value: string | null;
  onPick: (name: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  /** The search's and the list's accessible name. */
  label: string;
}) {
  const [query, setQuery] = useState('');
  // The highlight by name: a list that changes under it (a macro added or renamed) keeps it.
  const [lit, setLit] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // What moved the highlight last: the keys and the typing bring it into view, the pointer never.
  const reveal = useRef(true);
  const base = useId();
  const q = query.trim().toLowerCase();
  const shown = q ? names.filter(n => n.toLowerCase().includes(q)) : names;
  const at = lit !== null && shown.includes(lit) ? shown.indexOf(lit)
    : value !== null && shown.includes(value) ? shown.indexOf(value)
    : 0;
  const rows = Math.min(ROWS_MAX, Math.max(ROWS_MIN, names.length));

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  useEffect(() => {
    if (reveal.current) listRef.current?.querySelector(`[data-at="${at}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const take = (name: string | undefined) => {
    if (name && name !== value) onPick(name);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (shown.length === 0) return;
      reveal.current = true;
      setLit(shown[(at + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length]);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      take(shown[at]);
    }
  };

  return (
    <div className="insp-picker">
      <div className="insp-line">
        <div className="insp-box" data-disabled={disabled || undefined}>
          <span className="step-icon insp-picker-glass" data-icon="search" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label={label}
            aria-expanded="true"
            aria-controls={`${base}-list`}
            aria-activedescendant={shown.length > 0 ? `${base}-${at}` : undefined}
            placeholder={t('inspector.picker.search')}
            value={query}
            disabled={disabled}
            spellCheck={false}
            onChange={(e) => { reveal.current = true; setQuery(e.target.value); }}
            onKeyDown={onKeyDown}
          />
        </div>
        {query && <Clear label={t('common.actions.clearSearch')} disabled={disabled} onClear={() => { reveal.current = true; setQuery(''); }} />}
      </div>
      <div ref={listRef} id={`${base}-list`} className="insp-picker-list" role="listbox" aria-label={label} style={{ height: `${rows * ROW_REM}rem` }}>
        {shown.length === 0 ? (
          <span className="insp-picker-none">{names.length === 0 ? t('inspector.picker.empty') : t('inspector.picker.noMatch')}</span>
        ) : shown.map((name, i) => (
          <button
            key={name}
            id={`${base}-${i}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={name === value}
            data-at={i}
            data-lit={i === at || undefined}
            disabled={disabled}
            onMouseEnter={() => { reveal.current = false; setLit(name); }}
            onClick={() => take(name)}
          >
            <span className="insp-picker-name">{name}</span>
            {name === value && <span className="step-icon" data-icon="check" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}
