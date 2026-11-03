import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { t } from '../../../i18n';
import { useTheme } from '../../../state/ThemeContext';
import { colorDeclarations, resolveThemeColors } from '../../../themes';
import { openColor, useAp } from './appearanceStore';

/**
 * Settings › Appearance's live preview (settings-207; the concept's SettingsAppearance board): a
 * macro in a small window, in the theme as the app paints it. The theme under the pointer in the
 * gallery paints it alone, before it is chosen. Its parts open their colour in the editor, and the
 * colour row under the pointer outlines what it paints. The page is the app itself, so the preview
 * is for the eyes and the pointer: the editor reaches every colour by the keyboard. The steps' names
 * are the glossary's; the rest of its text is an example, in the build's language, and each part is
 * named as the editor names its colour.
 */
export function Preview() {
  const hoverTheme = useAp(s => s.hoverTheme);
  const { config, customPresets } = useTheme();
  const ref = useRef<HTMLDivElement>(null);
  // The theme under the pointer, as it comes, with the app's step colours (they are not a theme's).
  const css = hoverTheme
    ? colorDeclarations(resolveThemeColors({ ...config, baseThemeId: hoverTheme, colorOverrides: {} }, customPresets), config.uiSettings).join(' ')
    : '';
  useLayoutEffect(() => {
    if (ref.current) ref.current.style.cssText = css;
  }, [css]);
  return (
    <aside className="ap-preview" aria-label={t('appearance.preview.title')}>
      <span className="ap-pv-label">{t('appearance.preview.title')}</span>
      <div ref={ref} className="ap-pv" aria-hidden="true">
        <Spot k="bg-base" name={t('appearance.colors.names.bgBase')} className="ap-pv-bar">
          <span className="ap-pv-dot" />
          <Spot k="text-primary" name={t('appearance.colors.names.textPrimary')} className="ap-pv-name">{t('appearance.preview.macro')}</Spot>
        </Spot>
        <Spot k="bg-surface" name={t('appearance.colors.names.bgSurface')} className="ap-pv-rows">
          <Row k="actionMouseColor" name={t('appearance.colors.names.mouse')} tone="mouse" pill="Left Click" detail="1742, 388" mono />
          <Row k="actionKeyColor" name={t('appearance.colors.names.key')} tone="key" pill="Keystroke" detail="Ctrl+V" mono selected />
          <Row k="actionWaitImageColor" name={t('appearance.colors.names.wait')} tone="waitimage" pill="Wait Image" detail={t('appearance.preview.imageFile')} mono />
          <Row k="actionIfColor" name={t('appearance.colors.names.conditional')} tone="if" pill="If" detail={t('appearance.preview.ifDetail')} />
          <Row k="actionSendTextColor" name={t('appearance.colors.names.sendText')} tone="sendtext" pill="Send Text" detail={t('appearance.preview.sentText')} mono />
        </Spot>
        <div className="ap-pv-foot">
          <Spot k="replayColor" name={t('appearance.colors.names.replay')} className="ap-pv-replay">{t('common.actions.replay')}</Spot>
          <Spot k="accent-solid" name={t('appearance.colors.names.accentSolid')} className="ap-pv-add">{t('insert.addStep')}</Spot>
          <span className="ap-pv-gap" />
          <span className="ap-pv-switch" />
        </div>
      </div>
      <span className="ap-pv-hint">{t('appearance.preview.hint')}</span>
    </aside>
  );
}

/** A step row: the selected one is tinted in the accent, which it opens. The pill is the step's name. */
function Row({ k, name, tone, pill, detail, mono, selected }: { k: string; name: string; tone: string; pill: string; detail: string; mono?: boolean; selected?: boolean }) {
  const row = (
    <span className="ap-pv-row">
      <Spot k={k} name={name} className="ap-pv-pill" tone={tone} named>{pill}</Spot>
      <Spot k="text-secondary" name={t('appearance.colors.names.textSecondary')} className="ap-pv-detail" mono={mono}>{detail}</Spot>
    </span>
  );
  return selected ? <Spot k="accent" name={t('appearance.colors.names.accent')} className="ap-pv-selected">{row}</Spot> : row;
}

/**
 * A part that opens its colour (`k`, a theme or interface colour) in the editor. `named`: its text is
 * a name of the glossary (a step's), the same in every language.
 */
function Spot({ k, name, className, tone, mono, named, children }: { k: string; name: string; className: string; tone?: string; mono?: boolean; named?: boolean; children: ReactNode }) {
  const hot = useAp(s => s.hoverColor === k);
  return (
    <span
      className={`ap-pv-spot ${className}`}
      data-key={k}
      data-tone={tone}
      data-mono={mono || undefined}
      data-glossary={named ? '' : undefined}
      data-hot={hot || undefined}
      data-tip={t('appearance.preview.editTip', { name })}
      onClick={(e) => { e.stopPropagation(); openColor(k); }}
    >
      {children}
    </span>
  );
}
