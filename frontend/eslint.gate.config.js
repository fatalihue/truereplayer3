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
// Pre-existing violations live in eslint-gate-suppressions.json (generated with --suppress-all).
// Today's count is frozen and any NEW one fails the build. To clear one: fix it, then run
// `npm run lint:gate:prune`.
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

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

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.base, reactHooks.configs.flat.recommended],
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
    // The palette source. Scoped to the RULE, never a top-level `ignores` — see the note above.
    files: ['src/themes.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
])
