// ── Snippet export / import ──────────────────────────────────────────────────
//
// Snippets lived in localStorage and nowhere else. Profiles export, themes export, snippets did
// not — so a reinstall, a new machine or cleared site data lost the library with no warning and
// no way back.
//
// MECHANISM: the browser path (Blob + a.download to save, <input type="file"> + FileReader to
// load), which is exactly what ThemeEditor already does. The bridge is NOT reusable here:
// `dialog:pickFile` hardcodes an executable picker and returns a PATH with no read handler
// behind it, and `profile:export` exists because the BACKEND owns profile data — it has to read
// reference PNGs and recompute the compatibility floor. Snippets are frontend-only data, so
// round-tripping them through the host would buy nothing and add two message types.
//
// The pure functions live here, free of React and of the DOM, so the envelope rules are testable
// without a browser.

export interface Snippet {
  id: string;
  name: string;
  text: string;
  html?: string;
}

/** Versioned envelope. `kind` guards against importing a THEME file by mistake — both are .json
 *  and both come out of this app, so the extension proves nothing. */
export interface SnippetExport {
  kind: 'truereplayer-snippets';
  version: 1;
  snippets: Snippet[];
}

export const SNIPPET_EXPORT_KIND = 'truereplayer-snippets';

export function buildSnippetExport(snippets: Snippet[]): SnippetExport {
  return { kind: SNIPPET_EXPORT_KIND, version: 1, snippets };
}

export type ImportFailure =
  | 'not-json'
  | 'not-a-snippet-file'
  | 'unsupported-version'
  | 'no-snippets';

export type ImportResult =
  | { ok: true; snippets: Snippet[]; skipped: number }
  | { ok: false; reason: ImportFailure };

/**
 * Parse and VALIDATE a hand-editable file. Every field is re-checked rather than trusted: this
 * text can have been edited by hand, produced by an older build, or be a theme file that happens
 * to parse. An entry that fails is skipped and counted, not silently repaired — a snippet whose
 * text was dropped would insert nothing and look like a bug in the editor.
 */
export function parseSnippetImport(json: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, reason: 'not-json' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-a-snippet-file' };
  }
  const env = parsed as Partial<SnippetExport>;
  if (env.kind !== SNIPPET_EXPORT_KIND) return { ok: false, reason: 'not-a-snippet-file' };
  // Forward-compatible refusal: a file from a LATER build may carry fields this one would drop on
  // the next save, so it is refused rather than half-read.
  if (env.version !== 1) return { ok: false, reason: 'unsupported-version' };
  if (!Array.isArray(env.snippets)) return { ok: false, reason: 'not-a-snippet-file' };

  const good: Snippet[] = [];
  let skipped = 0;
  for (const raw of env.snippets) {
    if (!raw || typeof raw !== 'object') { skipped++; continue; }
    const s = raw as Partial<Snippet>;
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    const text = typeof s.text === 'string' ? s.text : '';
    // Both are required by the save path (handleSaveSnippet refuses an empty either), so an entry
    // missing one could never have been created here.
    if (!name || !text.trim()) { skipped++; continue; }
    good.push({
      // Ids are re-minted by the caller on merge; keeping the incoming one here lets a
      // replace-import round-trip a file unchanged.
      id: typeof s.id === 'string' && s.id ? s.id : '',
      name,
      text,
      ...(typeof s.html === 'string' && s.html ? { html: s.html } : {}),
    });
  }
  if (good.length === 0) return { ok: false, reason: 'no-snippets' };
  return { ok: true, snippets: good, skipped };
}

/** A fresh id, matching the save path's generator (crypto.randomUUID with a timestamp fallback). */
export function newSnippetId(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Merge imported snippets into the existing library.
 *
 * Ids are re-minted for every incoming snippet whose id collides with one already present — two
 * libraries built independently can hold the same id (the fallback generator is a timestamp), and
 * a duplicate key would make React reuse the wrong row. Names are NOT deduplicated: two snippets
 * may legitimately share a name, and silently dropping one would lose the user's work.
 */
export function mergeSnippets(existing: Snippet[], incoming: Snippet[]): Snippet[] {
  const taken = new Set(existing.map((s) => s.id));
  const added = incoming.map((s) => {
    const id = s.id && !taken.has(s.id) ? s.id : newSnippetId();
    taken.add(id);
    return { ...s, id };
  });
  return [...existing, ...added];
}

/** Filename for the saved file — same slug shape ThemeEditor uses. */
export function snippetExportFilename(now: Date): string {
  const p = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `truereplayer-snippets-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}.json`;
}
