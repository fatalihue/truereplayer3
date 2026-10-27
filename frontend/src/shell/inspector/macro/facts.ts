import type { ProfileEntry, TriggerMode } from '../../../bridge/messageTypes';

/**
 * What the macro's settings show of its library entry, in plain values. A switch brings a whole new
 * library (profiles:updated, new objects every time); read through useShallow, these settle on the
 * same value when nothing they show changed, so the settings do not draw again with the new list.
 */
export interface MacroFacts {
  name: string;
  hotkey: string | null;
  triggerMode: TriggerMode;
  hotstring: string | null;
  hotstringInstant: boolean;
  description: string | null;
  /** The tags, one per line (a string, so it compares by value). */
  tags: string;
  iconEmoji: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  profileVersion: number;
  appMinVersion: string | null;
}

export function macroFacts(profiles: readonly ProfileEntry[], name: string): MacroFacts | null {
  const e = profiles.find(p => p.name === name);
  if (!e) return null;
  return {
    name: e.name,
    hotkey: e.hotkey || null,
    triggerMode: e.triggerMode ?? 'onPress',
    hotstring: e.hotstring || null,
    hotstringInstant: e.hotstringInstant,
    description: e.description || null,
    tags: (e.tags ?? []).join('\n'),
    iconEmoji: e.iconEmoji || null,
    createdAt: e.createdAt ?? null,
    updatedAt: e.updatedAt ?? null,
    profileVersion: e.profileVersion ?? 1,
    appMinVersion: e.appMinVersion ?? null,
  };
}

export const tagList = (tags: string): string[] => (tags ? tags.split('\n') : []);
