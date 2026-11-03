// The build gate — TWO rules, one pass.
//
// This file replaces eslint.hooks.config.js and eslint.colors.config.js. They were two separate
// invocations, and each one paid a full parse of the same ~100 .ts/.tsx files with the same
// parser: measured 15.4 s and 14.2 s, so the lint phase of every build cost about 30 s to enforce
// two rules. Merging recovers roughly half of that. Everything else about the design is unchanged
// — it is still a narrow gate, still a RATCHET, still separate from `npm run lint`, which carries
// the whole recommended set and reports ~68 problems worth reviewing but not worth blocking on.
//
// ── Rule 1: react-hooks/exhaustive-deps ──────────────────────────────────────────────────────
// Catches the bug class this project keeps shipping: a useCallback/useMemo that READS state
// missing from its dependency array, so the callback keeps a stale closure. In SheetPanel that
// shape is always the same and always silent — handleSave compares the stale value against the
// stored one, finds them equal, sends no edit, and the UI still reports the change as saved. The
// user's edit is simply gone. It has landed at least twice, and it caught a third instance during
// the 2026-09-03 theme work, so the gate earns its keep.
//
// ── Rule 2: no-restricted-syntax, literal colours ────────────────────────────────────────────
// The golden rule is "components consume var(--color-*), never a literal colour", and until this
// gate existed it lived only in a comment — which is why it kept regressing: ImageCropper had
// re-introduced a frozen rgba() accent, the SAME defect TitleBar carries a comment about having
// fixed, and fifteen call sites painted text-white on bg-accent-solid while --color-accent-ink sat
// right there computing the correct ink (dark in 12 of the 37 presets, as low as 1.36:1).
//
// ── The one subtlety worth reading before editing ────────────────────────────────────────────
// themes.ts and index.css are where literal colours BELONG — they are the palette source. The
// colours config used to express that as a bare `{ ignores: [...] }` object, which in flat config
// is a GLOBAL ignore: merged naively into this file it would have dropped themes.ts out of the
// HOOKS gate too, silently weakening the rule that had just caught a real bug. So the exemption is
// scoped to the rule instead, as a later config object that turns only no-restricted-syntax off
// for those paths. Do not turn it back into a top-level `ignores`.
//
// ── Rule 3: tr/texto-solto, interface text outside the catalog ──────────────────────────────────
// The interface speaks en-US and pt-BR (plan .claude/planos/idiomas-tr3-2026-11-02.md, §3.2), and
// its text comes from the catalog in i18n/ through t(): one build per language, the text put in at
// compile time. Text written straight into JSX — a child, or aria-label / data-tip / placeholder /
// title / alt — would stay in English in the pt-BR build. What is only glossary (step names, keys,
// brands, the features: i18n/glossario.ts) is the same in both languages and passes. Every screen is
// in the catalog, so this rule has no suppressions: a text written in the code fails the build.
//
// Pre-existing violations live in eslint-gate-suppressions.json (generated with --suppress-all).
// Today's count is frozen and any NEW one fails the build. To clear one: fix it, then run
// `npm run lint:gate:prune`.
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'
import { lerTs } from '../tools/i18n-lib.mjs'

/** #rgb / #rrggbb / #rrggbbaa. */
const HEX = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`
/** rgb()/rgba()/hsl()/hsla() with literal numbers — the hand-written tint that should be color-mix. */
const FN = String.raw`(?:rgba?|hsla?)\(\s*\d`
/** Tailwind utilities that paint a fixed colour: text-white, bg-black/45, border-red-500/20, … */
const TW = String.raw`\b(?:text|bg|border|fill|stroke|ring|shadow|from|via|to|decoration|outline|accent|caret|divide|placeholder)-(?:white|black|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?\b`

const MSG = 'Literal colour in UI code. Consume a theme token instead — var(--color-…), or color-mix(in srgb, var(--color-…) N%, transparent) for a tint. See the rule note in eslint.gate.config.js.'

/** Restricting to Literal / TemplateElement (rather than any node) is what keeps a hex inside a
 *  comment quiet, and keeps the rule off values that merely look like colours in prose. */
const COLOUR_SELECTORS = [HEX, FN, TW].flatMap(re => [
  { selector: `Literal[value=/${re}/]`, message: MSG },
  { selector: `TemplateElement[value.raw=/${re}/]`, message: MSG },
])

// What may stay as written: the glossary, less the words that are also plain English ("Stop" the step
// and "Stop" the verb), plus the units.
const G = await lerTs(new URL('../i18n/glossario.ts', import.meta.url))
const COMUNS = new Set(['Pause', 'Stop', 'Return', 'Next', 'Break', 'If', 'Else', 'While', 'Assert', 'Click', 'Key', 'Text', 'Scroll', 'Variable', 'Random', 'Time'])
const coringa = (w) => [w, w[0].toUpperCase() + w.slice(1)].flatMap(x => [x, x + 's'])
const TERMOS = [...G.PASSOS, ...G.NOMES_ADD_STEP, ...G.CONDICOES, ...G.TECLAS, ...G.RECURSOS, ...G.MARCAS, ...Object.keys(G.CORINGAS).flatMap(coringa), 'ms', 'px']
  .filter(t => !COMUNS.has(t)).sort((a, b) => b.length - a.length)
const escapar = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c)
const SEM_TERMOS = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${TERMOS.map(escapar).join('|')})(?![\p{L}\p{N}])`, 'gu')
/** Text that needs the catalog: two letters in a row once the tokens and the glossary are out. */
const solto = (texto) => /\p{L}{2}/u.test(texto.replace(/\{[^{}]*\}/g, ' ').replace(SEM_TERMOS, ' '))
const ATRIBUTOS = new Set(['aria-label', 'data-tip', 'placeholder', 'title', 'alt'])

const textoSolto = {
  meta: { type: 'problem', messages: { solto: 'Interface text outside the catalog: "{{texto}}". It goes in i18n/ and comes through t() (eslint.gate.config.js, rule 3).' } },
  create(context) {
    const report = (node, texto) => context.report({ node, messageId: 'solto', data: { texto: texto.trim().replace(/\s+/g, ' ').slice(0, 50) } })
    // The strings an expression shows, not the ones handed to a call: t('…') is the catalog, and a
    // call's other arguments are its own business.
    const strings = (node, out = []) => {
      if (!node || typeof node !== 'object') return out
      if (node.type === 'Literal' && typeof node.value === 'string') out.push([node, node.value])
      else if (node.type === 'TemplateLiteral') {
        for (const q of node.quasis) out.push([q, q.value.cooked ?? q.value.raw])
        for (const e of node.expressions) strings(e, out)
      } else if (node.type === 'ConditionalExpression') { strings(node.consequent, out); strings(node.alternate, out) }
      // What reaches the screen: a + joins text, a && shows its right side only; a comparison
      // (page !== 'macros') shows nothing of its literals.
      else if (node.type === 'LogicalExpression') { if (node.operator !== '&&') strings(node.left, out); strings(node.right, out) }
      else if (node.type === 'BinaryExpression') { if (node.operator === '+') { strings(node.left, out); strings(node.right, out) } }
      else if (node.type === 'TSAsExpression' || node.type === 'TSNonNullExpression') strings(node.expression, out)
      return out
    }
    const conferir = (expr) => { for (const [n, s] of strings(expr)) if (solto(s)) report(n, s) }
    return {
      JSXText(node) { if (solto(node.value)) report(node, node.value) },
      JSXAttribute(node) {
        if (node.name.type !== 'JSXIdentifier' || !ATRIBUTOS.has(node.name.name) || !node.value) return
        if (node.value.type === 'Literal') { if (typeof node.value.value === 'string' && solto(node.value.value)) report(node.value, node.value.value) }
        else if (node.value.type === 'JSXExpressionContainer') conferir(node.value.expression)
      },
      JSXExpressionContainer(node) {
        if (node.parent.type === 'JSXElement' || node.parent.type === 'JSXFragment') conferir(node.expression)
      },
    }
  },
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.base, reactHooks.configs.flat.recommended],
    plugins: { tr: { rules: { 'texto-solto': textoSolto } } },
    // Silencing rules above leaves their existing eslint-disable comments "unused", which would
    // otherwise report here as noise about rules this gate does not even judge.
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // The two gates.
      'react-hooks/exhaustive-deps': 'error',
      'react-hooks/rules-of-hooks': 'error', // fundamental and already clean — keep it guarded
      'no-restricted-syntax': ['error', ...COLOUR_SELECTORS],
      'tr/texto-solto': 'error',
      // Everything else the recommended set turns on is silenced HERE (not in the main config,
      // where it stays visible to `npm run lint`) so the gate fails for exactly two reasons.
      // Extending the recommended set at all is what makes the codebase's existing
      // `eslint-disable react-hooks/…` comments resolve to a KNOWN rule; without it the gate
      // fails with "Definition for rule not found" on files that have nothing to do with either.
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/incompatible-library': 'off',
      'react-hooks/config': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/globals': 'off',
      'react-hooks/gating': 'off',
      'react-hooks/component-hook-factories': 'off',
      'react-hooks/unsupported-syntax': 'off',
      'react-hooks/use-memo': 'off',
      'react-hooks/no-deriving-state-in-effects': 'off',
      'react-hooks/void-use-memo': 'off',
      'react-hooks/immutability-violation': 'off',
    },
  },
  {
    // The palette source (the presets moved to their own file, which only the pickers load). Scoped
    // to the RULE, never a top-level `ignores` — see the note above.
    files: ['src/themes.ts', 'src/themePresets.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
])
