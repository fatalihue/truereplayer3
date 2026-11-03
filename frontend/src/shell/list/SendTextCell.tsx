import type { ActionItem } from '../../bridge/messageTypes';
import { sendTextDeliveryBadge } from '../../components/lexical/deliveryBadge';
import { SendTextPreview } from '../../components/SendTextPreview';
import { t } from '../../i18n';

/**
 * A Send Text step's Details: the text with its tokens as chips, and the delivery badge. Loaded
 * when the list first draws a Send Text step (rule 6): the token grammar it ports from the engine,
 * date formats included, is not part of opening the app. Until then the cell shows the plain text.
 */
export default function SendTextCell({ step }: { step: ActionItem }) {
  return (
    <SendTextPreview
      text={step.key}
      badge={sendTextDeliveryBadge(step)}
      badgeTips={{
        'rich-split': t('list.sendText.badgeRichSplit'),
        'type-drops-rich': t('list.sendText.badgeTypeDropsRich'),
      }}
    />
  );
}
