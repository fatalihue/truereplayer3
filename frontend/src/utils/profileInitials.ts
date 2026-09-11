// The avatar text for a profile in the collapsed rail, where it is the ONLY identification the
// row carries. Pure and dependency-free so it can be proven head-lessly, like conditionalBlocks.

// Grapheme splitter, built once at module scope: a new instance per render is pure waste on a
// list that re-renders with the panel.
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * The first USER-PERCEIVED character. `charAt` returns one UTF-16 unit, i.e. half of an emoji's
 * surrogate pair — "🔥 Farm" drew a broken glyph — and even code-point iteration splits a flag
 * into two regional indicators or drops a variation selector.
 */
export const firstGrapheme = (s: string): string => [...graphemes.segment(s)][0]?.segment ?? '';

/** Length in characters people SEE, not UTF-16 units: "🔥" is one glyph but `.length` 2. */
export const glyphCount = (s: string): number => [...graphemes.segment(s)].length;

/**
 * Initials for the rail avatar: "WhatsApp Web" → WW, "WhatsApp" → WA (camelCase is split),
 * "Fila 11" → F11, "Boas-vindas" → BV.
 *
 * A name the user prefixed with an emoji IS the identity they chose, so it is returned whole
 * rather than reduced to an initial from the word behind it — which also makes this branch agree
 * with the iconEmoji branch the row prefers when one is set.
 */
export function railInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const lead = firstGrapheme(trimmed);
  if (lead && !/\p{L}|\p{N}/u.test(lead)) return lead;
  const numbered = /^(.*?\D)\s*(\d{1,3})$/.exec(trimmed);
  if (numbered && numbered[1].trim()) return `${firstGrapheme(numbered[1].trim())}${numbered[2]}`.toUpperCase();
  const words = trimmed
    .replace(/([a-zà-ú])([A-ZÀ-Ú])/g, '$1 $2')
    .split(/[\s\-_./]+/)
    .filter(Boolean);
  if (words.length >= 2) {
    const second = words.slice(1).find((w) => glyphCount(w) >= 3) ?? words[1];
    return `${firstGrapheme(words[0])}${firstGrapheme(second)}`.toUpperCase();
  }
  return firstGrapheme(trimmed).toUpperCase();
}
