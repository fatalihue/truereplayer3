import { useEffect, useState, type CSSProperties, type KeyboardEvent, type MutableRefObject, type ReactNode } from 'react';
import type { ChainHead } from '../../components/lexical/clipboardModifiers';
import type { LexicalEditorHandle } from '../../components/lexical/LexicalTokenEditor';
import {
  CLIPBOARD_CHIPS, KEY_CHIPS, MORE_CLIPBOARD_CHIPS, MORE_KEY_CHIPS, MORE_ROW_CHIPS, MORE_VALUE_CHIPS, paletteToken, RUN_STATE_CHIPS, VALUE_CHIPS,
  type PaletteChip,
} from '../../components/lexical/tokenCatalog';
import { tokenTip } from '../../components/lexical/tokenDescriptions';
import { normalizeToken } from '../../components/lexical/tokenNormalize';
import { t } from '../../i18n';
import { preload, useLoaded } from '../lazyModule';
import { anchorBelow, type MenuAnchor } from '../menuAnchor';
import { Popover } from '../Popover';
import { useApp } from '../store';
import { emojiCategories, loadEmojiPicker } from './emoji';
import { appIsLight } from './inspectorState';
import { SnippetsTab } from './textSnippets';

type Tab = 'tokens' | 'snippets' | 'emoji';
const TABS: { id: Tab; label: string }[] = [
  { id: 'tokens', label: t('sendText.insert.tabs.tokens') },
  { id: 'snippets', label: t('sendText.insert.tabs.snippets') },
  { id: 'emoji', label: t('sendText.insert.tabs.emoji') },
];
// The tab last used, for the next expansion in this session.
let lastTab: Tab = 'tokens';

type PromptKind = NonNullable<PaletteChip['prompt']>;

// The four "More…" of today, in the same key (send-text-086), and the table's own.
const MORE_KEY = 'tr-sendtext-more';
type MoreOpen = { keys: boolean; values: boolean; clipboard: boolean; rows: boolean; table: boolean };
function loadMore(): MoreOpen {
  try {
    const p = JSON.parse(localStorage.getItem(MORE_KEY) ?? 'null');
    const o = p && typeof p === 'object' && !Array.isArray(p) ? p : {};
    return { keys: o.keys === true, values: o.values === true, clipboard: o.clipboard === true, rows: o.rows === true, table: o.table === true };
  } catch {
    return { keys: false, values: false, clipboard: false, rows: false, table: false };
  }
}
function saveMore(next: MoreOpen) {
  try { localStorage.setItem(MORE_KEY, JSON.stringify(next)); } catch { /* storage off: they last the session */ }
}

// The Data Loop table's group (D11): a chip per column, and in More… a column named by hand — one
// of another table, read by a Run Macro once per row or a For Each Data Row — and the next row's.
const TABLE_PROMPTS = MORE_ROW_CHIPS.filter(c => c.prompt === 'row' || c.prompt === 'rownext');
const MORE_RUN_CHIPS = MORE_ROW_CHIPS.filter(c => !c.prompt);
// A header with { } or : cannot be a {row:…} token (D18).
const tokenName = (header: string) => header.trim() !== '' && !/[{}:]/.test(header);

/**
 * The expanded Send Text's Insert panel: Tokens, Snippets and Emoji (send-text-081 and 082). What
 * it inserts goes in where the caret is, and the caret stays in the message (a press on a chip
 * does not take the focus from it).
 */
export function InsertPanel({ api, hasText, locked, onTransform }: {
  api: MutableRefObject<LexicalEditorHandle | null>;
  hasText: boolean;
  locked: boolean;
  /** Transform… from the panel (on the clipboard) or from a name prompt (on that source). */
  onTransform: (head: ChainHead) => void;
}) {
  const [tab, setTab] = useState<Tab>(lastTab);
  const choose = (next: Tab) => { lastTab = next; setTab(next); };
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex(x => x.id === tab);
    const next = e.key === 'ArrowRight' ? (i + 1) % TABS.length : e.key === 'ArrowLeft' ? (i + TABS.length - 1) % TABS.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : -1;
    if (next < 0) return;
    e.preventDefault();
    choose(TABS[next].id);
    e.currentTarget.querySelector<HTMLElement>(`#stx-tab-${TABS[next].id}`)?.focus();
  };
  return (
    <div className="stx-insert">
      <div role="tablist" aria-label={t('sendText.insert.panel')} className="stx-tabs" onKeyDown={onTabKey}>
        {TABS.map(x => (
          <button
            key={x.id}
            type="button"
            role="tab"
            id={`stx-tab-${x.id}`}
            aria-selected={tab === x.id}
            aria-controls="stx-tabpanel"
            tabIndex={tab === x.id ? 0 : -1}
            className="stx-tab"
            onPointerEnter={x.id === 'emoji' ? () => { void preload(loadEmojiPicker); } : undefined}
            onClick={() => choose(x.id)}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="stx-tabpanel" aria-labelledby={`stx-tab-${tab}`} className="stx-tabpanel" data-tab={tab}>
        {tab === 'tokens' && <TokensTab api={api} locked={locked} onTransform={onTransform} />}
        {tab === 'snippets' && <SnippetsTab api={api} hasText={hasText} locked={locked} />}
        {tab === 'emoji' && <EmojiTab api={api} locked={locked} />}
      </div>
    </div>
  );
}

/**
 * Insert › Tokens, in the concept's order: the Data Loop table's columns, Values, Keys, Clipboard
 * and Run state, each with its rare ones behind More… (kept open or shut between sessions). A chip
 * with a name to give (Variable…, Clip slot…) asks for it first, in a prompt at the chip.
 */
function TokensTab({ api, locked, onTransform }: {
  api: MutableRefObject<LexicalEditorHandle | null>;
  locked: boolean;
  onTransform: (head: ChainHead) => void;
}) {
  const headers = useApp(a => a.dataTable.headers);
  const [more, setMore] = useState<MoreOpen>(loadMore);
  const [prompt, setPrompt] = useState<{ kind: PromptKind; anchor: MenuAnchor; button: HTMLElement; serial: number } | null>(null);
  const toggle = (k: keyof MoreOpen) => setMore(prev => {
    const next = { ...prev, [k]: !prev[k] };
    saveMore(next);
    return next;
  });
  const pick = (chip: PaletteChip, button: HTMLElement) => {
    // The chip of the prompt that is open closes it again.
    if (prompt?.button === button) { setPrompt(null); return; }
    if (chip.prompt) setPrompt({ kind: chip.prompt, anchor: anchorBelow(button, 'start'), button, serial: (prompt?.serial ?? 0) + 1 });
    else if (chip.insert) api.current?.insertText(chip.insert);
  };
  const chip = (c: PaletteChip) => (
    <Chip key={c.label} label={c.label} named={!!c.insert} disabled={locked} tip={tokenTip(paletteToken(c), { palette: true, withRaw: false, skipKeys: true })} onPress={(b) => pick(c, b)} />
  );
  const columns = [...new Set(headers)];

  return (
    <div className="stx-tokens">
      <Group label={t('tokens.groups.dataTable')}>
        {columns.length === 0 && <span className="stx-group-none">{t('sendText.insert.noTable')}</span>}
        {columns.map(h => (
          <Chip
            key={h}
            label={h}
            tone="data"
            disabled={locked || !tokenName(h)}
            tip={tokenName(h)
              ? tokenTip(`{row:${h}}`, { palette: true, withRaw: false })
              : t('sendText.insert.badColumn')}
            onPress={() => api.current?.insertToken(`{row:${h}}`)}
          />
        ))}
        {columns.length === 0 ? TABLE_PROMPTS.map(chip) : <More open={more.table} onToggle={() => toggle('table')}>{TABLE_PROMPTS.map(chip)}</More>}
      </Group>
      <Group label={t('tokens.groups.values')}>
        {VALUE_CHIPS.map(chip)}
        <More open={more.values} onToggle={() => toggle('values')}>{MORE_VALUE_CHIPS.map(chip)}</More>
      </Group>
      <Group label={t('tokens.groups.keys')}>
        {KEY_CHIPS.map(chip)}
        <More open={more.keys} onToggle={() => toggle('keys')}>{MORE_KEY_CHIPS.map(chip)}</More>
      </Group>
      <Group label={t('tokens.groups.clipboard')}>
        {/* Named after its token, like the chip it becomes: the same in every language. */}
        {chip({ label: 'Clipboard', insert: '{clipboard}' })}
        {CLIPBOARD_CHIPS.map(chip)}
        <Chip
          label={t('sendText.actions.transform')}
          icon="wand-sparkles"
          disabled={locked}
          tip={t('sendText.insert.transformTip')}
          onPress={() => onTransform({ kind: 'clipboard' })}
        />
        <More open={more.clipboard} onToggle={() => toggle('clipboard')}>{MORE_CLIPBOARD_CHIPS.map(chip)}</More>
      </Group>
      <Group label={t('tokens.groups.runState')}>
        {RUN_STATE_CHIPS.map(chip)}
        <More open={more.rows} onToggle={() => toggle('rows')}>{MORE_RUN_CHIPS.map(chip)}</More>
      </Group>
      <span className="insp-hint">{t('sendText.insert.hint')}</span>
      {prompt && (
        <NamePrompt
          key={prompt.serial}
          kind={prompt.kind}
          anchor={prompt.anchor}
          toggle={prompt.button}
          onInsert={(token) => api.current?.insertToken(token)}
          onTransform={(head) => { setPrompt(null); onTransform(head); }}
          // The message takes the keyboard back with its caret where it was (the editor's own
          // focus, not the element's, which would put it at the start).
          onClose={() => { setPrompt(null); api.current?.focus(); }}
        />
      )}
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="stx-group" role="group" aria-label={label}>
      <span className="insp-label">{label}</span>
      <div className="stx-chips">{children}</div>
    </div>
  );
}

/**
 * A chip of the palette. The press keeps the focus where it was, so the caret stays put. A chip
 * `named` after its token (Date, Enter, Counter…) shows the label the token's chip has in the
 * editor, the same in every language (the glossary's tokens): data-glossary says so to the
 * language checks.
 */
function Chip({ label, named, tip, disabled, tone, icon, onPress }: {
  label: string;
  named?: boolean;
  tip?: string;
  disabled?: boolean;
  tone?: 'data';
  icon?: string;
  onPress: (button: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      className="stx-chip"
      data-glossary={named ? '' : undefined}
      data-tone={tone}
      data-tip={tip || undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onPress(e.currentTarget)}
    >
      {icon && <span className="step-icon" data-icon={icon} />}
      {label}
    </button>
  );
}

/** A group's rare chips, behind More… (Less closes them again). */
function More({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <>
      {open && children}
      <button type="button" className="stx-chip" data-more="" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={onToggle}>
        {open ? t('sendText.insert.less') : t('sendText.insert.more')}
      </button>
    </>
  );
}

const PROMPT_FIELD: Record<PromptKind, string> = {
  var: t('sendText.prompt.field.var'),
  row: t('sendText.prompt.field.row'),
  rownext: t('sendText.prompt.field.row'),
  clip: t('sendText.prompt.field.clip'),
  input: t('sendText.prompt.field.input'),
  env: t('sendText.prompt.field.env'),
};
// A slot's "1" and an environment variable's "USERNAME" are values, the same in every language.
const PROMPT_PLACEHOLDER: Record<PromptKind, string> = {
  var: t('sendText.prompt.example.var'),
  row: t('sendText.prompt.example.row'),
  rownext: t('sendText.prompt.example.row'),
  clip: '1',
  input: t('sendText.prompt.example.input'),
  env: 'USERNAME',
};
const PROMPT_HINT: Partial<Record<PromptKind, string>> = {
  input: t('sendText.prompt.hints.input'),
  clip: t('sendText.prompt.hints.clip'),
  env: t('sendText.prompt.hints.env'),
};
// What a name may hold, by the engine's rule for each token (send-text-102): a variable's and a
// slot's letters, digits and _; an environment variable's, those and parentheses; a column's,
// anything but { } and :; a prompt's label, anything but { } and |.
const PROMPT_STRIP: Record<PromptKind, RegExp> = {
  var: /[^A-Za-z0-9_]/g, clip: /[^A-Za-z0-9_]/g, env: /[^A-Za-z0-9_()]/g, row: /[{}:]/g, rownext: /[{}:]/g, input: /[{}|]/g,
};

/**
 * The name a chip needs before it is a token (Variable…, Row column…, Clip slot…, Ask input…,
 * Env…), at the chip (send-text-101 to 105): the token as it will land grows as the name is typed;
 * Enter or Insert puts it at the caret, and Transform… builds a chain on it instead (not for a
 * prompt's label, which has no chain). Esc or a press outside closes it.
 */
function NamePrompt({ kind, anchor, toggle, onInsert, onTransform, onClose }: {
  kind: PromptKind;
  anchor: MenuAnchor;
  toggle: HTMLElement;
  onInsert: (token: string) => void;
  onTransform: (head: ChainHead) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const n = name.trim();
  const shown = normalizeToken(`{${kind}:${name || 'x'}}`);
  const token = name ? shown : shown.replace(/x\}$/, '…}');
  const insert = () => {
    if (!n) return;
    onInsert(`{${kind}:${n}}`);
    onClose();
  };
  const transform = () => {
    if (!n || kind === 'input') return;
    onTransform(kind === 'row' || kind === 'rownext' ? { kind, column: n } : { kind, name: n });
  };
  return (
    <Popover anchor={anchor} label={PROMPT_FIELD[kind]} toggle={toggle} focusFirst restoreFocus={false} onClose={onClose}>
      <div className="stx-prompt">
        <span className="stx-prompt-token">{token}</span>
        <span className="stx-prompt-what">{tokenTip(`{${kind}:x}`, { withRaw: false })}</span>
        <input
          className="stx-input"
          type="text"
          aria-label={PROMPT_FIELD[kind]}
          placeholder={PROMPT_PLACEHOLDER[kind]}
          data-mono={kind !== 'input' || undefined}
          spellCheck={false}
          value={name}
          onChange={(e) => setName(e.target.value.replace(PROMPT_STRIP[kind], ''))}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            // Ctrl+Enter inserts too, as today's prompt did: going on to the Inspector's Ctrl+Enter
            // (D12) would drop the name typed. With nothing typed, it goes on.
            if (e.ctrlKey && !n) return;
            e.preventDefault();
            e.stopPropagation();
            insert();
          }}
        />
        {PROMPT_HINT[kind] && <span className="insp-hint">{PROMPT_HINT[kind]}</span>}
        <div className="stx-prompt-actions">
          {kind !== 'input' && (
            <button type="button" className="insp-button" disabled={!n} data-tip={t('sendText.prompt.transformTip')} onClick={transform}>
              <span className="step-icon" data-icon="wand-sparkles" />
              {t('sendText.actions.transform')}
            </button>
          )}
          <button type="button" className="insp-primary" disabled={!n} onClick={insert}>{t('sendText.actions.insert')}</button>
        </div>
        {/* In the corner, but last in the order: the field is what takes the keyboard first. */}
        <button type="button" className="insp-close stx-prompt-close" aria-label={t('common.actions.close')} data-tip={t('sendText.prompt.closeTip')} onClick={onClose}>
          <span className="step-icon" data-icon="x" />
        </button>
      </div>
    </Popover>
  );
}

/** Insert › Emoji: the macro icon's picker (its chunk), filling the panel. A press puts the emoji at
 *  the caret and leaves the picker where it was. */
function EmojiTab({ api, locked }: { api: MutableRefObject<LexicalEditorHandle | null>; locked: boolean }) {
  const loaded = useLoaded(loadEmojiPicker);
  useEffect(() => {
    if (!loaded) void preload(loadEmojiPicker);
  }, [loaded]);
  if (!loaded) return <div className="stx-emoji" />;
  const picker = loaded.module;
  const Picker = picker.default;
  return (
    <div className="stx-emoji" inert={locked || undefined}>
      <Picker
        onEmojiClick={(data) => api.current?.insertText(data.emoji)}
        theme={appIsLight() ? picker.Theme.LIGHT : picker.Theme.DARK}
        emojiStyle={picker.EmojiStyle.NATIVE}
        width="100%"
        height="100%"
        previewConfig={{ showPreview: false }}
        searchPlaceholder={t('sendText.insert.searchEmoji')}
        searchClearButtonLabel={t('common.actions.clear')}
        categories={emojiCategories(picker.Categories)}
        emojiData={loaded.emojiData}
        skinTonesDisabled
        lazyLoadEmojis
        style={{
          '--epr-bg-color': 'var(--color-bg-surface)',
          '--epr-category-label-bg-color': 'var(--color-bg-surface)',
          '--epr-hover-bg-color': 'var(--color-bg-elevated)',
          '--epr-search-input-bg-color': 'var(--color-bg-input)',
          '--epr-search-border-color': 'var(--color-border-default)',
          '--epr-text-color': 'var(--color-text-primary)',
          '--epr-category-icon-active-color': 'var(--color-accent-solid)',
          '--epr-highlight-color': 'var(--color-accent-solid)',
          // A little tighter than its defaults (10 and 30 px), so the search and the nine
          // categories fit the column.
          '--epr-horizontal-padding': '8px',
          '--epr-category-navigation-button-size': '26px',
        } as CSSProperties}
      />
    </div>
  );
}
