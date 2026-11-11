import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ArrowRightLeft, Download, Ellipsis, Gamepad2, Globe, Info, Keyboard, ListChecks, Lock, Plus, X } from 'lucide-react';
import { useBridge } from '../../../bridge/BridgeContext';
import { t } from '../../../i18n';
import { useRemaps } from '../../../logic/useRemaps';
import { useToast } from '../../../state/ToastContext';
import { DraftField, Keys, Segmented, Switch } from '../../inspector/fields';
import { MacroPicker } from '../../inspector/MacroPicker';
import { keycaps } from '../../library/model';
import { Menu } from '../../Menu';
import { anchorBelow, type MenuAnchor } from '../../menuAnchor';
import {
  EVERYWHERE, FNS, fnInfo, KEYS, legendOf, MODES, trKeyName, type FnKind, type Game, type KeyCap, type KeyFn,
} from '../../mk/mkModel';
import {
  fnAt, gameOf, globalsOf, layerKeyOf, listedGames, openGame, pickKey, remapsWith, setGameFn, setGameOn, useMk, type Source,
} from '../../mk/mkStore';
import { useApp } from '../../store';
import { openPage } from '../../ui';
import { MOUSE_TARGETS, mouseTarget } from '../remaps/remapModel';
import '../../inspector/editors.css';
import '../../inspector/windowEditors.css';
import '../remaps/remaps.css';
import './teclado.css';

/**
 * PROTÓTIPO MK — ② Teclado: o TrueReplayerMK como um modo do TR3 (ver shell/mk/mkModel.ts). Os jogos
 * à esquerda, no lugar e na forma da biblioteca; o teclado no meio, com a função de cada tecla na cor
 * do passo do TR3 que faz o mesmo; a tecla à direita, nas classes de "Remap settings". A macro de uma
 * tecla é uma macro da biblioteca do TR3, aberta no editor dele. Dados falsos, nada é gravado.
 */
export default function TecladoPage() {
  const key = useMk(s => s.key);
  // Esc fecha a tecla, como o painel dos Key Remaps.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape' || !useMk.getState().key) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      pickKey(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <section className="shell-page tk" aria-label="Teclado">
      <Games />
      <div className="tk-main">
        <Head />
        <Bar />
        <div className="tk-scroll">
          <Board />
          <Legend />
          <Notes />
        </div>
      </div>
      {key ? <KeyPanel code={key} /> : <EmptyPanel />}
    </section>
  );
}

// ── O que as telas leem ──

/** Os Key Remaps que valem por baixo do jogo aberto (variante A) ou em qualquer lugar (B). */
function useGlobals(): Record<string, KeyFn> {
  const remaps = useApp(a => a.settings.remaps);
  const variant = useMk(s => s.variant);
  const game = useMk(gameOf);
  return globalsOf(remaps, variant === 'beside' && game ? game.exes : null);
}

const globalName = (variant: 'beside' | 'merged') => (variant === 'beside' ? t('common.pages.remaps') : 'Em qualquer lugar');

// Na face da tecla, o botão em uma palavra; o nome inteiro (o dos Key Remaps) fica no painel e na dica.
const MOUSE_SHORT: Record<string, string> = {
  LeftClick: 'Esquerdo', RightClick: 'Direito', MiddleClick: 'Meio', XButton1: 'Lateral 1', XButton2: 'Lateral 2', ScrollUp: 'Roda ↑', ScrollDown: 'Roda ↓',
};

/** O que a tecla mostra embaixo do nome dela. */
function labelOf(fn: KeyFn, full = false): string {
  switch (fn.kind) {
    case 'key': return fn.combo ? keycaps(fn.combo) : '…';
    case 'mouse': return (full ? mouseTarget(fn.mouse ?? '')?.label : MOUSE_SHORT[fn.mouse ?? '']) ?? '…';
    case 'macro': return fn.macro ?? 'Escolher…';
    case 'text': return fn.text || '…';
    case 'off': return 'Desligada';
    case 'layer': return 'Camada';
    default: return '';
  }
}
/** A função em uma frase, para o nome acessível e a dica. */
function sentenceOf(fn: KeyFn): string {
  const mode = MODES.find(m => m.value === fn.mode)?.label.toLowerCase();
  switch (fn.kind) {
    case 'key': return `Outra tecla: ${labelOf(fn)}`;
    case 'mouse': return `Mouse: ${labelOf(fn, true)}`;
    case 'macro': return `Macro ${labelOf(fn)}${mode ? ` (${mode})` : ''}`;
    case 'text': return `Texto: ${fn.text ?? ''}`;
    case 'off': return 'Desligada';
    case 'layer': return 'Camada (segure)';
    default: return 'Padrão';
  }
}

// ── Os jogos (como a biblioteca) ──

function Games() {
  const variant = useMk(s => s.variant);
  // O seletor devolve o array do estado; a lista filtrada sai no render (um array novo por leitura
  // faria o useSyncExternalStore renderizar sem fim).
  const all = useMk(s => s.games);
  const games = listedGames({ games: all, variant });
  const open = useMk(s => s.open);
  const front = useMk(s => s.front);
  const remaps = useApp(a => a.settings.remaps);
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  const { showToast } = useToast();
  const merged = variant === 'merged';
  const everywhereCount = remaps.entries.filter(e => !e.process).length;
  const row = (g: Game) => (
    <button key={g.id} type="button" className="tk-game" aria-current={open === g.id || undefined} data-off={!g.on || undefined}
      onClick={() => openGame(g.id)}>
      <span className="tk-avatar" aria-hidden="true">{g.name[0]}</span>
      <span className="tk-game-text">
        <span className="tk-game-name">{g.name}</span>
        <span className="tk-game-exe">{g.exes.join(' · ')}</span>
      </span>
      {front === g.id && <span className="tk-front-dot" role="img" aria-label="Na frente agora" data-tip="Na frente agora" data-tip-pos="end" />}
    </button>
  );
  return (
    <aside className="tk-games" aria-label={merged ? 'Teclados' : 'Jogos'}>
      <div className="lib-header">
        <span className="lib-title">{merged ? 'Teclados' : 'Jogos'}</span>
        <button type="button" className="lib-new" aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
          <Plus aria-hidden="true" />
          <span>Adicionar</span>
        </button>
      </div>
      {menu && (
        <Menu anchor={menu.anchor} label="Adicionar jogo" toggle={menu.button} onClose={() => setMenu(null)}
          entries={[
            { label: 'Escolher entre os programas abertos…', onSelect: () => showToast('Protótipo: listaria os programas abertos, com o ícone do .exe.', { type: 'info' }) },
            { label: 'Procurar o .exe…', onSelect: () => showToast('Protótipo: abriria o diálogo do Windows para escolher o .exe.', { type: 'info' }) },
          ]} />
      )}
      <div className="tk-games-list">
        {merged && (
          <>
            <span className="lib-heading">Sempre</span>
            <button type="button" className="tk-game" aria-current={open === EVERYWHERE || undefined} data-off={!remaps.enabled || undefined}
              onClick={() => openGame(EVERYWHERE)}>
              <span className="tk-avatar" aria-hidden="true"><Globe /></span>
              <span className="tk-game-text">
                <span className="tk-game-name">Em qualquer lugar</span>
                <span className="tk-game-exe">{everywhereCount === 1 ? '1 tecla' : `${everywhereCount} teclas`} · todos os apps</span>
              </span>
            </button>
          </>
        )}
        <span className="lib-heading" data-after={merged || undefined}>Jogos</span>
        {games.filter(g => !g.app).map(row)}
        {merged && games.some(g => g.app) && (
          <>
            <span className="lib-heading" data-after>Outros apps</span>
            {games.filter(g => g.app).map(row)}
          </>
        )}
      </div>
      <p className="tk-games-foot">
        {merged
          ? 'Um jogo ou app na frente manda nas teclas dele; o resto segue "Em qualquer lugar".'
          : 'Liga sozinho com o .exe na frente. Fora dos jogos nada muda: valem as macros e os Key Remaps.'}
      </p>
    </aside>
  );
}

// ── A cabeça ──

function Head() {
  const game = useMk(gameOf);
  const open = useMk(s => s.open);
  const front = useMk(s => s.front);
  const holding = useMk(s => s.holding);
  const remaps = useApp(a => a.settings.remaps);
  const { setEnabled } = useRemaps();
  const { showToast } = useToast();
  const [menu, setMenu] = useState<{ anchor: MenuAnchor; button: HTMLButtonElement } | null>(null);
  if (open === EVERYWHERE) {
    return (
      <header className="tk-head">
        <div className="tk-titles">
          <h1 className="tk-title">Em qualquer lugar</h1>
          <p className="tk-sub">Vale em todos os apps, como os Key Remaps de hoje. Um jogo na frente manda nas teclas dele.</p>
        </div>
        <div className="tk-head-end">
          <span className="tk-use">Usar<Switch label="Usar em qualquer lugar" checked={remaps.enabled} onChange={setEnabled} /></span>
        </div>
      </header>
    );
  }
  if (!game) return <header className="tk-head" />;
  const isFront = front === game.id;
  return (
    <header className="tk-head">
      <div className="tk-titles">
        <h1 className="tk-title">
          {game.name}
          {isFront && game.on && <span className="tk-pill" data-tone={holding ? 'layer' : undefined}>{holding ? 'Na frente · Camada' : 'Na frente'}</span>}
        </h1>
        <p className="tk-sub">
          <code>{game.exes.join(' · ')}</code> · {game.app ? 'vale com o app na frente' : 'liga sozinho quando o jogo está na frente'}
        </p>
      </div>
      <div className="tk-head-end">
        <span className="tk-use">Usar<Switch label={`Usar no ${game.name}`} checked={game.on} onChange={(on) => setGameOn(game.id, on)} /></span>
        <span className="rm-sep" aria-hidden="true" />
        <button type="button" className="insp-button tk-file" data-tip="O jogo e as macros que ele usa, num arquivo só"
          onClick={() => showToast(`Protótipo: exportaria "${game.name}.trgame" com as macros dele.`, { type: 'info' })}>
          <Download aria-hidden="true" />
          {t('common.actions.export')}
        </button>
        <button type="button" className="insp-icon-button" aria-label="Mais ações do jogo" aria-haspopup="menu" aria-expanded={!!menu}
          onClick={(e) => setMenu(menu ? null : { anchor: anchorBelow(e.currentTarget, 'end'), button: e.currentTarget })}>
          <Ellipsis aria-hidden="true" />
        </button>
        {menu && (
          <Menu anchor={menu.anchor} label="Mais ações do jogo" toggle={menu.button} onClose={() => setMenu(null)}
            entries={[
              { label: 'Travar neste jogo', icon: Lock, onSelect: () => showToast('Protótipo: o jogo valeria mesmo fora da frente, até destravar (também pela bandeja).', { type: 'info' }) },
              { label: 'Adicionar outro .exe…', onSelect: () => showToast('Protótipo: para jogos com launcher ou vários .exe.', { type: 'info' }) },
              { label: t('common.actions.import'), onSelect: () => showToast('Protótipo: importaria um jogo com as macros dele.', { type: 'info' }) },
              'separator',
              { label: 'Renomear', onSelect: () => undefined },
              { label: 'Apagar', danger: true, onSelect: () => undefined },
            ]} />
        )}
      </div>
    </header>
  );
}

// ── A barra ──

function Bar() {
  const device = useMk(s => s.device);
  const view = useMk(s => s.view);
  const numpad = useMk(s => s.numpad);
  const open = useMk(s => s.open);
  const game = useMk(gameOf);
  const globals = useGlobals();
  const layerKey = layerKeyOf(game);
  const everywhere = open === EVERYWHERE;
  const count = everywhere ? Object.keys(globals).length
    : game ? (view === 'layer' ? Object.keys(game.layer).length : Object.keys(game.base).length) : 0;
  return (
    <div className="tk-bar">
      <div className="tk-seg-device">
        <Segmented<'keyboard' | 'mouse'> label="Dispositivo" value={device}
          options={[{ value: 'keyboard', label: 'Teclado' }, { value: 'mouse', label: 'Mouse' }]}
          onChange={(d) => useMk.setState({ device: d, key: null })} />
      </div>
      <div className="tk-seg-layer">
        <Segmented<'base' | 'layer'> label="Camada" value={everywhere ? 'base' : view}
          options={[
            { value: 'base', label: 'Base' },
            {
              value: 'layer',
              label: layerKey ? `Camada · segure ${legendOf(layerKey)}` : 'Camada',
              disabled: everywhere || !layerKey,
              tip: everywhere ? 'Em qualquer lugar não tem camada' : !layerKey ? 'Dê a função Camada a uma tecla para ter a Camada' : undefined,
            },
          ]}
          onChange={(v) => useMk.setState({ view: v })} />
      </div>
      <span className="rm-spacer" />
      <span className="tk-count">
        {count === 1 ? '1 tecla mudada' : `${count} teclas mudadas`}{view === 'layer' && !everywhere ? ' na Camada' : ''}
      </span>
      <button type="button" className="rm-chip" aria-pressed={numpad} onClick={() => useMk.setState({ numpad: !numpad })}>Numérico</button>
      <span className="tk-layout" data-tip="O desenho segue o layout do Windows (ABNT2, ANSI ou ISO). O jogo guarda a posição física da tecla.">ABNT2</span>
    </div>
  );
}

// ── O desenho ──

function Board() {
  const device = useMk(s => s.device);
  const numpad = useMk(s => s.numpad);
  const caps = numpad ? KEYS : KEYS.filter(k => k.block !== 'num');
  const gridRef = useRef<HTMLDivElement>(null);
  if (device === 'mouse') return <MouseBoard />;
  // As setas andam pelo desenho (o plano do MK: "setas andam pelo desenho do teclado").
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const dirs: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const d = dirs[e.key];
    const from = KEYS.find(k => k.code === (e.target as HTMLElement).dataset.code);
    if (!d || !from) return;
    e.preventDefault();
    const cx = from.col + from.w / 2;
    const cy = from.row + from.h / 2;
    let best: KeyCap | null = null;
    let bestScore = Infinity;
    for (const k of caps) {
      if (k === from) continue;
      const kx = k.col + k.w / 2;
      const ky = k.row + k.h / 2;
      const along = d[0] ? (kx - cx) * d[0] : (ky - cy) * d[1];
      if (along <= 0.01) continue;
      const across = d[0] ? Math.abs(ky - cy) * 8 : Math.abs(kx - cx);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = k; }
    }
    if (best) {
      pickKey(best.code);
      gridRef.current?.querySelector<HTMLElement>(`[data-code="${best.code}"]`)?.focus();
    }
  };
  return (
    <div className="tk-board">
      <div ref={gridRef} className="tk-grid" data-numpad={numpad || undefined} role="group" aria-label="Teclado ABNT2" onKeyDown={onKeyDown}>
        {caps.map(k => <Key key={k.code} cap={k} />)}
      </div>
    </div>
  );
}

function Key({ cap }: { cap: KeyCap }) {
  const state = useMk();
  const globals = useGlobals();
  const { fn, source } = fnAt(state, cap.code, globals);
  const selected = state.key === cap.code;
  const game = gameOf(state);
  const layerKey = layerKeyOf(game);
  const held = state.view === 'layer' && cap.code === layerKey;
  const info = fnInfo(fn.kind);
  const Icon = source === 'own' ? info.Icon : null;
  const label = held ? 'Segurada' : labelOf(fn);
  const words = fn.kind === 'default' ? cap.legend
    : `${cap.legend}: ${sentenceOf(fn)}${source === 'base' ? ' (da Base)' : source === 'global' ? ` (de ${globalName(state.variant)})` : ''}`;
  const clear = () => {
    if (state.open === EVERYWHERE) return;
    setGameFn(cap.code, { kind: 'default' });
  };
  return (
    <div className="tk-slot" data-iso={cap.isoEnter || undefined}
      style={{ gridColumn: `${cap.col} / span ${cap.w}`, gridRow: `${cap.row} / span ${cap.h}` }}>
      <button
        type="button"
        className="tk-key"
        data-code={cap.code}
        data-fn={fn.kind !== 'default' && source === 'own' ? fn.kind : undefined}
        data-source={source !== 'own' ? source : undefined}
        data-held={held || undefined}
        aria-pressed={selected}
        aria-label={words}
        data-tip={fn.kind !== 'default' ? words : undefined}
        tabIndex={selected || (!state.key && cap.code === 'Escape') ? 0 : -1}
        onClick={() => pickKey(selected ? null : cap.code)}
      >
        <span className="tk-leg">{cap.legend}</span>
        {Icon && <Icon className="tk-ico" aria-hidden="true" />}
        {source === 'base' && <span className="tk-inh" aria-hidden="true">↧</span>}
        {source === 'global' && <span className="tk-inh" aria-hidden="true">{state.variant === 'beside' ? <ArrowRightLeft /> : <Globe />}</span>}
        {label && <span className="tk-fn" data-one={!label.includes(' ') || undefined}>{label}</span>}
      </button>
      {source === 'own' && fn.kind !== 'default' && state.open !== EVERYWHERE && (
        <button type="button" className="tk-x" aria-label={`Limpar ${cap.legend}`} data-tip="Limpar" tabIndex={-1} onClick={clear}>
          <X aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** O mouse: o botão do meio, os laterais e a roda aceitam função; o esquerdo e o direito ficam de fora. */
const MOUSE_KEYS: KeyCap[] = [
  { code: 'MouseMiddle', legend: 'Meio', col: 1, row: 1, w: 4, h: 1, block: 'main' },
  { code: 'MouseX1', legend: 'Lateral 1', col: 1, row: 1, w: 4, h: 1, block: 'main' },
  { code: 'MouseX2', legend: 'Lateral 2', col: 1, row: 1, w: 4, h: 1, block: 'main' },
  { code: 'WheelUp', legend: 'Roda ↑', col: 1, row: 1, w: 4, h: 1, block: 'main' },
  { code: 'WheelDown', legend: 'Roda ↓', col: 1, row: 1, w: 4, h: 1, block: 'main' },
];
function MouseBoard() {
  const state = useMk();
  const globals = useGlobals();
  return (
    <div className="tk-mouse" role="group" aria-label="Mouse">
      {[{ code: 'MouseLeft', legend: 'Esquerdo' }, { code: 'MouseRight', legend: 'Direito' }].map(b => (
        <div key={b.code} className="tk-slot">
          <button type="button" className="tk-key" disabled data-tip="Fica de fora, para você nunca perder o clique">
            <span className="tk-leg">{b.legend}</span>
            <span className="tk-fn">Sempre normal</span>
          </button>
        </div>
      ))}
      {MOUSE_KEYS.map(k => {
        const { fn, source } = fnAt(state, k.code, globals);
        const info = fnInfo(fn.kind);
        const selected = state.key === k.code;
        return (
          <div key={k.code} className="tk-slot">
            <button type="button" className="tk-key" aria-pressed={selected} data-fn={fn.kind !== 'default' && source === 'own' ? fn.kind : undefined}
              onClick={() => pickKey(selected ? null : k.code)}>
              <span className="tk-leg">{k.legend}</span>
              {info.Icon && <info.Icon className="tk-ico" aria-hidden="true" />}
              <span className="tk-fn">{labelOf(fn)}</span>
            </button>
          </div>
        );
      })}
      <p className="tk-mouse-note">O esquerdo e o direito ficam de fora, para você nunca perder o clique. A roda só aceita funções de toque.</p>
    </div>
  );
}

// ── A legenda e as notas ──

function Legend() {
  const view = useMk(s => s.view);
  const variant = useMk(s => s.variant);
  const open = useMk(s => s.open);
  return (
    <div className="tk-legend" aria-label="Legenda">
      {FNS.filter(f => f.kind !== 'default').map(f => (
        <span key={f.kind} className="tk-legend-item" data-fn={f.kind}>
          <span className="tk-swatch" data-fn={f.kind} aria-hidden="true" />
          {f.Icon && <f.Icon aria-hidden="true" />}
          {f.label === 'Desligar' ? 'Desligada' : f.label}
        </span>
      ))}
      {view === 'layer' && open !== EVERYWHERE && (
        <span className="tk-legend-item" data-inh>
          <span className="tk-swatch" data-inh aria-hidden="true" />↧ Herdada da Base
        </span>
      )}
      {open !== EVERYWHERE && (
        <span className="tk-legend-item" data-inh>
          <span className="tk-swatch" data-inh aria-hidden="true" />
          {variant === 'beside' ? <ArrowRightLeft aria-hidden="true" /> : <Globe aria-hidden="true" />}
          {variant === 'beside' ? 'Vem dos Key Remaps' : 'Vem de Em qualquer lugar'}
        </span>
      )}
    </div>
  );
}

function Notes() {
  const variant = useMk(s => s.variant);
  const open = useMk(s => s.open);
  const app = useMk(s => !!gameOf(s)?.app);
  if (open === EVERYWHERE) {
    return (
      <div className="tk-notes">
        <p className="tk-note"><Info aria-hidden="true" /><span>São as mesmas regras que a página <b>Key Remaps</b> guardava (<code>remaps.json</code>): aqui elas só ganharam o desenho. Macro, Texto e Camada ficam para os jogos; fora deles, a macro dispara pela hotkey dela.</span></p>
      </div>
    );
  }
  return (
    <div className="tk-notes">
      <p className="tk-note"><Gamepad2 aria-hidden="true" /><span>Com o {app ? 'app' : 'jogo'} na frente, a tecla faz o que está aqui; a macro começa no apertar. Fora dele, ela volta ao normal sozinha, e o que estava segurado é solto.</span></p>
      {variant === 'beside'
        ? <p className="tk-note"><ArrowRightLeft aria-hidden="true" /><span>Os <b>Key Remaps</b> continuam na página deles. Uma tecla sem função aqui segue o remap (a marca ⇄); uma tecla com função aqui ganha do remap enquanto o jogo está na frente.</span></p>
        : <p className="tk-note"><Globe aria-hidden="true" /><span>Não há mais a página Key Remaps: as regras dela viraram <b>Em qualquer lugar</b>, e as "só no app" viraram entradas da lista, como o Excel.</span></p>}
    </div>
  );
}

// ── A tecla ──

function EmptyPanel() {
  return (
    <aside className="tk-panel" data-empty aria-label="Tecla">
      <div className="tk-empty">
        <span className="rm-empty-icon" aria-hidden="true"><Keyboard /></span>
        <span className="tk-empty-title">Escolha uma tecla</span>
        <span className="tk-empty-text">Clique numa tecla do desenho para dar uma função a ela. As setas andam pelo teclado.</span>
      </div>
    </aside>
  );
}

function KeyPanel({ code }: { code: string }) {
  const state = useMk();
  const globals = useGlobals();
  const remaps = useApp(a => a.settings.remaps);
  const { save } = useRemaps();
  const game = gameOf(state);
  const everywhere = state.open === EVERYWHERE;
  const layer = state.view === 'layer' && !everywhere;
  const { fn, source } = fnAt(state, code, globals);
  const legend = legendOf(code) !== code ? legendOf(code) : MOUSE_KEYS.find(k => k.code === code)?.legend ?? code;
  const where = everywhere ? 'Em qualquer lugar' : `${game?.name ?? ''} · ${layer ? `Camada (segure ${legendOf(layerKeyOf(game) ?? '')})` : 'Base'}`;
  // A função escolhida na lista: a própria, ou Padrão quando a tecla só herda.
  const kind: FnKind = source === 'own' ? fn.kind : 'default';
  const set = (next: KeyFn) => {
    if (everywhere) save(remapsWith(remaps.entries, code, next));
    else setGameFn(code, next);
  };
  const choose = (k: FnKind) => {
    if (k === kind) return;
    if (k === 'macro') set({ kind: 'macro', mode: 'once', interval: 100, keepOriginal: false });
    else if (k === 'text') set({ kind: 'text', text: '', enter: true });
    else if (k === 'mouse') set({ kind: 'mouse', mouse: 'XButton1' });
    else if (k === 'key') set({ kind: 'key', combo: '' });
    else set({ kind: k });
  };
  const patch = (p: Partial<KeyFn>) => set({ ...fn, ...p });
  const isLayerKey = !layer && !everywhere && fn.kind === 'layer';
  const disabledOf = (k: FnKind): string | null => {
    if (everywhere && (k === 'macro' || k === 'text' || k === 'layer')) return 'Fora dos jogos, a macro dispara pela hotkey dela';
    if (layer && k === 'layer') return 'A tecla de camada fica na Base';
    if (layer && code === layerKeyOf(game)) return 'Esta é a tecla que segura a Camada';
    if (code.startsWith('Wheel') && k === 'layer') return 'A roda só aceita funções de toque';
    return null;
  };
  const global = !everywhere ? globals[code] : undefined;
  return (
    <aside className="tk-panel" aria-label={`Tecla ${legend}`}>
      <div className="rm-panel-head">
        <span className="rm-panel-icon" aria-hidden="true">{legend.length <= 3 ? legend : <Keyboard />}</span>
        <div className="rm-panel-titles">
          <span className="rm-panel-title">Tecla {legend}</span>
          <span className="rm-panel-sub">{where}</span>
        </div>
        <button type="button" className="insp-icon-button" aria-label="Fechar a tecla" onClick={() => pickKey(null)}>
          <X aria-hidden="true" />
        </button>
      </div>
      <div className="rm-panel-body">
        <section className="rm-sec" aria-label="Função">
          <span className="rm-label">Função</span>
          <div className="tk-fns" role="radiogroup" aria-label="Função">
            {FNS.map(f => {
              const off = disabledOf(f.kind);
              const name = f.kind === 'default' && layer ? 'Igual à Base' : f.kind === 'default' && global ? `Segue ${globalName(state.variant)}` : f.label;
              const aside = f.kind === 'default' && layer && source === 'base' ? sentenceOf(fn)
                : f.kind === 'default' && source === 'global' ? sentenceOf(fn) : null;
              return (
                <button key={f.kind} type="button" role="radio" className="rm-radio" data-fn={f.kind} aria-checked={kind === f.kind}
                  disabled={!!off} data-tip={off ?? undefined} data-tip-pos="start" onClick={() => choose(f.kind)}>
                  {f.Icon ? <f.Icon aria-hidden="true" /> : <span className="tk-fn-none" aria-hidden="true" />}
                  {name}
                  {aside && <span className="tk-fn-aside">{aside}</span>}
                </button>
              );
            })}
          </div>
        </section>
        <Options code={code} legend={legend} fn={fn} kind={kind} source={source} patch={patch} isLayerKey={isLayerKey} />
        {global && source === 'own' && fn.kind !== 'default' && (
          <p className="rm-msg" data-tone="warn">
            {state.variant === 'beside'
              ? `Os Key Remaps também mudam ${legend} (${sentenceOf(global)}). Com o ${game?.name} na frente, vale a função daqui.`
              : `Em qualquer lugar, ${legend} é: ${sentenceOf(global)}. Com o ${game?.name} na frente, vale a função daqui.`}
          </p>
        )}
      </div>
      <div className="rm-panel-foot">
        {everywhere ? 'Salva sozinho. Vale em todos os apps, sem jogo na frente.' : `Salva sozinho. Vale com o ${game?.name} na frente.`}
      </div>
    </aside>
  );
}

function Options({ code, legend, fn, kind, source, patch, isLayerKey }: {
  code: string; legend: string; fn: KeyFn; kind: FnKind; source: Source; patch: (p: Partial<KeyFn>) => void; isLayerKey: boolean;
}) {
  const state = useMk();
  const game = gameOf(state);
  const variant = state.variant;
  switch (kind) {
    case 'default': {
      const typed = /^Key[A-Z]$/.test(code) ? `${legend} digita ${legend.toLowerCase()}` : `${legend} faz o de sempre`;
      return (
        <p className="rm-hint">
          {source === 'base' ? `Na Camada, ${legend} herda da Base: ${sentenceOf(fn)}. Escolha outra função para mudar só na Camada.`
            : source === 'global' ? `Sem função aqui, ${legend} segue ${globalName(variant)}: ${sentenceOf(fn)}.`
            : `A tecla segue normal: ${typed}.`}
        </p>
      );
    }
    case 'key':
      return (
        <section className="rm-sec" aria-label="Outra tecla">
          <span className="rm-label">Tecla que sai</span>
          <ComboCapture value={fn.combo ?? ''} onCapture={(combo) => patch({ combo })} />
          <p className="rm-hint">Ctrl, Shift, Alt e Win entram na combinação. Apertar, repetir e soltar seguem a tecla de verdade.</p>
        </section>
      );
    case 'mouse':
      return (
        <section className="rm-sec" aria-label="Mouse">
          <span className="rm-label">Botão</span>
          <div className="rm-mouse" role="radiogroup" aria-label="Botão do mouse">
            {MOUSE_TARGETS.map(m => (
              <button key={m.name} type="button" role="radio" className="rm-radio" aria-checked={fn.mouse === m.name}
                onClick={() => patch({ mouse: m.name })}>
                {m.label}
              </button>
            ))}
          </div>
        </section>
      );
    case 'macro':
      return <MacroOptions key={code} legend={legend} fn={fn} patch={patch} gameName={game?.name ?? ''} />;
    case 'text':
      return (
        <section className="rm-sec" aria-label="Texto">
          <span className="rm-label">Texto</span>
          <DraftField stepId={`mk-${code}`} field="text" label="Texto que a tecla digita" kind="text" multiline empty="clear"
            placeholder="gg! boa partida" stored={fn.text ?? ''} onApply={(text) => patch({ text })} />
          <div className="insp-row">
            <Switch label="Enter no fim" checked={!!fn.enter} onChange={(enter) => patch({ enter })} />
            <span className="insp-row-label">Enter no fim</span>
          </div>
          <p className="rm-hint">Para o chat do jogo ou um comando, como <code>/e dance</code>. É o mesmo envio do passo Send Text.</p>
        </section>
      );
    case 'off':
      return (
        <p className="rm-hint">
          {state.open === EVERYWHERE
            ? `${legend} não faz nada, em nenhum app. Um jogo na frente pode dar outra função a ela.`
            : `${legend} não faz nada com o ${game?.name ?? 'jogo'} na frente. Fora dele, segue normal.`}
        </p>
      );
    case 'layer':
      return (
        <section className="rm-sec" aria-label="Camada">
          <p className="rm-hint">
            Segurar {legend} libera a Camada; soltar volta à Base. Enquanto for a tecla de camada, {legend} perde a função própria. Uma tecla sem função na Camada herda da Base.
          </p>
          {isLayerKey && (
            <button type="button" className="insp-link" onClick={() => useMk.setState({ view: 'layer', key: null })}>Ver a Camada →</button>
          )}
        </section>
      );
  }
}

/** A Macro: uma macro da biblioteca do TR3, o modo, as repetições, e o caminho para o editor dele. */
function MacroOptions({ legend, fn, patch, gameName }: { legend: string; fn: KeyFn; patch: (p: Partial<KeyFn>) => void; gameName: string }) {
  const profiles = useApp(a => a.profiles);
  const order = useApp(a => a.profileOrder);
  const { send } = useBridge();
  const { showToast } = useToast();
  const names = profiles.map(p => p.name);
  const chosen = profiles.find(p => p.name === fn.macro) ?? null;
  const folder = order.folders.find(f => f.items.includes(fn.macro ?? ''))?.name;
  const mode = fn.mode ?? 'once';
  // O seletor da biblioteca (o do passo Run Macro) abre ao trocar; com uma macro escolhida, fica o cartão dela.
  const [picking, setPicking] = useState(false);
  const openInEditor = () => {
    if (!chosen) return;
    send({ type: 'profile:open', payload: { name: chosen.name } });
    openPage('macros');
  };
  return (
    <>
      <section className="rm-sec" aria-label="Macro">
        <span className="rm-label">Macro da biblioteca</span>
        {chosen && !picking ? (
          <div className="tk-macro">
            <ListChecks className="tk-macro-icon" aria-hidden="true" />
            <span className="tk-macro-text">
              <span className="tk-macro-name">{chosen.name}</span>
              <span className="tk-where">
                {folder ? <>pasta <b>{folder}</b> · </> : ''}{chosen.actionCount} passos
                {chosen.hotkey ? <> · hotkey <kbd className="kbd">{keycaps(chosen.hotkey)}</kbd></> : ''}
              </span>
            </span>
            <button type="button" className="insp-button tk-macro-swap" onClick={() => setPicking(true)}>Trocar</button>
          </div>
        ) : (
          <MacroPicker names={names} value={fn.macro ?? null} label="Macro da biblioteca" autoFocus={picking}
            onPick={(macro) => { patch({ macro }); setPicking(false); }} />
        )}
        <div className="insp-line">
          <button type="button" className="insp-button" disabled={!chosen} onClick={openInEditor}>Abrir no editor</button>
          <button type="button" className="insp-button"
            onClick={() => showToast(`Protótipo: gravaria uma macro nova na biblioteca${gameName ? ` (pasta ${gameName})` : ''} e a ligaria ao ${legend}.`, { type: 'info' })}>
            <span className="tk-rec" aria-hidden="true" />Gravar nova
          </button>
        </div>
      </section>
      <section className="rm-sec" aria-label="Modo">
        <span className="rm-label">Modo</span>
        <Segmented label="Modo" value={mode} wrap options={MODES} onChange={(m) => patch({ mode: m })} />
        {mode === 'times' && (
          <div className="insp-row">
            <span className="insp-row-label">Vezes</span>
            <span className="insp-row-end">
              <DraftField stepId={`mk-${legend}`} field="times" label="Vezes" kind="int" min={2} max={999} unit="×" stored={String(fn.times ?? 3)} onApply={(v) => patch({ times: Number(v) })} />
            </span>
          </div>
        )}
        {mode !== 'once' && (
          <div className="insp-row">
            <span className="insp-row-label">Intervalo entre repetições</span>
            <span className="insp-row-end">
              <DraftField stepId={`mk-${legend}`} field="interval" label="Intervalo entre repetições" kind="int" min={0} max={60000} unit="ms" stored={String(fn.interval ?? 100)} onApply={(v) => patch({ interval: Number(v) })} />
            </span>
          </div>
        )}
        <p className="rm-hint">
          {mode === 'once' ? 'Roda uma vez. Apertar de novo enquanto roda não reinicia.'
            : mode === 'times' ? `Roda ${fn.times ?? 3} vezes seguidas.`
            : mode === 'hold' ? `Repete enquanto ${legend} está apertada e para ao soltar.`
            : `O primeiro toque liga, o segundo para.`}
          {' '}Começa no apertar, sem esperar soltar.
        </p>
      </section>
      <section className="rm-sec" aria-label="Tecla original">
        <div className="insp-row">
          <Switch label="Manter a tecla original" checked={!!fn.keepOriginal} onChange={(keepOriginal) => patch({ keepOriginal })} />
          <span className="insp-row-label">Manter a tecla original</span>
        </div>
        <p className="rm-hint">{fn.keepOriginal ? `O jogo recebe o ${legend} também.` : `O jogo não recebe o ${legend}: só a macro roda.`}</p>
        {chosen?.hotkey && (
          <p className="rm-msg">Fora dos jogos, {chosen.name} continua disparando pela hotkey dela, <kbd className="kbd">{keycaps(chosen.hotkey)}</kbd>.</p>
        )}
      </section>
    </>
  );
}

/**
 * A tecla que sai, capturada no próprio painel. No TR3 de verdade seria a captura do gancho
 * (KeyCapture); aqui, sem motor, as teclas que a página vê.
 */
function ComboCapture({ value, onCapture }: { value: string; onCapture: (combo: string) => void }) {
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const mods = ['Control', 'Shift', 'Alt', 'Meta'];
      if (mods.includes(e.key)) return;
      if (e.key === 'Escape') { setListening(false); return; }
      const parts = [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', e.metaKey && 'Win'].filter(Boolean) as string[];
      parts.push(trKeyName(e.code));
      onCapture(parts.join('+'));
      setListening(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [listening, onCapture]);
  return (
    <button type="button" className="insp-capture rm-capture" aria-pressed={listening} data-listening={listening || undefined}
      onClick={() => setListening(on => !on)} onBlur={() => setListening(false)}>
      {value ? <Keys combo={value} /> : <span className="insp-capture-none">{t('inspector.fields.noKey')}</span>}
      <span className="insp-capture-hint">{listening ? 'Aperte a tecla ou a combinação…' : value ? 'Clique para trocar' : 'Clique e aperte a tecla'}</span>
    </button>
  );
}
