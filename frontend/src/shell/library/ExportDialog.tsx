import { useState } from 'react';
import { Folder, Search, Upload, X } from 'lucide-react';
import type { ProfileEntry, ProfileOrderData } from '../../bridge/messageTypes';
import { Button } from '../../components/common/Button';
import { DialogShell } from '../../components/common/DialogShell';
import { KbdTag } from '../../components/common/KbdTag';
import { CheckboxBox } from '../../components/Checkbox';
import { fmtNum, t } from '../../i18n';
import { runsBroughtAlong } from './model';

/**
 * ③ ⋯ › Export macros…: choose macros for one .trprofile file. The list follows the library —
 * Pinned (every pinned macro, in a folder or not), the folders, Ungrouped — and a macro in two
 * places is one choice. The filter narrows what shows; Select all and the counts mean what shows,
 * while Export takes every chosen macro, the hidden ones too (the footer says how many hide).
 * The macros the chosen ones run always go along: without them the file arrives broken and
 * fails without a word, so it is said, not asked.
 */
export function ExportDialog({ profiles, order, initial, onExport, onClose }: {
  profiles: ProfileEntry[];
  order: ProfileOrderData;
  /** Macros chosen when it opens. */
  initial: string[];
  onExport: (names: string[], includeOrganization: boolean) => void;
  onClose: () => void;
}) {
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(initial));
  const [filter, setFilter] = useState('');
  const [organization, setOrganization] = useState(true);

  const byName = new Map(profiles.map(p => [p.name, p]));
  const shows = (name: string) => !filter || name.toLowerCase().includes(filter.toLowerCase());
  const pinned = order.pinned.filter(n => byName.has(n) && shows(n));
  const folders = order.folders.map(f => ({ folder: f, names: f.items.filter(n => byName.has(n) && shows(n)) })).filter(f => f.names.length > 0);
  const grouped = new Set([...order.pinned, ...order.folders.flatMap(f => f.items)]);
  const loose = profiles.filter(p => !grouped.has(p.name) && shows(p.name)).map(p => p.name);
  const visible = profiles.filter(p => shows(p.name)).map(p => p.name);
  const visibleChosen = visible.filter(n => chosen.has(n)).length;
  const allChosen = visible.length > 0 && visibleChosen === visible.length;
  const hiddenChosen = [...chosen].filter(n => byName.has(n) && !shows(n)).length;
  const total = [...chosen].filter(n => byName.has(n)).length;
  const along = runsBroughtAlong(profiles, new Set([...chosen].filter(n => byName.has(n))));

  const toggle = (names: string[], on: boolean) => setChosen(prev => {
    const next = new Set(prev);
    for (const n of names) {
      if (on) next.add(n);
      else next.delete(n);
    }
    return next;
  });

  const row = (name: string) => {
    const entry = byName.get(name);
    return (
      <button
        key={name}
        type="button"
        role="checkbox"
        aria-checked={chosen.has(name)}
        onClick={() => toggle([name], !chosen.has(name))}
        className="w-full flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-surface text-left"
      >
        <CheckboxBox checked={chosen.has(name)} />
        <span className="w-4 text-center text-sm leading-none select-none shrink-0">{entry?.iconEmoji || '📄'}</span>
        <span className="text-minor text-text-primary truncate">{name}</span>
        <span className="ml-auto shrink-0 flex items-center gap-1.5">
          {entry?.hotkey && <KbdTag combo={entry.hotkey} unified />}
          {entry?.actionCount !== undefined && (
            <span className="text-caption text-text-tertiary tabular-nums">{t('library.export.steps', { count: entry.actionCount, n: fmtNum(entry.actionCount) })}</span>
          )}
        </span>
      </button>
    );
  };

  return (
    <DialogShell
      icon={<Upload size={14} style={{ color: 'var(--color-accent)' }} />}
      title={t('library.export.title')}
      size="md"
      cardClassName="max-h-[calc(90vh/var(--ui-zoom))]"
      closeOnBackdrop={false}
      onClose={onClose}
      footerHint={
        <span className="tabular-nums">
          {t('library.export.selected', { count: total })}{hiddenChosen > 0 && <> · {t('library.export.hiddenByFilter', { count: hiddenChosen })}</>}
        </span>
      }
      footer={
        <>
          <Button variant="secondary" size="md" className="min-w-[5.25rem]" onClick={onClose}>{t('common.actions.cancel')}</Button>
          <Button
            variant="primary"
            size="md"
            className="min-w-[5.25rem]"
            disabled={total === 0}
            onClick={() => {
              onExport(profiles.map(p => p.name).filter(n => chosen.has(n)), organization);
              onClose();
            }}
          >
            {t('common.actions.export')}
          </Button>
        </>
      }
    >
      <div className="px-4 pt-3">
        <div className="relative w-full">
          <Search size={13} aria-hidden="true" className="absolute left-2 top-1/2 -translate-y-1/2 text-text-disabled pointer-events-none" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('library.export.filterPlaceholder')}
            aria-label={t('library.export.filter')}
            className="input-field font-sans text-minor pl-7 pr-7"
          />
          {filter && (
            <button type="button" aria-label={t('library.export.clearFilter')} onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 flex text-text-disabled hover:text-text-secondary">
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="px-4 pt-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={allChosen}
          onClick={() => toggle(visible, !allChosen)}
          className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-surface border-b border-border-subtle text-left"
        >
          <CheckboxBox checked={allChosen} />
          <span className="text-minor font-medium text-text-secondary">{t('library.export.selectAll')}</span>
          <span className="ml-auto text-caption text-text-tertiary tabular-nums">{visibleChosen}/{visible.length}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-1 min-h-[10rem]">
        {visible.length === 0 && (
          <div className="py-6 flex flex-col items-center gap-2 text-caption text-text-tertiary">
            <span>{profiles.length === 0 ? t('library.export.none') : t('library.export.noMatch', { filter })}</span>
            {filter && <Button variant="ghost" onClick={() => setFilter('')}>{t('library.export.clearFilter')}</Button>}
          </div>
        )}
        {pinned.length > 0 && (
          <div className="mb-1">
            <div className="px-2 py-1 label-micro text-text-tertiary">{t('library.pinned')}</div>
            {pinned.map(row)}
          </div>
        )}
        {folders.map(({ folder, names }) => {
          const on = names.filter(n => chosen.has(n)).length;
          return (
            <div key={folder.name} className="mb-1">
              <button
                type="button"
                role="checkbox"
                aria-checked={on === names.length ? true : on > 0 ? 'mixed' : false}
                onClick={() => toggle(names, on !== names.length)}
                className="w-full flex items-center gap-1.5 px-2 py-1 rounded hover:bg-bg-surface text-left"
              >
                <CheckboxBox checked={on === names.length} indeterminate={on > 0 && on < names.length} />
                <Folder size={12} style={{ color: folder.color }} className="shrink-0" />
                <span className="text-minor font-medium text-text-secondary truncate">{folder.name}</span>
                <span className="ml-auto text-caption text-text-tertiary tabular-nums">{on}/{names.length}</span>
              </button>
              <div className="ml-5">{names.map(row)}</div>
            </div>
          );
        })}
        {loose.length > 0 && (
          <div className="mb-1">
            {folders.length > 0 && <div className="px-2 py-1 label-micro text-text-tertiary">{t('library.ungrouped')}</div>}
            {loose.map(row)}
          </div>
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-border-subtle space-y-2">
        <button
          type="button"
          role="checkbox"
          aria-checked={organization}
          onClick={() => setOrganization(v => !v)}
          className="w-full flex items-center gap-2 text-left"
          data-tip={t('library.export.organizationTip')}
        >
          <CheckboxBox checked={organization} />
          <span className="text-minor text-text-secondary">{t('library.export.organization')}</span>
        </button>
        {along.length > 0 && (
          <div
            className="text-caption text-text-tertiary leading-relaxed"
            data-tip={t('library.export.alongTip', { names: along.join(', ') })}
          >
            {t('library.export.along', { count: along.length })}
          </div>
        )}
      </div>
    </DialogShell>
  );
}
