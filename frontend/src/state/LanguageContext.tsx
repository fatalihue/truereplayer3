import { LANG } from '../i18n';

// The interface's language is the build's (plan of languages, §3.7 — D30): each build of the page is in
// one language, i18n/ holds the text, and changing the language loads the other build. The language
// of the tips alone, switched live, is gone with its Provider and its setter.
//
// What stays here is for the screens not yet moved to the catalog, until their slice moves them: the
// old pairs tt('English', 'Português') pick the build's language — tools/vite-i18n.mjs already picks
// them at compile time, so a build never carries the other — and useLanguage() tells which one this is.
export type Language = 'en' | 'pt-BR';

/** This build's language, in the old pairs' terms. */
export const LANGUAGE: Language = LANG === 'pt-BR' ? 'pt-BR' : 'en';

export function useLanguage(): { language: Language } {
  return { language: LANGUAGE };
}

const pick = (en: string, ptBr: string) => (LANGUAGE === 'pt-BR' ? ptBr : en);

/** The old pairs' function: tt('English', 'Português') → this build's one. */
export function useTt() {
  return pick;
}
