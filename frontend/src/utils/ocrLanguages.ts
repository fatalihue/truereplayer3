import type { OcrLanguage, OcrLanguagesPayload } from '../bridge/messageTypes';

// OCR language picker labels. Windows' display names carry the region ("English (United
// States)", 176 px) and never fit a settings field, so a pack shows its bare language name —
// "Português", "English" — and the region subtag joins it only when two listed packs share
// that name ("English (US)" + "English (GB)"), the one case where the region tells them apart.
// The full tag would not do: "English (en-US)" is 115 px against the field's ~92 px of text.
export function ocrLanguageOptions(langs: OcrLanguage[]) {
  // Full-width parentheses too: Windows names Chinese "中文(中华人民共和国)".
  const base = (n: string) => n.replace(/\s*[(（].*[)）]\s*$/, '').trim() || n;
  const count = new Map<string, number>();
  for (const l of langs) count.set(base(l.name), (count.get(base(l.name)) ?? 0) + 1);
  return langs.map(l => {
    const b = base(l.name);
    const region = l.tag.split('-').slice(1).join('-') || l.tag;
    return { value: l.tag, label: (count.get(b) ?? 0) > 1 ? `${b} (${region})` : b };
  });
}

// Tags compare case-insensitively: Windows reports "pt-BR", a hand-edited file may say "pt-br".
const sameTag = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// The picker's languages: the ones Settings always offers (Português, English — installable from
// there when missing) first, then any other pack installed on this PC. An offered language keeps
// the OFFERED name whether its pack is installed or not: taking Windows' name for an installed one
// made the same language change name on install ("English" → "Inglês" on a pt-BR Windows, back
// when the C# side sent DisplayName). The installed tag wins (Windows' casing). Both lists come
// from the C# side, so the offer has one source.
export function ocrPickerLanguages(offered: OcrLanguage[], available: OcrLanguage[]): OcrLanguage[] {
  return [
    ...offered.map(o => { const a = available.find(x => sameTag(x.tag, o.tag)); return a ? { tag: a.tag, name: o.name } : o; }),
    ...available.filter(a => !offered.some(o => sameTag(o.tag, a.tag))),
  ];
}

export type OcrLanguageNote =
  | { kind: 'installing' | 'restart'; text: string }
  | { kind: 'missing'; text: string; install: OcrLanguage | null };

// The line under the OCR Language row when the pick is not what a read will use: the pack is
// missing (with Install when it is one Settings offers), being installed, or installed but waiting
// for an app restart. Nothing when the pick is installed — or is Auto with a pack to resolve to.
// "Uses" is the C# side's own answer (effective), not a guess made here. Worded to ONE line beside
// Install: the row leaves 148 px for the text at 11 px ("Not on this PC — reads use Português" was
// 185 and wrapped; "Missing — uses Português" is 128).
export function ocrLanguageNote(pick: string, langs: OcrLanguagesPayload): OcrLanguageNote | null {
  const picker = ocrPickerLanguages(langs.offered, langs.available);
  const label = (tag: string) => {
    const i = picker.findIndex(x => sameTag(x.tag, tag));
    return i >= 0 ? ocrLanguageOptions(picker)[i].label : tag;
  };
  if (!pick) return langs.auto ? null : { kind: 'missing', text: 'No OCR language on this PC', install: null };
  if (langs.available.some(a => sameTag(a.tag, pick))) return null;
  if (langs.installing && sameTag(langs.installing, pick)) return { kind: 'installing', text: 'Installing…' };
  if (langs.pendingRestart.some(t => sameTag(t, pick))) return { kind: 'restart', text: 'Installed — restart TrueReplayer' };
  return {
    kind: 'missing',
    text: langs.effective ? `Missing — uses ${label(langs.effective)}` : 'Missing — no OCR yet',
    install: langs.offered.find(o => sameTag(o.tag, pick)) ?? null,
  };
}
