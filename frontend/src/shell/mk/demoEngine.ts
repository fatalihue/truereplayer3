// PROTÓTIPO MK (ver mkModel.ts). No Vite, sem o WebView2, um motor falso faz o papel do C#: responde
// às mensagens que a casca já manda (ui:ready, profile:click, settings:change, remap:save) com dados
// de exemplo. Nenhuma mensagem nova: é a mesma ponte, com um outro lado de mentira.
import type { ActionItem, ProfileEntry, ProfileFolder } from '../../bridge/messageTypes';

type Listener = (event: { data: unknown }) => void;
type Outgoing = { type: string; payload?: Record<string, unknown> };

let n = 0;
const step = (actionType: string, extra: Partial<ActionItem> = {}): ActionItem => ({
  actionType, atCursor: false, browserText: '', comment: '', conditionNegate: false, conditionTimeout: 0, confidence: 0.8,
  daysOfWeek: 0, delay: 0, holdDurationMs: 0, id: `mk${String(++n).padStart(30, '0')}`, imageBase64: '', imagePath: '',
  isFocusClick: false, isInsertionPoint: false, isSkipped: false, key: '', loopMaxIterations: 0, newTab: false,
  pixelClickOnMatch: false, pixelInvert: false, pixelTolerance: 0, randomPercent: 0, repeatCount: 1, restorePosition: false,
  restoreSize: false, rowNumber: 0, runOverData: false, shouldHighlight: false, timeout: 5000, typeAppend: false,
  typePaste: false, waitImageClickOnMatch: false, waitImageInvert: false, windowHeight: 0, windowMatchForegroundOnly: false,
  windowWidth: 0, windowX: 0, windowY: 0, x: 0, y: 0, ...extra,
} as ActionItem);
const tap = (key: string, hold = 60, before = 0) => [step('KeyDown', { key, delay: before }), step('KeyUp', { key, delay: hold })];
const click = (x: number, y: number, delay = 80) => step('LeftClick', { x, y, delay });

/** Os passos de cada macro de exemplo. As de jogo são as que o Teclado usa. */
const STEPS: Record<string, ActionItem[]> = {
  'Coletar': [...tap('E', 450), click(960, 540, 120)],
  'Pulo duplo': [...tap('Space', 60), ...tap('Space', 60, 180)],
  'Combo 1-2-3': [...tap('1', 40), click(960, 540), ...tap('2', 40, 220), click(960, 540), ...tap('3', 40, 220), click(960, 540)],
  'Farm automático': [click(812, 604, 0), click(1104, 604, 350), ...tap('E', 600, 350), step('RightClick', { x: 960, y: 540, delay: 200 })],
  'Trocar arma': [...tap('2', 40), ...tap('1', 40, 100)],
  'Ponte rápida': [step('KeyDown', { key: 'Shift' }), step('RightClick', { x: 960, y: 700, delay: 90 }), step('RightClick', { x: 960, y: 700, delay: 90 }), step('KeyUp', { key: 'Shift', delay: 90 })],
  'Relatório diário': [click(120, 88), ...tap('Ctrl+Home', 40, 300), step('SendText', { key: 'Relatório do dia', delay: 120 }), ...tap('Enter', 40)],
  'Preencher planilha': [click(240, 310), step('SendText', { key: 'João da Silva', delay: 80 }), ...tap('Tab'), step('SendText', { key: 'joao@exemplo.com', delay: 80 })],
  'Responder e-mail': [step('SendText', { key: 'Olá! Tudo bem? Recebi e já respondo.', delay: 80 }), ...tap('Ctrl+Enter', 40, 200)],
};

const entry = (name: string, extra: Partial<ProfileEntry> = {}): ProfileEntry => ({
  actionCount: (STEPS[name] ?? []).length, appMinVersion: '3.0.0', bringToFocus: false, createdAt: '2026-11-08T12:00:00.0000000Z',
  description: '', effectiveTargetTitleMatchMode: 'contains', effectiveUseRelativeCoordinates: false,
  filePath: `C:\\exemplo\\Profiles\\${name}.json`, hasEffectiveTarget: false, hasTrigger: false, hasWindowTarget: false, hotkey: null,
  hotstring: null, hotkeyConflict: false, hotstringInstant: false, iconEmoji: '', isDisabled: false, name, profileVersion: 3,
  restorePosition: false, restoreSize: false, tags: [], triggerArmed: false, triggerMode: 'onPress', updatedAt: '2026-11-10T12:00:00.0000000Z',
  useRelativeCoordinates: false, windowTargetTitleMatchMode: 'contains', windowTargetProcessName: null, windowTargetWindowTitle: null,
  effectiveTargetSource: null, effectiveTargetFolderName: null, effectiveTargetProcessName: null, effectiveTargetWindowTitle: null,
  appIconBase64: null, ...extra,
} as ProfileEntry);

const PROFILES: ProfileEntry[] = [
  entry('Coletar'),
  entry('Pulo duplo'),
  entry('Combo 1-2-3'),
  entry('Farm automático', { hotkey: 'F6', triggerMode: 'toggle' }),
  entry('Trocar arma'),
  entry('Ponte rápida'),
  entry('Relatório diário', { hotkey: 'F8' }),
  entry('Preencher planilha', { hotkey: 'Ctrl+Alt+P' }),
  entry('Responder e-mail', { hotstring: ';resp' }),
];
const folder = (name: string, color: string, items: string[]): ProfileFolder => ({ name, color, collapsed: false, items });
const ORDER = {
  pinned: [],
  folders: [
    folder('Roblox', '#a78bfa', ['Coletar', 'Pulo duplo', 'Combo 1-2-3', 'Farm automático', 'Trocar arma']),
    folder('Minecraft', '#8be597', ['Ponte rápida']),
  ],
  ungroupedOrder: ['Relatório diário', 'Preencher planilha', 'Responder e-mail'],
};

/** Instala o motor falso, só no Vite e só sem o WebView2. */
export function installDemoEngine() {
  const listeners = new Set<Listener>();
  const emit = (message: unknown) => { setTimeout(() => listeners.forEach(l => l({ data: message })), 0); };
  let active: string | null = null;
  // O eco das mudanças acumula: settings:loaded junta sobre os padrões, não sobre o estado atual.
  const settings: Record<string, unknown> = {
    profileKeyEnabled: true,
    remaps: {
      enabled: true,
      entries: [
        { from: 'Insert', to: '', enabled: true },
        { from: 'F1', to: '', enabled: true, process: 'EXCEL.EXE' },
      ],
    },
  };
  const stepsOf = (name: string | null) => (name ? STEPS[name] ?? [] : []).map((a, i) => ({ ...a, rowNumber: i + 1 }));
  const open = (name: string | null) => {
    active = name;
    emit({ type: 'profile:active', payload: { activeProfile: active } });
    emit({ type: 'actions:updated', payload: { actions: stepsOf(active) } });
  };

  const handle = (m: Outgoing) => {
    const p = m.payload ?? {};
    switch (m.type) {
      case 'ui:ready':
        emit({
          type: 'state:init',
          payload: {
            status: 'ready', activeProfile: active, actions: stepsOf(active), profiles: PROFILES, profileOrder: ORDER, settings,
            buttonStates: {
              recordEnabled: true, replayEnabled: true, recordingActive: false, replayActive: false, recordButtonText: 'Record',
              replayButtonText: 'Replay', canUndo: false, canRedo: false, copiedCount: 0,
            },
            profileLoop: { count: '1', enabled: false, interval: '200', intervalEnabled: false, dirty: false, scoped: true },
          },
        });
        break;
      case 'profile:click':
        open(active === p.name ? null : String(p.name));
        break;
      case 'profile:open':
        open(String(p.name));
        break;
      case 'settings:change':
        settings[String(p.key)] = p.value;
        emit({ type: 'settings:loaded', payload: { settings: { ...settings } } });
        break;
      case 'remap:save':
        settings.remaps = { ...(settings.remaps as object), enabled: p.enabled, entries: p.remaps };
        emit({ type: 'settings:loaded', payload: { settings: { ...settings } } });
        break;
    }
  };

  const w = window as unknown as { chrome?: Record<string, unknown> };
  w.chrome ??= {};
  w.chrome.webview = {
    postMessage: (message: unknown) => handle(message as Outgoing),
    addEventListener: (type: string, l: Listener) => { if (type === 'message') listeners.add(l); },
    removeEventListener: (_type: string, l: Listener) => { listeners.delete(l); },
  };
  console.info('[Protótipo MK] motor falso no lugar do C#: dados de exemplo.');
}
