import type { CheckOpener } from './inspectorState';

/** The probe families an If, an Else If or a While can check (the engine's conditionType). */
export type ConditionType =
  | 'ImageFound' | 'PixelColorMatch' | 'ScreenText' | 'WindowOpen' | 'ProcessRunning' | 'FileExists'
  | 'ClipboardMatch' | 'Variable' | 'BrowserElementState' | 'Random' | 'TimeWindow';

export interface Check {
  type: ConditionType;
  name: string;
  icon: string;
  desc: string;
  /** Made on the screen first (the image, the pixel, the region to read): Esc there makes nothing. */
  capture?: boolean;
  /** What "Passes when … is" names; the checks of a state read "Met" instead of "Found". */
  subject: string | null;
}

/** The Check list, in the concept's order (EditorPanels board). */
export const CHECKS: Check[] = [
  { type: 'ImageFound', name: 'Image found', icon: 'image', desc: 'An image on the screen — you capture it first', capture: true, subject: 'the image' },
  { type: 'PixelColorMatch', name: 'Pixel color', icon: 'pipette', desc: 'The color of one point — you pick it first', capture: true, subject: 'the color' },
  { type: 'ScreenText', name: 'Text on screen', icon: 'scan-text', desc: 'Text read in a region — you draw it first', capture: true, subject: null },
  { type: 'WindowOpen', name: 'Window open', icon: 'app-window', desc: 'A window, by its process or its title', subject: 'the window' },
  { type: 'ProcessRunning', name: 'Process running', icon: 'cpu', desc: 'A program running, with a window or not', subject: 'the process' },
  { type: 'FileExists', name: 'File exists', icon: 'file-check', desc: 'A file or a folder on the disk', subject: 'the file' },
  { type: 'ClipboardMatch', name: 'Clipboard', icon: 'clipboard', desc: 'The text that was copied', subject: null },
  { type: 'Variable', name: 'Variable', icon: 'variable', desc: 'A variable, compared with a value', subject: null },
  { type: 'BrowserElementState', name: 'Browser element', icon: 'globe', desc: 'An element of the page, through the extension', subject: 'the element' },
  { type: 'Random', name: 'Random', icon: 'dices', desc: 'A chance, in percent', subject: null },
  { type: 'TimeWindow', name: 'Time', icon: 'clock', desc: 'A time of day and days of the week', subject: null },
];

/** A While takes every check but Random: a coin flip has no stable way out of a loop. */
export const checksFor = (opener: CheckOpener | string): Check[] =>
  opener === 'While' ? CHECKS.filter(c => c.type !== 'Random') : CHECKS;

export const checkOf = (type: string | null | undefined): Check | undefined =>
  CHECKS.find(c => c.type.toLowerCase() === (type ?? '').toLowerCase());
