import { useState } from 'react';

/**
 * A polite live region that speaks `text` only when `when` changes.
 *
 * The capture dialogs' summary strip ("Clicks the Left button at 300, 400 · 5×, 600 ms apart.")
 * is REBUILT from the field values on every keystroke, so marking the strip itself aria-live had
 * a screen reader read the whole sentence again for each digit typed into Times, Gap or Hold. What
 * deserves a word is the STATE moving — a key arriving from the native hook, a point picked off
 * screen, the strip turning into a refusal — and that is what `when` is: the caller's state key
 * (the active message, plus the captured key where one arrives from outside the focus). The text
 * is taken at that moment; edits to the numbers after it stay quiet, the fields speak for those.
 *
 * Silent on mount: the opening state is what the dialog already shows.
 */
export function AnnounceOnChange({ when, text }: { when: string | number; text: string }) {
  const [said, setSaid] = useState<{ when: string | number; text: string }>({ when, text: '' });
  // The "previous value in state" pattern: adjusting state while rendering, conditionally, so it
  // settles in one pass — no effect, no extra commit.
  if (said.when !== when) setSaid({ when, text });
  return <span role="status" className="sr-only">{said.text}</span>;
}
