// The text catalog as the build reads it (plan .claude/planos/idiomas-tr3-2026-11-02.md, §3).
// tools/gen-i18n.mjs checks it and writes the types and the engine's strings from it; the Vite plugin
// (tools/vite-i18n.mjs) puts its text into the page, one language per build. Both load it from here,
// so there is one reading of the catalog and one set of rules.
//
// The catalog is i18n/<language>/<area>.ts: plain data, `export default { … }`. A value is a text, a
// plural ({ zero?, one, other }) or a group of more keys. Blanks are {{name}}; {{>area.key}} is the
// text of another key in the same language; single braces are tokens ({clipboard}) and stay as text.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = path.join(RAIZ, 'i18n');
export const IDIOMAS = ['en-US', 'pt-BR'];
export const ts = createRequire(path.join(RAIZ, 'frontend', 'package.json'))('typescript');

const LACUNA = /\{\{\s*([A-Za-z_]\w*)\s*\}\}/g;
const REFERENCIA = /\{\{>\s*([\w.-]+)\s*\}\}/g;
const TOKEN = /(?<!\{)\{(?!\{)[^{}\n]*\}(?!\})/g;
const FORMAS = ['zero', 'one', 'other'];

/**
 * Evaluates a .ts data file, fresh each time: a data: URL never hits Node's module cache, so the dev
 * server sees an edited catalog without a restart. The files hold data and `import type` only.
 */
export async function lerTs(arquivo) {
  const js = ts.transpileModule(fs.readFileSync(arquivo, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}

/** The areas of one language: { area: object }. */
export async function lerIdioma(idioma) {
  const dir = path.join(DIR, idioma);
  const areas = {};
  for (const nome of fs.readdirSync(dir).filter((n) => n.endsWith('.ts')).sort()) {
    areas[nome.slice(0, -3)] = (await lerTs(path.join(dir, nome))).default;
  }
  return areas;
}

const ehPlural = (v) => v && typeof v === 'object' && 'other' in v && 'one' in v && Object.keys(v).every((k) => FORMAS.includes(k));

/**
 * The flat catalog: entradas maps each key to { tipo: 'texto', texto } or { tipo: 'plural', formas },
 * and grupos maps each group to the keys of the plain texts right under it (what tn() gives).
 * Throws on a value that is none of the three.
 */
export function achatar(areas) {
  const entradas = new Map();
  const grupos = new Map();
  const andar = (prefixo, obj) => {
    const textos = [];
    let soTextos = true;
    for (const [k, v] of Object.entries(obj)) {
      const chave = `${prefixo}.${k}`;
      if (typeof v === 'string') { entradas.set(chave, { tipo: 'texto', texto: v }); textos.push(k); }
      else if (ehPlural(v)) { entradas.set(chave, { tipo: 'plural', formas: { ...v } }); soTextos = false; }
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        if (FORMAS.some((f) => f in v)) throw new Error(`${chave}: "zero", "one" e "other" são só do plural`);
        andar(chave, v);
        soTextos = false;
      } else throw new Error(`${chave}: não é texto, plural nem grupo`);
    }
    grupos.set(prefixo, { textos, soTextos });
  };
  for (const [area, obj] of Object.entries(areas)) andar(area, obj);
  return { entradas, grupos };
}

export const lacunas = (texto) => [...texto.matchAll(LACUNA)].map((m) => m[1]);
export const referencias = (texto) => [...texto.matchAll(REFERENCIA)].map((m) => m[1]);
export const tokens = (texto) => [...texto.replace(REFERENCIA, '').replace(LACUNA, '').matchAll(TOKEN)].map((m) => m[0]);
export const formasDe = (e) => (e.tipo === 'texto' ? [e.texto] : FORMAS.filter((f) => f in e.formas).map((f) => e.formas[f]));
export const lacunasDe = (e) => [...new Set(formasDe(e).flatMap(lacunas))].sort();

/** Puts the text of each {{>key}} in place, in the same language. Throws on a missing key or a loop. */
export function resolverReferencias(entradas) {
  const resolvido = new Map();
  const resolver = (chave, cadeia) => {
    if (resolvido.has(chave)) return resolvido.get(chave);
    const e = entradas.get(chave);
    if (!e || e.tipo !== 'texto') throw new Error(`{{>${chave}}}: ${e ? 'só um texto pode ser citado' : 'a chave não existe'} (em ${cadeia.at(-1)})`);
    if (cadeia.includes(chave)) throw new Error(`{{>…}} em círculo: ${[...cadeia, chave].join(' → ')}`);
    const texto = e.texto.replace(REFERENCIA, (_, ref) => resolver(ref, [...cadeia, chave]));
    if (lacunas(texto).length) throw new Error(`{{>${chave}}}: um texto citado não pode ter lacunas`);
    resolvido.set(chave, texto);
    return texto;
  };
  const trocar = (texto, chave) => texto.replace(REFERENCIA, (_, ref) => resolver(ref, [chave]));
  const saida = new Map();
  for (const [chave, e] of entradas) {
    if (e.tipo === 'texto') saida.set(chave, { tipo: 'texto', texto: trocar(e.texto, chave) });
    else saida.set(chave, { tipo: 'plural', formas: Object.fromEntries(Object.entries(e.formas).map(([f, t]) => [f, trocar(t, chave)])) });
  }
  return saida;
}

/** The catalog of one language, flat and with the references in place. qps is en-US, pseudo-localized. */
export async function catalogo(idioma) {
  const { entradas, grupos } = achatar(await lerIdioma(idioma === 'qps' ? 'en-US' : idioma));
  let resolvidas = resolverReferencias(entradas);
  if (idioma === 'qps') {
    resolvidas = new Map([...resolvidas].map(([k, e]) => [k, e.tipo === 'texto'
      ? { tipo: 'texto', texto: pseudo(e.texto) }
      : { tipo: 'plural', formas: Object.fromEntries(Object.entries(e.formas).map(([f, t]) => [f, pseudo(t)])) }]));
  }
  return { entradas: resolvidas, grupos };
}

// ── Pseudo-localization (§3.2): every text of the catalog marked ⟦…⟧, accented and 40% longer, the
// way Microsoft's qps-ploc is. On a screen of the qps build, text without the marks is text that did
// not come from the catalog. Blanks and tokens stay as they are.
const ACENTOS = Object.fromEntries([...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c, i) =>
  [c, [...'åƀçðéƒĝĥîĵķļɱñöþǫŕšţûṽŵẋýžÅƁÇÐÉƑĜĤÎĴĶĻṀÑÖÞǪŔŠŢÛṼŴẊÝŽ'][i]]));
export function pseudo(texto) {
  const partes = texto.split(/(\{\{[^}]*\}\}|\{[^{}]*\})/);
  const letras = partes.filter((_, i) => i % 2 === 0).join('').length;
  const corpo = partes.map((p, i) => (i % 2 ? p : [...p].map((c) => ACENTOS[c] ?? c).join(''))).join('');
  return `⟦${corpo}${'·'.repeat(Math.max(1, Math.round(letras * 0.4)))}⟧`;
}

// ── The plural rules (CLDR), as code (§3.4). en: one is exactly 1. pt: one is 0 ≤ n < 2, so 0 and 1,5
// are "one" ("0 segundo"); the catalog's zero comes first, which is why pt-BR always carries one.
// "many" (exact millions in pt) falls into other.
export function regraPlural(idioma, c, formas) {
  const z = formas.zero, o = formas.one, x = formas.other;
  if (o === x && (z === undefined || z === x)) return x;
  const um = idioma === 'pt-BR' ? `${c}<2` : `${c}===1`;
  const resto = o === x ? x : `${um}?${o}:${x}`;
  return z === undefined || z === resto ? `(${resto})` : `(${c}===0?${z}:${resto})`;
}

/** A JS expression for a text, its blanks taken from `valores` (blank → JS source). */
export function codigoTexto(texto, valores) {
  const nomes = lacunas(texto);
  if (!nomes.length) return JSON.stringify(texto);
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
  let out = '';
  let pos = 0;
  for (const m of texto.matchAll(LACUNA)) {
    out += esc(texto.slice(pos, m.index)) + '${' + valores[m[1]] + '}';
    pos = m.index + m[0].length;
  }
  return '`' + out + esc(texto.slice(pos)) + '`';
}

// ── The checks the TypeScript types cannot make (§3.2). Each returns the problems as lines.

/** The same areas and keys in both languages, each of the same kind, with the same blanks and tokens. */
export function conferirForma(en, pt) {
  const erros = [];
  for (const [chave, e] of en) {
    const p = pt.get(chave);
    if (!p) { erros.push(`${chave}: falta em pt-BR`); continue; }
    if (p.tipo !== e.tipo) { erros.push(`${chave}: ${e.tipo} em en-US e ${p.tipo} em pt-BR`); continue; }
    const le = lacunasDe(e).join(', '), lp = lacunasDe(p).join(', ');
    if (le !== lp) erros.push(`${chave}: lacunas {{${le}}} em en-US e {{${lp}}} em pt-BR`);
    const te = [...new Set(formasDe(e).flatMap(tokens))].sort().join(' '), tp = [...new Set(formasDe(p).flatMap(tokens))].sort().join(' ');
    if (te !== tp) erros.push(`${chave}: os tokens não são os mesmos (en-US: ${te || 'nenhum'}; pt-BR: ${tp || 'nenhum'})`);
    if (p.tipo === 'plural' && !('zero' in p.formas)) erros.push(`${chave}: plural sem zero em pt-BR (o CLDR conta 0 como "one": "0 segundo")`);
    for (const t of formasDe(e)) if (/\{\{(?!>)(?!\s*[A-Za-z_]\w*\s*\}\})/.test(t)) erros.push(`${chave}: lacuna malformada em en-US: ${t}`);
    for (const t of formasDe(p)) if (/\{\{(?!>)(?!\s*[A-Za-z_]\w*\s*\}\})/.test(t)) erros.push(`${chave}: lacuna malformada em pt-BR: ${t}`);
  }
  for (const chave of pt.keys()) if (!en.has(chave)) erros.push(`${chave}: só existe em pt-BR`);
  return erros;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const borda = (termo, flags = 'u') => new RegExp(`(?<![\\p{L}\\p{N}])${escRe(termo)}(?![\\p{L}\\p{N}])`, flags);

/** The glossary terms the build checks: where the English has one, the pt-BR has it too. */
export function termosConferidos(g) {
  const ambiguos = new Set(g.AMBIGUOS);
  const exatos = [...g.PASSOS, ...g.NOMES_ADD_STEP, ...g.CONDICOES, ...g.RECURSOS.filter((r) => r !== 'Macros'), ...g.MARCAS, ...g.TECLAS]
    .filter((t) => !ambiguos.has(t));
  return [
    ...[...new Set(exatos)].map((t) => ({ termo: t, re: borda(t) })),
    ...Object.keys(g.CORINGAS).map((t) => ({ termo: t, re: new RegExp(`(?<![\\p{L}\\p{N}])${escRe(t)}s?(?![\\p{L}\\p{N}])`, 'iu') })),
  ];
}

/** The glossary and the terminology, key by key (ISENCOES skips a key). */
export function conferirTermos(en, pt, g, terminologia) {
  const erros = [];
  const termos = termosConferidos(g);
  for (const [chave, e] of en) {
    const p = pt.get(chave);
    if (!p || p.tipo !== e.tipo || chave in g.ISENCOES) continue;
    const pares = e.tipo === 'texto' ? [[e.texto, p.texto]] : Object.keys(e.formas).filter((f) => f in p.formas).map((f) => [e.formas[f], p.formas[f]]);
    // The words of the text only: a blank's name ({{step}}) is not a word the screen shows.
    const palavras = (s) => s.replace(/\{\{[^}]*\}\}/g, ' ');
    for (const [te0, tp0] of pares) {
      const te = palavras(te0), tp = palavras(tp0);
      for (const { termo, re } of termos) if (re.test(te) && !re.test(tp)) erros.push(`${chave}: "${termo}" é do glossário e fica em inglês ("${tp0}")`);
      for (const t of terminologia) if (t.en && t.pt && t.en.test(te) && !t.pt.test(tp)) erros.push(`${chave}: "${t.ingles}" é "${t.portugues}" em pt-BR ("${tp0}")`);
    }
  }
  return [...new Set(erros)];
}
