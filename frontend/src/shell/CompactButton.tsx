import { PictureInPicture2 } from 'lucide-react';
import { t } from '../i18n';
import { useWindow } from '../logic/useWindow';

/**
 * Compact view, on the title bar of every page, beside the caption buttons (rule 10 of the plan;
 * CompactWindow board): the window small and always on top, with the compact layout. It takes the
 * place of Keep on top. Also in Ctrl+K.
 */
export default function CompactButton() {
  const win = useWindow();
  return (
    <button
      type="button"
      className="shell-compact no-drag"
      aria-label={t('titlebar.compact')}
      data-tip={t('titlebar.compactTip')}
      onClick={() => win.setCompact(true)}
    >
      <PictureInPicture2 aria-hidden="true" />
    </button>
  );
}
