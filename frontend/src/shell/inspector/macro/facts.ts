import type { ProfileEntry, ProfileOrderData, TriggerMode } from '../../../bridge/messageTypes';
import { asMode } from './target';

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
  /** The window target in effect: the macro's own, its folder's, or none. */
  targetSource: 'own' | 'folder' | null;
  targetFolder: string | null;
  targetProcess: string;
  targetTitle: string;
  targetMode: 'contains' | 'regex';
  /** Its switches: the macro's own with its own target, the folder's with the folder's. */
  targetRelative: boolean;
  targetBringToFocus: boolean;
  targetRestorePosition: boolean;
  targetRestoreSize: boolean;
  /** The target's program icon (a base64 PNG), or null. */
  targetIcon: string | null;
}

export function macroFacts(profiles: readonly ProfileEntry[], order: ProfileOrderData, name: string): MacroFacts | null {
  const e = profiles.find(p => p.name === name);
  if (!e) return null;
  const source = e.hasEffectiveTarget ? (e.effectiveTargetSource ?? (e.hasWindowTarget ? 'own' : null)) : null;
  const folder = source === 'folder' ? order.folders.find(f => f.name === e.effectiveTargetFolderName) : undefined;
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
    targetSource: source,
    targetFolder: source === 'folder' ? e.effectiveTargetFolderName : null,
    targetProcess: (source ? e.effectiveTargetProcessName : null) ?? '',
    targetTitle: (source ? e.effectiveTargetWindowTitle : null) ?? '',
    targetMode: asMode(source ? e.effectiveTargetTitleMatchMode : null),
    targetRelative: source ? e.effectiveUseRelativeCoordinates : false,
    targetBringToFocus: folder ? !!folder.bringToFocus : source === 'own' && e.bringToFocus,
    targetRestorePosition: folder ? !!folder.restorePosition : source === 'own' && e.restorePosition,
    targetRestoreSize: folder ? !!folder.restoreSize : source === 'own' && e.restoreSize,
    targetIcon: source ? e.appIconBase64 : null,
  };
}

export const tagList = (tags: string): string[] => (tags ? tags.split('\n') : []);
