import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronDown, Folder, FolderPlus, Pencil, Trash2 } from 'lucide-react';
import type { ProfileEntry, ProfileOrderData } from '../../bridge/messageTypes';
import { DialogFooter, DialogShell } from '../../components/common/DialogShell';
import { FieldError } from '../../components/common/FieldError';
import { useMacro } from '../../logic/useMacro';
import { DEFAULT_FOLDER_COLOR } from '../../themes';
import { ColorGrid } from './ColorGrid';
import { ExportDialog } from './ExportDialog';
import { nameTaken } from './model';

export type LibraryDialogState =
  | { kind: 'renameMacro' | 'renameFolder' | 'deleteMacro'; name: string }
  | { kind: 'newFolder' }
  | { kind: 'export'; names: string[] };

/**
 * The library's dialogs. Loaded when the first one opens (rule 6): they are not part of opening
 * the app.
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
