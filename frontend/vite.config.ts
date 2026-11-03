import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import i18n from '../tools/vite-i18n.mjs'

// One page per language (plan idiomas-tr3-2026-11-02.md, §3.3): TR_LANG picks the catalog the text
// comes from, and each language builds into its own folder of dist, the one the engine navigates to
// (https://app.local/<language>/index.html). npm run build makes en-US and pt-BR; qps is the
// pseudo-localized page only the tests use (npm run build:qps), and it does not ship.
const LANG = (process.env.TR_LANG ?? 'en-US') as 'en-US' | 'pt-BR' | 'qps'

// Strip crossorigin attribute from HTML — unnecessary for WebView2 and can cause issues
function removeCrossorigin(): import('vite').Plugin {
  return {
    name: 'remove-crossorigin',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

export default defineConfig({
  plugins: [
    // Before the React Compiler, which then memoizes JSX that already holds this language's text.
    i18n({ lang: LANG }),
    // The React Compiler memoizes components and hooks by itself (rule 2 of the interface plan), so
    // a store update re-renders only what reads the part that changed. The react-hooks lint already
    // holds the code to the rules it needs.
    react({ babel: { plugins: ['babel-plugin-react-compiler'] } }),
    tailwindcss(),
    removeCrossorigin(),
  ],
  base: './',
  build: {
    outDir: `dist/${LANG}`,
    assetsDir: 'assets',
    // The bundle only ever runs inside evergreen WebView2 (see MainWindow's WebView2 init), never
    // in an older browser, so there is no reason to pay for Vite's default downlevel target
    // (baseline-widely-available ≈ Chrome 107) — every helper emitted for spread / optional
    // chaining / async is dead weight in a chunk that is parsed on each launch.
    target: 'chrome114',
  },
  server: {
    port: 5173,
    // Fail instead of moving to 5174. The DEBUG build navigates to localhost:5173 by literal
    // (MainWindow), and 5173 is every Vite project's default: with the port taken, this server
    // used to come up elsewhere in silence and the app loaded whatever held 5173 — another
    // project, or a stale harness left running.
    strictPort: true,
  },
})
