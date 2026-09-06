// The one list of tokens the Insert Text window offers — drawn as chips by the Insert palette
// (SendTextDialog) and as the floating list the editor opens on `{` (LexicalTokenEditor's
// TokenAutocompletePlugin). It moved here from the dialog the day the autocomplete arrived: two
// surfaces reading one array cannot drift, two copies of it would have, and the palette's own
// order (by how often each group gets used) is the order the list keeps.
//
// Direct chips insert their seed string; prompt chips (Variable…, Row column…) have no seed —
// the palette opens a name prompt for them, the autocomplete inserts the OPEN half (`{var:`)
// and lets the finished token chip through the typing transform. Never a literal placeholder.

export interface PaletteChip {
  label: string;
  insert?: string;                                       // direct-insert seed (byte-identical to 2.7.x)
  prompt?: 'var' | 'row' | 'rownext' | 'clip' | 'input'; // opens the name/label prompt instead
}

// The token a palette chip stands for. Descriptions used to live inline on every chip, one copy
// each, and they vanished the moment the token BECAME a chip in the editor; they now come from
// the one shared table in lexical/tokenDescriptions. Direct chips ARE their seed; a prompt chip
// has no seed yet, so a synthetic one carries the right NAME — and, for {row:x}, lands on the
// data-column VARIANT rather than the bare action-row counter, which is what that chip means.
export const paletteToken = (chip: PaletteChip): string => chip.insert ?? `{${chip.prompt}:x}`;

export const VALUE_CHIPS: PaletteChip[] = [
  { label: 'Date', insert: '{date}' },
  { label: 'Time', insert: '{time}' },
  { label: 'DateTime', insert: '{datetime}' },
  { label: 'Random', insert: '{random:1-10}' },
  // Seed is PRE-normalized ({Pick:...}, args verbatim) — direct chips insert as text and only
  // a normalization fixed point survives the load gate as a chip. Click the chip to edit the
  // options one-per-line in its popover.
  { label: 'Pick', insert: '{Pick:a|b|c}' },
];

export const KEY_CHIPS: PaletteChip[] = [
  { label: 'Enter', insert: '{enter}' },
  { label: 'Tab', insert: '{tab}' },
  { label: 'Delay', insert: '{delay:500}' },
];

export const MORE_KEY_CHIPS: PaletteChip[] = [
  { label: 'Space', insert: '{space}' },
  { label: 'Backspace', insert: '{backspace}' },
  { label: 'Delete', insert: '{delete}' },
  { label: 'Escape', insert: '{escape}' },
  { label: 'Home', insert: '{home}' },
  { label: 'End', insert: '{end}' },
  { label: 'PageUp', insert: '{pageup}' },
  { label: 'PageDown', insert: '{pagedown}' },
  { label: 'Up', insert: '{up}' },
  { label: 'Down', insert: '{down}' },
  { label: 'Left', insert: '{left}' },
  { label: 'Right', insert: '{right}' },
];

// Clipboard-sourced tokens — grouped under the Clipboard section next to {clipboard}
// itself. {clip:N} is an in-app capture slot; {winclip:N} is the Windows Win+V history.
// Clip slot stays inline: it is the consumer end of the Copy to Slot action and the
// capture hotkey, so hiding it here would hide half of that feature.
export const CLIPBOARD_CHIPS: PaletteChip[] = [
  { label: 'Clip slot…', prompt: 'clip' },
];

// Collapsed: {clipboard:next} is a niche auto-advancing read, and {winclip:N} depends
// on a Windows setting being on and can surface anything recently copied.
export const MORE_CLIPBOARD_CHIPS: PaletteChip[] = [
  { label: 'Clipboard line (next)', insert: '{clipboard:next}' },
  { label: 'Clipboard history', insert: '{winclip:1}' },
];

export const RUN_STATE_CHIPS: PaletteChip[] = [
  { label: 'Variable…', prompt: 'var' },
  { label: 'Counter', insert: '{counter}' },
  // The block iteration (While / For Each) — inline next to Counter, its run-level twin.
  { label: 'Loop', insert: '{loop}' },
  { label: 'Ask input…', prompt: 'input' },
];

// Collapsed: every one of these is row-addressed, and the two data-table ones only
// resolve to anything in a profile that loops over data. They also carry the longest
// labels in the palette, so parking them keeps Run state to a single line.
export const MORE_ROW_CHIPS: PaletteChip[] = [
  { label: 'Data row #', insert: '{datarow}' },
  { label: 'Action row #', insert: '{row}' },
  { label: 'Row column…', prompt: 'row' },
  { label: 'Row column (next)…', prompt: 'rownext' },
];

// ── The flat list the `{` autocomplete filters ─────────────────────────────────────────────
export interface CatalogEntry {
  /** The palette's label, verbatim ("DateTime", "Variable…"). */
  label: string;
  /** The palette section it comes from — the list's group header when unfiltered. */
  group: string;
  /** The token NAME, lower case, for matching ("datetime", "var"). */
  name: string;
  /** direct = `insert` is a whole token and becomes a chip; prompt = `insert` is the open half. */
  kind: 'direct' | 'prompt';
  insert: string;
}

function entries(group: string, chips: PaletteChip[]): CatalogEntry[] {
  return chips.map((chip) => chip.insert
    ? { label: chip.label, group, name: chip.insert.slice(1).split(/[:}]/)[0].toLowerCase(), kind: 'direct', insert: chip.insert }
    : { label: chip.label, group, name: chip.prompt!, kind: 'prompt', insert: `{${chip.prompt}:` });
}

// The palette's order, palette's groups, plus the bare {clipboard} the palette draws inline
// beside "Advanced…" (the chain builder needs its own surface and is not a list entry).
export const TOKEN_CATALOG: CatalogEntry[] = [
  ...entries('Keys & timing', [...KEY_CHIPS, ...MORE_KEY_CHIPS]),
  ...entries('Values', VALUE_CHIPS),
  ...entries('Clipboard', [{ label: 'Clipboard', insert: '{clipboard}' }, ...CLIPBOARD_CHIPS, ...MORE_CLIPBOARD_CHIPS]),
  ...entries('Run state', [...RUN_STATE_CHIPS, ...MORE_ROW_CHIPS]),
];
