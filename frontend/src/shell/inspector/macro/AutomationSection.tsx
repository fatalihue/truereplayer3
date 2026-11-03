import { useEffect, useState } from 'react';
import { Zap } from 'lucide-react';
import { t } from '../../../i18n';
import { useAutomations } from '../../../logic/useAutomations';
import { cardWords, statusOf } from '../../pages/automations/automationModel';
import { useApp } from '../../store';
import { useUi } from '../../ui';
import { Switch } from '../fields';

/**
 * Macro settings › Automation (the Running board's "Automations"): the macro's automation, one per
 * macro as the engine keeps them — what fires it and its On — with Edit, which opens it in the
 * Automations page; or Add, which makes one there (every 5 minutes, off). Its On here is one of the
 * macro's settings: Ctrl+Z undoes it with the rest, as the engine keeps it in the macro's history.
 */
export function AutomationSection({ name }: { name: string }) {
  const entry = useApp(a => a.automation.entries.find(e => e.profile === name));
  const runAutomations = useApp(a => a.automation.enabled);
  const automations = useAutomations();
  // The switch moves at once and gives way to the engine's echo (rule 3).
  const [sent, setSent] = useState<boolean | null>(null);
  const armed = entry?.trigger.armed ?? false;
  if (sent !== null && sent === armed) setSent(null);
  useEffect(() => {
    if (sent === null) return;
    const id = setTimeout(() => setSent(null), 1000);
    return () => clearTimeout(id);
  }, [sent]);
  const ask = (kind: 'open' | 'create') => useUi.setState({ page: 'automations', automationAsk: { kind, name }, libraryPeek: false });

  if (!entry) {
    return (
      <div className="mset-group">
        <span className="mset-title">{t('macroSettings.automation.title')}</span>
        <div className="mset-target" data-none="">
          <span className="mset-target-text">
            <span className="mset-target-name">{t('macroSettings.automation.none')}</span>
            <span className="mset-target-sub">{t('macroSettings.automation.noneSub')}</span>
          </span>
          <button type="button" className="insp-link" onClick={() => ask('create')}>{t('common.actions.add')}</button>
        </div>
      </div>
    );
  }
  const on = sent ?? armed;
  const status = statusOf({ ...entry, trigger: { ...entry.trigger, armed: on } }, runAutomations);
  const words = cardWords(entry.trigger);
  const blocked = entry.isDisabled && !on;
  return (
    <div className="mset-group">
      <span className="mset-title">{t('macroSettings.automation.title')}</span>
      <div className="mset-target mset-auto">
        <span className="mset-auto-icon" data-tone={status.tone} aria-hidden="true"><Zap /></span>
        <span className="mset-target-text">
          <span className="mset-auto-name">{words.title}</span>
          <span className="mset-target-sub" data-tone={status.group === 'attention' ? 'warn' : undefined}>
            {status.group === 'attention' ? status.text : words.sub}
          </span>
        </span>
        <button type="button" className="insp-link" onClick={() => ask('open')}>{t('common.actions.edit')}</button>
        <Switch
          label={t('macroSettings.automation.on')}
          checked={on}
          disabled={blocked}
          tip={blocked ? t('macroSettings.automation.disabledTip') : undefined}
          onChange={(v) => {
            setSent(v);
            automations.setArmed(name, v);
          }}
        />
      </div>
    </div>
  );
}
