import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ChevronDown, ClipboardCopy, FolderOpen, RefreshCw, ScrollText } from 'lucide-react';
import { APP_NAME, TR2_NAME } from '../../../appIdentity';
import { useBridge } from '../../../bridge/BridgeContext';
import type { HotkeySettingKey, OcrLanguagesPayload, SettingsState } from '../../../bridge/messageTypes';
import { useAppActions, useExtensionHelp, useOcrLanguages, useSettings } from '../../../logic/useSettings';
import { useLanguage, useTt } from '../../../state/LanguageContext';
import { useToast } from '../../../state/ToastContext';
import { ocrLanguageNote, ocrLanguageOptions, ocrPickerLanguages } from '../../../utils/ocrLanguages';
import { DraftField, Segmented, Switch } from '../../inspector/fields';
import { Menu } from '../../Menu';
import { anchorBelow } from '../../menuAnchor';
import { preload, useLoaded } from '../../lazyModule';
import { openImport } from '../../importState';
import { useExtension } from '../../statusbar/extensionState';
import { useApp } from '../../store';
import type { SettingsCategory } from '../../ui';
import { ConflictNote, HotkeyField, HotkeysBadge, HotkeysIntro, ScreenTextNote } from './hotkeys';

/**
 * A setting of the page: its name, what it does (under the name, and what the search reads besides
 * it), and its control. A row shows only while it means something (`shown`, from the settings it
 * hangs on). Each control applies at once, as in today's panel; Settings has no Save.
 */
export interface Row {
  id: string;
  label: string;
  hint?: string;
  /** More for the search to find it by. */
  words?: string;
  Control: ComponentType;
  /** Under the hint, what changes with the setting (a hotkey's conflict, the region it reads). */
  Note?: ComponentType;
  shown?: (s: SettingsState) => boolean;
}
export interface Group { title: string; note?: string; rows: Row[] }
export interface Category {
  id: SettingsCategory;
  label: string;
  /** Built in this slice; the others show (disabled) only in the development build. */
  built: boolean;
  groups?: Group[];
  /** A category that is not a list of settings (the browser extension's folder and steps). */
  Panel?: ComponentType;
  /** For the search to find a Panel category by. */
  words?: string;
  /** Above the groups: what the category is, and a notice (Hotkeys' keys other apps use). */
  Intro?: ComponentType;
  /** Beside the name in the categories: a count that asks for a look. */
  Badge?: ComponentType;
  /** Starts loading the category's own chunk (rule 6): the page calls it when idle, and its tab sooner. */
  warm?: () => void;
}

// ── The controls. Each reads only what it shows (rule 1) and sends what the panel of today sent. ──

const useSetting = <K extends keyof SettingsState>(key: K) => useApp(a => a.settings[key]);

/** A setting's switch, by its key in the engine's settings:change. */
function settingSwitch(key: keyof SettingsState & string, label: string, invert = false): ComponentType {
  return function SettingSwitch() {
    const value = useSetting(key) as boolean;
    const settings = useSettings();
    return <Switch label={label} checked={invert ? !value : !!value} onChange={(on) => settings.change(key, invert ? !on : on)} />;
  };
}

/** A setting's number, sent as the text the engine parses (the convention of these keys), in bounds. */
function settingNumber(key: keyof SettingsState & string, label: string, max: number, unit: string, step?: number): ComponentType {
  return function SettingNumber() {
    const value = String(useSetting(key) ?? '');
    const settings = useSettings();
    return (
      <span className="set-num">
        <DraftField stepId="settings" field={key} label={label} kind="int" min={0} max={max} unit={unit} step={step} stored={value} onApply={(v) => settings.change(key, v)} />
      </span>
    );
  };
}

function TrayControl() {
  const on = useSetting('minimizeToTray');
  const settings = useSettings();
  return <Switch label={`Close keeps ${APP_NAME} in the tray`} checked={on} onChange={settings.setMinimizeToTray} />;
}
function RunOnStartupControl() {
  const on = useSetting('runOnStartup');
  const settings = useSettings();
  return <Switch label="Run on startup" checked={on} onChange={settings.setRunOnStartup} />;
}
function StartMinimizedControl() {
  const on = useSetting('startMinimized');
  const startup = useSetting('runOnStartup');
  const settings = useSettings();
  const tt = useTt();
  return (
    <Switch
      label="Startup minimized"
      checked={on}
      disabled={!startup}
      tip={startup ? undefined : tt('Turn on Run on startup first', 'Ligue o Run on startup antes')}
      onChange={settings.setStartMinimized}
    />
  );
}
function RunEndFlashControl() {
  const on = useSetting('runEndFlash');
  const settings = useSettings();
  return <Switch label="Flash on replay end" checked={on} onChange={settings.setRunEndFlash} />;
}
function RunEndSoundControl() {
  const on = useSetting('runEndSound');
  const settings = useSettings();
  return <Switch label="Sound on replay end" checked={on} onChange={settings.setRunEndSound} />;
}
function TooltipsControl() {
  const { language, setLanguage } = useLanguage();
  return (
    <Segmented<'en' | 'pt-BR'>
      label="Tooltips"
      value={language}
      options={[{ value: 'en', label: 'English' }, { value: 'pt-BR', label: 'Português (BR)' }]}
      onChange={setLanguage}
    />
  );
}
/** Reset all settings… (D23): asks first, in the page (SettingsPage's dialog). */
function ResetControl() {
  const busy = useApp(a => a.status !== 'ready');
  const tt = useTt();
  return (
    <button
      type="button"
      className="insp-button"
      disabled={busy}
      data-tip={busy ? tt('Stop the run or the recording first', 'Pare a execução ou a gravação antes') : undefined}
      onClick={() => askReset()}
    >
      Reset…
    </button>
  );
}
// The confirmation lives in the page; the row asks for it through here.
let askReset: () => void = () => {};
export const onResetAsked = (ask: () => void) => { askReset = ask; };

/** Import from TrueReplayer 2… (Tr2Import): the dialog that also makes the first-run offer. */
function ImportTr2Control() {
  const busy = useApp(a => a.status !== 'ready');
  const tt = useTt();
  return (
    <button
      type="button"
      className="insp-button"
      disabled={busy}
      data-tip={busy ? tt('Stop the run or the recording first', 'Pare a execução ou a gravação antes') : undefined}
      onClick={() => openImport()}
    >
      Import…
    </button>
  );
}

/** Jitter, the app's: its switch and its percentage (today's Delay variation chip, settings-030). */
function JitterControl() {
  const on = useSetting('useDelayVariation');
  const value = useSetting('delayVariation');
  const settings = useSettings();
  return (
    <span className="set-pair">
      <span className="set-num">
        <DraftField stepId="settings" field="delayVariation" label="Jitter" kind="int" min={0} max={100} unit="%" stored={String(value ?? '')} disabled={!on} onApply={(v) => settings.change('delayVariation', v)} />
      </span>
      <Switch label="Jitter on" checked={on} onChange={(v) => settings.change('useDelayVariation', v)} />
    </span>
  );
}

const PathStepNumber = settingNumber('moveStepPx', 'Path step', 2000, 'px');
/** Path step, with today's note at 0: Game Mode stays on, and the cursor jumps. */
function PathStepControl() {
  const value = useSetting('moveStepPx');
  const zero = Number.parseInt(value, 10) === 0;
  return (
    <span className="set-stack">
      <PathStepNumber />
      {zero && <span className="insp-hint" role="status">No walk — single jump</span>}
    </span>
  );
}

/**
 * Screen Text's language (settings-129): Português and English always, then the packs this PC has,
 * then Auto. The app's own list (the shell's Menu: ↑ ↓ Home End Enter Esc, settings-074), not the
 * OS's. Under it, today's note: a pick this PC lacks, with Install (settings-130); installing; and
 * the restart it waits for.
 */
function OcrLanguageControl() {
  const pick = useSetting('ocrLanguage') ?? '';
  const settings = useSettings();
  const langs = useOcrLanguages(true);
  const [menu, setMenu] = useState<HTMLButtonElement | null>(null);
  const options = [
    ...ocrLanguageOptions(langs ? ocrPickerLanguages(langs.offered, langs.available) : []),
    { value: '', label: langs?.auto ? `Auto (${langs.auto})` : 'Auto' },
  ];
  const shown = options.find(o => o.value.toLowerCase() === pick.toLowerCase())?.label ?? (pick || 'Auto');
  useInstallToasts(langs);
  return (
    <span className="set-stack">
      <button
        type="button"
        className="insp-button set-choice"
        aria-label="Language"
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <span className="set-choice-label">{shown}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {menu && (
        <Menu
          anchor={anchorBelow(menu, 'end')}
          label="Language"
          toggle={menu}
          focusFirst
          entries={options.map(o => ({ label: o.label, checked: o.value.toLowerCase() === pick.toLowerCase(), onSelect: () => settings.change('ocrLanguage', o.value) }))}
          onClose={() => setMenu(null)}
        />
      )}
      {langs && <OcrNote pick={pick} langs={langs} onInstall={settings.installOcrLanguage} />}
    </span>
  );
}

function OcrNote({ pick, langs, onInstall }: { pick: string; langs: OcrLanguagesPayload; onInstall: (tag: string) => void }) {
  const tt = useTt();
  const note = ocrLanguageNote(pick, langs);
  if (!note) return null;
  const install = note.kind === 'missing' ? note.install : null;
  const name = install ? (ocrLanguageOptions(ocrPickerLanguages(langs.offered, langs.available)).find(o => o.value === install.tag)?.label ?? install.tag) : '';
  return (
    <span className="set-note" data-tone={note.kind === 'missing' ? 'warn' : undefined}>
      <span role="status">{note.text}</span>
      {install && (
        <button
          type="button"
          className="set-link"
          disabled={!!langs.installing}
          aria-label={`Install ${name} text recognition`}
          data-tip={tt('Adds the Windows OCR pack for this language. Windows asks for permission; the download comes from Windows Update.',
                       'Adiciona o pacote de OCR do Windows para este idioma. O Windows pede permissão; o download vem do Windows Update.')}
          onClick={() => onInstall(install.tag)}
        >
          Install
        </button>
      )}
    </span>
  );
}

/** The install's outcome, in a toast that names the language (today's panel's). */
function useInstallToasts(langs: OcrLanguagesPayload | null) {
  const { subscribe } = useBridge();
  const { showToast } = useToast();
  const tt = useTt();
  const latest = useRef({ langs, tt, showToast });
  useEffect(() => { latest.current = { langs, tt, showToast }; });
  useEffect(() => subscribe((msg) => {
    if (msg.type !== 'ocr:installResult') return;
    const { langs: l, tt: t, showToast: toast } = latest.current;
    const r = msg.payload;
    const opt = l && ocrLanguageOptions(ocrPickerLanguages(l.offered, l.available)).find(o => o.value.toLowerCase() === r.tag.toLowerCase());
    const name = opt?.label ?? r.tag;
    if (r.ok) {
      toast(r.restartApp
        ? t(`${name} text recognition installed — restart ${APP_NAME} to use it.`, `Reconhecimento de texto em ${name} instalado — reinicie o ${APP_NAME} para usar.`)
        : r.restartWindows
          ? t(`${name} text recognition installed — restart Windows to finish.`, `Reconhecimento de texto em ${name} instalado — reinicie o Windows para concluir.`)
          : t(`${name} text recognition installed.`, `Reconhecimento de texto em ${name} instalado.`),
      'success');
    } else if (r.canceled) {
      toast(t('Install canceled — Windows needs your permission to add the pack.', 'Instalação cancelada — o Windows precisa da sua permissão para adicionar o pacote.'), 'info');
    } else {
      toast(t(`Couldn't install ${name} text recognition: ${r.error ?? 'unknown error'}`, `Não foi possível instalar o reconhecimento de texto em ${name}: ${r.error ?? 'erro desconhecido'}`), 'error');
    }
  }), [subscribe]);
}

/**
 * Browser extension (D25; dialogos-095 to 099): whether it is connected, how to load it, its folder.
 * Opening the category only asks where the folder is: a category passed through on the way must not
 * take what is on the clipboard. Copy path copies it when asked (the dialog of today copied on
 * opening, because opening it was the asking).
 */
function BrowserPanel() {
  const tt = useTt();
  const reply = useExtensionHelp(false);
  const connection = useExtension(s => s.connection);
  const outdated = useExtension(s => s.outdated);
  const appActions = useAppActions();
  const { send } = useBridge();
  // Copy path's answer is the reply that comes after the click: the one on screen then (the
  // opening's, asked without the copy) says nothing about it (dialogos-098).
  const [askedOver, setAskedOver] = useState<ReturnType<typeof useExtensionHelp> | undefined>(undefined);
  const answered = askedOver !== undefined && reply !== askedOver;
  const connected = connection !== 'unknown' ? connection === 'connected' : reply ? reply.connected : null;
  const steps = [
    tt('Open chrome://extensions (Edge: edge://extensions, Brave: brave://extensions).', 'Abra chrome://extensions (Edge: edge://extensions, Brave: brave://extensions).'),
    tt('Turn on "Developer mode".', 'Ative o "Modo do desenvolvedor".'),
    tt('Click "Load unpacked" and pick this folder:', 'Clique em "Carregar sem compactação" e escolha esta pasta:'),
  ];
  return (
    <div className="set-panel">
      {/* Two channels on the state, never colour alone — the status bar's own rule. */}
      <p className="set-state" data-state={outdated ? 'reload' : connected === null ? undefined : connected ? 'connected' : 'off'} role="status">
        {outdated
          ? tt(`Version ${outdated.current} is loaded and this app expects ${outdated.expected}. Reload it in chrome://extensions.`,
               `A versão ${outdated.current} está carregada e este app espera a ${outdated.expected}. Recarregue em chrome://extensions.`)
          : connected === null ? ' '
            : connected
              ? tt('The TrueReplayer extension is connected.', 'A extensão do TrueReplayer está conectada.')
              : tt('Connect the TrueReplayer extension to Chrome (or Edge).', 'Conecte a extensão do TrueReplayer ao Chrome (ou Edge).')}
      </p>
      <ol className="set-steps">
        {steps.map(s => <li key={s}>{s}</li>)}
      </ol>
      {/* The path is the payload: selectable even when a copy fails. */}
      <div className="set-path">{reply ? reply.path : '…'}</div>
      <div className="set-actions">
        <button
          type="button"
          className="insp-button"
          disabled={!reply?.exists}
          onClick={() => { setAskedOver(reply); send({ type: 'extension:help', payload: {} }); }}
        >
          <ClipboardCopy aria-hidden="true" />
          Copy path
        </button>
        <button type="button" className="insp-button" disabled={!reply?.exists} onClick={appActions.openExtensionFolder}>
          <FolderOpen aria-hidden="true" />
          Open folder
        </button>
      </div>
      <p className="insp-hint" role="status">
        {!reply ? null
          : !reply.exists ? <span data-error="">{tt(`This folder is missing. Reinstall ${APP_NAME} to restore it.`, `Esta pasta não existe. Reinstale o ${APP_NAME} para restaurá-la.`)}</span>
          : answered && reply.copied ? tt(`The path is copied. The extension updates itself along with ${APP_NAME}.`, `O caminho foi copiado. A extensão se atualiza sozinha junto com o ${APP_NAME}.`)
          : answered ? tt(`Could not copy the path — select it above. The extension updates itself along with ${APP_NAME}.`, `Não deu para copiar o caminho — selecione-o acima. A extensão se atualiza sozinha junto com o ${APP_NAME}.`)
          : tt(`The extension updates itself along with ${APP_NAME}.`, `A extensão se atualiza sozinha junto com o ${APP_NAME}.`)}
      </p>
    </div>
  );
}

function CopyDiagnosticsControl() {
  const app = useAppActions();
  return <button type="button" className="insp-button" onClick={app.copyDiagnostics}><ClipboardCopy aria-hidden="true" />Copy diagnostics</button>;
}
function LogsControl() {
  const app = useAppActions();
  return <button type="button" className="insp-button" onClick={app.openLogsFolder}><ScrollText aria-hidden="true" />Open logs folder</button>;
}
function ReloadControl() {
  const app = useAppActions();
  return <button type="button" className="insp-button" onClick={app.reloadUI}><RefreshCw aria-hidden="true" />Reload UI</button>;
}

/**
 * Appearance (appearance.tsx) comes in a chunk of its own, with the 37 presets: the start never loads
 * them. Settings brings it when the page has nothing to do, or the pointer or the focus on its tab
 * sooner. Opened straight on it (Ctrl+K), the page draws once the chunk is in.
 */
const loadAppearance = () => import('./appearance');
function AppearanceLoader() {
  const mod = useLoaded(loadAppearance);
  useEffect(() => { if (!mod) void preload(loadAppearance); }, [mod]);
  return mod ? <mod.AppearancePanel /> : null;
}
function AppearanceIntro() {
  return <p className="set-intro">Themes, density and motion. Every change shows at once, in the whole app, and Ctrl+Z undoes it.</p>;
}

/** A hotkey's row (hotkeys.tsx): its key with Change and ✕, and under the description its conflict. */
function hotkeyRow(id: string, settingKey: HotkeySettingKey, label: string, more: { hint?: string; words: string; noKeyWhy?: string }): Row {
  return {
    id,
    label,
    hint: more.hint,
    words: `hotkey shortcut key ${more.words}`,
    Control: function Hotkey() { return <HotkeyField settingKey={settingKey} label={label} />; },
    Note: settingKey === 'copyScreenTextHotkey'
      ? ScreenTextNote
      : function Conflict() { return <ConflictNote settingKey={settingKey} noKeyWhy={more.noKeyWhy} />; },
  };
}

// ── The categories, in the concept's order (SettingsHotkeys board). ──

export const CATEGORIES: Category[] = [
  {
    id: 'general',
    label: 'General',
    built: true,
    groups: [
      {
        title: 'Window',
        rows: [
          { id: 'tray', label: `Close keeps ${APP_NAME} in the tray`, hint: 'The X hides the window in the tray instead of closing the app.', words: 'system tray minimize close', Control: TrayControl },
        ],
      },
      {
        title: 'Startup',
        rows: [
          { id: 'runOnStartup', label: 'Run on startup', hint: 'Opens with Windows.', words: 'boot login autostart', Control: RunOnStartupControl },
          { id: 'startMinimized', label: 'Startup minimized', hint: 'Opened with Windows, it starts in the tray.', words: 'hidden tray', Control: StartMinimizedControl },
          { id: 'runAsAdmin', label: 'Run as administrator', hint: `From the next time ${APP_NAME} opens; Windows asks for permission. Needed to click in windows that run as administrator.`, words: 'elevated uac admin', Control: settingSwitch('runAsAdmin', 'Run as administrator') },
        ],
      },
      {
        title: 'When a run ends',
        note: 'Only while the window is behind another one — usually the game.',
        rows: [
          { id: 'runEndFlash', label: 'Flash on replay end', hint: 'Flashes the taskbar button.', words: 'notify taskbar', Control: RunEndFlashControl },
          { id: 'runEndSound', label: 'Sound on replay end', hint: 'Plays the Windows sound — another one if the run failed.', words: 'notify beep audio', Control: RunEndSoundControl },
        ],
      },
      {
        title: 'Interface',
        rows: [
          { id: 'tooltips', label: 'Tooltips', hint: 'The language of the tips; names and labels stay in English.', words: 'language portuguese english idioma', Control: TooltipsControl },
        ],
      },
      {
        title: TR2_NAME,
        rows: [
          { id: 'importTr2', label: `Import from ${TR2_NAME}`, hint: `A copy of its macros, settings, remaps, theme and snippets. ${TR2_NAME} is not changed.`, words: 'import copy migrate old version previous', Control: ImportTr2Control },
        ],
      },
      {
        title: 'Reset',
        rows: [
          { id: 'reset', label: 'Reset all settings', hint: 'Every setting back to its default. Your macros, their steps and the Clicker presets stay.', words: 'defaults restore factory', Control: ResetControl },
        ],
      },
    ],
  },
  {
    id: 'hotkeys',
    label: 'Hotkeys',
    built: true,
    Intro: HotkeysIntro,
    Badge: HotkeysBadge,
    groups: [
      {
        title: 'Recording and replay',
        rows: [
          hotkeyRow('record', 'recordingHotkey', 'Record', { hint: 'Starts and stops recording into the open macro', words: 'recording' }),
          hotkeyRow('replay', 'replayHotkey', 'Replay or stop', { hint: 'Runs the open macro, or stops whatever is running', words: 'run play' }),
          hotkeyRow('shortcuts', 'profileKeyToggleHotkey', 'Shortcuts on or off', { hint: 'Silences macro hotkeys, hotstrings and Key Remaps at once', words: 'profile keys toggle silence pause' }),
        ],
      },
      {
        title: 'Window',
        rows: [
          hotkeyRow('front', 'foregroundHotkey', `Bring ${APP_NAME} to the front`, { words: 'foreground focus show window', noKeyWhy: 'the tray icon does it' }),
          hotkeyRow('clicker', 'modeToggleHotkey', 'Open the Clicker', { hint: 'Pressed again, back to the macros', words: 'mode toggle clicker macro' }),
        ],
      },
      {
        title: 'Clicker',
        note: 'Only while the Clicker is on.',
        rows: [
          hotkeyRow('clickerStart', 'cursorClickStartHotkey', 'Start and stop', { hint: 'Starts the clicks, or stops them', words: 'clicker autoclicker' }),
          hotkeyRow('clickerPause', 'cursorClickPauseHotkey', 'Pause', { hint: 'Pauses the clicks, or resumes them', words: 'clicker autoclicker resume' }),
        ],
      },
      {
        title: 'Screen and clipboard',
        rows: [
          hotkeyRow('clip', 'captureSlotHotkey', 'Copy the selection to a clip slot', { hint: 'Fills the next {clip:N} for Send Text', words: 'capture slot clipboard selection' }),
          hotkeyRow('screenText', 'copyScreenTextHotkey', 'Copy text from the screen', { hint: 'Reads a region with Screen Text', words: 'ocr read region clipboard' }),
        ],
      },
    ],
  },
  {
    id: 'appearance',
    label: 'Appearance',
    built: true,
    Intro: AppearanceIntro,
    Panel: AppearanceLoader,
    warm: () => { void preload(loadAppearance); },
    words: 'theme themes color colour accent dark light follow windows vivid pastel monochrome random my own save custom density compact normal spacious motion animations text size font corner roundness radius zoom scale data monospace',
  },
  {
    id: 'recording',
    label: 'Recording and playback',
    built: true,
    groups: [
      {
        title: 'Recording',
        rows: [
          { id: 'realTiming', label: 'Record the real timing', hint: 'Off: every recorded click and key gets the delay below instead of the time you took.', words: 'delay timing', Control: settingSwitch('useCustomDelay', 'Record the real timing', true) },
          { id: 'delay', label: 'Delay for new steps', hint: 'The delay a new step starts with: from the insert row, from the browser extension, and recorded ones when the real timing is off.', words: 'ms wait', Control: settingNumber('customDelay', 'Delay for new steps', 60000, 'ms', 100) },
        ],
      },
      {
        title: 'Playback',
        note: 'The default for macros without their own; each macro can set its own in Replay ▾.',
        rows: [
          { id: 'returnCursor', label: 'Return cursor', hint: 'The cursor goes back to where it was when the run started.', words: 'mouse restore position', Control: settingSwitch('restoreCursor', 'Return cursor') },
          { id: 'gameMode', label: 'Game Mode', hint: 'The cursor walks a path so games accept the move; off, it jumps.', words: 'smooth movement roblox path', Control: settingSwitch('smoothMovement', 'Game Mode') },
          { id: 'fastApproach', label: 'Fast approach', hint: 'Teleports long moves and walks only the last stretch. Turn off if a game misclicks.', words: 'teleport settle', Control: settingSwitch('fastApproach', 'Fast approach'), shown: s => s.smoothMovement },
          { id: 'jitter', label: 'Jitter', hint: 'Random ±% on each delay — less robotic.', words: 'variation random delay', Control: JitterControl },
        ],
      },
      {
        title: 'Game Mode tuning',
        note: 'For every macro, and for the Clicker\'s Game move.',
        rows: [
          { id: 'clickDelay', label: 'Click delay', hint: 'Pause before each button event. Applies with Game Mode off too.', words: 'mouse button press', Control: settingNumber('moveClickDelay', 'Click delay', 1000, 'ms') },
          { id: 'pathStep', label: 'Path step', hint: 'Max px per step. Lower = smoother, slower. ~20 for Roblox.', words: 'smooth px', Control: PathStepControl, shown: s => s.smoothMovement },
          { id: 'stepDelay', label: 'Step delay', hint: 'Wait between the steps of the path.', words: 'smooth ms', Control: settingNumber('moveStepDelay', 'Step delay', 100, 'ms'), shown: s => s.smoothMovement },
          { id: 'distance', label: 'Distance', hint: 'Walked stretch before the target after a teleport. ~80 px.', words: 'fast approach settle px', Control: settingNumber('settleDistance', 'Distance', 4000, 'px'), shown: s => s.smoothMovement && s.fastApproach },
        ],
      },
    ],
  },
  {
    id: 'screen',
    label: 'Screen Text',
    built: true,
    groups: [
      {
        title: 'Text recognition',
        note: 'Read by Wait Text, Text on screen, Set Variable\'s Screen, the automations and the Copy text from the screen hotkey.',
        rows: [
          { id: 'ocrLanguage', label: 'Language', hint: 'Português by default; a language this PC lacks installs from here.', words: 'ocr install read text portuguese english', Control: OcrLanguageControl },
        ],
      },
    ],
  },
  { id: 'browser', label: 'Browser extension', built: true, Panel: BrowserPanel, words: 'chrome edge brave extension unpacked folder path connect' },
  {
    id: 'diagnostics',
    label: 'Diagnostics',
    built: true,
    groups: [
      {
        title: 'When something goes wrong',
        rows: [
          { id: 'copyDiagnostics', label: 'Copy diagnostics', hint: 'The version, the system and the recent log lines, for a bug report.', words: 'support bug report about version', Control: CopyDiagnosticsControl },
          { id: 'logs', label: 'Open logs folder', hint: 'Where the session logs are kept.', words: 'support log session', Control: LogsControl },
          { id: 'reload', label: 'Reload UI', hint: 'Reloads the interface; the engine, and a run in progress, go on.', words: 'refresh stuck frozen', Control: ReloadControl },
        ],
      },
    ],
  },
];
