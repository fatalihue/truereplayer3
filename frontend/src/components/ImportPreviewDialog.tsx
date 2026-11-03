import { useState, useMemo, useEffect } from 'react';
import { Download, AlertTriangle, FolderOpen, Hash, Pencil, Replace, Ban, Type, Zap, PackageCheck, Link2 } from 'lucide-react';
import type { ImportPreviewPayload, ImportConflictResolution } from '../bridge/messageTypes';
import { Checkbox, CheckboxBox } from './Checkbox';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { SegmentedControl, type SegmentOption } from './common/SegmentedControl';
import { KbdTag } from './common/KbdTag';
import { fmtNum, t } from '../i18n';
import { formatDate, formatRelative } from '../utils/dateFormat';

// The target's line is a sentence of the catalog with the target in the monospaced face: t() is handed
// this private-use mark in the target's place and the sentence is cut there, so the target sits wherever
// the language puts it (as the tips cut theirs at the key cap). No text has this character.
const TARGET = '\uE000';
const [TARGETS_BEFORE, TARGETS_AFTER = ''] = t('dialogs.importPreview.targets', { target: TARGET }).split(TARGET);

interface ImportPreviewDialogProps {
  preview: ImportPreviewPayload;
  /**
   * Called with the list of selected profile names and the per-profile resolution
   * for any name conflicts. The map only contains entries for profiles whose name
   * collides with an existing local profile; for the rest, the backend imports normally.
   */
  onConfirm: (selectedNames: string[], conflictResolutions: Record<string, ImportConflictResolution>) => void;
  onCancel: () => void;
}

/**
 * Phase 2 of the import flow (after the security warning, if shown). Renders one
 * checkbox row per profile in the .trprofile envelope so the user can review
 * metadata + cherry-pick which ones to actually import.
 *
 * Row anatomy is four zones of decreasing weight (2026-08 rework): identity
 * (emoji/name/version, provenance right-aligned as a watermark) → description
 * (the one field that says WHAT a third-party profile does) → risk facts
 * (hotkey, hotstring, repeats, target, automation trigger) → scale
 * (actions/images/data rows). Dependencies and tags sit between risk and scale.
 *
 * Incompatible profiles (AppMinVersion > running version) are rendered greyed-out
 * with a reason and cannot be selected — the backend rejects them as a safety net
 * even if the frontend bug lets one through.
 *
 * Conflict resolution (Overwrite / Rename / Skip dialog) still happens server-side
 * during confirm; this dialog only shows whether a name conflict EXISTS via a chip.
 */
export function ImportPreviewDialog({ preview, onConfirm, onCancel }: ImportPreviewDialogProps) {
  // Default selection: every compatible profile checked. The user opts out per item
  // rather than opting in — matches the "I'm importing this file because I want it all"
  // mental model and matches Stream Deck / VS Code profile import UX.
  // Keyed by name, which is a row id only because the backend makes it one: a file listing two
  // profiles under the same name has the repeats numbered before the preview is built
  // (DisambiguateDuplicateEntryNames). Two rows sharing a key shared a checkbox, and the confirm
  // — which picks by name — wrote both from a dialog that counted one.
  const initialSelection = useMemo(() => {
    const map: Record<string, boolean> = {};
    preview.profiles.forEach(p => { map[p.name] = p.compatible; });
    return map;
  }, [preview.profiles]);

  const [selected, setSelected] = useState<Record<string, boolean>>(initialSelection);

  // Per-conflict resolution. Default "rename" matches the safest choice — never silently
  // destroys existing local work. Only populated for profiles flagged nameConflict; the
  // backend ignores entries that don't actually conflict at import time.
  const initialResolutions = useMemo(() => {
    const map: Record<string, ImportConflictResolution> = {};
    preview.profiles.forEach(p => {
      if (p.nameConflict) map[p.name] = 'rename';
    });
    return map;
  }, [preview.profiles]);

  const [conflictResolutions, setConflictResolutions] = useState<Record<string, ImportConflictResolution>>(initialResolutions);

  // Resync selection when preview changes (defensive — caller usually unmounts/remounts).
  useEffect(() => {
    setSelected(initialSelection);
    setConflictResolutions(initialResolutions);
  }, [initialSelection, initialResolutions]);

  // Two conflict scopes, deliberately distinct: the HEADER counts every conflict in
  // the file (it summarizes the file); the bulk banner below counts — and applies
  // to — SELECTED rows only. The banner used to count everything, so bulk-apply
  // silently rewrote resolutions on rows the user had already unchecked.
  const conflictCountAll = preview.profiles.filter(p => p.nameConflict).length;
  const selectedConflictNames = useMemo(
    () => preview.profiles.filter(p => p.nameConflict && !!selected[p.name]).map(p => p.name),
    [preview.profiles, selected]
  );

  // Bulk-apply: when every SELECTED conflicting profile shares the same resolution,
  // the bulk control shows it as the active segment. null = they disagree (no segment
  // active); clicking one resets every selected conflict at once.
  const bulkResolution: ImportConflictResolution | null = useMemo(() => {
    if (selectedConflictNames.length === 0) return null;
    const vals = selectedConflictNames.map(n => conflictResolutions[n] ?? 'rename');
    const first = vals[0];
    return vals.every(v => v === first) ? first : null;
  }, [selectedConflictNames, conflictResolutions]);

  const applyBulkResolution = (res: ImportConflictResolution) => {
    setConflictResolutions(prev => {
      const next = { ...prev };
      selectedConflictNames.forEach(n => { next[n] = res; });
      return next;
    });
  };

  const selectedCount = Object.entries(selected).filter(([name, on]) => {
    if (!on) return false;
    const p = preview.profiles.find(x => x.name === name);
    return p?.compatible === true;
  }).length;

  // Rows that are checked + compatible but whose name-conflict is resolved to "skip" WON'T
  // actually be written — the backend counts them as skipped. Excluding them from the count
  // keeps the button/footer honest: "Import Selected (3)" that yields "All 2 were skipped" was
  // the reported bug. selectedCount is the raw checked set; effectiveImportCount is what lands.
  const skipResolvedCount = preview.profiles.filter(p =>
    !!selected[p.name] && p.compatible && p.nameConflict && (conflictResolutions[p.name] ?? 'rename') === 'skip'
  ).length;
  const effectiveImportCount = selectedCount - skipResolvedCount;

  const compatibleCount = preview.profiles.filter(p => p.compatible).length;
  const incompatibleCount = preview.profiles.length - compatibleCount;
  // Derived from selectedCount, not a second every() scan — two independent formulas
  // for "how many selectable rows are selected" could silently diverge.
  const allSelected = compatibleCount > 0 && selectedCount === compatibleCount;

  const handleConfirm = () => {
    const names = Object.entries(selected)
      .filter(([_, on]) => on)
      .map(([name]) => name)
      .filter(name => preview.profiles.find(p => p.name === name)?.compatible === true);
    onConfirm(names, conflictResolutions);
  };

  const toggleAll = (value: boolean) => {
    const next: Record<string, boolean> = {};
    preview.profiles.forEach(p => { next[p.name] = value && p.compatible; });
    setSelected(next);
  };

  // Conflict resolutions on the DS SegmentedControl (the hand-rolled ResolutionChips
  // predated it). Each option carries its CONSEQUENCE as the tooltip — "Rename" alone
  // never said the import lands as "Name (2)", nor "Overwrite" that it destroys yours.
  //
  // WITH TIPS ONLY ON THE BANNER. The same three words appear once at the top and again
  // on every conflicting row, so tipping all of them repeats one explanation N+1 times for
  // a meaning that does not change per row. The banner is where the choice is read first
  // and where it is explained; the row controls are the same three labels, now silent.
  const resolutionOptions = (iconSize: number, withTips = false): SegmentOption<ImportConflictResolution>[] => [
    {
      value: 'rename', label: t('common.actions.rename'), icon: <Pencil size={iconSize} />,
      tip: withTips ? t('dialogs.importPreview.resolution.renameTip') : undefined,
    },
    {
      value: 'overwrite', label: t('dialogs.importPreview.resolution.overwrite'), icon: <Replace size={iconSize} />,
      tip: withTips ? t('dialogs.importPreview.resolution.overwriteTip') : undefined,
    },
    {
      value: 'skip', label: t('dialogs.importPreview.resolution.skip'), icon: <Ban size={iconSize} />,
      tip: withTips ? t('dialogs.importPreview.resolution.skipTip') : undefined,
    },
  ];

  return (
    <DialogShell
      icon={<Download size={14} style={{ color: 'var(--color-accent)' }} />}
      title={t('dialogs.importPreview.title')}
      // max-h keeps the review list scrollable inside the card on short windows
      // (the profile list below is the flex-1 overflow-y-auto region).
      size="xl"
      cardClassName="max-h-[calc(90vh/var(--ui-zoom))]"
      onClose={onCancel}
      // closeOnBackdrop FALSE: accidentally clicking outside while reviewing a
      // dozen profiles would discard the selection + conflict choices. The user
      // dismisses via the Cancel button, Esc, or completing the import.
      closeOnBackdrop={false}
      // tabular-nums on the counts here and on the button: they change on every checkbox, and
      // proportional digits made the hint and the button label shuffle sideways as they ticked.
      footerHint={
        <span className="tabular-nums">
          {skipResolvedCount > 0
            ? `${t('dialogs.importPreview.willImport', { count: effectiveImportCount })} · ${t('dialogs.importPreview.skipped', { count: skipResolvedCount })}`
            : t('dialogs.importPreview.willImportOf', { count: effectiveImportCount, total: compatibleCount })}
        </span>
      }
      footer={<DialogFooter secondary={{ label: t('common.actions.cancel'), onClick: onCancel }} primary={{ label: t('dialogs.importPreview.importSelected', { n: effectiveImportCount }), onClick: handleConfirm, disabled: effectiveImportCount === 0, className: 'tabular-nums' }} />}
      // No Enter rule (unchanged from the hand-rolled version); this handler only
      // preserves the old scrim-level stopPropagation so keystrokes typed while
      // reviewing don't leak to app-level shortcut handlers. Esc is owned by the
      // shell (it already stops propagation before this runs).
      onCardKeyDown={(e) => e.stopPropagation()}
    >
        {/* File summary — three reading levels: the file, then the numbers that size
            the review task (the decision line), then forensic provenance demoted to
            tertiary. The old header opened with the trivia and scattered the decision
            numbers across three bands. */}
        <div className="px-4 py-3 border-b border-border-subtle bg-bg-surface/30">
          <div className="flex items-center gap-2 text-minor">
            <FolderOpen size={12} className="text-text-tertiary" />
            <span className="text-text-secondary font-medium truncate">{preview.fileName}</span>
          </div>
          <div className="mt-1 text-minor text-text-secondary flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{t('dialogs.file.macros', { count: preview.profiles.length })}</span>
            {conflictCountAll > 0 && (
              <span
                className="text-warning-ink flex items-center gap-1"
                data-tip={t('dialogs.importPreview.conflictsTip')}
              >
                <AlertTriangle size={11} style={{ color: 'var(--color-warning-ink)' }} />
                {t('dialogs.importPreview.conflicts', { count: conflictCountAll })}
              </span>
            )}
            {incompatibleCount > 0 && (
              <span
                className="text-warning-ink"
                data-tip={t('dialogs.importPreview.incompatibleTip', { count: incompatibleCount })}
              >
                {t('dialogs.importPreview.incompatible', { count: incompatibleCount })}
              </span>
            )}
            {preview.hasOrganization && (
              <span className="text-accent-hover">{t('dialogs.importPreview.organization')}</span>
            )}
          </div>
          <div className="mt-1 text-caption text-text-tertiary flex flex-wrap gap-x-4 gap-y-0.5">
            <span>{t('dialogs.importPreview.exported', { date: formatDate(preview.exportedAt) })}</span>
            <span>{t('dialogs.importPreview.format', { version: preview.envelopeVersion })}</span>
            <span>{t('dialogs.importPreview.yourApp', { version: preview.runningVersion })}</span>
          </div>
        </div>

        {/* Select-all — the Export dialog's row idiom (CheckboxBox + count), replacing
            the hover-only "Select all / Clear" text links. The box is aria-hidden, so the
            row itself carries the checkbox role and its checked / mixed state. */}
        <div className="px-4 py-1.5 border-b border-border-subtle">
          <button
            type="button"
            role="checkbox"
            aria-checked={allSelected ? true : selectedCount > 0 ? 'mixed' : false}
            onClick={() => toggleAll(!allSelected)}
            disabled={compatibleCount === 0}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-surface cursor-pointer text-left disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CheckboxBox checked={allSelected} indeterminate={selectedCount > 0 && !allSelected} />
            <span className="text-minor font-medium text-text-secondary">{t('dialogs.importPreview.selectAll')}</span>
            <span className="ml-auto text-caption text-text-tertiary tabular-nums">{selectedCount}/{compatibleCount}</span>
          </button>
        </div>

        {/* Bulk conflict resolution — rendered only when at least one SELECTED profile
            collides with an existing local name, and bulk-apply touches only those
            rows (unchecked rows keep their resolution untouched). Warning band, not a
            hardcoded amber wash. */}
        {selectedConflictNames.length > 0 && (
          <div className="warning-band px-4 py-3 border-b border-border-subtle flex items-center gap-4 flex-wrap">
            <span className="text-minor font-medium text-warning-ink flex items-center gap-2">
              <AlertTriangle size={14} style={{ color: 'var(--color-warning-ink)' }} />
              {t('dialogs.importPreview.applyAll', { count: selectedConflictNames.length })}
            </span>
            <SegmentedControl
              options={resolutionOptions(12, true)}
              value={bulkResolution}
              onChange={applyBulkResolution}
              ariaLabel={t('dialogs.importPreview.resolveAll')}
            />
          </div>
        )}

        {/* Profile list */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1.5">
          {preview.profiles.map((p, i) => {
            const isChecked = !!selected[p.name];
            return (
              <div
                key={i}
                // No hover tint: the card is not a click target (only its Checkbox toggles, and the
                // conflict control lives inside it), so lighting it up promised a click that did
                // nothing.
                className={`flex items-start gap-3 px-3 py-2.5 rounded border ${
                  p.compatible
                    ? 'border-border-subtle bg-bg-card'
                    : ''
                }`}
                // Incompatible card: the border carries the read, the 6% tint does not.
                // Measured: mixed 30% into the neutral border it was 1.00–1.12:1 against a
                // NORMAL neighbouring row on light and 1.56–2.05:1 on dark — i.e. below the
                // 3:1 graphics floor on all 37 presets, not just the light ones. It now uses
                // the per-theme derived ink (4.05–4.59 light, 4.84–8.87 dark) plus a 3px left
                // edge, so position is the second channel.
                // The 6% tint is knowingly NOT fixed: 1.14–1.27:1 on light, and no alpha of a
                // yellow can clear 3:1 over a light surface. The "Requires TrueReplayer X or
                // newer" line remains the primary read.
                // NO whole-card opacity: it compounded with the disabled Checkbox's
                // own opacity-50 (0.35 effective — the tooltip target vanished), and
                // the user still needs to READ what an incompatible profile is.
                style={p.compatible ? undefined : {
                  borderColor: 'var(--color-warning-ink)',
                  borderLeftWidth: '3px',
                  background: 'color-mix(in srgb, var(--color-warning) 6%, transparent)',
                }}
              >
                {/* Checkbox — disabled (not just no-op) on incompatible rows, with the
                    reason on hover; the body warning below stays as the primary read. */}
                <div className="pt-0.5">
                  <Checkbox
                    checked={isChecked && p.compatible}
                    disabled={!p.compatible}
                    // Box-only, so it needs a name: the row's profile name.
                    ariaLabel={p.name}
                    title={!p.compatible
                      ? t('dialogs.importPreview.requires', { version: p.appMinVersion ?? '' })
                      : undefined}
                    onChange={(value) => {
                      setSelected(prev => ({ ...prev, [p.name]: value }));
                    }}
                  />
                </div>

                {/* Icon */}
                <div className="text-lg leading-none pt-0.5 select-none w-5 text-center">
                  {p.iconEmoji || '📄'}
                </div>

                {/* Main info — the four zones. */}
                <div className="flex-1 min-w-0">
                  {/* Z1 — identity; provenance right-aligned as a watermark, with the
                      created date on hover instead of competing inline. */}
                  <div className="flex items-center gap-2">
                    <span className="text-minor font-medium text-text-primary truncate">{p.name}</span>
                    <span className="text-caption px-1.5 py-px rounded bg-bg-surface text-text-tertiary border border-border-subtle shrink-0">
                      v{p.profileVersion}
                    </span>
                    {p.updatedAt && (
                      <span
                        className="ml-auto shrink-0 text-caption text-text-tertiary"
                        data-tip={p.createdAt ? t('dialogs.importPreview.created', { date: formatDate(p.createdAt) }) : undefined}
                      >
                        {t('dialogs.importPreview.updated', { when: formatRelative(p.updatedAt) })}
                      </span>
                    )}
                  </div>

                  {/* Z2 — description, promoted: for a third-party profile this is the
                      only field that says WHAT it does. It used to sit below the
                      dependency chips. */}
                  {p.description && (
                    <div className="mt-0.5 text-caption text-text-secondary leading-snug line-clamp-2">
                      {p.description}
                    </div>
                  )}

                  {/* Z3 — risk facts, grouped and one nuance above the scale line:
                      what the profile will DO to this machine once imported. */}
                  {(p.hotkey || p.hotstring || (p.enableLoop && (p.loopCount ?? 1) > 1) || p.targetProcessName || p.targetWindowTitle || p.hasTrigger) && (
                    <div className="mt-1 flex items-center gap-x-2.5 gap-y-1 flex-wrap text-caption text-text-secondary">
                      {/* Hostile-envelope guard: KbdTag renders one unbreakable monospace
                          token, so an absurd combo would overflow the card sideways.
                          Sane combos keep the chip; junk degrades to a clamped span. */}
                      {p.hotkey && (
                        p.hotkey.length <= 40
                          ? <KbdTag combo={p.hotkey} unified />
                          : <span className="font-mono truncate max-w-[160px]">{p.hotkey}</span>
                      )}
                      {p.hotstring && (
                        <span
                          className="font-mono flex items-center gap-1 max-w-[160px]"
                          data-tip={t('dialogs.importPreview.hotstringTip')}
                        >
                          <Type size={10} className="text-text-tertiary shrink-0" />
                          <span className="truncate">{p.hotstring}</span>
                        </span>
                      )}
                      {/* Loop count travels with the export. Shown only when it actually
                          repeats: an incoming profile that fires 500 clicks per press
                          should not be a surprise the receiver discovers by running it. */}
                      {p.enableLoop && (p.loopCount ?? 1) > 1 && (
                        <span>{t('dialogs.importPreview.repeats', { n: fmtNum(p.loopCount ?? 1) })}</span>
                      )}
                      {(p.targetProcessName || p.targetWindowTitle) && (
                        <span className="truncate">
                          {/* Falls back to the window TITLE when no process name travels —
                              the target used to vanish entirely in that case. */}
                          {TARGETS_BEFORE}<span className="font-mono">{p.targetProcessName ?? p.targetWindowTitle}</span>{TARGETS_AFTER}
                        </span>
                      )}
                      {p.hasTrigger && (
                        <span
                          className="flex items-center gap-1 text-warning-ink"
                          data-tip={t('dialogs.importPreview.triggerTip')}
                        >
                          <Zap size={10} style={{ color: 'var(--color-warning-ink)' }} />
                          {t('dialogs.importPreview.trigger')}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Run Profile dependency chips: bundled here / calls your existing
                      profile / nothing to call. The glyph is the second channel — the
                      text color alone died on the presets where the hues converge.
                      Sans, not mono: these are profile NAMES, the same ones the row's own
                      title shows in sans — mono is for data and tokens only. */}
                  {p.dependencies && p.dependencies.length > 0 && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <span className="text-caption text-text-tertiary">{t('dialogs.importPreview.runs')}</span>
                      {p.dependencies.map(d => {
                        const DepIcon = d.status === 'inEnvelope' ? PackageCheck
                                      : d.status === 'missing' ? AlertTriangle
                                      : Link2;
                        return (
                          <span
                            key={d.name}
                            className="text-caption px-1.5 py-0.5 rounded border inline-flex items-center gap-1"
                            data-tip={
                              d.status === 'inEnvelope'
                                ? t('dialogs.importPreview.depBundled')
                                : d.status === 'localOnly'
                                  ? t('dialogs.importPreview.depLocal')
                                  : t('dialogs.importPreview.depMissing')
                            }
                            // Both hues use their DERIVED ink, not the raw token: this is 10px
                            // text. Raw --color-replay measured 1.32–1.89:1 on all 14 light
                            // presets — the green chip was as invisible as the amber one beside
                            // it, and fixing only the amber branch would have left two chips on
                            // the same line at opposite legibility.
                            style={{
                              color: d.status === 'inEnvelope' ? 'var(--color-replay-fg)'
                                   : d.status === 'missing' ? 'var(--color-warning-ink)'
                                   : 'var(--color-text-tertiary)',
                              borderColor: 'var(--color-border-subtle)',
                            }}
                          >
                            <DepIcon size={9} className="shrink-0" />
                            {d.name}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {p.tags && p.tags.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {p.tags.map(tag => (
                        <span
                          key={tag}
                          className="text-caption px-1.5 py-0.5 rounded bg-bg-surface text-text-tertiary border border-border-subtle"
                        >
                          <Hash size={8} className="inline -mt-px mr-0.5" />
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Z4 — scale, demoted to the last line in tertiary. */}
                  <div className="mt-1 text-caption text-text-tertiary flex items-center gap-3 flex-wrap">
                    <span>{t('dialogs.importPreview.steps', { count: p.actionCount, n: fmtNum(p.actionCount) })}</span>
                    {!!p.imageCount && (
                      <span>{t('dialogs.importPreview.images', { count: p.imageCount, n: fmtNum(p.imageCount) })}</span>
                    )}
                    {p.dataRowCount > 0 && (
                      <span>{t('dialogs.importPreview.dataRows', { count: p.dataRowCount, n: fmtNum(p.dataRowCount) })}</span>
                    )}
                  </div>

                  {!p.compatible && (
                    <div className="mt-1.5 flex items-start gap-1.5 text-caption text-warning-ink">
                      <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-warning-ink)' }} />
                      <span>
                        {t('dialogs.importPreview.cantImport', { version: p.appMinVersion ?? '' })}
                      </span>
                    </div>
                  )}

                  {/* Per-row conflict resolution. Only rendered when this row's name
                      collides with an existing local profile AND the row is selected
                      (no point picking a resolution for a row you've unchecked). */}
                  {p.nameConflict && p.compatible && isChecked && (
                    <>
                      {/* Incoming-vs-yours diff so Overwrite is an informed choice. Present, don't
                          editorialize — a newer date doesn't imply better. */}
                      {p.localVersion != null && (
                        <div className="mt-1.5 text-caption text-text-tertiary">
                          {p.updatedAt
                            ? t('dialogs.importPreview.incomingWhen', { version: p.profileVersion, when: formatRelative(p.updatedAt) })
                            : t('dialogs.importPreview.incoming', { version: p.profileVersion })}
                          {' → '}
                          {p.localUpdatedAt
                            ? t('dialogs.importPreview.yoursWhen', { version: p.localVersion, when: formatRelative(p.localUpdatedAt) })
                            : t('dialogs.importPreview.yours', { version: p.localVersion })}
                        </div>
                      )}
                      <div className="mt-1.5 flex items-center gap-1.5 text-caption text-warning-ink">
                        <span>{t('dialogs.importPreview.nameExists')}</span>
                        <SegmentedControl
                          options={resolutionOptions(11)}
                          dense
                          value={conflictResolutions[p.name] ?? 'rename'}
                          onChange={(res) => setConflictResolutions(prev => ({ ...prev, [p.name]: res }))}
                          ariaLabel={t('dialogs.importPreview.resolveOne', { name: p.name })}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
    </DialogShell>
  );
}
