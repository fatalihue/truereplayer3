import type { ProfileEntry } from '../../../bridge/messageTypes';

/** The engine's own limits (HandleProfileSetMetadata): its regex, ten tags, 32 characters each. */
export const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 32;
const TAG_REGEX = /^[a-z0-9\-_+.]+$/;
/** How many of the most used tags show as one-click chips, and how many suggestions under the field. */
export const TOP_TAGS = 6;
export const MAX_SUGGESTIONS = 8;

/** Why a tag was not added: the one line under the field. */
export type TagReject = 'invalid' | 'duplicate' | 'full';
export const TAG_MESSAGE: Record<TagReject, string> = {
  invalid: 'Letters, numbers and - _ + . only.',
  duplicate: 'This macro already has that tag.',
  full: 'Ten tags is the maximum.',
};

/**
 * What a person types, folded into what the tag grammar takes (as the Info dialog of today): a
 * space between two words is a hyphen, "diário" is "diario", and the case goes. What survives this
 * and still fails is a genuinely odd tag, which gets a message.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_TAG_LENGTH);
}

/** The tag a typed text adds to `tags`, or why it cannot. */
export function checkTag(raw: string, tags: readonly string[]): { tag: string } | { reject: TagReject } {
  const tag = normalizeTag(raw);
  if (!tag || !TAG_REGEX.test(tag)) return { reject: 'invalid' };
  if (tags.includes(tag)) return { reject: 'duplicate' };
  if (tags.length >= MAX_TAGS) return { reject: 'full' };
  return { tag };
}

/**
 * The tags in use across the library, most used first, counted from the macros the store already
 * holds (every entry carries its tags): what the engine's profile:tagList answers, with no ask.
 * Stored tags are folded on the way in, so a tag written "Produção" counts as "producao".
 */
export function tagsInUse(profiles: readonly ProfileEntry[]): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const p of profiles) {
    for (const raw of p.tags ?? []) {
      const tag = normalizeTag(raw);
      if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// The selector below runs on every store update (a run updates the store each frame): the counting
// is done once per list of macros, and the answer is a string, which compares by value.
let countedFor: readonly ProfileEntry[] | null = null;
let counted = '';
/** tagsInUse as one string ("tag\tcount" per line), for a store selector. */
export function tagsInUseKey(profiles: readonly ProfileEntry[]): string {
  if (profiles !== countedFor) {
    countedFor = profiles;
    counted = tagsInUse(profiles).map(t => `${t.tag}\t${t.count}`).join('\n');
  }
  return counted;
}
export const parseTagsKey = (key: string): { tag: string; count: number }[] =>
  (key ? key.split('\n').map((line) => { const [tag, n] = line.split('\t'); return { tag, count: Number(n) }; }) : []);
