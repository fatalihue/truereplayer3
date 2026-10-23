import type { ActionItem } from '../../bridge/messageTypes';
import { sendTextDeliveryBadge } from '../../components/lexical/deliveryBadge';
import { SendTextPreview } from '../../components/SendTextPreview';

/**
 * A Send Text step's Details: the text with its tokens as chips, and the delivery badge. Loaded
 * when the list first draws a Send Text step (rule 6): the token grammar it ports from the engine,
 * date formats included, is not part of opening the app. Until then the cell shows the plain text.
 */
export default function SendTextCell({ step, tt }: { step: ActionItem; tt: (en: string, pt: string) => string }) {
  return (
    <SendTextPreview
      text={step.key}
      badge={sendTextDeliveryBadge(step)}
      badgeTips={{
        'rich-split': tt(
          'Rich, but a key or delay token splits the text, so replay pastes it as plain. Move the token to an end, split the action, or use Markdown/Discord.',
          'Rich, mas um token de tecla ou delay divide o texto, então o replay cola como texto puro. Mova o token para uma ponta, divida a ação ou use Markdown/Discord.',
        ),
        'type-drops-rich': tt(
          'Type sends keystrokes, no clipboard, so the formatting is not sent. It stays saved: use Paste, or Markdown/Discord to type the marks.',
          'Type envia teclas, sem área de transferência, então a formatação não é enviada. Ela fica salva: use Paste, ou Markdown/Discord para digitar as marcas.',
        ),
      }}
    />
  );
}
