import { ArrowLeftRight } from 'lucide-react';
import { APP_NAME, TR2_NAME } from '../appIdentity';
import { useBridge } from '../bridge/BridgeContext';
import { DialogFooter, DialogShell } from '../components/common/DialogShell';
import { useTt } from '../state/LanguageContext';

/**
 * TrueReplayer 2 was launched while this app runs (plan truereplayer3-paralelo-2026-10-30.md,
 * decision 5): it found its mutex name held, knocked and left. Only one of the two can run, so the
 * choice is to switch — this app exits, saved as ever, and opens TrueReplayer 2 — or to stay. With no
 * installed TrueReplayer 2 to open, switching only closes this app.
 */
export function Tr2Knocked({ tr2Installed, onClose }: { tr2Installed: boolean; onClose: () => void }) {
  const { send } = useBridge();
  const tt = useTt();
  const go = () => send({ type: 'coexist:switch', payload: { openTr2: tr2Installed } });
  return (
    <DialogShell
      icon={<ArrowLeftRight size={14} className="text-accent" />}
      title={`${TR2_NAME} tried to open`}
      size="sm"
      zClass="z-(--z-dialog-raised)"
      onClose={onClose}
      footer={<DialogFooter
        secondary={{ label: 'Stay here', onClick: onClose }}
        primary={{ label: tr2Installed ? `Switch to ${TR2_NAME}` : `Close ${APP_NAME}`, onClick: go, autoFocus: true }} />}
    >
      <div className="p-4 flex flex-col gap-2">
        <p className="text-body text-text-secondary">
          {tt('Only one can run at a time: shortcuts, remapped keys, automations and the browser extension would clash.',
            'Só um abre por vez: atalhos, teclas remapeadas, automações e a extensão do navegador iriam brigar.')}
        </p>
        <p className="text-minor text-text-tertiary">
          {tr2Installed
            ? tt(`Switching closes ${APP_NAME} — everything is already saved — and opens ${TR2_NAME}.`,
              `Trocar fecha o ${APP_NAME} — tudo já está salvo — e abre o ${TR2_NAME}.`)
            : tt(`Close ${APP_NAME} — everything is already saved — and open ${TR2_NAME} again.`,
              `Feche o ${APP_NAME} — tudo já está salvo — e abra o ${TR2_NAME} de novo.`)}
        </p>
      </div>
    </DialogShell>
  );
}
