import { ArrowLeftRight } from 'lucide-react';
import { APP_NAME, TR2_NAME } from '../appIdentity';
import { useBridge } from '../bridge/BridgeContext';
import { DialogFooter, DialogShell } from '../components/common/DialogShell';
import { t } from '../i18n';

/**
 * TrueReplayer 2 was launched while this app runs (plan truereplayer3-paralelo-2026-10-30.md,
 * decision 5): it found its mutex name held, knocked and left. Only one of the two can run, so the
 * choice is to switch — this app exits, saved as ever, and opens TrueReplayer 2 — or to stay. With no
 * installed TrueReplayer 2 to open, switching only closes this app.
 */
export function Tr2Knocked({ tr2Installed, onClose }: { tr2Installed: boolean; onClose: () => void }) {
  const { send } = useBridge();
  const go = () => send({ type: 'coexist:switch', payload: { openTr2: tr2Installed } });
  return (
    <DialogShell
      icon={<ArrowLeftRight size={14} className="text-accent" />}
      title={t('shell.coexist.title', { tr2: TR2_NAME })}
      size="sm"
      zClass="z-(--z-dialog-raised)"
      onClose={onClose}
      footer={<DialogFooter
        secondary={{ label: t('shell.coexist.stay'), onClick: onClose }}
        primary={{ label: tr2Installed ? t('shell.coexist.switchTo', { tr2: TR2_NAME }) : t('shell.coexist.closeApp', { app: APP_NAME }), onClick: go, autoFocus: true }} />}
    >
      <div className="p-4 flex flex-col gap-2">
        <p className="text-body text-text-secondary">{t('shell.coexist.why')}</p>
        <p className="text-minor text-text-tertiary">
          {tr2Installed
            ? t('shell.coexist.switchCloses', { app: APP_NAME, tr2: TR2_NAME })
            : t('shell.coexist.closeAndOpen', { app: APP_NAME, tr2: TR2_NAME })}
        </p>
      </div>
    </DialogShell>
  );
}
