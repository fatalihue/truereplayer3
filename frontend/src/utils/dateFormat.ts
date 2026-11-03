// Shared date formatting for the profile-sharing surfaces. formatDate/formatRelative
// lived inline in ImportPreviewDialog since 2.7.2 with a "factor out when a third
// consumer appears" note; formatDateLong was ProfileInfoDialog's private near-twin.
// One home, one 'Unknown'/invalid-ISO policy. The day and the time are written in the
// interface's language (LANG, the build's), and the words come from the catalog (i18n/*/dates.ts).
import { LANG, t } from '../i18n';

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return t('dates.unknown');
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return t('dates.unknown');
    return d.toLocaleDateString(LANG, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return t('dates.unknown');
  }
}

/** Date + time, for the Info tab's Created/Updated fields. */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return t('dates.unknown');
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return t('dates.unknown');
    return d.toLocaleString(LANG, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return t('dates.unknown');
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    const diffMs = Date.now() - d.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return t('dates.justNow');
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return t('dates.minutes', { count: diffMin });
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return t('dates.hours', { count: diffHr });
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return t('dates.days', { count: diffDay });
    const diffMo = Math.floor(diffDay / 30);
    if (diffMo < 12) return t('dates.months', { count: diffMo });
    return t('dates.years', { count: Math.floor(diffMo / 12) });
  } catch {
    return '';
  }
}
