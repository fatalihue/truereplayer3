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
import { splitTokenSegments, richFlavorSurvives } from './lexical/tokenNormalize';

export type DeliveryBadge = { label: 'rich' | 'md'; degraded: boolean };

/**
 * What the grid is allowed to SAY about a SendText row's delivery, or null for a plain row.
 *
 * The badge used to be `keyHtml && sendMode !== 'plain'` — a promise of formatting made from
 * the mere EXISTENCE of a rich flavor, with no knowledge of the rule that decides whether the
 * engine will actually attach it. A rich row whose payload is split by a key/delay token got a
 * confident "rich" badge and then pasted plain, and nothing on screen told it apart from a row
 * that really does paste formatted. `degraded` closes that: it asks the same predicate the
 * engine's ==1 gate answers (richFlavorSurvives, ported in lexical/tokenNormalize.ts).
 *
 * `degraded` changes the badge's COLOUR and gives it a tooltip; it never changes the LABEL.
 * The label states the configured delivery, which is a fact this function knows for certain,
 * while the predicate behind `degraded` reasons about the AUTHORED payload and can disagree
 * with a particular run in both directions (see that file's banner). Colouring a suspicion is
 * honest; relabelling the row 'plain' on it would be a second lie in the opposite direction.
 *
 * Markdown/Discord are never degraded: ActionExecution.cs:3603-3609 sends KeyMarkdown as PLAIN
 * text with sendHtml = null, so the ==1 gate is not on their path — every segment is pasted and
 * the marks, being literal characters, ride along.
 */
export function sendTextDeliveryBadge(action: {
  key: string;
  keyHtml?: string | null;
  sendMode?: 'rich' | 'markdown' | 'plain' | 'discord' | null;
}): DeliveryBadge | null {
  if (!action.keyHtml || action.sendMode === 'plain') return null;
  if (action.sendMode === 'markdown' || action.sendMode === 'discord') return { label: 'md', degraded: false };
  // 'rich', or null/undefined — and null is the PRIMARY path, not a legacy edge:
  // NormalizeSendMode (WebViewBridge.cs:4098-4102) maps 'rich', empty and every unknown string
  // to null, so that is what every rich row on disk carries. ActionExecution.cs:3608 treats an
  // empty mode as rich, so it must be judged by the same rule rather than skipped.
  return { label: 'rich', degraded: !richFlavorSurvives(action.key) };
}

interface SendTextPreviewProps {
  text: string;
  /** Tiny delivery badge shown before the text — see sendTextDeliveryBadge. Null for plain rows. */
  badge?: DeliveryBadge | null;
  /** Portal tooltip for a DEGRADED badge. Built at the call site because tt() is a hook. */
  badgeTip?: string;
}

export function SendTextPreview({ text, badge = null, badgeTip }: SendTextPreviewProps) {
  if (!text) return null;
  // "Hello{Enter}World" → [text "Hello", token "{Enter}", text "World"]. Unclosed `{`
  // and unknown names both fall through as literal text, matching what replay does
  // with them.
  const segments = splitTokenSegments(text);
  return (
    <>
      {badge && (
        <span
          // Two channels for the degraded state, never one: warning ink AND a tooltip that says
          // what will happen. Colour alone dies in roughly half the themes, and the label is
          // deliberately NOT repurposed to carry the state — see sendTextDeliveryBadge.
          className={`inline-flex items-center px-1 py-[1px] mr-1 text-[9px] font-semibold uppercase tracking-wide rounded select-none align-middle ${
            badge.degraded
              ? 'text-warning-ink bg-[color-mix(in_srgb,var(--color-warning-ink)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-warning-ink)_45%,transparent)]'
              : 'text-accent bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)]'
          }`}
          data-tip={badge.degraded ? badgeTip : undefined}
        >
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
            className="inline-flex items-center px-1.5 py-[1px] mx-[1px] text-[12px] font-mono rounded text-[var(--color-action-sendtext-fg)] bg-[var(--color-action-sendtext-fg)]/15 border border-[var(--color-action-sendtext-fg)]/40 select-none align-middle"
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
