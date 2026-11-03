import { useEffect, useRef, type ReactNode } from 'react';
import { Languages, Unplug } from 'lucide-react';
import { APP_NAME } from '../../appIdentity';
import { useBridge } from '../../bridge/BridgeContext';
import { t } from '../../i18n';
import { useOcrLanguages, useSettings } from '../../logic/useSettings';
import { useToast } from '../../state/ToastContext';
import { ocrLanguageNote, ocrLanguageOptions, ocrPickerLanguages } from '../../utils/ocrLanguages';
import { useExtension } from '../statusbar/extensionState';
import { useApp } from '../store';
import { openSettings } from '../ui';
import './missing.css';

/**
 * What a step needs and this computer does not have yet, said where the step is edited, with the
 * way to get it (EmptyStates board, "O que falta, na hora em que falta"): the browser extension for
 * the browser steps and checks, and Windows' text reading for the steps and checks that read the
 * screen (settings-130 and nativo-130). Nothing shows while all is there.
 */
function Missing({ icon, title, text, children }: { icon: ReactNode; title: string; text: string; children?: ReactNode }) {
  return (
    <div className="insp-missing" role="status">
      {icon}
      <div className="insp-missing-text">
        <span className="insp-missing-title">{title}</span>
        <span>{text}</span>
        {children}
      </div>
    </div>
  );
}

/** The browser steps run through the extension: offline, they fail and their checks read as not found. */
export function ExtensionMissing() {
  const connection = useExtension(s => s.connection);
  if (connection !== 'disconnected') return null;
  return (
    <Missing icon={<Unplug aria-hidden="true" />} title={t('inspector.missing.extension')} text={t('inspector.missing.extensionText')}>
      <button type="button" className="insp-button insp-missing-action" onClick={() => openSettings('browser')}>{t('inspector.missing.setUp')}</button>
    </Missing>
  );
}

/**
 * The screen is read in the language of Settings › Screen Text: its Windows pack missing, being
 * installed, or waiting for a restart. Install here is the one of Settings, and the toast is for the
 * install asked here.
 */
export function OcrMissing() {
  const pick = useApp(a => a.settings.ocrLanguage) ?? '';
  const langs = useOcrLanguages(true);
  const settings = useSettings();
  const { subscribe } = useBridge();
  const { showToast } = useToast();
  const asked = useRef<string | null>(null);
  useEffect(() => subscribe((m) => {
    if (m.type !== 'ocr:installResult' || asked.current?.toLowerCase() !== m.payload.tag.toLowerCase()) return;
    asked.current = null;
    const r = m.payload;
    if (r.ok) {
      showToast(r.restartApp ? t('inspector.missing.doneRestartApp', { app: APP_NAME })
        : r.restartWindows ? t('inspector.missing.doneRestartWindows')
        : t('inspector.missing.done'), 'success');
    } else if (r.canceled) showToast(t('inspector.missing.canceled'), 'info');
    else showToast(t('inspector.missing.failed', { error: r.error ?? t('inspector.missing.unknownError') }), 'error');
  }), [subscribe, showToast]);
  if (!langs) return null;
  const note = ocrLanguageNote(pick, langs);
  if (!note) return null;
  const picker = ocrPickerLanguages(langs.offered, langs.available);
  const options = ocrLanguageOptions(picker);
  const name = (tag: string) => options.find(o => o.value.toLowerCase() === tag.toLowerCase())?.label ?? tag;
  const icon = <Languages aria-hidden="true" />;
  const screenText = <button type="button" className="insp-button insp-missing-action" onClick={() => openSettings('screen')}>{t('inspector.missing.openScreenText')}</button>;

  if (note.kind !== 'missing') {
    return note.kind === 'installing'
      ? <Missing icon={icon} title={t('inspector.missing.installing', { name: name(pick) })} text={t('inspector.missing.installingText')} />
      : <Missing icon={icon} title={t('inspector.missing.installed', { name: name(pick) })} text={t('inspector.missing.restart', { app: APP_NAME })} />;
  }
  if (!pick) return <Missing icon={icon} title={t('inspector.missing.none')} text={t('inspector.missing.noneText')}>{screenText}</Missing>;
  const text = langs.effective
    ? t('inspector.missing.notInstalledUntil', { effective: name(langs.effective) })
    : t('inspector.missing.notInstalledText');
  const install = note.install;
  return (
    <Missing icon={icon} title={t('inspector.missing.notInstalled', { name: name(pick) })} text={text}>
      {install
        ? (
          <button
            type="button"
            className="insp-button insp-missing-action"
            disabled={!!langs.installing}
            data-tip={t('inspector.missing.installTip')}
            onClick={() => { asked.current = install.tag; settings.installOcrLanguage(install.tag); }}
          >
            {t('inspector.missing.install')}
          </button>
        )
        : screenText}
    </Missing>
  );
}
