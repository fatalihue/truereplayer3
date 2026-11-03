import type { Plugin } from 'vite';

/** The page's text, one language per build: see vite-i18n.mjs. */
export default function i18n(opts: { lang: 'en-US' | 'pt-BR' | 'qps' }): Plugin;
