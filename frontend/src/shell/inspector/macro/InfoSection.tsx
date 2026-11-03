import { useEffect, useRef, useState } from 'react';
import { useBridge } from '../../../bridge/BridgeContext';
import { fmtNum, t } from '../../../i18n';
import { useMacro } from '../../../logic/useMacro';
import { formatDateLong } from '../../../utils/dateFormat';
import { settingsFocused, type SettingsSection } from '../../ui';
import { DraftField, Section } from '../fields';
import { tagList, type MacroFacts } from './facts';
import { IconPicker } from './IconPicker';
import { TagEditor } from './TagEditor';

/** The engine's own cut (HandleProfileSetMetadata). */
const MAX_DESCRIPTION = 500;

/**
 * Macro settings › Info (D6): the icon, the description and the #tags, each applied as it changes,
 * and the history, only to read. Today's Profile Info dialog had Save and Cancel; here Ctrl+Z
 * undoes (the engine keeps the info in the macro's history).
 */
export function InfoSection({ facts, locked, focus }: { facts: MacroFacts; locked: boolean; focus: { section: SettingsSection; seq: number } | null }) {
  const macro = useMacro();
  const name = facts.name;
  const [typed, setTyped] = useState<string | null>(null);
  // What was sent shows (and counts) until the engine's echo carries it, as the field itself does.
  const [sent, setSent] = useState<string | null>(null);
  if (sent !== null && (facts.description ?? '') === (sent.trim() || '')) setSent(null);
  useEffect(() => {
    if (sent === null) return;
    const id = setTimeout(() => setSent(null), 1000);
    return () => clearTimeout(id);
  }, [sent]);
  const description = typed ?? sent ?? facts.description ?? '';
  const over = description.length - MAX_DESCRIPTION;

  // Edit info… from the macro's menu (or Ctrl+K) brings the focus to the description.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!focus) return;
    const field = boxRef.current?.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${t('macroSettings.info.description')}"]`);
    field?.focus();
    field?.scrollIntoView({ block: 'nearest' });
    settingsFocused();
  }, [focus]);

  return (
    <div ref={boxRef} className="mset-group">
      <span className="mset-title">{t('macroSettings.info.title')}</span>
      <Section label={t('macroSettings.info.icon')}>
        <IconPicker value={facts.iconEmoji} disabled={locked} onPick={(iconEmoji) => macro.setInfo({ name, iconEmoji })} />
      </Section>
      <Section
        label={t('macroSettings.info.description')}
        hint={over > 0
          ? <span data-error="">{t('macroSettings.info.tooLong', { count: over, n: fmtNum(over) })}</span>
          : `${description.length} / ${MAX_DESCRIPTION}`}
      >
        <DraftField
          stepId={`macro:${name}`}
          field="description"
          label={t('macroSettings.info.description')}
          kind="text"
          multiline
          placeholder={t('macroSettings.info.descriptionPlaceholder')}
          maxLength={MAX_DESCRIPTION}
          stored={facts.description ?? ''}
          disabled={locked}
          parse={(text) => (text.length > MAX_DESCRIPTION ? null : text)}
          onText={setTyped}
          onApply={(text) => { setSent(text); macro.setInfo({ name, description: text.trim() || null }); }}
        />
      </Section>
      <Section label={t('macroSettings.info.tags')}>
        <TagEditor tags={tagList(facts.tags)} disabled={locked} onChange={(tags) => macro.setInfo({ name, tags: tags.length > 0 ? tags : null })} />
      </Section>
      <History facts={facts} />
    </div>
  );
}

/**
 * The history, only to read (D6): created, changed, the macro's version and the app version it
 * needs. What pins that version is worked out from the file, so it is asked for when the history
 * is opened, not with every macro.
 */
function History({ facts }: { facts: MacroFacts }) {
  const macro = useMacro();
  const { subscribe } = useBridge();
  const [open, setOpen] = useState(false);
  const [requiredBy, setRequiredBy] = useState<{ name: string; list: string[] } | null>(null);
  const name = facts.name;

  useEffect(() => {
    if (!open) return;
    const off = subscribe((m) => {
      if (m.type === 'profile:metadata' && m.payload.name === name && m.payload.found) {
        setRequiredBy({ name, list: m.payload.appMinVersionContributors ?? [] });
      }
    });
    macro.requestMetadata(name);
    return off;
  }, [open, name, macro, subscribe]);
  const contributors = requiredBy?.name === name ? requiredBy.list : [];

  return (
    <div className="mset-history">
      <button type="button" className="insp-link" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        {open ? t('macroSettings.info.hideHistory') : t('macroSettings.info.history')}
      </button>
      {open && (
        <dl className="mset-facts">
          <dt>{t('macroSettings.info.created')}</dt>
          <dd>{formatDateLong(facts.createdAt)}</dd>
          <dt>{t('macroSettings.info.updated')}</dt>
          <dd>{formatDateLong(facts.updatedAt)}</dd>
          <dt>{t('macroSettings.info.version')}</dt>
          <dd>v{facts.profileVersion}</dd>
          <dt>{t('macroSettings.info.minAppVersion')}</dt>
          <dd>
            {facts.appMinVersion ?? t('macroSettings.info.anyVersion')}
            {contributors.length > 0 && <span className="mset-facts-why">{t('macroSettings.info.requiredBy', { list: contributors.join(', ') })}</span>}
          </dd>
        </dl>
      )}
    </div>
  );
}
