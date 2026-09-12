import { tryParseInt32 } from './int32';

/**
 * How long the extension will spend INSIDE a Browser Type command — the mirror of
 * `BrowserBridgeService.TypeKeyBudgetMs`.
 *
 * The Test button arms a safety timeout so the UI recovers if the bridge never answers, and that
 * timeout has to be at least as generous as the backend's own: {delay:N} pauses (500 ms bare,
 * capped at 60 s), 30 ms per {key:N} press (N capped at 100), and the per-character delay over
 * what is left once the key tokens are removed.
 *
 * Two things this file exists to stop:
 *  - The count was read with `/^\d+$/`, while the C# reads `int.TryParse` under
 *    NumberStyles.Integer and the extension reads its own parser. `{delay: 30000}` — one space —
 *    failed the regex and was billed as a bare 500 ms here, while the two sides that EXECUTE it
 *    waited 30 s. The net fired first, the real answer was dropped, and a Test that worked
 *    reported NO_RESPONSE.
 *  - The budget was computed over the RAW text. A `{clipboard}` holding four thousand characters
 *    resolves before it is typed, so the backend budgets the resolved length and this side
 *    budgeted the token. See `browser:testAccepted`, which carries the authoritative number: this
 *    function is the fallback for an older backend that does not send it.
 */

// Keep in step with BrowserBridgeService.TypeKeyTokenRegex and the extension's key grammar.
const KEY_TOKEN_RE = /\{(enter|tab|esc|escape|backspace|delete|up|down|left|right|space|home|end|pageup|pagedown|delay)(?::([^}]*))?\}/gi;

export const TYPE_BUDGET_CEILING_MS = 10 * 60 * 1000;

export function typeBudgetMs(text: string | null | undefined, charDelayMs: number): number {
  if (!text) return 0;
  let total = 0;
  for (const m of text.matchAll(KEY_TOKEN_RE)) {
    const parsed = m[2] != null ? tryParseInt32(m[2]) : null;
    const n = parsed != null && parsed > 0 ? parsed : 0;
    if (m[1].toLowerCase() === 'delay') total += n > 0 ? Math.min(n, 60000) : 500;
    else total += 30 * (n > 0 ? Math.min(n, 100) : 1);
  }
  if (charDelayMs > 0) total += charDelayMs * text.replace(KEY_TOKEN_RE, '').length;
  return Math.min(total, TYPE_BUDGET_CEILING_MS);
}
