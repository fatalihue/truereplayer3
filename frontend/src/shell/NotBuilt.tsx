import { t } from '../i18n';

/**
 * A part of the new shell that does not exist yet. The plan shows these only in the development
 * build, so the test build the owner opens never carries a "not built yet".
 */
export function NotBuilt({ what }: { what: string }) {
  if (!import.meta.env.DEV) return null;
  return <div className="shell-notbuilt">{t('shell.notBuilt', { what })}</div>;
}
