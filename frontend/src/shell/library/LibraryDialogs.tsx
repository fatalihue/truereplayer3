import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AppWindow, ChevronDown, Eraser, Folder, FolderPlus, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useBridge } from '../../bridge/BridgeContext';
import type { ProfileEntry, ProfileOrderData } from '../../bridge/messageTypes';
import { DialogFooter, DialogShell } from '../../components/common/DialogShell';
import { FieldError } from '../../components/common/FieldError';
import { useMacro } from '../../logic/useMacro';
import { useSteps } from '../../logic/useSteps';
import { useTt } from '../../state/LanguageContext';
import { useToast } from '../../state/ToastContext';
import { DEFAULT_FOLDER_COLOR } from '../../themes';
import { Switch } from '../inspector/fields';
import { asMode, targetProblem, type TargetValue } from '../inspector/macro/target';
import { TargetFields } from '../inspector/macro/TargetFields';
import { useApp } from '../store';
import { ColorGrid } from './ColorGrid';
import { ExportDialog } from './ExportDialog';
import { nameTaken } from './model';

export type LibraryDialogState =
  | { kind: 'renameMacro' | 'renameFolder' | 'deleteMacro' | 'revertMacro' | 'clearSteps' | 'folderTarget'; name: string }
  | { kind: 'newFolder' }
  | { kind: 'export'; names: string[] };

/**
 * The dialogs of the library and of the macro's menu. Loaded when the first one opens (rule 6):
 * they are not part of opening the app.
 */
export default function LibraryDialog({ dialog, profiles, order, onClose }: {
  dialog: LibraryDialogState;
  profiles: ProfileEntry[];
  order: ProfileOrderData;
  onClose: () => void;
}) {
  const macro = useMacro();
  switch (dialog.kind) {
    case 'renameMacro':
      return (
        <NameDialog
          title="Rename macro"
          initial={dialog.name}
          placeholder="New name…"
          names={profiles.map(p => p.name)}
          takenMessage="A macro with that name already exists."
          onRename={(name) => macro.rename(dialog.name, name)}
          onClose={onClose}
        />
      );
    case 'renameFolder':
      return (
        <NameDialog
          title="Rename folder"
          initial={dialog.name}
          placeholder="New folder name…"
          names={order.folders.map(f => f.name)}
          takenMessage="A folder with that name already exists."
          onRename={(name) => macro.renameFolder(dialog.name, name)}
          onClose={onClose}
        />
      );
    case 'newFolder':
      return <NewFolderDialog folders={order.folders.map(f => f.name)} onCreate={macro.createFolder} onClose={onClose} />;
    case 'deleteMacro':
      return <DeleteMacroDialog name={dialog.name} onDelete={() => macro.remove(dialog.name)} onClose={onClose} />;
    case 'revertMacro':
      return <RevertMacroDialog name={dialog.name} onRevert={macro.revert} onClose={onClose} />;
    case 'clearSteps':
      return <ClearStepsDialog name={dialog.name} onClose={onClose} />;
    case 'folderTarget':
      return <FolderTargetDialog folderName={dialog.name} profiles={profiles} order={order} onClose={onClose} />;
    case 'export':
      return <ExportDialog profiles={profiles} order={order} initial={dialog.names} onExport={macro.exportMacros} onClose={onClose} />;
  }
}

/** Focus the field and select what it holds, before the dialog takes the focus for itself. */
function useSelectedField() {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return ref;
}

/**
 * Renaming a macro or a folder. A name another one already has (without case — names are files,
 * or the folder list) keeps the dialog open with the reason, and Rename stays off; the same name
 * just closes it.
 */
function NameDialog({ title, initial, placeholder, names, takenMessage, onRename, onClose }: {
  title: string;
  initial: string;
  placeholder: string;
  names: string[];
  takenMessage: string;
  onRename: (name: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const field = useSelectedField();
  const taken = nameTaken(value, names, initial);
  const confirm = () => {
    const name = value.trim();
    if (!name || taken) return;
    if (name !== initial) onRename(name);
    onClose();
  };
  return (
    <DialogShell
      icon={<Pencil size={14} className="text-accent" />}
      title={title}
      size="sm"
      onClose={onClose}
      footer={<DialogFooter secondary={{ label: 'Cancel', onClick: onClose }} primary={{ label: 'Rename', onClick: confirm, disabled: !value.trim() || taken }} />}
    >
      <div className="p-4 flex flex-col">
        <input
          ref={field}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }}
          placeholder={placeholder}
          aria-label={placeholder.replace('…', '')}
          className="input-field font-sans"
        />
        <FieldError show={taken}>{takenMessage}</FieldError>
      </div>
    </DialogShell>
  );
}

/** A new folder: a name nobody has, a colour, and a preview of how it will read in the library. */
function NewFolderDialog({ folders, onCreate, onClose }: {
  folders: string[];
  onCreate: (name: string, color: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(DEFAULT_FOLDER_COLOR);
  const field = useSelectedField();
  const taken = nameTaken(name, folders);
  const confirm = () => {
    const trimmed = name.trim();
    if (!trimmed || taken) return;
    onCreate(trimmed, color);
    onClose();
  };
  return (
    <DialogShell
      icon={<FolderPlus size={14} className="text-accent" />}
      title="New folder"
      size="sm"
      onClose={onClose}
      footer={<DialogFooter secondary={{ label: 'Cancel', onClick: onClose }} primary={{ label: 'Create', onClick: confirm, disabled: !name.trim() || taken }} />}
    >
      <div className="p-4 flex flex-col">
        <input
          ref={field}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } }}
          placeholder="Folder name…"
          aria-label="Folder name"
          className="input-field font-sans mb-4"
        />
        <ColorGrid value={color} onPick={setColor} />
        <div className="lib-folder-preview" style={{ '--folder-color': color } as CSSProperties}>
          <ChevronDown aria-hidden="true" />
          <Folder aria-hidden="true" />
          <span>{name.trim() || 'Folder name'}</span>
          <span>preview</span>
        </div>
        <FieldError show={taken}>A folder with that name already exists.</FieldError>
      </div>
    </DialogShell>
  );
}

/**
 * Deleting a macro: its file and its images go, with no undo. Cancel holds the focus and Enter on
 * the card is contained, so a reflexive Enter never deletes; only the Delete button does.
 */
function DeleteMacroDialog({ name, onDelete, onClose }: { name: string; onDelete: () => void; onClose: () => void }) {
  return (
    <DialogShell
      icon={<Trash2 size={14} style={{ color: 'var(--color-recording-fg)' }} />}
      title="Delete macro"
      size="sm"
      onClose={onClose}
      onCardKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
      footer={<DialogFooter danger secondary={{ label: 'Cancel', onClick: onClose, autoFocus: true }} primary={{ label: 'Delete', onClick: () => { onDelete(); onClose(); } }} />}
    >
      <div className="p-4 flex flex-col gap-2">
        <p className="text-body text-text-secondary">
          Delete macro <span className="text-text-primary font-medium">'{name}'</span>?
        </p>
        <p className="text-minor text-text-tertiary">Its file and its images are deleted. This can't be undone.</p>
      </div>
    </DialogShell>
  );
}

/**
 * "Revert to when I opened it": the engine writes back the copy it took on opening and reopens the
 * macro, dropping the edits and their undo history. The engine does not ask, so this does, the way
 * the delete does: Cancel holds the focus.
 */
function RevertMacroDialog({ name, onRevert, onClose }: { name: string; onRevert: () => void; onClose: () => void }) {
  return (
    <DialogShell
      icon={<RotateCcw size={14} style={{ color: 'var(--color-recording-fg)' }} />}
      title="Revert macro"
      size="sm"
      onClose={onClose}
      onCardKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
      footer={<DialogFooter danger secondary={{ label: 'Cancel', onClick: onClose, autoFocus: true }} primary={{ label: 'Revert', onClick: () => { onRevert(); onClose(); } }} />}
    >
      <div className="p-4 flex flex-col gap-2">
        <p className="text-body text-text-secondary">
          Put <span className="text-text-primary font-medium">'{name}'</span> back the way it was when you opened it?
        </p>
        <p className="text-minor text-text-tertiary">The changes since then are lost, and Ctrl+Z can't bring them back.</p>
      </div>
    </DialogShell>
  );
}

/**
 * Clear all steps (casca-060 to 063): every step of the open macro goes, and Ctrl+Z brings them back.
 * Cancel holds the focus, as in the other confirmations. It closes by itself once there is nothing it
 * could clear: the list is empty, a run started, or another macro opened under it.
 */
function ClearStepsDialog({ name, onClose }: { name: string; onClose: () => void }) {
  const steps = useApp(a => a.actions.length);
  const busy = useApp(a => a.status !== 'ready');
  const open = useApp(a => a.activeProfile);
  const { clear } = useSteps();
  const gone = steps === 0 || busy || open !== name;
  useEffect(() => { if (gone) onClose(); }, [gone, onClose]);
  return (
    <DialogShell
      icon={<Eraser size={14} style={{ color: 'var(--color-recording-fg)' }} />}
      title="Clear all steps"
      size="sm"
      onClose={onClose}
      onCardKeyDown={(e) => { if (e.key === 'Enter') e.stopPropagation(); }}
      footer={<DialogFooter danger secondary={{ label: 'Cancel', onClick: onClose, autoFocus: true }} primary={{ label: 'Clear all', onClick: () => { if (!gone) clear({}); onClose(); } }} />}
    >
      <div className="p-4 flex flex-col gap-2">
        <p className="text-body text-text-secondary">
          Clear all {steps} step{steps === 1 ? '' : 's'} of <span className="text-text-primary font-medium">'{name}'</span>?
        </p>
        <p className="text-minor text-text-tertiary">Ctrl+Z brings them back.</p>
      </div>
    </DialogShell>
  );
}

/**
 * A folder's window target (dialogos-038): the Inspector's fields, for every macro in it without a
 * target of its own. Saved by Set target, because a folder's settings are in no macro's Ctrl+Z.
 * Remove asks the engine and the toast comes with its confirmation (a removal that would make two
 * hotkeys collide is refused, and the dialog stays). Turning Relative coordinates while macros read
 * their points in the folder's space holds Set target until the note about them is read
 * (dialogos-048 and 049): a folder has no steps of its own to convert.
 */
function FolderTargetDialog({ folderName, profiles, order, onClose }: {
  folderName: string;
  profiles: ProfileEntry[];
  order: ProfileOrderData;
  onClose: () => void;
}) {
  const macro = useMacro();
  const tt = useTt();
  const { showToast } = useToast();
  const { subscribe } = useBridge();
  const folder = order.folders.find(f => f.name === folderName);
  const own = !!folder?.hasWindowTarget;
  const savedRelative = !!folder?.useRelativeCoordinates;
  const [value, setValue] = useState<TargetValue>(() => ({
    processName: folder?.windowTargetProcessName ?? '',
    windowTitle: folder?.windowTargetWindowTitle ?? '',
    titleMatchMode: asMode(folder?.windowTargetTitleMatchMode),
  }));
  // The newest fields for Set target: a field still being typed commits as it is left, which is
  // just before the click that reads this.
  const latest = useRef(value);
  const [relative, setRelative] = useState(savedRelative);
  const [bringToFocus, setBringToFocus] = useState(!!folder?.bringToFocus);
  const [restorePosition, setRestorePosition] = useState(!!folder?.restorePosition);
  const [restoreSize, setRestoreSize] = useState(!!folder?.restoreSize);
  const inheriting = (folder?.items ?? []).filter(n => { const p = profiles.find(q => q.name === n); return !!p && !p.hasWindowTarget; }).length;
  const [noteRead, setNoteRead] = useState(false);
  const note = inheriting > 0 && !noteRead && relative !== savedRelative;
  const problem = targetProblem(value);

  const asked = useRef(false);
  const live = useRef({ onClose, showToast, tt, macro });
  useEffect(() => { live.current = { onClose, showToast, tt, macro }; });
  useEffect(() => subscribe((message) => {
    if (message.type !== 'profile:folderWindowTargetRemoved' || message.payload.folderName !== folderName || !asked.current) return;
    asked.current = false;
    const r = message.payload;
    const l = live.current;
    if (r.hadTarget) {
      const label = r.processName || r.windowTitle || 'target';
      l.showToast(l.tt(`Removed folder target (${label}) from "${r.folderName}"`, `Alvo da pasta (${label}) removido de "${r.folderName}"`), {
        type: 'success',
        duration: 10000,
        action: {
          label: 'Undo',
          // Everything the removal wiped, the switches and the captured rect included.
          onClick: () => l.macro.setFolderWindowTarget({
            folderName: r.folderName, processName: r.processName, windowTitle: r.windowTitle, titleMatchMode: r.titleMatchMode,
            relativeCoordinates: r.relativeCoordinates, bringToFocus: r.bringToFocus, restorePosition: r.restorePosition, restoreSize: r.restoreSize,
            windowX: r.windowX, windowY: r.windowY, windowWidth: r.windowWidth, windowHeight: r.windowHeight,
          }),
        },
      });
    }
    l.onClose();
  }), [subscribe, folderName]);

  const set = () => {
    const v = latest.current;
    if (targetProblem(v) || note) return;
    macro.setFolderWindowTarget({
      folderName, processName: v.processName.trim(), windowTitle: v.windowTitle.trim(), titleMatchMode: v.titleMatchMode,
      relativeCoordinates: relative, bringToFocus, restorePosition, restoreSize,
    });
    onClose();
  };
  const row = (label: string, on: boolean, setOn: (on: boolean) => void, tip: string, disabled = false) => (
    <div className="insp-row">
      <Switch label={label} checked={on} disabled={disabled} tip={tip} onChange={setOn} />
      <span className="insp-row-label">{label}</span>
    </div>
  );

  return (
    <DialogShell
      icon={<AppWindow size={14} className="text-text-tertiary" />}
      title="Folder window target"
      onClose={onClose}
      // A form of several fields: a stray click on the scrim must not drop them (Esc or Cancel only).
      closeOnBackdrop={false}
      footerStart={own ? (
        <button type="button" className="insp-link" style={{ color: 'var(--color-recording-fg)' }} onClick={() => { asked.current = true; macro.removeFolderWindowTarget(folderName); }}>
          Remove
        </button>
      ) : undefined}
      footer={<DialogFooter
        secondary={{ label: 'Cancel', onClick: onClose }}
        primary={{
          label: 'Set target',
          onClick: set,
          disabled: problem !== null || note,
          tip: note ? tt("Read the note about this folder's macros first", 'Leia o aviso sobre os macros desta pasta primeiro') : undefined,
        }}
      />}
    >
      <div className="p-4 flex flex-col gap-3">
        <p className="text-minor text-text-secondary">
          For every macro in <span className="text-text-primary font-medium">‘{folderName}’</span> without a target of its own.
        </p>
        <TargetFields id={`folder:${folderName}`} value={value} onChange={(patch) => { latest.current = { ...latest.current, ...patch }; setValue(latest.current); }} />
        {row('Relative coordinates', relative, setRelative,
          tt("The points of its macros' steps follow the window when it moves", 'Os pontos dos passos dos macros acompanham a janela quando ela se move'),
          !relative && targetProblem(value) === 'empty')}
        {note && (
          <div className="mset-convert" role="status">
            <span>
              {inheriting} macro{inheriting === 1 ? '' : 's'} in this folder use{inheriting === 1 ? 's' : ''} its target, with X/Y set for {savedRelative ? 'relative' : 'absolute'} coords.
              They are not converted: if a macro's clicks land in the wrong place, open it and run
              “Convert coordinates to {savedRelative ? 'absolute' : 'relative'}” (Ctrl+K).
            </span>
            <span className="mset-convert-actions">
              <button type="button" className="insp-button" data-primary="" onClick={() => setNoteRead(true)}>Got it</button>
            </span>
          </div>
        )}
        {row('Bring to focus', bringToFocus, setBringToFocus,
          tt('Brings the window to the front before a run. With it on, the hotkeys work from any window.', 'Traz a janela para a frente antes de rodar. Ligado, os atalhos funcionam de qualquer janela.'))}
        {row('Restore position', restorePosition, setRestorePosition,
          tt('Puts the window back where it was captured, before a run', 'Devolve a janela à posição capturada, antes de rodar'))}
        {row('Restore size', restoreSize, setRestoreSize,
          tt('Puts the window back to the captured size, before a run', 'Devolve a janela ao tamanho capturado, antes de rodar'))}
        <button
          type="button"
          className="insp-button"
          disabled={problem !== null}
          data-tip={tt('Reads where the window is now, and its size, for Restore position and Restore size', 'Lê agora onde a janela está e o tamanho dela, para Restore position e Restore size')}
          onClick={() => macro.updateWindowSize({ folderName, processName: value.processName || undefined, windowTitle: value.windowTitle || undefined, titleMatchMode: value.titleMatchMode })}
        >
          Update window size &amp; position
        </button>
      </div>
    </DialogShell>
  );
}
