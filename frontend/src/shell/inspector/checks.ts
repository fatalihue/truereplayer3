import { t } from '../../i18n';
import type { CheckOpener } from './inspectorState';

/** The probe families an If, an Else If or a While can check (the engine's conditionType). */
export type ConditionType =
  | 'ImageFound' | 'PixelColorMatch' | 'ScreenText' | 'WindowOpen' | 'ProcessRunning' | 'FileExists'
  | 'ClipboardMatch' | 'Variable' | 'BrowserElementState' | 'Random' | 'TimeWindow';

export interface Check {
  type: ConditionType;
  /** The condition's name: glossary, the same in both languages (i18n/glossario.ts). */
  name: string;
  icon: string;
  /** What it looks at, in one line (the catalog's conditions.desc): the Check menu's tip, and the
   *  line under the name in the list of a step being made. */
  desc: string;
  /** Made on the screen first (the image, the pixel, the region to read): Esc there makes nothing. */
  capture?: boolean;
}

/** The Check list, in the concept's order (EditorPanels board). */
export const CHECKS: Check[] = [
  { type: 'ImageFound', name: 'Image found', icon: 'image', desc: t('conditions.desc.ImageFound'), capture: true },
  { type: 'PixelColorMatch', name: 'Pixel color', icon: 'pipette', desc: t('conditions.desc.PixelColorMatch'), capture: true },
  { type: 'ScreenText', name: 'Text on screen', icon: 'scan-text', desc: t('conditions.desc.ScreenText'), capture: true },
  { type: 'WindowOpen', name: 'Window open', icon: 'app-window', desc: t('conditions.desc.WindowOpen') },
  { type: 'ProcessRunning', name: 'Process running', icon: 'cpu', desc: t('conditions.desc.ProcessRunning') },
  { type: 'FileExists', name: 'File exists', icon: 'file-check', desc: t('conditions.desc.FileExists') },
  { type: 'ClipboardMatch', name: 'Clipboard', icon: 'clipboard', desc: t('conditions.desc.ClipboardMatch') },
  { type: 'Variable', name: 'Variable', icon: 'variable', desc: t('conditions.desc.Variable') },
  { type: 'BrowserElementState', name: 'Browser element', icon: 'globe', desc: t('conditions.desc.BrowserElementState') },
  { type: 'Random', name: 'Random', icon: 'dices', desc: t('conditions.desc.Random') },
  { type: 'TimeWindow', name: 'Time', icon: 'clock', desc: t('conditions.desc.TimeWindow') },
];

/** The checks of a state, the six an Assert takes (the engine's actions:insertAssert). */
export type StateCheck = Extract<ConditionType, 'WindowOpen' | 'ProcessRunning' | 'FileExists' | 'ClipboardMatch' | 'Variable' | 'TimeWindow'>;
const STATE_CHECKS: ReadonlySet<ConditionType> = new Set<StateCheck>(['WindowOpen', 'ProcessRunning', 'FileExists', 'ClipboardMatch', 'Variable', 'TimeWindow']);
export const isStateCheck = (type: ConditionType): type is StateCheck => STATE_CHECKS.has(type);

/**
 * A While takes every check but Random: a coin flip has no stable way out of a loop. An Assert,
 * and a Wait until (an Assert that waits, then stops quietly), take the checks of a state: an image
 * and a pixel have their waits, a coin flip is no requirement, and a page element has Assert Element.
 */
export const checksFor = (opener: CheckOpener | string): Check[] =>
  opener === 'While' ? CHECKS.filter(c => c.type !== 'Random')
  : opener === 'Assert' || opener === 'WaitUntil' ? CHECKS.filter(c => isStateCheck(c.type))
  : CHECKS;

/** The step type a check being made becomes: a Wait until is an Assert. */
export const openerType = (opener: CheckOpener) => (opener === 'WaitUntil' ? 'Assert' : opener);

export const checkOf = (type: string | null | undefined): Check | undefined =>
  CHECKS.find(c => c.type.toLowerCase() === (type ?? '').toLowerCase());
