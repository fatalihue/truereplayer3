import { useEffect, useState } from 'react';
import { AppWindow, Clipboard, Cpu, FileCheck, Image, Pipette, ScanText, type LucideIcon } from 'lucide-react';
import type { ActionItem, AutomationEntry, TriggerConfig } from '../../../bridge/messageTypes';
import { useAutomations } from '../../../logic/useAutomations';
import { useTt } from '../../../state/LanguageContext';
import { CHECKS } from '../../inspector/checks';
import { CheckTargetContext, type AnchorWindow, type CheckTarget } from '../../inspector/checkTarget';
import { Section, Switch } from '../../inspector/fields';
import { ImageProbe } from '../../inspector/ImageProbe';
import { loadReferenceCrop, type StepEdit } from '../../inspector/inspectorState';
import { PixelCheck, ScreenTextCheck } from '../../inspector/screenChecks';
import { ClipboardCheck, FileCheck as FileExistsCheck, ProcessCheck, WindowCheck } from '../../inspector/stateChecks';
import { preload, useLoaded } from '../../lazyModule';
import { Menu } from '../../Menu';
import { anchorBelow, type MenuAnchor } from '../../menuAnchor';
import { imageAsks, useAutomationsUi, type Cmds } from './automationsStore';
// The editors' icons come with the Inspector's editors, which this page may come before.
import '../../inspector/editorIcons.css';

/**
 * When… (phase 3, slice 9): the condition an automation watches, in the same editor as the If and
 * While steps — the Inspector's checks, editing the automation's trigger instead of a step
 * (checkTarget: the trigger's fields have the steps' names). An automation watches seven things:
 * an image, a pixel, a screen read, a window, a process, a file, and the clipboard changing (D17).
 * The three with coordinates can follow a window instead of the screen ("Relative to a window", D17).
 */

type Change = (patch: Partial<TriggerConfig>, control?: string) => void;
type Kind = 'ImageFound' | 'PixelColorMatch' | 'ScreenText' | 'WindowOpen' | 'ProcessRunning' | 'FileExists' | 'ClipboardChanged';
const KINDS: { type: Kind; Icon: LucideIcon }[] = [
  { type: 'ImageFound', Icon: Image },
  { type: 'PixelColorMatch', Icon: Pipette },
  { type: 'ScreenText', Icon: ScanText },
  { type: 'WindowOpen', Icon: AppWindow },
  { type: 'ProcessRunning', Icon: Cpu },
  { type: 'FileExists', Icon: FileCheck },
  { type: 'ClipboardChanged', Icon: Clipboard },
];
/** The check of the If's list a condition is, by name, icon and description; the clipboard's is its own. */
const look = (type: Kind) => (type === 'ClipboardChanged'
  ? { name: 'Clipboard', icon: 'clipboard', desc: 'The copied text changes' }
  : CHECKS.find(c => c.type === type)!);
const kindOf = (t: TriggerConfig): Kind => KINDS.find(k => k.type === t.conditionType)?.type ?? 'WindowOpen';
/** The three conditions with a point or a region, which can follow a window. */
const placed = (k: Kind) => k === 'PixelColorMatch' || k === 'ImageFound' || k === 'ScreenText';

/** The automation's trigger as the Inspector's checks read a step: the same names, a region as four numbers. */
function stepOf(t: TriggerConfig, profile: string): ActionItem {
  const r = t.searchRegion;
  return {
    id: `automation:${profile}`,
    actionType: 'If',
    conditionType: t.conditionType === 'ClipboardChanged' ? 'ClipboardMatch' : t.conditionType,
    windowProcessName: t.windowProcessName ?? '',
    windowTitle: t.windowTitle ?? '',
    windowTitleMatchMode: t.windowTitleMatchMode ?? 'contains',
    windowMatchForegroundOnly: t.windowMatchForegroundOnly,
    filePath: t.filePath ?? '',
    pixelX: t.pixelX,
    pixelY: t.pixelY,
    pixelColor: t.pixelColor ?? '',
    pixelTolerance: t.pixelTolerance,
    imagePath: t.imagePath ?? '',
    imageBase64: t.imageBase64 || null,
    confidence: t.imageConfidence || 0.8,
    waitImageSearchX: r ? r.x : null,
    waitImageSearchY: r ? r.y : null,
    waitImageSearchW: r ? r.w : null,
    waitImageSearchH: r ? r.h : null,
    conditionOperator: t.conditionOperator ?? null,
    conditionOperand: t.conditionOperand ?? '',
    ocrReadAs: t.ocrReadAs ?? null,
    ocrTextColor: t.ocrTextColor ?? '',
    ocrColorTolerance: t.ocrColorTolerance ?? 70,
    clipboardPattern: t.clipboardPattern ?? '',
  } as unknown as ActionItem;
}

const int = (v: string, empty: number) => (v.trim() === '' ? empty : Math.trunc(Number(v)) || 0);
/** A change the checks make (the steps' field names, the engine's text forms), as the trigger's. */
function patchOf(edits: StepEdit[]): Partial<TriggerConfig> {
  const p: Partial<TriggerConfig> = {};
  for (const { field, value } of edits) {
    switch (field) {
      case 'waitImageSearchRegion': {
        const [x, y, w, h] = value.split(',').map(Number);
        p.searchRegion = value && w > 0 && h > 0 ? { x, y, w, h } : null;
        break;
      }
      case 'confidence': p.imageConfidence = Number(value) || 0.8; break;
      case 'pixelX': p.pixelX = int(value, 0); break;
      case 'pixelY': p.pixelY = int(value, 0); break;
      case 'pixelTolerance': p.pixelTolerance = int(value, 10); break;
      case 'ocrColorTolerance': p.ocrColorTolerance = int(value, 70); break;
      case 'windowMatchForegroundOnly': p.windowMatchForegroundOnly = value === 'true'; break;
      case 'pixelColor': p.pixelColor = value || null; break;
      case 'ocrReadAs': p.ocrReadAs = value || null; break;
      case 'ocrTextColor': p.ocrTextColor = value || null; break;
      case 'windowProcessName': p.windowProcessName = value; break;
      case 'windowTitle': p.windowTitle = value; break;
      case 'windowTitleMatchMode': p.windowTitleMatchMode = value; break;
      case 'filePath': p.filePath = value; break;
      case 'clipboardPattern': p.clipboardPattern = value; break;
      case 'conditionOperator': p.conditionOperator = value; break;
      case 'conditionOperand': p.conditionOperand = value; break;
    }
  }
  return p;
}

/** Why the coordinates were cleared when "Relative to a window" turned (today's panel's words). */
const CLEARED = {
  toWindow: 'Coordinates cleared — they were screen coordinates. Pick again to store them relative to the window.',
  toScreen: 'Coordinates cleared — they were relative to the window. Pick again to store them as screen coordinates.',
} as const;

/**
 * The condition: which one (a menu of the seven, with what it was before a change: Ctrl+Z brings it
 * back), the window its coordinates follow, its own fields — the If's — and why it never fires as it is.
 */
export function Condition({ name, t, never, change, cmds }: { name: string; t: TriggerConfig; never: string | null; change: Change; cmds: Cmds }) {
  const tt = useTt();
  const kind = kindOf(t);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; keyboard: boolean; button: HTMLButtonElement } | null>(null);
  const [was, setWas] = useState<string | null>(null);
  const [cleared, setCleared] = useState<keyof typeof CLEARED | null>(null);
  const anchored = placed(kind) && t.useRelativeCoordinates;
  const anchor: AnchorWindow = { processName: t.windowProcessName ?? '', windowTitle: t.windowTitle ?? '', titleMatchMode: t.windowTitleMatchMode === 'regex' ? 'regex' : 'contains' };
  const target: CheckTarget = {
    edit: (edits) => {
      change(patchOf(edits), edits.map(e => e.field).join('+'));
      return true;
    },
    tools: anchored ? { absolute: true, anchor } : { absolute: true },
    profile: name,
    captureFor: `for the ${name} automation`,
    captureImage: () => imageAsks.set(cmds.captureImage(name), name),
    chooseImage: () => imageAsks.set(cmds.chooseImage(name), name),
    cropImage: () => useAutomationsUi.setState({ crop: name }),
  };
  const step = stepOf(t, name);
  const cur = look(kind);

  const choose = (next: Kind) => {
    if (next === kind) return;
    setWas(cur.name);
    setCleared(null);
    // Leaving an image leaves its PNG to the next sweep: a stale path under another condition is a
    // file nothing keeps (today's panel). The window fields and the anchor stay.
    change(kind === 'ImageFound' ? { conditionType: next, imagePath: null, imageBase64: null, searchRegion: null } : { conditionType: next });
  };
  // "Relative to a window" says which space the stored numbers are in, and nothing can convert them:
  // turning it clears the point and the region (one re-pick), and says so for the field on screen.
  const relative = (on: boolean) => {
    const hadPoint = t.pixelX !== 0 || t.pixelY !== 0;
    const hadRegion = !!t.searchRegion;
    change({ useRelativeCoordinates: on, ...(hadPoint ? { pixelX: 0, pixelY: 0 } : {}), ...(hadRegion ? { searchRegion: null } : {}) });
    setCleared((kind === 'PixelColorMatch' ? hadPoint : hadRegion) ? (on ? 'toWindow' : 'toScreen') : null);
  };
  // The notice speaks while the field it is about is still empty.
  const showCleared = cleared && (kind === 'PixelColorMatch' ? t.pixelX === 0 && t.pixelY === 0 : !t.searchRegion);
  const windowName = (t.windowProcessName ?? '').trim() || (t.windowTitle ?? '').trim();

  return (
    <CheckTargetContext.Provider value={target}>
      <Section label="Condition" hint={was ? `Was ${was} · Ctrl+Z brings it back` : 'The same condition editor as the If and While steps.'}>
        <button
          type="button"
          className="insp-check-button"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          aria-label={`Condition: ${cur.name}`}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'start'), keyboard: e.detail === 0, button: e.currentTarget })}
        >
          <span className="step-icon" data-icon={cur.icon} />
          <span className="insp-check-name">{cur.name}</span>
          <span className="step-icon" data-icon="chevron-down" />
        </button>
      </Section>
      {menu && (
        <Menu
          anchor={menu.anchor}
          label="Conditions"
          focusFirst={menu.keyboard}
          toggle={menu.button}
          onClose={() => setMenu(null)}
          entries={KINDS.map(({ type, Icon }) => {
            const c = look(type);
            return { label: c.name, icon: Icon, checked: type === kind, tip: c.desc, onSelect: () => choose(type) };
          })}
        />
      )}
      {placed(kind) && (
        <>
          <div className="insp-row">
            <span className="insp-row-label">Relative to a window</span>
            <Switch label="Relative to a window" tip={tt('Coordinates follow the window instead of the screen', 'As coordenadas seguem a janela em vez da tela')}
              checked={t.useRelativeCoordinates} onChange={relative} />
          </div>
          {t.useRelativeCoordinates && <WindowCheck step={step} locked={false} anchor />}
          {t.useRelativeCoordinates && (
            <p className="am-msg">{windowName ? `Relative to ${windowName}’s top-left corner` : 'Relative to the window’s top-left corner — name it above'}</p>
          )}
          {showCleared && cleared && <p className="am-msg" data-tone="warn" role="status">{CLEARED[cleared]}</p>}
          <div className="insp-rule" />
        </>
      )}
      <Fields kind={kind} step={step} />
      {never && <p className="am-msg" data-tone="warn">Never fires as it is: {never}</p>}
    </CheckTargetContext.Provider>
  );
}

/** The condition's own fields: the If's, with what an automation adds (the clipboard's "changes"). */
function Fields({ kind, step }: { kind: Kind; step: ActionItem }) {
  switch (kind) {
    case 'ImageFound': return <ImageProbe step={step} locked={false} reads="found" />;
    case 'PixelColorMatch': return <PixelCheck step={step} locked={false} reads="found" />;
    case 'ScreenText': return <ScreenTextCheck step={step} locked={false} />;
    case 'WindowOpen': return <WindowCheck step={step} locked={false} />;
    case 'ProcessRunning': return <ProcessCheck step={step} locked={false} />;
    case 'FileExists': return <FileExistsCheck step={step} locked={false} />;
    case 'ClipboardChanged': return <ClipboardCheck step={step} locked={false} changes />;
  }
}

/** The reference image being cropped, in the expanded panel (the Inspector's crop, dialogos-087). */
export function CropView({ entry }: { entry: AutomationEntry }) {
  const mod = useLoaded(loadReferenceCrop);
  const cmds = useAutomations();
  useEffect(() => {
    if (!mod) void preload(loadReferenceCrop);
  }, [mod]);
  const t = entry.trigger;
  const name = entry.profile;
  const leave = () => {
    useAutomationsUi.setState({ crop: null });
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.am-panel [data-crop-open]')?.focus({ preventScroll: true }));
  };
  // The image went (another condition, an undo): nothing left to crop.
  useEffect(() => {
    if (t.conditionType !== 'ImageFound' || !t.imagePath) useAutomationsUi.setState({ crop: null });
  }, [t.conditionType, t.imagePath]);
  const CropEditor = mod?.CropEditor;
  if (!CropEditor || !t.imagePath) return <div className="am-panel-body" />;
  return (
    <CropEditor
      imagePath={t.imagePath}
      imageBase64={t.imageBase64}
      sub={`Automation of ${name} · expanded`}
      colors={{ bg: 'color-mix(in srgb, var(--color-replay) 14%, transparent)', fg: 'var(--color-replay-fg)' }}
      onDone={(rect) => {
        if (t.imagePath) imageAsks.set(cmds.cropReference(name, t.imagePath, rect), name);
        leave();
      }}
      onRecapture={() => imageAsks.set(cmds.captureImage(name), name)}
      onLeave={leave}
    />
  );
}
