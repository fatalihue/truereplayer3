import { useDeferredValue, useMemo } from 'react';
import { PREVIEW_NOTE_TIP, PREVIEW_REASON_TIP, resolveMessagePreview, type PreviewPiece } from '../../components/lexical/messagePreview';
import { normalizeToken, splitTokenSegments } from '../../components/lexical/tokenNormalize';
import { useClipboardContent } from '../../logic/useClipboardContent';
import { useRunState } from '../../logic/useRunState';
import { useTt } from '../../state/LanguageContext';
import { describeDelivery } from '../../utils/sendTextStatus';
import type { SendMethod, SendMode } from '../../utils/sendTextTypes';
import { useApp } from '../store';

/** The name a value is known by, for the line under the preview: a variable's, a column's. */
const nameOf = (token: string) => token.slice(1, -1).split(':')[1] ?? '';
const joined = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/**
 * Preview, with today's values (send-text-125): the message as it resolves now — the clipboard,
 * the Data Loop table's first row, the variables and slots of the last run, the date and time —
 * under the message, in the expanded Send Text. What cannot be known before the run is a grey
 * marker that says why in its tip; one line under says where the values came from. Then how it
 * goes out (send-text-126): pasted or typed, the flavour, what becomes of the formatting and why,
 * and the tokens it fills in.
 *
 * It follows the typing a beat behind (a deferred value), so the keys never wait for it, and it
 * reads the clipboard only for a text that has a clipboard token.
 */
export function TextPreview({ text, mode, method, delay, hasFormatting, tokens, richWillDegrade }: {
  text: string;
  mode: SendMode;
  method: SendMethod;
  delay: number;
  hasFormatting: boolean;
  tokens: number;
  richWillDegrade: boolean;
}) {
  const tt = useTt();
  const shown = useDeferredValue(text);
  const { clipRaw, clipReady } = useClipboardContent(/\{clipboard/i.test(shown));
  const table = useApp(a => a.dataTable);
  const run = useRunState(true);
  const pieces = useMemo<PreviewPiece[]>(() => resolveMessagePreview(shown, {
    clipRaw,
    clipReady,
    dataTable: { headers: table.headers, rows: table.rows, loopOverData: table.loopOverData },
    variables: run.variables,
    slots: run.slots,
    // The time at the last change of the text or of a source, not a clock ticking in the panel:
    // the run stamps the moment it sends either way.
  }, new Date()), [shown, clipRaw, clipReady, table, run]);

  // Where the values came from, once each.
  const fromRun: string[] = [];
  const fromRow: string[] = [];
  let clock = false;
  for (const p of pieces) {
    if (p.kind !== 'resolved' || !p.note) continue;
    if (p.note === 'last-run' && !fromRun.includes(nameOf(p.token))) fromRun.push(nameOf(p.token));
    else if (p.note === 'first-data-row' && !fromRow.includes(nameOf(p.token))) fromRow.push(nameOf(p.token));
    else if (p.note === 'clock') clock = true;
  }
  const facts = describeDelivery({
    sendMode: mode, sendMethod: method, hasFormatting, tokenCount: tokens, richWillDegrade,
    charDelayMs: method === 'type' && delay > 0 ? delay : null,
  });
  const names: string[] = [];
  for (const seg of splitTokenSegments(shown)) {
    if (seg.kind !== 'token') continue;
    const name = normalizeToken(seg.value).slice(1, -1);
    if (!names.includes(name)) names.push(name);
  }
  const tokensLine = names.length === 0 ? 'None'
    : `${names.slice(0, 8).join(', ')}${names.length > 8 ? ` +${names.length - 8} more` : ''} · filled in at replay`;

  return (
    <div className="insp-section stx-preview">
      <span className="insp-label">Preview, with today's values</span>
      <div className="stx-bubble" data-empty={shown.trim() === '' || undefined}>
        {shown.trim() === '' ? 'Nothing to send yet' : pieces.map((p, i) => (
          p.kind === 'text' ? <span key={i}>{p.text}</span>
            : p.kind === 'resolved' ? (
              <span key={i} className="stx-value" data-tip={p.note ? tt(PREVIEW_NOTE_TIP[p.note][0], PREVIEW_NOTE_TIP[p.note][1]) : undefined}>{p.text}</span>
            ) : (
              <span key={i} className="stx-pending" data-tip={`${tt(PREVIEW_REASON_TIP[p.reason][0], PREVIEW_REASON_TIP[p.reason][1])} — ${p.token}`}>{p.label}</span>
            )
        ))}
      </div>
      {(mode === 'markdown' || mode === 'discord') && hasFormatting && (
        <span className="insp-hint">Formatting marks (*bold*) are added on send.</span>
      )}
      {fromRun.length > 0 && (
        <span className="insp-hint">
          {joined(fromRun)} {fromRun.length === 1 ? 'comes' : 'come'} from the last run, in Live Variables. The real run fills in the value it has at that moment.
        </span>
      )}
      {fromRow.length > 0 && (
        <span className="insp-hint">
          {joined(fromRow)} {fromRow.length === 1 ? 'is' : 'are'} the Data Loop table’s first row; a run uses the row it is on.
        </span>
      )}
      {clock && <span className="insp-hint">Dates and times are now’s; the run uses the moment it sends.</span>}
      <dl className="stx-facts">
        <dt>Transport</dt>
        <dd>{facts.transport}</dd>
        <dt>Flavor</dt>
        <dd>{facts.flavor}</dd>
        <dt>Formatting</dt>
        <dd data-tone={facts.formatting.tone}>
          {/* A warning in two channels, the glyph and the ink, as today's. */}
          {facts.formatting.tone === 'warn' && <span className="step-icon stx-facts-warn" data-icon="triangle-alert" role="img" aria-label="Warning" />}
          {facts.formatting.verdict}
          {facts.formatting.why && <span className="stx-facts-why">{facts.formatting.why}</span>}
        </dd>
        <dt>Tokens</dt>
        <dd>{tokensLine}</dd>
      </dl>
    </div>
  );
}
