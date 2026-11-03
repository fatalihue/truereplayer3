import { useEffect, useState } from 'react';
import { AppWindow, Clipboard, Cpu, FileCheck, Image, Pipette, ScanText, type LucideIcon } from 'lucide-react';
import type { ActionItem, AutomationEntry, TriggerConfig } from '../../../bridge/messageTypes';
import { t } from '../../../i18n';
import { useAutomations } from '../../../logic/useAutomations';
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
/** The check of the If's list a condition is, by name (glossary), icon and description; the clipboard's is its own. */
const look = (type: Kind) => (type === 'ClipboardChanged'
  ? { name: 'Clipboard', icon: 'clipboard', desc: t('automations.condition.clipboardDesc') }
  : CHECKS.find(c => c.type === type)!);
const kindOf = (trigger: TriggerConfig): Kind => KINDS.find(k => k.type === trigger.conditionType)?.type ?? 'WindowOpen';
/** The three conditions with a point or a region, which can follow a window. */
const placed = (k: Kind) => k === 'PixelColorMatch' || k === 'ImageFound' || k === 'ScreenText';

/** The automation's trigger as the Inspector's checks read a step: the same names, a region as four numbers. */
function stepOf(trigger: TriggerConfig, profile: string): ActionItem {
  const r = trigger.searchRegion;
  return {
    id: `automation:${profile}`,
    actionType: 'If',
    conditionType: trigger.conditionType === 'ClipboardChanged' ? 'ClipboardMatch' : trigger.conditionType,
    windowProcessName: trigger.windowProcessName ?? '',
    windowTitle: trigger.windowTitle ?? '',
    windowTitleMatchMode: trigger.windowTitleMatchMode ?? 'contains',
    windowMatchForegroundOnly: trigger.windowMatchForegroundOnly,
    filePath: trigger.filePath ?? '',
    pixelX: trigger.pixelX,
    pixelY: trigger.pixelY,
    pixelColor: trigger.pixelColor ?? '',
    pixelTolerance: trigger.pixelTolerance,
    imagePath: trigger.imagePath ?? '',
    imageBase64: trigger.imageBase64 || null,
    confidence: trigger.imageConfidence || 0.8,
    waitImageSearchX: r ? r.x : null,
    waitImageSearchY: r ? r.y : null,
    waitImageSearchW: r ? r.w : null,
    waitImageSearchH: r ? r.h : null,
    conditionOperator: trigger.conditionOperator ?? null,
    conditionOperand: trigger.conditionOperand ?? '',
    ocrReadAs: trigger.ocrReadAs ?? null,
    ocrTextColor: trigger.ocrTextColor ?? '',
    ocrColorTolerance: trigger.ocrColorTolerance ?? 70,
    clipboardPattern: trigger.clipboardPattern ?? '',
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
  toWindow: t('automations.condition.clearedToWindow'),
  toScreen: t('automations.condition.clearedToScreen'),
} as const;

/**
 * The condition: which one (a menu of the seven, with what it was before a change: Ctrl+Z brings it
 * back), the window its coordinates follow, its own fields — the If's — and why it never fires as it is.
 */
export function Condition({ name, trigger, never, change, cmds }: { name: string; trigger: TriggerConfig; never: string | null; change: Change; cmds: Cmds }) {
  const kind = kindOf(trigger);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; keyboard: boolean; button: HTMLButtonElement } | null>(null);
  const [was, setWas] = useState<string | null>(null);
  const [cleared, setCleared] = useState<keyof typeof CLEARED | null>(null);
  const anchored = placed(kind) && trigger.useRelativeCoordinates;
  const anchor: AnchorWindow = { processName: trigger.windowProcessName ?? '', windowTitle: trigger.windowTitle ?? '', titleMatchMode: trigger.windowTitleMatchMode === 'regex' ? 'regex' : 'contains' };
  const target: CheckTarget = {
    edit: (edits) => {
      change(patchOf(edits), edits.map(e => e.field).join('+'));
      return true;
    },
    tools: anchored ? { absolute: true, anchor } : { absolute: true },
    profile: name,
    captureFor: t('automations.condition.captureFor', { name }),
    captureImage: () => imageAsks.set(cmds.captureImage(name), name),
    chooseImage: () => imageAsks.set(cmds.chooseImage(name), name),
    cropImage: () => useAutomationsUi.setState({ crop: name }),
  };
  const step = stepOf(trigger, name);
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
    const hadPoint = trigger.pixelX !== 0 || trigger.pixelY !== 0;
    const hadRegion = !!trigger.searchRegion;
    change({ useRelativeCoordinates: on, ...(hadPoint ? { pixelX: 0, pixelY: 0 } : {}), ...(hadRegion ? { searchRegion: null } : {}) });
    setCleared((kind === 'PixelColorMatch' ? hadPoint : hadRegion) ? (on ? 'toWindow' : 'toScreen') : null);
  };
  // The notice speaks while the field it is about is still empty.
  const showCleared = cleared && (kind === 'PixelColorMatch' ? trigger.pixelX === 0 && trigger.pixelY === 0 : !trigger.searchRegion);
  const windowName = (trigger.windowProcessName ?? '').trim() || (trigger.windowTitle ?? '').trim();

  return (
    <CheckTargetContext.Provider value={target}>
      <Section label={t('automations.condition.label')} hint={was ? t('conditions.was', { name: was }) : t('automations.condition.hint')}>
        <button
          type="button"
          className="insp-check-button"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          aria-label={t('automations.condition.named', { name: cur.name })}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'start'), keyboard: e.detail === 0, button: e.currentTarget })}
        >
          <span className="step-icon" data-icon={cur.icon} />
          <span className="insp-check-name" data-glossary="">{cur.name}</span>
          <span className="step-icon" data-icon="chevron-down" />
        </button>
      </Section>
      {menu && (
        <Menu
          anchor={menu.anchor}
          label={t('automations.condition.menu')}
          focusFirst={menu.keyboard}
          toggle={menu.button}
          onClose={() => setMenu(null)}
          entries={KINDS.map(({ type, Icon }) => {
            const c = look(type);
            return { label: c.name, named: true, icon: Icon, checked: type === kind, tip: c.desc, onSelect: () => choose(type) };
          })}
        />
      )}
      {placed(kind) && (
        <>
          <div className="insp-row">
            <span className="insp-row-label">{t('automations.condition.relative')}</span>
            <Switch label={t('automations.condition.relative')} tip={t('automations.condition.relativeTip')}
              checked={trigger.useRelativeCoordinates} onChange={relative} />
          </div>
          {trigger.useRelativeCoordinates && <WindowCheck step={step} locked={false} anchor />}
          {trigger.useRelativeCoordinates && (
            <p className="am-msg">{windowName ? t('automations.condition.relativeTo', { window: windowName }) : t('automations.condition.relativeToUnnamed')}</p>
          )}
          {showCleared && cleared && <p className="am-msg" data-tone="warn" role="status">{CLEARED[cleared]}</p>}
          <div className="insp-rule" />
        </>
      )}
      <Fields kind={kind} step={step} />
      {never && <p className="am-msg" data-tone="warn">{t('automations.runs.never', { reason: never })}</p>}
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
  const trigger = entry.trigger;
  const name = entry.profile;
  const leave = () => {
    useAutomationsUi.setState({ crop: null });
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.am-panel [data-crop-open]')?.focus({ preventScroll: true }));
  };
  // The image went (another condition, an undo): nothing left to crop.
  useEffect(() => {
    if (trigger.conditionType !== 'ImageFound' || !trigger.imagePath) useAutomationsUi.setState({ crop: null });
  }, [trigger.conditionType, trigger.imagePath]);
  const CropEditor = mod?.CropEditor;
  if (!CropEditor || !trigger.imagePath) return <div className="am-panel-body" />;
  return (
    <CropEditor
      imagePath={trigger.imagePath}
      imageBase64={trigger.imageBase64}
      sub={t('automations.condition.cropSub', { name })}
      colors={{ bg: 'color-mix(in srgb, var(--color-replay) 14%, transparent)', fg: 'var(--color-replay-fg)' }}
      onDone={(rect) => {
        if (trigger.imagePath) imageAsks.set(cmds.cropReference(name, trigger.imagePath, rect), name);
        leave();
      }}
      onRecapture={() => imageAsks.set(cmds.captureImage(name), name)}
      onLeave={leave}
    />
  );
}
