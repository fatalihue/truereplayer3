import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { APP_FOLDER, APP_NAME, TR2_NAME } from '../appIdentity';
import { useBridge } from '../bridge/BridgeContext';
import type { Tr2ImportSummary } from '../bridge/messageTypes';
import { DialogFooter, DialogShell } from '../components/common/DialogShell';
import { t } from '../i18n';
import { closeImport } from './importState';
import { Switch } from './inspector/fields';

type Part = 'macros' | 'settings' | 'remaps' | 'appearance';
const PARTS: readonly Part[] = ['macros', 'settings', 'remaps', 'appearance'];

/** A part's line, with what TrueReplayer 2 has: "141 macros in 15 folders, with 2 images". */
function partLabel(part: Part, s: Tr2ImportSummary | null) {
  if (part === 'macros') {
    if (!s) return t('common.pages.macros');
    const macros = t('shell.import.macros', { count: s.macros });
    const folderCount = s.folders ? t('shell.import.folders', { count: s.folders }) : '';
    const imageCount = s.images ? t('shell.import.images', { count: s.images }) : '';
    if (folderCount && imageCount) return t('shell.import.macrosInFoldersWithImages', { macros, folderCount, imageCount });
    if (folderCount) return t('shell.import.macrosInFolders', { macros, folderCount });
    if (imageCount) return t('shell.import.macrosWithImages', { macros, imageCount });
    return macros;
  }
  if (part === 'settings') return t('shell.import.settings');
  if (part === 'remaps') return s ? t('shell.import.remaps', { count: s.remaps }) : t('shell.import.remapsLabel');
  return t('shell.import.appearance');
}

const available = (part: Part, s: Tr2ImportSummary | null) =>
  !!s && (part === 'macros' ? s.macros > 0 : part === 'remaps' ? s.remaps > 0 : part === 'settings' ? s.settings : s.appearance);

/**
 * "Import from TrueReplayer 2" (plan truereplayer3-paralelo-2026-10-30.md, decision 4): a copy of
 * TrueReplayer 2's macros, settings, remaps, theme and snippets, which TrueReplayer 2 keeps as they
 * are. The engine stages the copy, restarts, and puts it in place before anything loads; what this
 * app had goes to Backups first. It opens from the first-run screen, where it is one of the ways to
 * start, and from Settings › General.
 */
export function ImportTr2() {
  const { send, subscribe } = useBridge();
  const [summary, setSummary] = useState<Tr2ImportSummary | null>(null);
  const [chosen, setChosen] = useState<Record<Part, boolean>>({ macros: true, settings: true, remaps: true, appearance: true });
  const [phase, setPhase] = useState<'idle' | 'working' | 'restarting'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribe((m) => {
    if (m.type === 'import:summary') setSummary(m.payload);
    else if (m.type === 'import:error') { setPhase('idle'); setError(m.payload.message); }
    else if (m.type === 'import:staged') setPhase('restarting');
  }), [subscribe]);
  // Fresh numbers: TrueReplayer 2 may have closed, or changed, since the first-run card counted.
  useEffect(() => { send({ type: 'import:scan', payload: {} }); }, [send]);

  const s = summary;
  const picked = PARTS.filter(p => chosen[p] && available(p, s));
  const blocked = !s || !s.tr2Found || s.tr2Running || picked.length === 0 || phase !== 'idle';
  const run = () => {
    setError(null);
    setPhase('working');
    send({ type: 'import:run', payload: { macros: picked.includes('macros'), settings: picked.includes('settings'), remaps: picked.includes('remaps'), appearance: picked.includes('appearance') } });
  };
  const leave = () => {
    if (phase === 'idle') closeImport();
  };

  return (
    <DialogShell
      icon={<Download size={14} className="text-accent" />}
      title={t('shell.import.title', { tr2: TR2_NAME })}
      size="md"
      zClass="z-(--z-dialog-raised)"
      onClose={leave}
      canClose={() => phase === 'idle'}
      closeOnBackdrop={false}
      footer={<DialogFooter
        secondary={{ label: t('common.actions.cancel'), onClick: leave, disabled: phase !== 'idle' }}
        primary={{ label: phase === 'working' ? t('shell.import.importing') : phase === 'restarting' ? t('shell.import.restarting') : t('common.actions.import'), onClick: run, disabled: blocked, autoFocus: true }} />}
    >
      <div className="p-4 flex flex-col gap-3">
        <p className="text-body text-text-secondary">{t('shell.import.intro', { tr2: TR2_NAME })}</p>
        {s && !s.tr2Found
          ? <p className="text-body text-text-tertiary">{t('shell.import.notFound', { tr2: TR2_NAME })}</p>
          : (
            <div className="flex flex-col gap-1.5">
              {PARTS.map(p => (
                <div key={p} className="flex items-center justify-between gap-3">
                  <span className={available(p, s) ? 'text-body text-text-primary' : 'text-body text-text-tertiary'}>{partLabel(p, s)}</span>
                  <Switch label={partLabel(p, s)} checked={chosen[p] && available(p, s)} disabled={!available(p, s) || phase !== 'idle'}
                    onChange={(on) => setChosen(c => ({ ...c, [p]: on }))} />
                </div>
              ))}
            </div>
          )}
        {s?.tr2Running && (
          <p className="text-minor" style={{ color: 'var(--color-warning-fg, var(--color-recording-fg))' }}>
            {t('shell.import.closeTr2First', { tr2: TR2_NAME })}
          </p>
        )}
        {error && <p className="text-minor" style={{ color: 'var(--color-recording-fg)' }}>{error}</p>}
        <p className="text-minor text-text-tertiary">
          {t('shell.import.stayOff')}
          {' '}
          {s?.tr3HasData && <>{t('shell.import.backupFirst', { app: APP_NAME, dir: APP_FOLDER })}{' '}</>}
          {t('shell.import.restarts', { app: APP_NAME })}
        </p>
      </div>
    </DialogShell>
  );
}
