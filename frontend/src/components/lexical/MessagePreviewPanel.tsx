import { useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTt } from '../../state/LanguageContext';
import { normalizeToken, splitTokenSegments } from './tokenNormalize';
import type { DeliveryFacts } from '../../utils/sendTextStatus';
import { useAppState } from '../../state/AppStateContext';
import { useClipboardContent } from '../../logic/useClipboardContent';
import { useRunState } from '../../logic/useRunState';
import { PREVIEW_NOTE_TIP as NOTE_TIP, PREVIEW_REASON_TIP as REASON_TIP, resolveMessagePreview, type PreviewPiece } from './messagePreview';
import type { SendMethod } from '../../utils/sendTextTypes';

// Third rail tab: the message as it will actually be sent. Everything this panel cannot resolve for
// certain is drawn as a labelled placeholder, never as a value — the discipline the Advanced
// Clipboard surface set for its own preview.
//
// The placeholder styling is deliberately NOT the token-chip hue: that colour means "a token" on
// every other surface in this dialog (the editor chip, the grid chip, the surface's token line),
// and reusing it here would make one hue mean two things on the same screen.
//
// The sentences of the placeholders and of the resolved values live with the resolver
// (messagePreview), shared with the expanded Inspector's preview.

export function MessagePreviewPanel({ text, method, marksAdded = false, delivery }: {
  text: string;
  method: SendMethod;
  /** Delivery is Markdown/Discord AND the document carries formatting — so the engine will send
   *  KeyMarkdown, which is this text plus literal marks the panel cannot render. */
  marksAdded?: boolean;
  /** The "Delivery" block under the message: transport, flavor, the fate of the formatting and
   *  WHY, in full — see describeDelivery. The tab has the room the status strip does not. */
  delivery?: DeliveryFacts;
}) {
  const tt = useTt();
  const { clipRaw, clipReady } = useClipboardContent();
  const { dataTable } = useAppState();
  const runState = useRunState(true);

  const pieces = useMemo<PreviewPiece[]>(() => resolveMessagePreview(text, {
    clipRaw,
    clipReady,
    dataTable: {
      headers: dataTable.headers,
      rows: dataTable.rows,
      loopOverData: dataTable.loopOverData,
    },
    variables: runState.variables,
    slots: runState.slots,
    // A fresh Date per recompute, not per render: this useMemo only re-runs when the payload or a
    // source actually changes, so the clock does not tick inside the panel — which is correct,
    // because the value the engine stamps is the one at SEND time either way.
  }, new Date()), [text, clipRaw, clipReady, dataTable, runState]);

  const empty = text.trim().length === 0;

  // The names the Delivery block lists — the chips' own labels (the normalised token minus the
  // braces, so a saved `{enter}` reads "Enter" here as it does in the editor), each once, in
  // order of first appearance.
  const tokenNames = useMemo(() => {
    const names: string[] = [];
    for (const seg of splitTokenSegments(text)) {
      if (seg.kind !== 'token') continue;
      const name = normalizeToken(seg.value).slice(1, -1);
      if (!names.includes(name)) names.push(name);
    }
    return names;
  }, [text]);
  const tokensLine = tokenNames.length === 0
    ? 'None'
    : `${tokenNames.slice(0, 8).join(', ')}${tokenNames.length > 8 ? ` +${tokenNames.length - 8} more` : ''} · filled in at replay`;

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 pt-2 pb-1 shrink-0">
        <div className="label-micro text-text-tertiary">
          {method === 'type'
            ? 'What this will type'
            : 'What this will paste'}
        </div>
        {/* This panel renders the PLAIN payload — the same string the engine resolves — and it has
            no way to render the markdown flavor, which is exported imperatively from the editor at
            confirm time (getMarkdown), not derivable from `text`. Under Markdown/Discord with
            formatting present the engine sends KeyMarkdown: this exact text PLUS literal marks.
            Rather than silently show a payload one step short of the truth, say so. Gated on
            hasFormatting because with none the two flavors are identical and the note would be
            noise. */}
        {marksAdded && (
          <div className="text-caption leading-snug text-text-tertiary mt-0.5">
            {'Formatting marks (*bold*) are added on send.'}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
        <div
          className="text-minor leading-relaxed whitespace-pre-wrap break-words rounded border px-2 py-1.5"
          style={{
            background: 'color-mix(in srgb, var(--color-replay) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--color-replay) 40%, transparent)',
            color: 'var(--color-replay-fg)',
          }}
        >
          {empty ? (
            <span className="italic text-text-disabled">
              {'Nothing to send yet'}
            </span>
          ) : (
            pieces.map((p, i) =>
              p.kind === 'text' ? (
                <span key={i}>{p.text}</span>
              ) : p.kind === 'resolved' ? (
                <span
                  key={i}
                  // Resolved values are underlined rather than tinted: they ARE the message, and a
                  // second colour on them would compete with the placeholders that need attention.
                  className="underline decoration-dotted underline-offset-2"
                  data-tip={p.note ? tt(NOTE_TIP[p.note][0], NOTE_TIP[p.note][1]) : undefined}
                >
                  {p.text === '' ? '' : p.text}
                </span>
              ) : (
                <span
                  key={i}
                  className="inline-flex items-center px-1 mx-[1px] rounded text-caption font-mono align-baseline select-none border text-text-tertiary bg-bg-card border-border-default"
                  data-tip={`${tt(REASON_TIP[p.reason][0], REASON_TIP[p.reason][1])} — ${p.token}`}
                >
                  {p.label}
                </span>
              ),
            )
          )}
        </div>
        {/* The other question this tab is for: not just WHAT goes out but HOW. Four rows on one
            grid, label column auto-sized. The Formatting row carries the ladder's own verdict and,
            when it is a warning, its full sentence — the WHY that the status strip could only park
            in a tooltip. Two channels for the warning (glyph + ink), as the strip does.
            warning-ink is legal here: the rail paints on the card's bg-bg-elevated, one of the
            three surfaces the ink is solved against. */}
        {delivery && (
          <div className="mt-3">
            <div className="label-micro text-text-tertiary mb-1">Delivery</div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-caption leading-snug">
              <dt className="text-text-tertiary">Transport</dt>
              <dd className="text-text-secondary min-w-0">{delivery.transport}</dd>
              <dt className="text-text-tertiary">Flavor</dt>
              <dd className="text-text-secondary min-w-0">{delivery.flavor}</dd>
              <dt className="text-text-tertiary">Formatting</dt>
              <dd className={`min-w-0 ${delivery.formatting.tone === 'warn' ? 'text-warning-ink' : 'text-text-secondary'}`}>
                {delivery.formatting.tone === 'warn' && (
                  <TriangleAlert size={11} className="inline-block align-[-1px] mr-1 shrink-0" />
                )}
                {delivery.formatting.verdict}
                {delivery.formatting.why && (
                  <div className="text-text-tertiary mt-0.5">{delivery.formatting.why}</div>
                )}
              </dd>
              <dt className="text-text-tertiary">Tokens</dt>
              <dd className="text-text-secondary min-w-0 break-words">{tokensLine}</dd>
            </dl>
          </div>
        )}
      </div>
    </div>
  );
}
