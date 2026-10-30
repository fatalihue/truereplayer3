import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from 'react';
import { Check, ChevronDown, ChevronLeft, ChevronRight, Clipboard, ClipboardPaste, Download, Pipette, RotateCcw, SlidersHorizontal, TriangleAlert, Upload, Wand2 } from 'lucide-react';
import { useEditorTools } from '../../../logic/useEditorTools';
import { useTt } from '../../../state/LanguageContext';
import { useTheme } from '../../../state/ThemeContext';
import { useToast } from '../../../state/ToastContext';
import { measurePaintedContrast, withOriginalAlpha } from '../../../themeChecks';
import { hslTracks } from '../../../themePresets';
import {
  DEFAULT_UI_SETTINGS, hexToHSL, hslToHex, pickInk, toHex, validateExportedTheme,
  type ExportedTheme, type ThemeColors, type ThemeUISettings,
} from '../../../themes';
import { useAsk } from '../../inspector/probes';
import { baseOf, showView, useAp } from './appearanceStore';
import './themeEditor.css';

/**
 * Settings › Appearance's theme editor (phase 3, slice 4), the parts of today's Theme Editor that are
 * not on the page: Edit colors… (settings-165 to 183) and Share or import… (settings-199 to 206). Each
 * is a view of the page, with the way back at its top; the live preview stays beside it. A chunk of
 * its own, which the page brings when it has nothing to do.
 */

// ── The colours ──

type Kind = 'theme' | 'ui';
interface Field { key: string; label: string; kind: Kind }
interface Section { title: string; fields: Field[]; pairs?: boolean; accent?: boolean }

const SECTIONS: Section[] = [
  { title: 'Accent', accent: true, fields: [
    { key: 'accent', label: 'Accent', kind: 'theme' },
    { key: 'accent-solid', label: 'Solid', kind: 'theme' },
    { key: 'accent-hover', label: 'Hover', kind: 'theme' },
  ] },
  { title: 'Backgrounds', fields: [
    { key: 'bg-base', label: 'Base', kind: 'theme' },
    { key: 'bg-surface', label: 'Surface', kind: 'theme' },
    { key: 'bg-card', label: 'Card', kind: 'theme' },
    { key: 'bg-elevated', label: 'Elevated', kind: 'theme' },
    { key: 'bg-input', label: 'Input', kind: 'theme' },
  ] },
  { title: 'Text', fields: [
    { key: 'text-primary', label: 'Primary', kind: 'theme' },
    { key: 'text-secondary', label: 'Secondary', kind: 'theme' },
    { key: 'text-tertiary', label: 'Tertiary', kind: 'theme' },
    { key: 'text-disabled', label: 'Disabled', kind: 'theme' },
  ] },
  { title: 'Borders', fields: [
    { key: 'border-subtle', label: 'Subtle', kind: 'theme' },
    { key: 'border-default', label: 'Default', kind: 'theme' },
    { key: 'border-strong', label: 'Strong', kind: 'theme' },
  ] },
  { title: 'Semantic', fields: [
    { key: 'recordingColor', label: 'Recording', kind: 'ui' },
    { key: 'replayColor', label: 'Replay', kind: 'ui' },
    { key: 'clickerColor', label: 'Clicker', kind: 'ui' },
  ] },
  { title: 'Action types', pairs: true, fields: [
    { key: 'actionMouseColor', label: 'Mouse', kind: 'ui' },
    { key: 'actionKeyColor', label: 'Key', kind: 'ui' },
    { key: 'actionScrollColor', label: 'Scroll', kind: 'ui' },
    { key: 'actionSendTextColor', label: 'Send Text', kind: 'ui' },
    { key: 'actionSetVariableColor', label: 'Set Variable', kind: 'ui' },
    // One colour for the Wait family (Image, Pixel Color, Text), as today.
    { key: 'actionWaitImageColor', label: 'Wait', kind: 'ui' },
    { key: 'actionBrowserColor', label: 'Browser', kind: 'ui' },
    { key: 'actionRunProfileColor', label: 'Run Macro', kind: 'ui' },
    { key: 'actionPauseColor', label: 'Pause', kind: 'ui' },
    { key: 'actionIfColor', label: 'Conditional', kind: 'ui' },
    { key: 'actionLoopColor', label: 'Loop', kind: 'ui' },
    { key: 'actionFlowColor', label: 'Stop / Return', kind: 'ui' },
    { key: 'actionActivateWindowColor', label: 'Activate Window', kind: 'ui' },
  ] },
];
const FIELDS = SECTIONS.flatMap(s => s.fields);

/** The file's name in a path the Save dialog chose. */
const fileOf = (path: string) => path.split(/[\\/]/).pop() || path;

/** The way back to the page, and what the view is. */
function Head({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="te-head">
      <button type="button" className="te-back" autoFocus onClick={() => showView('main')}>
        <ChevronLeft aria-hidden="true" />
        Appearance
      </button>
      <h3 className="te-title">{title}</h3>
      {detail && <span className="te-detail">{detail}</span>}
    </div>
  );
}

/**
 * Edit colors…: the 29 colours in their groups, each with its swatch (the colour picker), its hex,
 * the eyedropper, the HSL sliders (one open at a time), the way back to the theme's colour and the
 * contrast it reaches once painted. A preview hotspot opens its colour here.
 */
export function ColorsView() {
  const tt = useTt();
  const { showToast } = useToast();
  const { config, resolvedColors, customPresets, setColorOverride, clearColorOverride, setAccentColor, setUISetting } = useTheme();
  const focus = useAp(s => s.focus);
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const [hsl, setHsl] = useState<string | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  // A hotspot asked for a colour: its group opens, and its HSL (derived here, as it changes). The
  // view comes with the ask, so the first one counts too; leaving the view drops it (showView).
  const [seen, setSeen] = useState(0);
  if (focus && focus.seq !== seen) {
    setSeen(focus.seq);
    setHsl(focus.key);
    const group = SECTIONS.find(s => s.fields.some(f => f.key === focus.key));
    if (group && closed.has(group.title)) setClosed(new Set([...closed].filter(t => t !== group.title)));
  }
  useEffect(() => {
    if (!focus) return;
    const id = requestAnimationFrame(() => {
      const row = document.querySelector<HTMLElement>(`.te-row[data-key="${CSS.escape(focus.key)}"]`);
      row?.scrollIntoView({ block: 'center' });
      row?.querySelector<HTMLInputElement>('.te-hex')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, [focus]);

  const base = baseOf(config.baseThemeId, customPresets);
  const value = (f: Field) => (f.kind === 'theme' ? resolvedColors[f.key as keyof ThemeColors] : String(config.uiSettings[f.key as keyof ThemeUISettings]));
  const original = (f: Field) => (f.kind === 'theme' ? base.colors[f.key as keyof ThemeColors] : String(DEFAULT_UI_SETTINGS[f.key as keyof ThemeUISettings]));
  const changed = (f: Field) => (f.kind === 'theme' ? f.key in config.colorOverrides : value(f) !== original(f));
  const count = FIELDS.filter(changed).length;

  // A colour picked goes to the recent ones once the gesture settles: a drag passes many on its way.
  // Another colour changed meanwhile settles the one waiting at once, so two quick edits keep both.
  const recentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const waiting = useRef<{ key: string; hex: string } | null>(null);
  useEffect(() => () => { if (recentTimer.current) clearTimeout(recentTimer.current); }, []);
  const remember = (hex: string) => {
    const c = toHex(hex).toLowerCase();
    setRecent(r => [c, ...r.filter(x => x !== c)].slice(0, 8));
  };
  const apply = (f: Field, hex: string) => {
    if (f.kind === 'theme') {
      const k = f.key as keyof ThemeColors;
      setColorOverride(k, withOriginalAlpha(hex, resolvedColors[k]));
    } else {
      setUISetting(f.key as keyof ThemeUISettings, hex as ThemeUISettings[keyof ThemeUISettings]);
    }
    if (recentTimer.current) clearTimeout(recentTimer.current);
    if (waiting.current && waiting.current.key !== f.key) remember(waiting.current.hex);
    waiting.current = { key: f.key, hex };
    recentTimer.current = setTimeout(() => {
      if (waiting.current) remember(waiting.current.hex);
      waiting.current = null;
    }, 400);
  };
  const reset = (f: Field) => {
    if (f.kind === 'theme') clearColorOverride(f.key as keyof ThemeColors);
    else setUISetting(f.key as keyof ThemeUISettings, DEFAULT_UI_SETTINGS[f.key as keyof ThemeUISettings]);
  };
  // The eyedropper is the app's own pick on the screen, the Pixel color check's: the window steps
  // aside, and the colour clicked comes back. The browser's EyeDropper exists in WebView2, but its
  // picker never came up (phase 3's live test).
  const tools = useEditorTools();
  const picking = useRef<Field | null>(null);
  const pick = useAsk('pixel:colorPicked', (p) => {
    const f = picking.current;
    picking.current = null;
    if (f && !p.cancelled && !p.refused && p.hex) apply(f, p.hex.toLowerCase());
  });
  const pickFor = (f: Field) => {
    picking.current = f;
    pick.ask(requestId => tools.pickColor({ requestId, absolute: true, colorOnly: true }));
  };
  const open = hsl ? FIELDS.find(f => f.key === hsl) : undefined;
  // A recent colour goes to the field whose HSL is open; with none open, it is copied.
  const pickRecent = async (c: string) => {
    if (open) { apply(open, c); return; }
    try {
      await navigator.clipboard.writeText(c);
      setCopied(c);
      setTimeout(() => setCopied(p => (p === c ? null : p)), 1200);
    } catch {
      showToast(tt('Could not copy the color — click inside the window and try again.', 'Não foi possível copiar a cor — clique dentro da janela e tente de novo.'), 'error');
    }
  };

  return (
    <div className="te">
      <Head title="Colors" detail={count ? `${base.name} · ${count} changed` : base.name} />
      {SECTIONS.map(section => {
        const isClosed = closed.has(section.title);
        const n = section.fields.filter(changed).length;
        return (
          <section key={section.title} className="te-group" aria-label={section.title}>
            <button
              type="button"
              className="te-group-head"
              aria-expanded={!isClosed}
              onClick={() => setClosed(isClosed ? new Set([...closed].filter(t => t !== section.title)) : new Set([...closed, section.title]))}
            >
              {isClosed ? <ChevronRight aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              {section.title}
              {n > 0 && <span className="te-count">· {n} changed</span>}
              {isClosed && (
                <span className="te-dots" aria-hidden="true">
                  {section.fields.map(f => <span key={f.key} style={{ '--swatch': value(f) } as CSSProperties} />)}
                </span>
              )}
            </button>
            {!isClosed && (
              <div className="te-rows" data-pairs={section.pairs || undefined}>
                {section.fields.map(f => (
                  <ColorRow
                    key={f.key}
                    field={f}
                    value={value(f)}
                    changed={changed(f)}
                    check={measurePaintedContrast(f.kind, f.key, resolvedColors, config.uiSettings)}
                    hslOpen={hsl === f.key}
                    picking={pick.waiting}
                    onChange={(hex) => apply(f, hex)}
                    onPick={() => pickFor(f)}
                    onReset={() => reset(f)}
                    onToggleHsl={() => setHsl(hsl === f.key ? null : f.key)}
                  />
                ))}
                {section.accent && (
                  <button type="button" className="te-derive" onClick={() => setAccentColor(toHex(resolvedColors.accent))}>
                    <Wand2 aria-hidden="true" />
                    Derive solid &amp; hover
                  </button>
                )}
              </div>
            )}
          </section>
        );
      })}
      {recent.length > 0 && (
        <div className="te-recent">
          <span className="te-recent-label">Recent</span>
          {recent.map(c => (
            <button
              key={c}
              type="button"
              className="te-recent-swatch"
              style={{ '--swatch': c } as CSSProperties}
              aria-label={open ? `Apply ${c} to ${open.label}` : `Copy ${c}`}
              data-tip={open
                ? tt(`Apply ${c} to ${open.label}`, `Aplicar ${c} em ${open.label}`)
                : copied === c ? tt(`${c} — copied!`, `${c} — copiado!`) : tt(`${c} — click to copy`, `${c} — clique para copiar`)}
              onClick={() => { void pickRecent(c); }}
            >
              {copied === c && <Check aria-hidden="true" style={{ color: pickInk(c) }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// What the contrast is measured against, in the tip's language.
const WHAT_PT: Record<string, string> = {
  'worst surface': 'pior superfície',
  'UI boundary': 'limite de componente',
  'label on solid fill': 'rótulo sobre o preenchimento',
  'accent as text': 'destaque como texto',
  'derived ink on its own wash': 'tinta derivada sobre o próprio fundo',
};

function ColorRow({ field, value, changed, check, hslOpen, picking, onChange, onPick, onReset, onToggleHsl }: {
  field: Field;
  value: string;
  changed: boolean;
  /** The ratio the colour reaches once painted (measurePaintedContrast), against its own floor. */
  check: { ratio: number; target: number; what: string } | null;
  hslOpen: boolean;
  /** An eyedropper pick is out, for this row or another. */
  picking: boolean;
  onChange: (hex: string) => void;
  onPick: () => void;
  onReset: () => void;
  onToggleHsl: () => void;
}) {
  const tt = useTt();
  const { label } = field;
  const hex = toHex(value);
  // The field's own text while it has the focus: a complete #rrggbb applies as typed; leaving it
  // shows the colour stored.
  const [draft, setDraft] = useState<string | null>(null);
  // The H, S and L the sliders stand on, held while the colour is the one they made: at S 0 or L 0
  // or 100 every hue is the same grey, and re-deriving it would jump to red.
  const [hold, setHold] = useState<{ hex: string; h: number; s: number; l: number } | null>(null);
  const hslNow = hold && hold.hex === hex.toLowerCase() ? hold : hexToHSL(hex);
  const tracks = hslTracks(hslNow.h, hslNow.s, hslNow.l);
  const setHslValue = (h: number, s: number, l: number) => {
    const next = hslToHex(h, s, l);
    setHold({ hex: toHex(next).toLowerCase(), h, s, l });
    onChange(next);
  };
  const passing = check ? check.ratio >= check.target : true;
  const bad = check ? check.ratio < check.target * 0.67 : false;
  const tip = check ? tt(`${check.what}: ${check.ratio.toFixed(1)}:1 — wants ${check.target}+`,
    `${WHAT_PT[check.what] ?? check.what}: ${check.ratio.toFixed(1)}:1 — precisa de ${check.target}+`) : undefined;
  return (
    <div className="te-row-wrap">
      <div className="te-row" data-key={field.key}
        onPointerEnter={() => useAp.setState({ hoverColor: field.key })}
        onPointerLeave={() => useAp.setState(s => (s.hoverColor === field.key ? { hoverColor: null } : s))}
      >
        <span className="te-label">{label}</span>
        <label className="te-swatch" style={{ '--swatch': value } as CSSProperties}>
          <input type="color" aria-label={`${label} color`} value={hex} onChange={(e) => onChange(e.target.value)} />
        </label>
        <input
          className="te-hex"
          type="text"
          aria-label={`${label} hex`}
          spellCheck={false}
          value={draft ?? hex}
          onFocus={() => setDraft(hex)}
          onBlur={() => setDraft(null)}
          onChange={(e) => {
            setDraft(e.target.value);
            if (/^#[0-9a-fA-F]{6}$/.test(e.target.value)) onChange(e.target.value);
          }}
        />
        <span className="te-tools">
          <button type="button" className="te-tool" aria-label={`Pick ${label} color from screen`} data-tip={tt('Pick a color from the screen', 'Pegar uma cor da tela')} disabled={picking} onClick={onPick}>
            <Pipette aria-hidden="true" />
          </button>
          <button type="button" className="te-tool" data-on={hslOpen || undefined} aria-label={`${label} HSL sliders`} aria-expanded={hslOpen} data-tip={tt('HSL sliders', 'Controles HSL')} onClick={onToggleHsl}>
            <SlidersHorizontal aria-hidden="true" />
          </button>
          {changed
            ? (
              <button type="button" className="te-tool te-tool-reset" aria-label={`Reset ${label} to the theme's color`} data-tip={tt('Back to the theme’s color', 'Voltar à cor do tema')} onClick={onReset}>
                <RotateCcw aria-hidden="true" />
              </button>
            )
            : <span className="te-tool-slot" aria-hidden="true" />}
        </span>
        {check && (
          passing
            ? <span className="te-contrast" data-tip={tip}>{check.ratio.toFixed(1)}</span>
            : <span className="te-contrast" data-tone={bad ? 'bad' : 'warn'} data-tip={tip}><TriangleAlert aria-hidden="true" />{check.ratio.toFixed(1)}</span>
        )}
      </div>
      {hslOpen && (
        <div className="te-hsl">
          <Channel short="H" name={`${label} hue`} max={360} unit="°" value={Math.round(hslNow.h)} track={tracks.hue}
            onChange={(v) => setHslValue(v, hslNow.s, hslNow.l)} />
          <Channel short="S" name={`${label} saturation`} max={100} unit="%" value={Math.round(hslNow.s)} track={tracks.saturation}
            onChange={(v) => setHslValue(hslNow.h, v, hslNow.l)} />
          <Channel short="L" name={`${label} lightness`} max={100} unit="%" value={Math.round(hslNow.l)} track={tracks.lightness}
            onChange={(v) => setHslValue(hslNow.h, hslNow.s, v)} />
        </div>
      )}
    </div>
  );
}

function Channel({ short, name, max, unit, value, track, onChange }: { short: string; name: string; max: number; unit: string; value: number; track: string; onChange: (v: number) => void }) {
  return (
    <div className="te-channel">
      <span className="te-channel-name" aria-hidden="true">{short}</span>
      <span className="te-channel-track" style={{ '--track': track } as CSSProperties}>
        <input type="range" aria-label={name} min={0} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="te-channel-knob" style={{ '--at': `${(value / max) * 100}%` } as CSSProperties} />
      </span>
      <span className="te-channel-value" aria-hidden="true">{value}{unit}</span>
    </div>
  );
}

// ── Share or import ──

/**
 * Share or import…: the theme as one JSON (its colours, the changes on them and the interface), to a
 * file or the clipboard; and a theme from a file, the clipboard or pasted, back on the page with the
 * toast's Undo (Ctrl+Z too).
 */
export function ShareView() {
  const tt = useTt();
  const { showToast } = useToast();
  const { config, exportTheme, importTheme, restoreConfig } = useTheme();
  const [name, setName] = useState('My theme');
  const [copy, setCopy] = useState<'idle' | 'ok' | 'failed'>('idle');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (copy === 'idle') return;
    const id = setTimeout(() => setCopy('idle'), 2000);
    return () => clearTimeout(id);
  }, [copy]);

  const theName = () => name.trim() || 'My theme';
  // Export to file goes through the system's Save dialog: a download from the page went to
  // Downloads without asking where. Said once written; a cancel says nothing.
  const tools = useEditorTools();
  const saving = useAsk('dialog:saveFileResult', (r) => {
    if (r.error) showToast(tt(`Could not save the theme: ${r.error}`, `Não foi possível salvar o tema: ${r.error}`), 'error');
    else if (r.path) showToast(tt(`Saved ${fileOf(r.path)}`, `${fileOf(r.path)} salvo`), 'success');
  });
  const exportFile = () => {
    const file = `${theName().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'theme'}.json`;
    const text = JSON.stringify(exportTheme(theName()), null, 2);
    saving.ask(requestId => tools.saveFile({ requestId, name: file, text, title: 'Export theme' }));
  };
  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(exportTheme(theName()), null, 2));
      setCopy('ok');
    } catch {
      setCopy('failed');
    }
  };
  const take = (json: string) => {
    setError('');
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      setError('Invalid JSON: paste the whole exported theme.');
      return;
    }
    const before = config;
    if (!validateExportedTheme(parsed) || !importTheme(parsed as ExportedTheme)) {
      setError('Invalid theme: missing color keys or UI settings.');
      return;
    }
    setText('');
    showView('main');
    showToast(tt(`Imported the theme “${parsed.name}”`, `Tema “${parsed.name}” importado`), {
      type: 'success',
      duration: 10000,
      // What the page was before it: a change like any other, which Ctrl+Z can take back too.
      action: { label: 'Undo', onClick: () => restoreConfig(before) },
    });
  };
  const fromFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => take(String(reader.result));
    reader.onerror = () => setError('Could not read the selected file.');
    reader.readAsText(file);
  };
  const paste = async () => {
    let clip: string;
    try {
      clip = await navigator.clipboard.readText();
    } catch {
      setError('Could not read the clipboard — paste the JSON manually.');
      return;
    }
    setText(clip);
    take(clip);
  };

  return (
    <div className="te">
      <Head title="Share or import" />
      <section className="te-share" aria-labelledby="te-export">
        <h4 id="te-export" className="te-share-title">Export this theme</h4>
        <div className="te-share-row">
          <input className="te-name" type="text" aria-label="Theme name" placeholder="My theme" spellCheck={false} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="button" className="insp-button" disabled={saving.waiting} onClick={exportFile}><Download aria-hidden="true" />Export to file</button>
          <button type="button" className="insp-button" onClick={() => { void copyJson(); }}>
            <Clipboard aria-hidden="true" />
            {copy === 'ok' ? 'Copied' : copy === 'failed' ? 'Copy failed' : 'Copy to clipboard'}
          </button>
        </div>
        <p className="te-share-hint">One JSON with the theme’s colors, your changes to them and the interface settings.</p>
      </section>
      <section className="te-share" aria-labelledby="te-import">
        <h4 id="te-import" className="te-share-title">Import a theme</h4>
        <div className="te-share-row">
          <button type="button" className="insp-button" onClick={() => fileRef.current?.click()}><Upload aria-hidden="true" />Import from file</button>
          <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={fromFile} />
          <button type="button" className="insp-button" onClick={() => { void paste(); }}><ClipboardPaste aria-hidden="true" />Paste from clipboard</button>
        </div>
        <textarea className="te-json" aria-label="Theme JSON" placeholder="Paste theme JSON here…" spellCheck={false} value={text} onChange={(e) => { setText(e.target.value); setError(''); }} />
        {text.trim() && <button type="button" className="insp-button" data-variant="primary" onClick={() => take(text)}>Apply theme</button>}
        {/* Mounted always (aria-live): an error that mounts with its text is not read. */}
        <p className="te-error" role="alert" aria-live="assertive">{error}</p>
      </section>
    </div>
  );
}
