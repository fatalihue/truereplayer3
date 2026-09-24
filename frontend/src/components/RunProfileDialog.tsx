import { useState, useEffect, useMemo } from 'react';
import { Repeat2 } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';
import { useTt } from '../state/LanguageContext';
import { NumberInput } from './common/NumberInput';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { ProfileSearchList } from './common/ProfileSearchList';

export interface RunProfileDialogProps {
  /** What the dialog is DOING — drives the title and the confirm label. Required, and
   *  deliberately not derived from `initial`: drag-to-insert passes `initial` purely to
   *  pre-fill the dropped profile, and inferring intent from that data made the insert
   *  dialog announce itself as "Edit Run Profile" with a "Save" button. */
  mode: 'add' | 'edit';
  /** Values to open on. Pre-fills the picker and the repeat count; on `add` it is the
   *  profile the user just dropped, on `edit` it is what the action stores. NOT a mode
   *  signal — see `mode`. */
  initial?: { profileName: string; repeatCount: number; runOverData?: boolean };
  /** Name of the profile that will own the action. Used to filter self-reference. */
  excludeProfileName?: string;
  onConfirm: (profileName: string, repeatCount: number, runOverData: boolean) => void;
  onClose: () => void;
}

/**
 * Dialog used by "Add Run Profile" (from the Add Actions menu, and from dragging a profile
 * onto the grid) and by "Edit Run Profile" (double-click on an existing RunProfile row).
 *
 * Shows a profile dropdown (filtered to exclude self-references) and a
 * numeric repeat count. Validates non-empty selection before confirming.
 */
export function RunProfileDialog({ mode, initial, excludeProfileName, onConfirm, onClose }: RunProfileDialogProps) {
  const { profiles } = useAppState();
  const tt = useTt();
  const [profileName, setProfileName] = useState(initial?.profileName ?? '');
  const [repeatCount, setRepeatCount] = useState(initial?.repeatCount ?? 1);
  const [runOverData, setRunOverData] = useState(initial?.runOverData ?? false);

  // Drop self-references and disabled profiles from the picker. Disabled profiles are
  // skipped at replay time anyway (HandleRunProfile early-returns), so hiding them here
  // avoids the foot-gun of picking one that won't run. Exception: keep the currently-
  // selected target visible even if it's disabled, so edit mode shows what's stored.
  const eligibleProfiles = useMemo(() => {
    return profiles.filter(p => {
      if (p.name === excludeProfileName) return false;
      if (p.isDisabled && p.name !== initial?.profileName) return false;
      return true;
    });
  }, [profiles, excludeProfileName, initial?.profileName]);

  // Seed the picker's search box with the profile this dialog opened on, so the target is
  // READ as well as selected: dragging a profile onto the grid used to open a full list of
  // ~80 names with the dropped one highlighted somewhere inside it, which is a scroll away
  // from telling the user which profile they just dropped.
  //
  // Guarded on the name actually being in the list. A stored target that has since been
  // deleted is not eligible, and seeding it would pre-filter the picker down to NOTHING —
  // strictly worse than the unfiltered list, and for the one case where the user most needs
  // to pick a replacement.
  const seedQuery = useMemo(() => {
    const name = initial?.profileName;
    if (!name) return undefined;
    return eligibleProfiles.some((p) => p.name === name) ? name : undefined;
  }, [initial?.profileName, eligibleProfiles]);

  // Pre-select the first eligible profile if none chosen yet.
  useEffect(() => {
    if (!profileName && eligibleProfiles.length > 0) {
      setProfileName(eligibleProfiles[0].name);
    }
  }, [eligibleProfiles, profileName]);

  // The picker's search field autofocuses (see ProfileSearchList autoFocus) over
  // DialogShell's card focus, so the user can type to filter immediately.

  const canConfirm = profileName.trim().length > 0 && repeatCount >= 1;

  const handleConfirm = () => {
    if (!canConfirm) return;
    // Truncated as well as clamped: the backend reads an int, and a fraction it could not read used
    // to throw there after the undo snapshot, losing the insert with the dialog already closed.
    onConfirm(profileName, Math.max(1, Math.min(999, Math.trunc(repeatCount))), runOverData);
  };

  return (
    <DialogShell
      icon={<Repeat2 size={14} className="shrink-0" style={{ color: 'var(--color-action-runprofile-fg)' }} />}
      title={mode === 'edit' ? 'Edit Run Profile' : 'Add Run Profile'}
      onClose={onClose}
      // Picker dialog: the dropdown pre-selects a value and the repeat count is a
      // one-keystroke tweak — a stray backdrop click discards nothing hard to redo,
      // so backdrop-dismiss stays enabled (the default).
      closeOnBackdrop={true}
      footerHint={'Enter confirms · Esc cancels'}
      footer={<DialogFooter secondary={{ label: 'Cancel', onClick: onClose }} primary={{ label: mode === 'edit' ? 'Save' : 'Add', onClick: handleConfirm, disabled: !canConfirm }} />}
      onCardKeyDown={(e) => {
        // Plain Enter confirms — this dialog is single-field (a select), so the
        // multi-line-text justification for Ctrl+Enter (used in SendTextDialog)
        // doesn't apply here. Esc is owned by DialogShell.
        if (e.key === 'Enter') {
          e.preventDefault();
          e.stopPropagation();
          handleConfirm();
        }
      }}
    >
      {/* Body */}
      <div className="px-4 py-4 flex flex-col gap-4">
        {eligibleProfiles.length === 0 ? (
          <div className="text-xs text-text-tertiary py-4 text-center">
            {'No other profile to call.'}
            <br />
            {'Create one first.'}
          </div>
        ) : (
          <>
            {/* Search-and-pick instead of a native <select>: the OS dropdown has no filter,
                so picking one of ~80 profiles meant scrolling a wall of names. Same
                type-to-narrow behaviour as the Profiles panel and the export dialog. */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wide font-semibold text-text-tertiary">
                Profile to run
              </label>
              <ProfileSearchList
                profiles={eligibleProfiles.map((p) => p.name)}
                value={profileName || null}
                onChange={setProfileName}
                autoFocus
                initialQuery={seedQuery}
                ariaLabel={'Profile to run'}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-wide font-semibold text-text-tertiary">
                Repeat
              </label>
              {/* REAL disabled on the input, not only a dimmed wrapper. `pointer-events-none`
                  stops the mouse and nothing else — the field keeps its place in the tab order,
                  and a value typed into it is kept in state and PERSISTED by Confirm, under a
                  control the dialog is painting as unavailable. Over-data ignores RepeatCount at
                  replay (the engine forces one pass per row), so what gets saved is a number that
                  never runs, waiting to take effect the day the user turns over-data off. */}
              <div className={`flex items-center gap-2 ${runOverData ? 'opacity-40' : ''}`}>
                <span className="inline-flex">
                  <NumberInput
                    value={repeatCount}
                    onChange={setRepeatCount}
                    integer
                    min={1}
                    max={999}
                    inputWidth="w-16"
                    inputHeight="h-8"
                    disabled={runOverData}
                    ariaLabel={'Repeat count'}
                  />
                </span>
                <span className="text-xs text-text-tertiary">
                  {repeatCount === 1 ? 'time per call' : 'times per call'}
                </span>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={runOverData}
                onChange={(e) => setRunOverData(e.target.checked)}
              />
              <span className="text-xs text-text-primary"
                data-tip={tt("Once per row of the called profile's table. Overrides Repeat.", 'Uma vez por linha da tabela do perfil chamado. Substitui o Repeat.')}>
                Run once per data row
              </span>
            </label>

            <div className="text-[11px] text-text-tertiary leading-relaxed bg-bg-card border border-border-subtle rounded px-2.5 py-2">
              {'Runs the called profile’s actions inline; its own Loops/Interval are ignored (use Repeat). Disabled profiles are skipped; max 5 levels deep.'}
            </div>
          </>
        )}
      </div>
    </DialogShell>
  );
}
