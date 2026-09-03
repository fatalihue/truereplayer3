// Build gate #2 — the theme-token rule.
//
// The project's golden rule is "components consume var(--color-*), never a literal colour", and
// until now it lived only in a comment. That is exactly why it kept regressing: ImageCropper had
// re-introduced a frozen `rgba(96, 205, 255, 0.65)` accent — the SAME defect TitleBar carries a
// comment about having fixed — and fifteen call sites painted `text-white` on `bg-accent-solid`
// while `--color-accent-ink` sat right there computing the correct ink. In 12 of the 37 presets
// that ink is dark, so white measured as low as 1.36:1. A convention nothing enforces is a
// convention that decays.
//
// Shaped after eslint.hooks.config.js, deliberately: one narrow gate, its own config, its own
// suppressions file, so the build fails for exactly one reason and today's count is frozen as a
// RATCHET. To clear a suppression, fix it and run `npm run lint:colors:prune`.
//
// What it does NOT do: judge `themes.ts` (the palettes ARE the source of truth), `index.css`
// (the :root defaults), or a colour inside `var(--token, fallback)` — a fallback is defensive
// and correct. Scrims, shadows and colours computed from user data are out of scope by
// construction, since the rule only looks at literals written into className and JSX attributes.
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'

/** #rgb / #rrggbb / #rrggbbaa, and the two colour keywords that actually get typed by hand. */
const HEX = String.raw`#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b`
/** rgb()/rgba()/hsl()/hsla() with literal numbers — the hand-written tint that should be color-mix. */
const FN = String.raw`(?:rgba?|hsla?)\(\s*\d`
/** Tailwind utilities that paint a fixed colour: text-white, bg-black/45, border-red-500/20, … */
const TW = String.raw`\b(?:text|bg|border|fill|stroke|ring|shadow|from|via|to|decoration|outline|accent|caret|divide|placeholder)-(?:white|black|slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d{1,3})?\b`

const MSG = 'Literal colour in UI code. Consume a theme token instead — var(--color-…), or color-mix(in srgb, var(--color-…) N%, transparent) for a tint. See the rule note in eslint.colors.config.js.'

export default defineConfig([
  globalIgnores(['dist']),
  {
    // The palette source and the :root defaults are where literal colours BELONG.
    ignores: ['src/themes.ts', 'src/index.css', 'eslint.colors.config.js'],
  },
  {
    files: ['**/*.{ts,tsx}'],
    // react-hooks is pulled in only so the codebase's existing `eslint-disable
    // react-hooks/…` comments still resolve to a KNOWN rule here; every one of its rules is
    // then switched off below. Without this the gate fails with "Definition for rule not
    // found" on files that have nothing to do with colour.
    extends: [tseslint.configs.base, reactHooks.configs.flat.recommended],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/rules-of-hooks': 'off',
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
      'no-restricted-syntax': ['error',
        // A literal colour anywhere in a string that reaches the DOM. Restricting to Literal /
        // TemplateElement (rather than any node) is what keeps a hex inside a comment quiet.
        { selector: `Literal[value=/${HEX}/]`, message: MSG },
        { selector: `TemplateElement[value.raw=/${HEX}/]`, message: MSG },
        { selector: `Literal[value=/${FN}/]`, message: MSG },
        { selector: `TemplateElement[value.raw=/${FN}/]`, message: MSG },
        { selector: `Literal[value=/${TW}/]`, message: MSG },
        { selector: `TemplateElement[value.raw=/${TW}/]`, message: MSG },
      ],
    },
  },
])
