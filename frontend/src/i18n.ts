import type { Chaves, Tabelas } from './i18n.g';

// The interface's language (plan .claude/planos/idiomas-tr3-2026-11-02.md, §3). The text lives in the
// catalog, i18n/<language>/<area>.ts at the repo root, and each build of the page is in one language:
// tools/vite-i18n.mjs replaces every t() and tn() below with the text of the build's language at
// compile time. The code asks for a key and never tests the language; the language only picks the
// build, and changing it loads the other one.

/** The languages the interface speaks. */
export type Idioma = 'en-US' | 'pt-BR';

// TR_LANG of the build (tools/vite-i18n.mjs): qps is the pseudo-localized one the tests sweep, which
// formats like en-US.
declare const __TR_LANG__: Idioma | 'qps';

/** This build's language: the one numbers, dates and lists are written in. */
export const LANG: Idioma = __TR_LANG__ === 'pt-BR' ? 'pt-BR' : 'en-US';

type Args<K extends keyof Chaves> = [Chaves[K]] extends [never] ? [] : [Chaves[K]];

/**
 * The text of a key in this build's language: t('library.newMacro'), t('library.renamed', { name }),
 * t('list.steps', { count }) — count picks a plural's form. Replaced at compile time; the key and the
 * blanks are checked by the types (i18n.g.ts) and by the plugin.
 */
export function t<K extends keyof Chaves>(key: K, ..._blanks: Args<K>): string {
  throw new Error(`t('${key}') was not compiled (tools/vite-i18n.mjs)`);
}

/** A group of plain texts as an object, for a lookup at run time: tn('common.pages')[page]. */
export function tn<K extends keyof Tabelas>(key: K): Readonly<Record<Tabelas[K], string>> {
  throw new Error(`tn('${key}') was not compiled (tools/vite-i18n.mjs)`);
}

// The formatters are made once, on first use, and never at the opening: an Intl object is not free.
let numero: Intl.NumberFormat | undefined;
let hora: Intl.DateTimeFormat | undefined;

/** A number with this language's grouping: 1,412 / 1.412. */
export const fmtNum = (n: number): string => (numero ??= new Intl.NumberFormat(LANG)).format(n);

/** A time of day, hours and minutes: 2:05 PM / 14:05. */
export const fmtHora = (d: Date): string => (hora ??= new Intl.DateTimeFormat(LANG, { hour: '2-digit', minute: '2-digit' })).format(d);
