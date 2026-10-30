import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTt } from '../../../state/LanguageContext';
import { useTheme } from '../../../state/ThemeContext';
import { colorDeclarations, resolveThemeColors } from '../../../themes';
import { openColor, useAp } from './appearanceStore';

/**
 * Settings › Appearance's live preview (settings-207; the concept's SettingsAppearance board): a
 * macro in a small window, in the theme as the app paints it. The theme under the pointer in the
 * gallery paints it alone, before it is chosen. Its parts open their colour in the editor, and the
 * colour row under the pointer outlines what it paints. The page is the app itself, so the preview
 * is for the eyes and the pointer: the editor reaches every colour by the keyboard.
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
    <aside className="ap-preview" aria-label="Live preview">
      <span className="ap-pv-label">Live preview</span>
      <div ref={ref} className="ap-pv" aria-hidden="true">
        <Spot k="bg-base" name="Base" className="ap-pv-bar">
          <span className="ap-pv-dot" />
          <Spot k="text-primary" name="Primary" className="ap-pv-name">Trade Roblox</Spot>
        </Spot>
        <Spot k="bg-surface" name="Surface" className="ap-pv-rows">
          <Row k="actionMouseColor" name="Mouse" tone="mouse" pill="Left Click" detail="1742, 388" mono />
          <Row k="actionKeyColor" name="Key" tone="key" pill="Keystroke" detail="Ctrl+V" mono selected />
          <Row k="actionWaitImageColor" name="Wait" tone="waitimage" pill="Wait Image" detail="btn-ok.png" mono />
          <Row k="actionIfColor" name="Conditional" tone="if" pill="If" detail="has “Ready”" />
          <Row k="actionSendTextColor" name="Send Text" tone="sendtext" pill="Send Text" detail="Olá! Tudo bem?" mono />
        </Spot>
        <div className="ap-pv-foot">
          <Spot k="replayColor" name="Replay" className="ap-pv-replay">Replay</Spot>
          <Spot k="accent-solid" name="Solid" className="ap-pv-add">Add step</Spot>
          <span className="ap-pv-gap" />
          <span className="ap-pv-switch" />
        </div>
      </div>
      <span className="ap-pv-hint">Hover a theme to try it here before choosing.</span>
    </aside>
  );
}

/** A step row: the selected one is tinted in the accent, which it opens. */
function Row({ k, name, tone, pill, detail, mono, selected }: { k: string; name: string; tone: string; pill: string; detail: string; mono?: boolean; selected?: boolean }) {
  const row = (
    <span className="ap-pv-row">
      <Spot k={k} name={name} className="ap-pv-pill" tone={tone}>{pill}</Spot>
      <Spot k="text-secondary" name="Secondary" className="ap-pv-detail" mono={mono}>{detail}</Spot>
    </span>
  );
  return selected ? <Spot k="accent" name="Accent" className="ap-pv-selected">{row}</Spot> : row;
}

/** A part that opens its colour (`k`, a theme or interface colour) in the editor. */
function Spot({ k, name, className, tone, mono, children }: { k: string; name: string; className: string; tone?: string; mono?: boolean; children: ReactNode }) {
  const tt = useTt();
  const hot = useAp(s => s.hoverColor === k);
  return (
    <span
      className={`ap-pv-spot ${className}`}
      data-key={k}
      data-tone={tone}
      data-mono={mono || undefined}
      data-hot={hot || undefined}
      data-tip={tt(`${name} — click to edit`, `${name} — clique para editar`)}
      onClick={(e) => { e.stopPropagation(); openColor(k); }}
    >
      {children}
    </span>
  );
}
