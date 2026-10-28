import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { getActionTypeColors } from '../../utils/displayUtils';
import { insideLoop } from '../list/blocks';
import { insertPoint, useSelection } from '../list/selection';
import { stepIcon } from '../list/stepTypes';
import type { MenuAnchor } from '../menuAnchor';
import { Popover } from '../Popover';
import { useApp } from '../store';
import { GROUPS, ITEMS, search, type CatalogItem, type GroupId } from './catalog';
import { insertHere } from './inserts';
import './catalog.css';

// What this build offers: a type still waiting for its editor shows only in the development build.
const OFFERED = ITEMS.filter(item => item.insert || import.meta.env.DEV);
const SHOWN_GROUPS = GROUPS.filter(g => OFFERED.some(item => item.group === g.id));

// The group the catalog reopens on: the last one used.
let lastGroup: GroupId = SHOWN_GROUPS[0].id;
const remember = (id: GroupId) => { lastGroup = id; };

/**
 * ⑥ Add step: one catalog, with a search. The groups are on the left and their step types on the
 * right, each with what it does; typing searches all of them. ↑ ↓ move, Enter inserts and Esc
 * closes; the footer says where the step goes (the insertion point, after the last selected step).
 * The new step lands there, and the list selects it.
 *
 * The search field keeps the focus and drives the list (a combobox), so the arrows never leave it.
 */
export default function AddStepCatalog({ anchor, toggle, onClose }: {
  anchor: MenuAnchor;
  toggle: Element | null;
  onClose: () => void;
}) {
  const cmds = useSteps();
  const tt = useTt();
  const steps = useApp(a => a.actions);
  const rows = useApp(a => a.dataTable.rows.length);
  const at = useSelection(s => insertPoint(steps, s.keys));
  // Break loop and Next iteration mean something only inside a loop (casca-079 and 080).
  const inLoop = insideLoop(steps, at);
  const offOf = (item: CatalogItem) => (item.inLoop && !inLoop ? tt('Only inside a loop', 'Só dentro de um laço') : null);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<GroupId>(() => lastGroup);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const searching = query.trim() !== '';
  const items = searching ? search(OFFERED, query) : OFFERED.filter(item => item.group === group);
  // A new list starts on its first item.
  const listKey = searching ? `q:${query}` : `g:${group}`;
  const [shownKey, setShownKey] = useState(listKey);
  if (shownKey !== listKey) { setShownKey(listKey); setActive(0); }
  const current = items[Math.min(active, items.length - 1)];

  useLayoutEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active, listKey]);

  const choose = (item: CatalogItem | undefined) => {
    if (!item?.insert || offOf(item)) return;
    remember(item.group);
    insertHere(item.insert, cmds);
    onClose();
  };

  const pickGroup = (id: GroupId) => {
    setGroup(id);
    remember(id);
    setQuery('');
  };

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(Math.max(0, Math.min(items.length - 1, (current ? items.indexOf(current) : 0) + step)));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(current);
    }
  };

  // The groups are a vertical tab list: the arrows move between them, and the one they reach opens.
  const onGroupKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const pos = SHOWN_GROUPS.findIndex(g => g.id === (e.target as HTMLElement).dataset.group);
    if (pos < 0) return;
    let next = -1;
    if (e.key === 'ArrowDown') next = (pos + 1) % SHOWN_GROUPS.length;
    else if (e.key === 'ArrowUp') next = (pos - 1 + SHOWN_GROUPS.length) % SHOWN_GROUPS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SHOWN_GROUPS.length - 1;
    else return;
    e.preventDefault();
    pickGroup(SHOWN_GROUPS[next].id);
    e.currentTarget.querySelector<HTMLElement>(`[data-group="${SHOWN_GROUPS[next].id}"]`)?.focus();
  };

  const where = steps.length === 0 ? 'Inserts into the empty macro'
    : at < steps.length ? `Inserts after step ${at}`
    : `Inserts at the end, after step ${steps.length}`;

  return (
    <Popover anchor={anchor} label="Add step" toggle={toggle} focusFirst onClose={onClose}>
      <div className="cat">
        <label className="cat-search">
          <span className="step-icon" data-icon="search" />
          <input
            type="text"
            role="combobox"
            aria-label="Search steps"
            aria-expanded="true"
            aria-controls="cat-list"
            aria-autocomplete="list"
            aria-activedescendant={current ? `cat-opt-${current.id}` : undefined}
            placeholder={`Search ${OFFERED.length} step types`}
            spellCheck={false}
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
        </label>
        <div className="cat-body">
          <div role="tablist" aria-orientation="vertical" aria-label="Step groups" className="cat-groups" onKeyDown={onGroupKey}>
            {SHOWN_GROUPS.map(g => {
              const on = !searching && g.id === group;
              return (
                <button
                  key={g.id}
                  type="button"
                  role="tab"
                  className="cat-group"
                  data-group={g.id}
                  aria-selected={on}
                  aria-controls="cat-list"
                  tabIndex={on || (searching && g.id === group) ? 0 : -1}
                  onClick={() => pickGroup(g.id)}
                >
                  <span className="cat-group-name">{g.label}</span>
                  <span className="cat-group-count">{OFFERED.filter(item => item.group === g.id).length}</span>
                </button>
              );
            })}
          </div>
          <div
            ref={listRef}
            id="cat-list"
            role="listbox"
            aria-label={searching ? 'Matching steps' : SHOWN_GROUPS.find(g => g.id === group)?.label}
            className="cat-items"
            // The search keeps the focus: a press on an item only chooses it.
            onMouseDown={(e) => e.preventDefault()}
          >
            {items.map((item, i) => (
              <Item
                key={item.id}
                item={item}
                active={item === current}
                off={offOf(item)}
                // For Each Data Row says how many rows the table has (casca-078).
                detail={item.type === 'ForEachRow' ? (rows === 0 ? 'the table is empty' : `${rows} row${rows === 1 ? '' : 's'}`) : undefined}
                group={searching ? GROUPS.find(g => g.id === item.group)?.label : undefined}
                onHover={() => { if (active !== i) setActive(i); }}
                onChoose={() => choose(item)}
              />
            ))}
            {items.length === 0 && <p className="cat-empty">No step type matches “{query.trim()}”.</p>}
          </div>
        </div>
        <div className="cat-foot">
          <span>{where}</span>
          <span className="cat-spacer" />
          <span>Enter inserts · Esc closes</span>
        </div>
      </div>
    </Popover>
  );
}

function Item({ item, active, off, detail, group, onHover, onChoose }: {
  item: CatalogItem;
  active: boolean;
  /** Why it cannot go where the step would land (the tip), or null. */
  off: string | null;
  /** A fact after its line (the Data Loop table's rows). */
  detail?: string;
  /** Searching: the group it is in. */
  group?: string;
  onHover: () => void;
  onChoose: () => void;
}) {
  const colors = getActionTypeColors(item.type);
  const built = !!item.insert;
  return (
    <div
      id={`cat-opt-${item.id}`}
      role="option"
      className="cat-item"
      aria-selected={active}
      aria-disabled={!built || !!off || undefined}
      data-tip={off ?? undefined}
      onMouseMove={onHover}
      onClick={onChoose}
    >
      <span className="cat-tile" style={{ background: colors.bg, color: colors.fg } as CSSProperties}>
        <span className="step-icon" data-icon={item.icon ?? stepIcon(item.type) ?? 'zap'} />
      </span>
      <span className="cat-text">
        <span className="cat-name">{item.name}{group && <span className="cat-in"> · {group}</span>}</span>
        <span className="cat-desc">{item.desc}{detail && <> · {detail}</>}</span>
      </span>
      {!built && <span className="cat-later">not built yet</span>}
      {item.more && <span className="step-icon cat-more" data-icon="chevron-right" />}
    </div>
  );
}
