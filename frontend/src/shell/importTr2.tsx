import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { APP_FOLDER, APP_NAME, TR2_NAME } from '../appIdentity';
import { useBridge } from '../bridge/BridgeContext';
import type { Tr2ImportSummary } from '../bridge/messageTypes';
import { DialogFooter, DialogShell } from '../components/common/DialogShell';
import { useTt } from '../state/LanguageContext';
import { closeImport } from './importState';
import { Switch } from './inspector/fields';

type Part = 'macros' | 'settings' | 'remaps' | 'appearance';
const PARTS: readonly Part[] = ['macros', 'settings', 'remaps', 'appearance'];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function partLabel(part: Part, s: Tr2ImportSummary | null) {
  if (part === 'macros') {
    if (!s) return 'Macros';
    const extra = [s.folders ? `in ${plural(s.folders, 'folder', 'folders')}` : '', s.images ? `with ${plural(s.images, 'image', 'images')}` : '']
      .filter(Boolean).join(', ');
    return `${plural(s.macros, 'macro', 'macros')}${extra ? ' ' + extra : ''}`;
  }
  if (part === 'settings') return 'Settings and hotkeys';
  if (part === 'remaps') return s ? plural(s.remaps, 'key remap', 'key remaps') : 'Key remaps';
  return 'Theme and snippets';
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
  const tt = useTt();
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
      title={`Import from ${TR2_NAME}`}
      size="md"
      zClass="z-(--z-dialog-raised)"
      onClose={leave}
      canClose={() => phase === 'idle'}
      closeOnBackdrop={false}
      footer={<DialogFooter
        secondary={{ label: 'Cancel', onClick: leave, disabled: phase !== 'idle' }}
        primary={{ label: phase === 'working' ? 'Importing…' : phase === 'restarting' ? 'Restarting…' : 'Import', onClick: run, disabled: blocked, autoFocus: true }} />}
    >
      <div className="p-4 flex flex-col gap-3">
        <p className="text-body text-text-secondary">
          {tt(`A copy of what ${TR2_NAME} has. ${TR2_NAME} itself is not changed.`, `Uma cópia do que o ${TR2_NAME} tem. O ${TR2_NAME} não muda.`)}
        </p>
        {s && !s.tr2Found
          ? <p className="text-body text-text-tertiary">{tt(`${TR2_NAME}'s data isn't on this computer.`, `Os dados do ${TR2_NAME} não estão neste computador.`)}</p>
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
            {tt(`Close ${TR2_NAME} first: its files must not change while they are copied.`, `Feche o ${TR2_NAME} antes: os arquivos dele não podem mudar durante a cópia.`)}
          </p>
        )}
        {error && <p className="text-minor" style={{ color: 'var(--color-recording-fg)' }}>{error}</p>}
        <p className="text-minor text-text-tertiary">
          {tt('Automations and “Run on startup” stay off here until you turn them on.', 'Automações e “Run on startup” ficam desligados aqui até você ligar.')}
          {' '}
          {s?.tr3HasData
            ? tt(`What ${APP_NAME} has now is kept in Documents\\${APP_FOLDER}\\Backups first. `, `O que o ${APP_NAME} tem agora fica antes em Documents\\${APP_FOLDER}\\Backups. `)
            : ''}
          {tt(`${APP_NAME} restarts to finish.`, `O ${APP_NAME} reinicia para terminar.`)}
        </p>
      </div>
    </DialogShell>
  );
}
