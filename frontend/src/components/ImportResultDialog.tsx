import type { ReactNode } from 'react';
import { Download, AlertTriangle, FolderOpen, Keyboard, ImageOff, Ban, Check } from 'lucide-react';
import type { ImportResultPayload } from '../bridge/messageTypes';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { t } from '../i18n';

// The folder sentences are sentences of the catalog with parts in medium weight: the folder names, and
// in the "kept" note the one word it turns on ("your" target, not the sender's). t() is handed these
// private-use marks in their place and the sentence is cut at them, so each part sits wherever the
// language puts it (as the tips cut theirs at the key cap). No text has these characters.
const NAMES = '\uE000';
const EM = '\uE001';
const END = '\uE002';

/** A folder sentence: `names` in medium weight at NAMES, and the words between EM and END too. */
function folderSentence(sentence: string, names: string): ReactNode[] {
  const out: ReactNode[] = [];
  let em = false;
  sentence.split(/([\uE000-\uE002])/).forEach((part, i) => {
    if (part === NAMES) out.push(<span key={i} className="font-medium">{names}</span>);
    else if (part === EM) em = true;
    else if (part === END) em = false;
    else if (part) out.push(em ? <span key={i} className="font-medium">{part}</span> : part);
  });
  return out;
}

interface ImportResultDialogProps {
  result: ImportResultPayload;
  onClose: () => void;
}

/**
 * Post-import result — rendered only when the confirm finished with something worth
 * reading (skips, renames, image failures, folder-target notes, hotkey collisions).
 * A CLEAN import never opens this: it keeps the plain success toast, so the happy
 * path never pays a third modal.
 *
 * This replaces a single 300+ character toast that died in 3 seconds plus one loose
 * toast per hotkey collision (word-sniffed red by the frontend). The most consequential
 * fact of the flow — "the imported profiles will use YOUR folder target, not the
 * sender's" — finally gets a surface that waits to be read.
 */
export function ImportResultDialog({ result, onClose }: ImportResultDialogProps) {
  // final name → requested name, for the "renamed (X was taken)" annotation.
  const renamedFrom = new Map(result.renames.map(r => [r.to, r.from]));

  return (
    <DialogShell
      icon={<Download size={14} style={{ color: 'var(--color-accent)' }} />}
      title={t('dialogs.importResult.title')}
      size="lg"
      cardClassName="max-h-[calc(85vh/var(--ui-zoom))]"
      onClose={onClose}
      // Pure reading, nothing to lose — backdrop click may dismiss (unlike the
      // preview, where a stray click would discard a curated selection).
      closeOnBackdrop
      footer={<DialogFooter primary={{ label: t('common.actions.close'), onClick: onClose }} />}
    >
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 text-minor">
        {/* Imported — final names; rename-allocated ones say so. */}
        {result.importedNames.length > 0 && (
          <section>
            <div className="font-medium text-text-primary flex items-center gap-1.5">
              {/* The derived -fg ink, not the raw hue: raw --color-replay measured 1.3–1.9:1
                  on the light presets. */}
              <Check size={12} style={{ color: 'var(--color-replay-fg)' }} />
              {t('dialogs.importResult.imported', { count: result.imported })}
            </div>
            <ul className="mt-1 space-y-0.5 text-text-secondary">
              {result.importedNames.map(n => {
                const from = renamedFrom.get(n);
                return (
                  <li key={n} className="truncate">
                    {n}
                    {from !== undefined && (
                      <span className="text-text-tertiary"> {t('dialogs.importResult.renamed', { from })}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {result.skipped > 0 && (
          <section>
            <div className="font-medium text-text-primary flex items-center gap-1.5">
              <Ban size={12} className="text-text-tertiary" />
              {t('dialogs.importResult.skipped', { count: result.skipped })}
            </div>
            {/* Unchecked rows are NOT in this count — they are never sent to the
                backend at all. Only selected rows can be skipped. */}
            <p className="mt-1 text-text-tertiary leading-relaxed">
              {t('dialogs.importResult.skippedNote')}
            </p>
          </section>
        )}

        {result.imageFailureNames.length > 0 && (
          <section>
            <div className="font-medium text-warning-ink flex items-center gap-1.5">
              <ImageOff size={12} style={{ color: 'var(--color-warning-ink)' }} />
              {t('dialogs.importResult.images', { count: result.imageFailureNames.length })}
            </div>
            {/* Index keys: the same image file name can fail in TWO profiles of one
                envelope (names are per-profile; only the on-disk GUID differs). */}
            <ul className="mt-1 space-y-0.5 text-text-secondary font-mono text-caption">
              {result.imageFailureNames.map((n, i) => (
                <li key={i} className="truncate">{n}</li>
              ))}
            </ul>
            <p className="mt-1 text-text-tertiary">{t('dialogs.importResult.imagesNote')}</p>
          </section>
        )}

        {(result.hasOrganization || result.adoptedFolderTargets.length > 0 || result.keptLocalFolderTargets.length > 0) && (
          <section>
            <div className="font-medium text-text-primary flex items-center gap-1.5">
              <FolderOpen size={12} className="text-text-tertiary" />
              {t('dialogs.importResult.folders')}
            </div>
            <div className="mt-1 space-y-1.5 text-text-secondary leading-relaxed">
              {result.hasOrganization && <p>{t('dialogs.importResult.organization')}</p>}
              {result.adoptedFolderTargets.length > 0 && (
                <p>{folderSentence(t('dialogs.importResult.adopted', { count: result.adoptedFolderTargets.length, names: NAMES }), result.adoptedFolderTargets.join(', '))}</p>
              )}
              {/* The one consequence that must not pass unread: the receiver's own target
                  won, so the imported profiles act on a DIFFERENT window than authored. */}
              {result.keptLocalFolderTargets.length > 0 && (
                <p className="warning-band pl-2.5 py-1.5 rounded-r">
                  {folderSentence(t('dialogs.importResult.kept', { count: result.keptLocalFolderTargets.length, names: NAMES, em: EM, end: END }), result.keptLocalFolderTargets.join(', '))}
                </p>
              )}
            </div>
          </section>
        )}

        {result.hotkeyCollisions.length > 0 && (
          <section>
            <div className="font-medium text-warning-ink flex items-center gap-1.5">
              <Keyboard size={12} style={{ color: 'var(--color-warning-ink)' }} />
              {t('dialogs.importResult.hotkeys', { count: result.hotkeyCollisions.length })}
            </div>
            <ul className="mt-1 space-y-1 text-text-secondary leading-relaxed">
              {result.hotkeyCollisions.map((msg, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" style={{ color: 'var(--color-warning-ink)' }} />
                  <span>{msg}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </DialogShell>
  );
}
