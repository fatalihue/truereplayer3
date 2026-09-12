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
 * The first grapheme that carries IDENTITY. Punctuation is packaging: "[WIP] Farm" is a Farm
 * profile wearing a label, and an avatar reading "[" identifies nothing.
 *
 * Skipping it at the word boundary is not enough — the brackets, quotes and guillemets people
 * decorate names with sit INSIDE the token, so every place that reads an initial has to ask this
 * question rather than take the first character and hope.
 */
const firstIdentGrapheme = (s: string): string => {
  for (const { segment } of graphemes.segment(s)) {
    if (/\p{L}|\p{N}/u.test(segment)) return segment;
  }
  return firstGrapheme(s);
};

/**
 * Cut to at most `n` user-perceived characters, adding an ellipsis when anything was dropped.
 *
 * `slice` counts UTF-16 units, so it happily cuts an emoji in half and leaves a lone surrogate —
 * the tooltip that shows a profile's description did exactly that, sixteen lines above the code in
 * the same file that documents the rule.
 */
export function cutGlyphs(s: string, n: number): string {
  const parts = [...graphemes.segment(s)];
  if (parts.length <= n) return s;
  return parts.slice(0, n).map((p) => p.segment).join('') + '…';
}

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
  // Guard by INCLUSION, not by "is not a letter or a number". The early return was written for a
  // name the user prefixed with an emoji, but it fired for any leading punctuation too —
  // "_backup farm" drew a single "_" in the rail avatar, and "[WIP] Farm" a "[".
  if (lead && /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(lead)) return lead;
  const numbered = /^(.*?\D)\s*(\d{1,3})$/.exec(trimmed);
  if (numbered && numbered[1].trim()) return `${firstIdentGrapheme(numbered[1].trim())}${numbered[2]}`.toUpperCase();
  const words = trimmed
    .replace(/([a-zà-ú])([A-ZÀ-Ú])/g, '$1 $2')
    .split(/[\s\-_./]+/)
    // …and a token made only of punctuation is not a word. Without this "[WIP] Farm" splits into
    // "[WIP]" and "Farm" and takes the "[" as its first initial — the same defect one level down.
    .filter((w) => /\p{L}|\p{N}/u.test(w));
  if (words.length >= 2) {
    const second = words.slice(1).find((w) => glyphCount(w) >= 3) ?? words[1];
    return `${firstIdentGrapheme(words[0])}${firstIdentGrapheme(second)}`.toUpperCase();
  }
  // words[0], not `trimmed`: the split has already dropped the leading separators, and reading the
  // raw string here is how "...reticencias" came back as ".". Falling back to `trimmed` keeps a
  // name made only of punctuation — which the emoji branch above did not claim — showing something.
  return firstIdentGrapheme(words[0] ?? trimmed).toUpperCase();
}
