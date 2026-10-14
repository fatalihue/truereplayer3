// Static (non-Lexical) renderer for SendText payloads in the grid Key column.
// Parses `{token}` patterns and renders each as a compact pink chip — same visual
// identity as the interactive chips in the Lexical-based Insert Text editor
// (`lexical/TokenChip.tsx`), minus the popover / cursor / hover affordances since
// the grid cell is read-only. Used inside the existing truncating wrapper, so
// long sequences still clip at the cell's max-width with the title attribute
// showing the full raw text on hover.

// A chip here is a PROMISE that replay will substitute the thing. This file used to chip
// every `{...}` it found, with no whitelist at all, so a literal `{xpto}` — text the engine
// leaves exactly as typed — was drawn identically to a live {clipboard}, and nothing on
// screen told the two apart until the macro ran and pasted the braces. The preview and the
// Insert Text editor now ask the SAME walker (grammar ported from the engine's own matchers)
// instead of each keeping a private copy of the rule.
import { splitTokenSegments } from './lexical/tokenNormalize';
import type { DeliveryBadge, DeliveryBadgeTip } from './lexical/deliveryBadge';

interface SendTextPreviewProps {
  text: string;
  /** Tiny delivery badge shown before the text — see sendTextDeliveryBadge. Null for plain rows. */
  badge?: DeliveryBadge | null;
  /**
   * Portal tooltips for a DEGRADED badge, keyed by REASON — a row can be degraded because the
   * payload splits (rich-split) or because typing cannot carry formatting at all
   * (type-drops-rich), and the two need different advice. Built at the call site because tt()
   * is a hook.
   */
  badgeTips?: Partial<Record<DeliveryBadgeTip, string>>;
}

export function SendTextPreview({ text, badge = null, badgeTips }: SendTextPreviewProps) {
  if (!text) return null;
  // "Hello{Enter}World" → [text "Hello", token "{Enter}", text "World"]. Unclosed `{`
  // and unknown names both fall through as literal text, matching what replay does
  // with them.
  const segments = splitTokenSegments(text);
  return (
    <>
      {badge && (
        <span
          // TWO VISIBLE CHANNELS for the degraded state, and the hue is not one of them on its
          // own: measured across the presets, the accent-to-warning-ink distance collapses to
          // near zero on several (gruvbox-dark among them), so a badge that changed only its
          // colour would be invisible exactly where it matters. The channels are the leading "!"
          // glyph and the dashed border; the tooltip carries the explanation.
          //
          // No warning-ink WASH behind it. --color-warning-ink is solved against bg-surface /
          // bg-card / bg-elevated plus an 8% tint, and a 12% fill of the ink over itself is a
          // heavier ground than the solve models — the badge sits on the row's own surface,
          // which IS in that list, so the border and the ink carry it instead.
          className={`inline-flex items-center gap-[3px] px-1 py-[1px] mr-1 text-caption font-semibold uppercase tracking-wide rounded select-none align-middle ${
            badge.degraded
              ? 'text-warning-ink border border-dashed border-[color-mix(in_srgb,var(--color-warning-ink)_60%,transparent)]'
              : 'text-accent bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)]'
          }`}
          data-tip={badge.degraded && badge.tip ? badgeTips?.[badge.tip] : undefined}
        >
          {badge.degraded && <span aria-hidden="true">!</span>}
          {badge.label}
        </span>
      )}
      {segments.map((segment, idx) =>
        segment.kind === 'token' ? (
          // Chip style mirrors lexical/TokenChip.tsx but drops the interactive bits:
          // no cursor-pointer, no hover state, no ring on open — this is purely a
          // visual preview. `select-none` keeps the chip from highlighting when the
          // user selects the row.
          <span
            key={idx}
            className="inline-flex items-center px-1.5 py-[1px] mx-[1px] text-minor leading-[inherit] font-mono rounded text-[var(--color-action-sendtext-fg)] bg-[var(--color-action-sendtext-fg)]/15 border border-[var(--color-action-sendtext-fg)]/40 select-none align-middle"
          >
            {segment.value.slice(1, -1)}
          </span>
        ) : (
          <span key={idx}>{segment.value}</span>
        ),
      )}
    </>
  );
}
