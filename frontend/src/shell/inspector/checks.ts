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
  /** The desc in pt-BR, for the Check menu's tip. */
  descPt: string;
  /** Made on the screen first (the image, the pixel, the region to read): Esc there makes nothing. */
  capture?: boolean;
  /** What "Passes when … is" names; the checks of a state read "Met" instead of "Found". */
  subject: string | null;
}

/** The Check list, in the concept's order (EditorPanels board). */
export const CHECKS: Check[] = [
  { type: 'ImageFound', name: 'Image found', icon: 'image', desc: 'An image on the screen — you capture it first', descPt: 'Uma imagem na tela — você a captura antes', capture: true, subject: 'the image' },
  { type: 'PixelColorMatch', name: 'Pixel color', icon: 'pipette', desc: 'The color of one point — you pick it first', descPt: 'A cor de um ponto — você o escolhe antes', capture: true, subject: 'the color' },
  { type: 'ScreenText', name: 'Text on screen', icon: 'scan-text', desc: 'Text read in a region — you draw it first', descPt: 'Um texto lido numa região — você a desenha antes', capture: true, subject: null },
  { type: 'WindowOpen', name: 'Window open', icon: 'app-window', desc: 'A window, by its process or its title', descPt: 'Uma janela, pelo processo ou pelo título', subject: 'the window' },
  { type: 'ProcessRunning', name: 'Process running', icon: 'cpu', desc: 'A program running, with a window or not', descPt: 'Um programa rodando, com janela ou não', subject: 'the process' },
  { type: 'FileExists', name: 'File exists', icon: 'file-check', desc: 'A file or a folder on the disk', descPt: 'Um arquivo ou uma pasta no disco', subject: 'the file' },
  { type: 'ClipboardMatch', name: 'Clipboard', icon: 'clipboard', desc: 'The text that was copied', descPt: 'O texto que foi copiado', subject: null },
  { type: 'Variable', name: 'Variable', icon: 'variable', desc: 'A variable, compared with a value', descPt: 'Uma variável, comparada com um valor', subject: null },
  { type: 'BrowserElementState', name: 'Browser element', icon: 'globe', desc: 'An element of the page, through the extension', descPt: 'Um elemento da página, pela extensão', subject: 'the element' },
  { type: 'Random', name: 'Random', icon: 'dices', desc: 'A chance, in percent', descPt: 'Uma chance, em porcentagem', subject: null },
  { type: 'TimeWindow', name: 'Time', icon: 'clock', desc: 'A time of day and days of the week', descPt: 'Um horário e dias da semana', subject: null },
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
