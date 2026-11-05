import { useEffect, useRef, useState, type ComponentType } from 'react';
import { ChevronDown, ClipboardCopy, FolderOpen, RefreshCw, ScrollText } from 'lucide-react';
import { APP_NAME, TR2_NAME } from '../../../appIdentity';
import { useBridge } from '../../../bridge/BridgeContext';
import type { HotkeySettingKey, OcrLanguagesPayload, SettingsState } from '../../../bridge/messageTypes';
import { readLanguagePick, useAppActions, useExtensionHelp, useOcrLanguages, useSettings, type LanguagePick } from '../../../logic/useSettings';
import { t } from '../../../i18n';
import { useToast } from '../../../state/ToastContext';
import { ocrLanguageNote, ocrLanguageOptions, ocrPickerLanguages } from '../../../utils/ocrLanguages';
import { DraftField, Switch } from '../../inspector/fields';
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
  return <Switch label={t('settings.rows.tray.label', { app: APP_NAME })} checked={on} onChange={settings.setMinimizeToTray} />;
}
function CompactWhileRunningControl() {
  const on = useSetting('compactWhileRunning') ?? false;
  const settings = useSettings();
  return <Switch label={t('settings.rows.compactRun.label')} checked={on} onChange={(v) => settings.change('compactWhileRunning', v)} />;
}
function RunOnStartupControl() {
  const on = useSetting('runOnStartup');
  const settings = useSettings();
  return <Switch label={t('settings.rows.runOnStartup.label')} checked={on} onChange={settings.setRunOnStartup} />;
}
function StartMinimizedControl() {
  const on = useSetting('startMinimized');
  const startup = useSetting('runOnStartup');
  const settings = useSettings();
  return (
    <Switch
      label={t('settings.rows.startMinimized.label')}
      checked={on}
      disabled={!startup}
      tip={startup ? undefined : t('settings.rows.startMinimized.needsStartup')}
      onChange={settings.setStartMinimized}
    />
  );
}
function RunEndFlashControl() {
  const on = useSetting('runEndFlash');
  const settings = useSettings();
  return <Switch label={t('settings.rows.runEndFlash.label')} checked={on} onChange={settings.setRunEndFlash} />;
}
function RunEndSoundControl() {
  const on = useSetting('runEndSound');
  const settings = useSettings();
  return <Switch label={t('settings.rows.runEndSound.label')} checked={on} onChange={settings.setRunEndSound} />;
}
/**
 * The interface's language (settings-132, D30): Windows, English or Português, each language in its own
 * name, in the same list as Screen Text's language. It lives in tr-language (interface.json, through
 * InterfaceStore); the engine loads the page's build of the language, and the page comes back here
 * (plan of languages, §3.6). Windows — no key — follows the language Windows shows.
 */
function LanguageControl() {
  const settings = useSettings();
  const [pick, setPick] = useState(readLanguagePick);
  const [menu, setMenu] = useState<HTMLButtonElement | null>(null);
  const options: { value: LanguagePick; label: string }[] = [
    { value: 'auto', label: t('settings.language.windows') },
    { value: 'en-US', label: t('settings.language.english') },
    { value: 'pt-BR', label: t('settings.language.portugues') },
  ];
  const choose = (value: LanguagePick) => {
    setPick(value);
    settings.setLanguage(value);
  };
  return (
    <span className="set-stack">
      <button
        type="button"
        className="insp-button set-choice"
        aria-label={t('settings.language.label')}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <span className="set-choice-label">{options.find(o => o.value === pick)?.label}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {menu && (
        <Menu
          anchor={anchorBelow(menu, 'end')}
          label={t('settings.language.label')}
          toggle={menu}
          focusFirst
          entries={options.map(o => ({ label: o.label, checked: o.value === pick, onSelect: () => choose(o.value) }))}
          onClose={() => setMenu(null)}
        />
      )}
    </span>
  );
}
/** Reset all settings… (D23): asks first, in the page (SettingsPage's dialog). */
function ResetControl() {
  const busy = useApp(a => a.status !== 'ready');
  return (
    <button
      type="button"
      className="insp-button"
      disabled={busy}
      data-tip={busy ? t('settings.busy') : undefined}
      onClick={() => askReset()}
    >
      {t('settings.reset.button')}
    </button>
  );
}
// The confirmation lives in the page; the row asks for it through here.
let askReset: () => void = () => {};
export const onResetAsked = (ask: () => void) => { askReset = ask; };

/** Import from TrueReplayer 2… (Tr2Import): the dialog that also makes the first-run offer. */
function ImportTr2Control() {
  const busy = useApp(a => a.status !== 'ready');
  return (
    <button
      type="button"
      className="insp-button"
      disabled={busy}
      data-tip={busy ? t('settings.busy') : undefined}
      onClick={() => openImport()}
    >
      {t('common.actions.importEllipsis')}
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
        <DraftField stepId="settings" field="delayVariation" label={t('settings.rows.jitter.label')} kind="int" min={0} max={100} unit="%" stored={String(value ?? '')} disabled={!on} onApply={(v) => settings.change('delayVariation', v)} />
      </span>
      <Switch label={t('settings.rows.jitter.on')} checked={on} onChange={(v) => settings.change('useDelayVariation', v)} />
    </span>
  );
}

const PathStepNumber = settingNumber('moveStepPx', t('settings.rows.pathStep.label'), 2000, 'px');
/** Path step, with today's note at 0: Game Mode stays on, and the cursor jumps. */
function PathStepControl() {
  const value = useSetting('moveStepPx');
  const zero = Number.parseInt(value, 10) === 0;
  return (
    <span className="set-stack">
      <PathStepNumber />
      {zero && <span className="insp-hint" role="status">{t('settings.rows.pathStep.noWalk')}</span>}
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
  // The languages are named by the engine, each in its own name ("Português", "English"), the same in
  // every language of the interface; only Auto comes from the catalog.
  const options = [
    ...ocrLanguageOptions(langs ? ocrPickerLanguages(langs.offered, langs.available) : []),
    { value: '', label: langs?.auto ? t('settings.rows.ocrLanguage.autoWith', { name: langs.auto }) : t('settings.rows.ocrLanguage.auto') },
  ];
  const picked = options.find(o => o.value.toLowerCase() === pick.toLowerCase());
  const shown = picked?.label ?? (pick || t('settings.rows.ocrLanguage.auto'));
  // A language's name (or the tag of one this PC no longer lists), not Auto.
  const named = picked ? picked.value !== '' : pick !== '';
  useInstallToasts(langs);
  return (
    <span className="set-stack">
      <button
        type="button"
        className="insp-button set-choice"
        aria-label={t('settings.rows.ocrLanguage.label')}
        aria-haspopup="menu"
        aria-expanded={!!menu}
        onClick={(e) => setMenu(menu ? null : e.currentTarget)}
      >
        <span className="set-choice-label" data-glossary={named ? '' : undefined}>{shown}</span>
        <ChevronDown aria-hidden="true" />
      </button>
      {menu && (
        <Menu
          anchor={anchorBelow(menu, 'end')}
          label={t('settings.rows.ocrLanguage.label')}
          toggle={menu}
          focusFirst
          entries={options.map(o => ({ label: o.label, named: o.value !== '', checked: o.value.toLowerCase() === pick.toLowerCase(), onSelect: () => settings.change('ocrLanguage', o.value) }))}
          onClose={() => setMenu(null)}
        />
      )}
      {langs && <OcrNote pick={pick} langs={langs} onInstall={settings.installOcrLanguage} />}
    </span>
  );
}

function OcrNote({ pick, langs, onInstall }: { pick: string; langs: OcrLanguagesPayload; onInstall: (tag: string) => void }) {
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
          aria-label={t('settings.rows.ocrLanguage.installLabel', { name })}
          data-tip={t('settings.rows.ocrLanguage.installTip')}
          onClick={() => onInstall(install.tag)}
        >
          {t('settings.rows.ocrLanguage.install')}
        </button>
      )}
    </span>
  );
}

/** The install's outcome, in a toast that names the language (today's panel's). */
function useInstallToasts(langs: OcrLanguagesPayload | null) {
  const { subscribe } = useBridge();
  const { showToast } = useToast();
  const latest = useRef({ langs, showToast });
  useEffect(() => { latest.current = { langs, showToast }; });
  useEffect(() => subscribe((msg) => {
    if (msg.type !== 'ocr:installResult') return;
    const { langs: l, showToast: toast } = latest.current;
    const r = msg.payload;
    const opt = l && ocrLanguageOptions(ocrPickerLanguages(l.offered, l.available)).find(o => o.value.toLowerCase() === r.tag.toLowerCase());
    const name = opt?.label ?? r.tag;
    if (r.ok) {
      toast(r.restartApp
        ? t('settings.ocrInstall.restartApp', { name, app: APP_NAME })
        : r.restartWindows
          ? t('settings.ocrInstall.restartWindows', { name })
          : t('settings.ocrInstall.done', { name }),
      'success');
    } else if (r.canceled) {
      toast(t('settings.ocrInstall.canceled'), 'info');
    } else {
      toast(t('settings.ocrInstall.failed', { name, error: r.error ?? t('settings.ocrInstall.unknownError') }), 'error');
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
    t('settings.browser.steps.open'),
    t('settings.browser.steps.developerMode'),
    t('settings.browser.steps.loadUnpacked'),
  ];
  return (
    <div className="set-panel">
      {/* Two channels on the state, never colour alone — the status bar's own rule. */}
      <p className="set-state" data-state={outdated ? 'reload' : connected === null ? undefined : connected ? 'connected' : 'off'} role="status">
        {outdated
          ? t('settings.browser.outdated', { current: outdated.current, expected: outdated.expected })
          : connected === null ? ' '
            : connected
              ? t('settings.browser.connected')
              : t('settings.browser.disconnected')}
      </p>
      <ol className="set-steps">
        {steps.map(s => <li key={s}>{s}</li>)}
      </ol>
      {/* The path is the payload: selectable even when a copy fails. A path is data, the same in every language. */}
      <div className="set-path" data-glossary="">{reply ? reply.path : '…'}</div>
      <div className="set-actions">
        <button
          type="button"
          className="insp-button"
          disabled={!reply?.exists}
          onClick={() => { setAskedOver(reply); send({ type: 'extension:help', payload: {} }); }}
        >
          <ClipboardCopy aria-hidden="true" />
          {t('settings.browser.copyPath')}
        </button>
        <button type="button" className="insp-button" disabled={!reply?.exists} onClick={appActions.openExtensionFolder}>
          <FolderOpen aria-hidden="true" />
          {t('settings.browser.openFolder')}
        </button>
      </div>
      <p className="insp-hint" role="status">
        {!reply ? null
          : !reply.exists ? <span data-error="">{t('settings.browser.missing', { app: APP_NAME })}</span>
          : answered && reply.copied ? t('settings.browser.copied', { app: APP_NAME })
          : answered ? t('settings.browser.copyFailed', { app: APP_NAME })
          : t('settings.browser.updatesItself', { app: APP_NAME })}
      </p>
    </div>
  );
}

function CopyDiagnosticsControl() {
  const app = useAppActions();
  return <button type="button" className="insp-button" onClick={app.copyDiagnostics}><ClipboardCopy aria-hidden="true" />{t('settings.rows.copyDiagnostics.label')}</button>;
}
function LogsControl() {
  const app = useAppActions();
  return <button type="button" className="insp-button" onClick={app.openLogsFolder}><ScrollText aria-hidden="true" />{t('settings.rows.logs.label')}</button>;
}
function ReloadControl() {
  const app = useAppActions();
  return <button type="button" className="insp-button" onClick={app.reloadUI}><RefreshCw aria-hidden="true" />{t('settings.rows.reload.label')}</button>;
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
  return <p className="set-intro">{t('settings.appearance.intro')}</p>;
}

/** A hotkey's row (hotkeys.tsx): its key with Change and ✕, and under the description its conflict. */
function hotkeyRow(id: string, settingKey: HotkeySettingKey, label: string, more: { hint?: string; words: string }): Row {
  return {
    id,
    label,
    hint: more.hint,
    // The words every hotkey is found by, then the row's own: a bag of words, never shown.
    words: `${t('settings.hotkeys.words')} ${more.words}`,
    Control: function Hotkey() { return <HotkeyField settingKey={settingKey} label={label} />; },
    Note: settingKey === 'copyScreenTextHotkey'
      ? ScreenTextNote
      : function Conflict() { return <ConflictNote settingKey={settingKey} />; },
  };
}

// ── The categories, in the concept's order (SettingsHotkeys board). ──

// The texts are the catalog's (i18n/*/settings.ts), in the build's language: the search reads the label,
// the hint and the words of that language.
export const CATEGORIES: Category[] = [
  {
    id: 'general',
    label: t('settings.categories.general'),
    built: true,
    groups: [
      {
        title: t('settings.groups.window'),
        rows: [
          { id: 'tray', label: t('settings.rows.tray.label', { app: APP_NAME }), hint: t('settings.rows.tray.hint'), words: t('settings.rows.tray.words'), Control: TrayControl },
          { id: 'compact-run', label: t('settings.rows.compactRun.label'), hint: t('settings.rows.compactRun.hint'), words: t('settings.rows.compactRun.words'), Control: CompactWhileRunningControl },
        ],
      },
      {
        title: t('settings.groups.startup'),
        rows: [
          { id: 'runOnStartup', label: t('settings.rows.runOnStartup.label'), hint: t('settings.rows.runOnStartup.hint'), words: t('settings.rows.runOnStartup.words'), Control: RunOnStartupControl },
          { id: 'startMinimized', label: t('settings.rows.startMinimized.label'), hint: t('settings.rows.startMinimized.hint'), words: t('settings.rows.startMinimized.words'), Control: StartMinimizedControl },
          { id: 'runAsAdmin', label: t('settings.rows.runAsAdmin.label'), hint: t('settings.rows.runAsAdmin.hint', { app: APP_NAME }), words: t('settings.rows.runAsAdmin.words'), Control: settingSwitch('runAsAdmin', t('settings.rows.runAsAdmin.label')) },
        ],
      },
      {
        title: t('settings.groups.runEnds'),
        note: t('settings.groups.runEndsNote'),
        rows: [
          { id: 'runEndFlash', label: t('settings.rows.runEndFlash.label'), hint: t('settings.rows.runEndFlash.hint'), words: t('settings.rows.runEndFlash.words'), Control: RunEndFlashControl },
          { id: 'runEndSound', label: t('settings.rows.runEndSound.label'), hint: t('settings.rows.runEndSound.hint'), words: t('settings.rows.runEndSound.words'), Control: RunEndSoundControl },
        ],
      },
      {
        title: t('settings.groups.interface'),
        rows: [
          // Found by either language's words, whatever the one on screen (plan of languages, §3.6).
          { id: 'language', label: t('settings.language.label'), hint: t('settings.language.hint'), words: 'language idioma lingua língua portuguese português portugues english inglês ingles interface', Control: LanguageControl },
        ],
      },
      {
        title: t('settings.groups.files'),
        rows: [
          {
            id: 'dataFolder',
            label: t('settings.rows.dataFolder.label'),
            hint: t('settings.rows.dataFolder.hint'),
            words: t('settings.rows.dataFolder.words'),
            Control: function DataFolder() {
              const app = useAppActions();
              return <button type="button" className="insp-button" onClick={app.openDataFolder}><FolderOpen aria-hidden="true" />{t('settings.rows.dataFolder.label')}</button>;
            },
          },
        ],
      },
      {
        title: TR2_NAME,
        rows: [
          { id: 'importTr2', label: t('settings.rows.importTr2.label', { tr2: TR2_NAME }), hint: t('settings.rows.importTr2.hint', { tr2: TR2_NAME }), words: t('settings.rows.importTr2.words'), Control: ImportTr2Control },
        ],
      },
      {
        title: t('settings.groups.reset'),
        rows: [
          { id: 'reset', label: t('settings.rows.reset.label'), hint: t('settings.rows.reset.hint'), words: t('settings.rows.reset.words'), Control: ResetControl },
        ],
      },
    ],
  },
  {
    id: 'hotkeys',
    label: t('settings.categories.hotkeys'),
    built: true,
    Intro: HotkeysIntro,
    Badge: HotkeysBadge,
    groups: [
      {
        title: t('settings.groups.recordReplay'),
        rows: [
          hotkeyRow('record', 'recordingHotkey', t('settings.hotkeys.record.label'), { hint: t('settings.hotkeys.record.hint'), words: t('settings.hotkeys.record.words') }),
          hotkeyRow('replay', 'replayHotkey', t('settings.hotkeys.replay.label'), { hint: t('settings.hotkeys.replay.hint'), words: t('settings.hotkeys.replay.words') }),
          hotkeyRow('shortcuts', 'profileKeyToggleHotkey', t('settings.hotkeys.shortcuts.label'), { hint: t('settings.hotkeys.shortcuts.hint'), words: t('settings.hotkeys.shortcuts.words') }),
        ],
      },
      {
        title: t('settings.groups.window'),
        rows: [
          hotkeyRow('front', 'foregroundHotkey', t('settings.hotkeys.front.label', { app: APP_NAME }), { words: t('settings.hotkeys.front.words') }),
          hotkeyRow('clicker', 'modeToggleHotkey', t('settings.hotkeys.clicker.label'), { hint: t('settings.hotkeys.clicker.hint'), words: t('settings.hotkeys.clicker.words') }),
        ],
      },
      {
        title: t('settings.groups.clicker'),
        note: t('settings.groups.clickerNote'),
        rows: [
          hotkeyRow('clickerStart', 'cursorClickStartHotkey', t('settings.hotkeys.clickerStart.label'), { hint: t('settings.hotkeys.clickerStart.hint'), words: t('settings.hotkeys.clickerStart.words') }),
          hotkeyRow('clickerPause', 'cursorClickPauseHotkey', t('settings.hotkeys.clickerPause.label'), { hint: t('settings.hotkeys.clickerPause.hint'), words: t('settings.hotkeys.clickerPause.words') }),
        ],
      },
      {
        title: t('settings.groups.screenClipboard'),
        rows: [
          hotkeyRow('clip', 'captureSlotHotkey', t('settings.hotkeys.clip.label'), { hint: t('settings.hotkeys.clip.hint'), words: t('settings.hotkeys.clip.words') }),
          hotkeyRow('screenText', 'copyScreenTextHotkey', t('settings.hotkeys.screenText.label'), { hint: t('settings.hotkeys.screenText.hint'), words: t('settings.hotkeys.screenText.words') }),
        ],
      },
    ],
  },
  {
    id: 'appearance',
    label: t('settings.categories.appearance'),
    built: true,
    Intro: AppearanceIntro,
    Panel: AppearanceLoader,
    warm: () => { void preload(loadAppearance); },
    words: t('settings.appearance.words'),
  },
  {
    id: 'recording',
    label: t('settings.categories.recording'),
    built: true,
    groups: [
      {
        title: t('settings.groups.recording'),
        rows: [
          { id: 'realTiming', label: t('settings.rows.realTiming.label'), hint: t('settings.rows.realTiming.hint'), words: t('settings.rows.realTiming.words'), Control: settingSwitch('useCustomDelay', t('settings.rows.realTiming.label'), true) },
          { id: 'delay', label: t('settings.rows.delay.label'), hint: t('settings.rows.delay.hint'), words: t('settings.rows.delay.words'), Control: settingNumber('customDelay', t('settings.rows.delay.label'), 60000, 'ms', 100) },
        ],
      },
      {
        title: t('settings.groups.playback'),
        note: t('settings.groups.playbackNote'),
        rows: [
          { id: 'returnCursor', label: t('settings.rows.returnCursor.label'), hint: t('settings.rows.returnCursor.hint'), words: t('settings.rows.returnCursor.words'), Control: settingSwitch('restoreCursor', t('settings.rows.returnCursor.label')) },
          { id: 'gameMode', label: t('settings.rows.gameMode.label'), hint: t('settings.rows.gameMode.hint'), words: t('settings.rows.gameMode.words'), Control: settingSwitch('smoothMovement', t('settings.rows.gameMode.label')) },
          { id: 'fastApproach', label: t('settings.rows.fastApproach.label'), hint: t('settings.rows.fastApproach.hint'), words: t('settings.rows.fastApproach.words'), Control: settingSwitch('fastApproach', t('settings.rows.fastApproach.label')), shown: s => s.smoothMovement },
          { id: 'jitter', label: t('settings.rows.jitter.label'), hint: t('settings.rows.jitter.hint'), words: t('settings.rows.jitter.words'), Control: JitterControl },
        ],
      },
      {
        title: t('settings.groups.tuning'),
        note: t('settings.groups.tuningNote'),
        rows: [
          { id: 'clickDelay', label: t('settings.rows.clickDelay.label'), hint: t('settings.rows.clickDelay.hint'), words: t('settings.rows.clickDelay.words'), Control: settingNumber('moveClickDelay', t('settings.rows.clickDelay.label'), 1000, 'ms') },
          { id: 'pathStep', label: t('settings.rows.pathStep.label'), hint: t('settings.rows.pathStep.hint'), words: t('settings.rows.pathStep.words'), Control: PathStepControl, shown: s => s.smoothMovement },
          { id: 'stepDelay', label: t('settings.rows.stepDelay.label'), hint: t('settings.rows.stepDelay.hint'), words: t('settings.rows.stepDelay.words'), Control: settingNumber('moveStepDelay', t('settings.rows.stepDelay.label'), 100, 'ms'), shown: s => s.smoothMovement },
          { id: 'distance', label: t('settings.rows.distance.label'), hint: t('settings.rows.distance.hint'), words: t('settings.rows.distance.words'), Control: settingNumber('settleDistance', t('settings.rows.distance.label'), 4000, 'px'), shown: s => s.smoothMovement && s.fastApproach },
        ],
      },
    ],
  },
  {
    id: 'screen',
    label: t('settings.categories.screen'),
    built: true,
    groups: [
      {
        title: t('settings.groups.textRecognition'),
        note: t('settings.groups.textRecognitionNote'),
        rows: [
          { id: 'ocrLanguage', label: t('settings.rows.ocrLanguage.label'), hint: t('settings.rows.ocrLanguage.hint'), words: t('settings.rows.ocrLanguage.words'), Control: OcrLanguageControl },
        ],
      },
    ],
  },
  { id: 'browser', label: t('settings.categories.browser'), built: true, Panel: BrowserPanel, words: t('settings.browser.words') },
  {
    id: 'diagnostics',
    label: t('settings.categories.diagnostics'),
    built: true,
    groups: [
      {
        title: t('settings.groups.diagnostics'),
        rows: [
          { id: 'copyDiagnostics', label: t('settings.rows.copyDiagnostics.label'), hint: t('settings.rows.copyDiagnostics.hint'), words: t('settings.rows.copyDiagnostics.words'), Control: CopyDiagnosticsControl },
          { id: 'logs', label: t('settings.rows.logs.label'), hint: t('settings.rows.logs.hint'), words: t('settings.rows.logs.words'), Control: LogsControl },
          { id: 'reload', label: t('settings.rows.reload.label'), hint: t('settings.rows.reload.hint'), words: t('settings.rows.reload.words'), Control: ReloadControl },
        ],
      },
    ],
  },
];
