import { useState, useEffect, useRef, useMemo } from 'react';
import { Info, Smile, Hash, X, AlertTriangle } from 'lucide-react';
import EmojiPicker, { Theme as EmojiTheme, EmojiStyle } from 'emoji-picker-react';
import { DialogShell, DialogFooter  } from './common/DialogShell';
import { FieldError } from './common/FieldError';
import { Button } from './common/Button';
import { splitCombo } from './common/KbdTag';
import { compactKey } from '../utils/keyNames';
import { useBridge } from '../bridge/BridgeContext';
import { useAppState } from '../state/AppStateContext';
import { useTt } from '../state/LanguageContext';
import type { ProfileMetadataPayload, TagListEntry } from '../bridge/messageTypes';
import { formatDateLong } from '../utils/dateFormat';

interface ProfileInfoDialogProps {
  /** Profile name to edit metadata for. Triggers a profile:getMetadata fetch on mount. */
  profileName: string;
  onClose: () => void;
}

/** Matches HandleProfileSetMetadata's own 500-char cut. The UI used to stop at 200, so 300 of the
 *  characters the backend accepts were unreachable — a limit on each side and neither the truth. */
const MAX_DESCRIPTION = 500;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 32;
/** Same regex the backend uses to validate tags. Keep in sync with HandleProfileSetMetadata. */
const TAG_REGEX = /^[a-z0-9\-_+.]+$/;
/** How many "most used" tags to offer as one-click chips. */
const TOP_TAG_CHIPS = 6;

/**
 * Fold what a person actually types into what the tag grammar accepts.
 *
 * The grammar is `a-z 0-9 . - _ +`, which rejects a space AND an accent — the two first things
 * anyone types in a pt-BR app ("backup diário", "produção"). Before this, `addTag` simply
 * returned on a reject: the counter did not move, the text stayed in the field, and nothing said
 * why. Converting is better than refusing here because the intent is never ambiguous — a space
 * between two words is a hyphen, "diário" is "diario" — and what survives conversion and still
 * fails is a genuinely odd tag, which now gets a message.
 */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    // NFD splits a letter from its accent; the range is the combining-marks block.
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, MAX_TAG_LENGTH);
}

/** Why a tag was not added — drives the one-line message under the field. */
type TagReject = 'invalid' | 'duplicate' | 'full';

/**
 * Profile Info editor. Two halves that answer two different questions:
 *   - EDITABLE sharing metadata: icon emoji, description, tags.
 *   - READ-ONLY facts about the profile itself: what it contains, and its history.
 *
 * The read-only half is the later addition. The dialog is called "Info" and is where someone
 * goes to understand a profile they have not opened in months — and it used to answer only
 * "created / updated / min app version", nothing about the actions, the hotkey or the target.
 * Everything it now shows comes from the ProfileEntry the sidebar already holds, so it costs no
 * extra round-trip.
 *
 * Save model: the dialog edits a local copy and only calls profile:setMetadata when the user
 * clicks Save. Leaving with unsaved edits asks first (canClose) — the same three-way prompt the
 * Send Text and Automation editors use.
 */
export function ProfileInfoDialog({ profileName, onClose }: ProfileInfoDialogProps) {
  const { send, subscribe } = useBridge();
  const { profiles, profileOrder } = useAppState();
  const tt = useTt();

  const [loaded, setLoaded] = useState(false);
  const [original, setOriginal] = useState<ProfileMetadataPayload | null>(null);

  // Edit-buffer state
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState('');
  const [tagError, setTagError] = useState<TagReject | null>(null);
  const [iconEmoji, setIconEmoji] = useState<string | null>(null);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  // Tag autocomplete source — populated on mount from profile:listTags.
  const [allTags, setAllTags] = useState<TagListEntry[]>([]);
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  // Which suggestion the arrow keys are on. -1 = none, and Enter then commits the DRAFT.
  const [activeSuggestion, setActiveSuggestion] = useState(-1);

  const tagInputRef = useRef<HTMLInputElement>(null);

  // The sidebar's own row for this profile — every read-only fact below comes from here.
  const entry = useMemo(() => profiles.find(p => p.name === profileName), [profiles, profileName]);
  const folderName = useMemo(
    () => profileOrder?.folders?.find(f => f.items.includes(profileName))?.name ?? null,
    [profileOrder, profileName],
  );

  // Fetch metadata + tag list on mount. Re-fetches if the profile name changes
  // (caller usually unmounts/remounts, but guard for hot-reload).
  useEffect(() => {
    send({ type: 'profile:getMetadata', payload: { name: profileName } });
    send({ type: 'profile:listTags', payload: {} });
  }, [profileName, send]);

  // Subscribe to bridge replies — handles both the metadata and the tag list.
  useEffect(() => {
    return subscribe((msg) => {
      if (msg.type === 'profile:metadata' && msg.payload.name === profileName) {
        const m = msg.payload;
        setOriginal(m);
        setDescription(m.description ?? '');
        setTags(m.tags ?? []);
        setIconEmoji(m.iconEmoji ?? null);
        setLoaded(true);
      } else if (msg.type === 'profile:tagList') {
        setAllTags(msg.payload.tags);
      }
      // profile:versionBumped intentionally not consumed in 2.2.0 — the bump UI was removed.
      // Re-add the handler when the share-via-link / marketplace path resurfaces the bump button.
    });
  }, [subscribe, profileName]);

  // Autocomplete candidates: filter local-known tags by the current draft, exclude
  // already-selected ones. Cap at 8 suggestions so the dropdown stays compact.
  const suggestions = useMemo(() => {
    const draft = normalizeTag(tagDraft);
    return allTags
      .filter(t => !tags.includes(t.tag))
      .filter(t => draft === '' || t.tag.includes(draft))
      .slice(0, 8);
  }, [allTags, tags, tagDraft]);

  // The backend sorts profile:tagList by usage, so "most used" is just the head of what is
  // still unused here. Offered as chips because consistent tags across profiles are the whole
  // point of the sidebar's #tag search — and remembering a tag is the part people get wrong.
  const topTags = useMemo(
    () => allTags.filter(t => !tags.includes(t.tag)).slice(0, TOP_TAG_CHIPS),
    [allTags, tags],
  );

  // The arrow keys move within a list that the draft reshapes, so the highlight has to go home
  // whenever the list can have changed — otherwise index 3 of the old list commits a tag the
  // user is no longer looking at.
  useEffect(() => { setActiveSuggestion(-1); }, [tagDraft, tags]);

  const addTag = (raw: string): TagReject | null => {
    const cleaned = normalizeTag(raw);
    if (!cleaned || !TAG_REGEX.test(cleaned)) return 'invalid';
    if (tags.includes(cleaned)) return 'duplicate';
    if (tags.length >= MAX_TAGS) return 'full';
    setTags(prev => [...prev, cleaned]);
    setTagDraft('');
    setTagError(null);
    return null;
  };

  /** Add and report — the single place a rejection becomes a visible message. */
  const commitTag = (raw: string) => { setTagError(addTag(raw)); };

  const removeTag = (tag: string) => {
    setTags(prev => prev.filter(t => t !== tag));
    setTagError(null);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Arrow keys drive the suggestion list. Without them the dropdown was mouse-only: with
    // "planilha" listed and "pl" typed, Enter added the literal "pl" and the suggestion could
    // only be reached with the pointer.
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && showTagSuggestions && suggestions.length > 0) {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActiveSuggestion(i => {
        const next = i + step;
        if (next < 0) return suggestions.length - 1;
        if (next >= suggestions.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === 'Enter' || e.key === ',' || e.key === 'Tab') {
      // The highlighted suggestion wins; with no highlight, the typed draft.
      const picked = activeSuggestion >= 0 ? suggestions[activeSuggestion]?.tag : null;
      if (picked) {
        e.preventDefault();
        commitTag(picked);
      } else if (tagDraft.trim()) {
        e.preventDefault();
        commitTag(tagDraft);
      }
    } else if (e.key === 'Backspace' && tagDraft === '' && tags.length > 0) {
      // Backspace on empty input removes the last tag — matches GitHub / Twitter UX.
      removeTag(tags[tags.length - 1]);
    } else if (e.key === 'Escape' && showTagSuggestions) {
      // Escape with the suggestion dropdown open closes just the dropdown —
      // stopPropagation keeps DialogShell's Esc handler from also closing the
      // dialog. With the dropdown closed we don't handle Esc here at all, so
      // it bubbles to the shell and dismisses the dialog normally.
      e.preventDefault();
      e.stopPropagation();
      setShowTagSuggestions(false);
    }
  };

  // Is there work that leaving would destroy? A half-typed tag does not count — Save commits it.
  const dirty = loaded && (
    description !== (original?.description ?? '')
    || JSON.stringify(tags) !== JSON.stringify(original?.tags ?? [])
    || (iconEmoji ?? null) !== (original?.iconEmoji ?? null)
  );

  const handleSave = () => {
    // A tag typed but never confirmed is still work the user did — committing it here is why
    // `dirty` can ignore the draft. Computed locally because setTags would not have flushed.
    const pending = normalizeTag(tagDraft);
    const finalTags = pending && TAG_REGEX.test(pending) && !tags.includes(pending) && tags.length < MAX_TAGS
      ? [...tags, pending]
      : tags;

    // Only send fields that actually changed — keeps the diff minimal and avoids
    // touching UpdatedAt when the user just opened the dialog and closed it.
    const payload: { name: string; description?: string | null; tags?: string[] | null; iconEmoji?: string | null } = {
      name: profileName,
    };
    if (description !== (original?.description ?? '')) {
      payload.description = description.trim() || null;
    }
    const originalTags = JSON.stringify(original?.tags ?? []);
    const currentTags = JSON.stringify(finalTags);
    if (originalTags !== currentTags) {
      payload.tags = finalTags.length > 0 ? finalTags : null;
    }
    if ((iconEmoji ?? null) !== (original?.iconEmoji ?? null)) {
      payload.iconEmoji = iconEmoji;
    }

    if (Object.keys(payload).length > 1) {
      send({ type: 'profile:setMetadata', payload });
    }
    onClose();
  };

  // The emoji picker (emoji-picker-react) swallows Escape internally to clear its own search box,
  // so the key never reaches the card's keydown handlers. Catch it at the document level in
  // CAPTURE phase while the picker is open and close it ourselves before the picker's handler
  // runs. The stopPropagation also keeps DialogShell's Esc handler from closing the whole
  // dialog — while the picker is open, Esc means "close the picker", not "close the dialog".
  useEffect(() => {
    if (!showEmojiPicker) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setShowEmojiPicker(false);
      }
    };
    document.addEventListener('keydown', onEsc, true);
    return () => document.removeEventListener('keydown', onEsc, true);
  }, [showEmojiPicker]);

  // The picker's own light/dark, taken from the APP's theme rather than a literal. It was pinned
  // to DARK, so on any of the five light presets a 320 px black panel opened inside a light card.
  // `color-scheme` on the root is the app's OWN answer (applyThemeConfig writes it from the base
  // surface), so reading it here cannot drift from the palette the dialog is painted in —
  // EmojiTheme.AUTO would follow the OS instead, which has nothing to do with the chosen preset.
  const [pickerTheme, setPickerTheme] = useState<EmojiTheme>(EmojiTheme.DARK);
  useEffect(() => {
    if (!showEmojiPicker) return;
    const scheme = getComputedStyle(document.documentElement).colorScheme || '';
    setPickerTheme(scheme.includes('light') ? EmojiTheme.LIGHT : EmojiTheme.DARK);
  }, [showEmojiPicker]);

  const TAG_MESSAGE: Record<TagReject, string> = {
    invalid: tt('Letters, numbers and - _ + . only.', 'Apenas letras, números e - _ + .'),
    duplicate: tt('This profile already has that tag.', 'Este profile já tem essa tag.'),
    full: tt('Ten tags is the maximum.', 'Dez tags é o máximo.'),
  };

  return (
    <>
    <DialogShell
      icon={<Info size={14} style={{ color: 'var(--color-accent)' }} />}
      title={`Profile Info — ${profileName}`}
      // Pre-close veto, NOT an onClose that declines: DialogShell's onClose runs after it has
      // committed to leaving. Without this, Esc and Cancel threw away an edited description in
      // silence — while closeOnBackdrop=false below existed precisely so a stray click could not.
      canClose={() => {
        if (confirmDiscard) return false;
        if (!dirty) return true;
        setConfirmDiscard(true);
        return false;
      }}
      onClose={onClose}
      // closeOnBackdrop=false: multi-field metadata form (description text,
      // tags, icon emoji) — a stray click on the scrim must not discard
      // unsaved edits. Dismissal is Esc or Cancel; Save commits.
      closeOnBackdrop={false}
      // Ctrl+Enter saves, like the Data panel and Insert Text. A bare Enter belongs to the
      // textarea (it makes a paragraph) and to the tag field, so the modifier is the only
      // spelling available here — DialogShell forwards Enter WITH a modifier on purpose.
      onCardKeyDown={(e) => {
        if (e.key === 'Enter' && e.ctrlKey) {
          e.preventDefault();
          if (loaded) handleSave();
        }
      }}
      // max-h keeps the card inside the viewport so the body below can scroll.
      // `relative` is the anchor for the emoji picker, which is positioned against the CARD
      // rather than the body: inside the body it was a normal flex child and grew the dialog by
      // ~340 px on open (dialog height must never change with state), and an absolute inside the
      // body would be clipped by that body's own overflow-y-auto.
      size="lg"
      cardClassName="max-h-[90vh] relative"
      footer={<DialogFooter secondary={{ label: 'Cancel', onClick: onClose }} primary={{ label: 'Save', onClick: handleSave, disabled: !loaded }} />}
    >
        {/* Body */}
        {/* min-h: the loading placeholder is as tall as the loaded form, so the card does not
            grow by ~400 px the moment the metadata arrives. */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-[27rem]">
          {!loaded ? (
            <div className="text-xs text-text-tertiary py-4 text-center">Loading…</div>
          ) : (
            <>
              {/* Icon. The Version readout that used to sit beside it moved down into HISTORY:
                  the Bump button went away in 2.2.0 (nothing consumes "newer version available"
                  yet), so a bare number was taking half of the app's most prominent row to say
                  something no one can act on. Among the other read-only facts it reads as one. */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-tertiary uppercase tracking-wide">Icon</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowEmojiPicker(v => !v)}
                    className="w-12 h-12 flex items-center justify-center text-2xl bg-bg-input border border-border-subtle rounded hover:border-accent-solid transition-colors"
                  >
                    {iconEmoji || <Smile size={18} className="text-text-tertiary" />}
                  </button>
                  {iconEmoji && (
                    <button
                      type="button"
                      onClick={() => setIconEmoji(null)}
                      className="text-[11px] text-text-tertiary hover:text-text-primary transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* Description */}
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-text-tertiary uppercase tracking-wide">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, MAX_DESCRIPTION))}
                  placeholder="What does this profile do?"
                  rows={4}
                  className="w-full px-3 py-2 text-xs text-text-primary bg-bg-input border border-border-subtle rounded outline-none focus:border-accent-solid placeholder:text-text-disabled transition-colors resize-none"
                />
                <div className="text-[10px] text-text-tertiary text-right">
                  {description.length} / {MAX_DESCRIPTION}
                </div>
              </div>

              {/* Tags */}
              <div className="flex flex-col gap-1 relative">
                <label className="text-[11px] text-text-tertiary uppercase tracking-wide">Tags</label>
                <div className="flex flex-wrap gap-1 px-2 py-2 bg-bg-input border border-border-subtle rounded focus-within:border-accent-solid transition-colors">
                  {tags.map(t => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-bg-surface text-text-primary border border-border-subtle"
                    >
                      <Hash size={10} className="text-text-tertiary" />
                      {t}
                      <button
                        type="button"
                        onClick={() => removeTag(t)}
                        className="hover:text-warning-ink transition-colors"
                      >
                        <X size={10} />
                      </button>
                    </span>
                  ))}
                  <input
                    ref={tagInputRef}
                    type="text"
                    value={tagDraft}
                    onChange={(e) => { setTagDraft(e.target.value.toLowerCase()); setTagError(null); }}
                    onKeyDown={handleTagKeyDown}
                    onFocus={() => setShowTagSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowTagSuggestions(false), 150)}
                    placeholder={tags.length === 0 ? 'Add a tag…' : ''}
                    disabled={tags.length >= MAX_TAGS}
                    role="combobox"
                    aria-expanded={showTagSuggestions && suggestions.length > 0}
                    aria-controls="tag-suggestions"
                    // Same VERTICAL box as a chip — text size, py and a transparent border — so the
                    // row is one chip tall whether or not any chip is in it. Without this the box
                    // jumped 7 px the moment the first tag landed, which re-centres the card in
                    // its scrim ([[feedback-dialog-height-fixed]]).
                    // The chip's ingredients rather than a min-h in pixels: a number here would be
                    // a second source of truth for the chip's height, and would drift silently the
                    // day the chip's padding or text size changes. Measured equal at 12, 14 and
                    // 17 px of --ui-font-size.
                    // Chips wrapping to a SECOND line still grows the box — that is what a wrapping
                    // field does, and no reserve can honestly prevent it.
                    className="flex-1 min-w-[100px] bg-transparent text-[11px] py-0.5 border border-transparent text-text-primary outline-none placeholder:text-text-disabled disabled:opacity-50"
                  />
                </div>

                {/* ONE always-mounted line: the hint at rest, the rejection when there is one.
                    The counter rides the same row, so nothing here can change the card's height
                    while the user types ([[convention-reserved-validation-line]]). */}
                <div className="flex items-start justify-between gap-2">
                  <FieldError
                    show
                    className={`text-[10px] mt-0 flex-1 min-w-0 ${tagError ? 'text-recording' : 'text-text-tertiary'}`}
                    tip={tagError ? TAG_MESSAGE[tagError] : undefined}
                  >
                    {tagError
                      ? TAG_MESSAGE[tagError]
                      : tt('Press Enter or comma to add. Spaces and accents are converted.',
                          'Enter ou vírgula para adicionar. Espaço e acento são convertidos.')}
                  </FieldError>
                  <span className="text-[10px] text-text-tertiary shrink-0 tabular-nums">{tags.length} / {MAX_TAGS}</span>
                </div>

                {/* Most-used tags, one click each. Always mounted — an invisible placeholder chip
                    holds the row when there is nothing left to offer, so the card does not
                    resize as the last suggestion is consumed. */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className={`text-[10px] text-text-tertiary shrink-0 ${topTags.length ? '' : 'invisible'}`}>
                    {tt('Most used', 'Mais usadas')}
                  </span>
                  {topTags.length > 0 ? topTags.map(t => (
                    <button
                      key={t.tag}
                      type="button"
                      onClick={() => commitTag(t.tag)}
                      disabled={tags.length >= MAX_TAGS}
                      data-tip={tt(`Used by ${t.count} profiles`, `Usada em ${t.count} profiles`)}
                      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded border border-border-subtle text-text-secondary hover:border-accent-solid hover:text-text-primary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Hash size={9} className="text-text-tertiary" />{t.tag}
                    </button>
                  )) : (
                    <span aria-hidden="true" className="invisible inline-flex px-1.5 py-0.5 text-[10px] border">·</span>
                  )}
                </div>

                {/* Autocomplete dropdown */}
                {showTagSuggestions && suggestions.length > 0 && (
                  <div id="tag-suggestions" role="listbox" className="absolute top-full mt-1 left-0 right-0 z-10 menu-surface max-h-[180px] overflow-y-auto">
                    {suggestions.map((s, i) => (
                      <button
                        key={s.tag}
                        type="button"
                        role="option"
                        aria-selected={i === activeSuggestion}
                        onMouseEnter={() => setActiveSuggestion(i)}
                        onMouseDown={(e) => {
                          // onMouseDown (not onClick) so it fires before input blur clears the dropdown.
                          e.preventDefault();
                          commitTag(s.tag);
                          tagInputRef.current?.focus();
                        }}
                        className={`w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors ${
                          i === activeSuggestion ? 'bg-bg-surface text-text-primary' : 'text-text-secondary hover:bg-bg-surface'
                        }`}
                      >
                        <span className="flex items-center gap-1.5">
                          <Hash size={10} className="text-text-tertiary" />
                          {s.tag}
                        </span>
                        <span className="text-[10px] text-text-tertiary">
                          used {s.count}×
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── What the profile CONTAINS ──
                  Everything here rides in the profiles:updated payload the sidebar already holds,
                  so none of it costs a round-trip. Every field is always rendered, with an em dash
                  when unset: a block that drops rows for a profile without a hotkey would make two
                  profiles' dialogs different heights for no reason the reader can see. */}
              <div className="pt-2 border-t border-border-subtle">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">Contents</div>
                <div className="grid grid-cols-2 gap-3">
                  <ReadOnlyField label="Actions" value={entry?.actionCount != null ? String(entry.actionCount) : '—'} />
                  <ReadOnlyField label="Hotkey" value={entry?.hotkey ? splitCombo(entry.hotkey).map(compactKey).join(' + ') : '—'} />
                  <ReadOnlyField
                    label="Hotstring"
                    value={entry?.hotstring ? `${entry.hotstringInstant ? '⚡' : '↵'} ${entry.hotstring}` : '—'}
                  />
                  <ReadOnlyField
                    label="Window target"
                    value={targetLabel(entry?.effectiveTargetProcessName, entry?.effectiveTargetWindowTitle, entry?.hasEffectiveTarget)}
                    hint={entry?.effectiveTargetSource === 'folder' && entry.effectiveTargetFolderName
                      ? `Inherited from ${entry.effectiveTargetFolderName}`
                      : undefined}
                  />
                  <ReadOnlyField label="Folder" value={folderName ?? '—'} />
                  <ReadOnlyField
                    label="Automation"
                    value={!entry?.hasTrigger ? '—' : entry.triggerArmed ? 'Armed' : 'Configured, not armed'}
                  />
                </div>
              </div>

              {/* ── History ── */}
              <div className="pt-2 border-t border-border-subtle">
                <div className="text-[10px] text-text-tertiary uppercase tracking-wide mb-2">History</div>
                <div className="grid grid-cols-2 gap-3">
                  <ReadOnlyField label="Created" value={formatDateLong(original?.createdAt)} />
                  <ReadOnlyField label="Updated" value={formatDateLong(original?.updatedAt)} />
                  {/* Display-only. The Bump UI went away in 2.2.0 because the app has no
                      update-detection consumer yet — the profile:bumpVersion bridge handler is
                      still there for when share-via-link / marketplace makes it mean something. */}
                  <ReadOnlyField label="Profile version" value={`v${original?.profileVersion ?? 1}`} />
                  <ReadOnlyField
                    label="Min app version"
                    value={original?.appMinVersion ?? 'Any'}
                    hint={
                      original?.appMinVersionContributors && original.appMinVersionContributors.length > 0
                        ? `Required by: ${original.appMinVersionContributors.join(', ')}`
                        : undefined
                    }
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Emoji picker — a SIBLING of the scrolling body and absolutely positioned against the
            card. Two constraints meet here: out of flow so opening it cannot change the dialog's
            height (the house rule), and outside the body so the body's overflow-y-auto cannot
            clip the bottom of a 320 px picker. Still inside the card, so DialogShell's Tab trap —
            which enumerates the card only — keeps the picker's search field reachable. `top` is
            the header (49 px) plus the icon row; Esc is handled by this dialog's own listener. */}
        {showEmojiPicker && (
          <div className="absolute left-4 right-4 top-[7.5rem] z-30 border border-border-subtle rounded overflow-hidden bg-bg-card shadow-[var(--shadow-dialog)]">
            <EmojiPicker
              onEmojiClick={(emojiData) => {
                setIconEmoji(emojiData.emoji);
                setShowEmojiPicker(false);
              }}
              theme={pickerTheme}
              emojiStyle={EmojiStyle.NATIVE}
              width="100%"
              height={320}
              previewConfig={{ showPreview: false }}
              searchPlaceholder="Search emoji…"
            />
          </div>
        )}
    </DialogShell>

    {/* Leaving with unsaved edits. Same three-way shape as the Send Text and Automation prompts —
        and, like those, a SIBLING shell at a higher layer rather than something inside the card. */}
    {confirmDiscard && (
      <DialogShell
        icon={<AlertTriangle size={14} style={{ color: 'var(--color-warning-ink)' }} />}
        title="Unsaved info"
        size="sm"
        zClass="z-[60]"
        onClose={() => setConfirmDiscard(false)}
        footer={
          <DialogFooter
            secondary={{ label: 'Keep editing', onClick: () => setConfirmDiscard(false), autoFocus: true }}
            extra={<Button variant="destructiveText" size="md" onClick={() => { setConfirmDiscard(false); onClose(); }}>Discard</Button>}
            primary={{ label: 'Save', onClick: () => { setConfirmDiscard(false); handleSave(); } }}
          />
        }
      >
        <p className="px-4 py-4 text-xs text-text-secondary leading-relaxed">
          Unsaved changes will be lost — icon, description and tags.
        </p>
      </DialogShell>
    )}
    </>
  );
}

/** What the sidebar row calls the target, in the dialog's own voice. */
function targetLabel(procName?: string | null, windowTitle?: string | null, has?: boolean): string {
  if (!has) return '—';
  if (procName) return /\.exe$/i.test(procName) ? procName : `${procName}.exe`;
  if (windowTitle) return windowTitle;
  return 'Window target';
}

function ReadOnlyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <label className="text-[10px] text-text-tertiary uppercase tracking-wide">{label}</label>
      <span className="text-xs text-text-secondary truncate" data-tip={value.length > 28 ? value : undefined}>{value}</span>
      {hint && <span className="text-[10px] text-text-tertiary truncate" data-tip={hint}>{hint}</span>}
    </div>
  );
}
