import { useDeferredValue, useMemo } from 'react';
import { PREVIEW_NOTE_TIP, PREVIEW_REASON_TIP, resolveMessagePreview, type PreviewPiece } from '../../components/lexical/messagePreview';
import { normalizeToken, splitTokenSegments } from '../../components/lexical/tokenNormalize';
import { fmtNum, LANG, t } from '../../i18n';
import { useClipboardContent } from '../../logic/useClipboardContent';
import { useRunState } from '../../logic/useRunState';
import { describeDelivery } from '../../utils/sendTextStatus';
import type { SendMethod, SendMode } from '../../utils/sendTextTypes';
import { useApp } from '../store';

/** The name a value is known by, for the line under the preview: a variable's, a column's. */
const nameOf = (token: string) => token.slice(1, -1).split(':')[1] ?? '';
// Made once, on first use, like the formatters of i18n.ts: "a, b, and c" / "a, b e c".
let lista: Intl.ListFormat | undefined;
const joined = (names: string[]) => (lista ??= new Intl.ListFormat(LANG, { type: 'conjunction' })).format(names);

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
  // The tokens as the chips write them, up to 8, joined by commas: names of the glossary, not a sentence.
  const tokensLine = names.length === 0 ? t('sendText.preview.noTokens')
    : names.length > 8 ? t('sendText.preview.tokensLineMore', { names: names.slice(0, 8).join(', '), n: fmtNum(names.length - 8) })
    : t('sendText.preview.tokensLine', { names: names.join(', ') });

  return (
    <div className="insp-section stx-preview">
      <span className="insp-label">{t('sendText.preview.title')}</span>
      <div className="stx-bubble" data-empty={shown.trim() === '' || undefined}>
        {shown.trim() === '' ? t('sendText.preview.empty') : pieces.map((p, i) => (
          p.kind === 'text' ? <span key={i}>{p.text}</span>
            : p.kind === 'resolved' ? (
              <span key={i} className="stx-value" data-tip={p.note ? PREVIEW_NOTE_TIP[p.note] : undefined}>{p.text}</span>
            ) : (
              <span key={i} className="stx-pending" data-tip={`${PREVIEW_REASON_TIP[p.reason]} — ${p.token}`}>{p.label}</span>
            )
        ))}
      </div>
      {(mode === 'markdown' || mode === 'discord') && hasFormatting && (
        <span className="insp-hint">{t('sendText.preview.marksAdded')}</span>
      )}
      {fromRun.length > 0 && (
        <span className="insp-hint">{t('sendText.preview.fromRun', { count: fromRun.length, names: joined(fromRun) })}</span>
      )}
      {fromRow.length > 0 && (
        <span className="insp-hint">{t('sendText.preview.fromRow', { count: fromRow.length, names: joined(fromRow) })}</span>
      )}
      {clock && <span className="insp-hint">{t('sendText.preview.clock')}</span>}
      <dl className="stx-facts">
        <dt>{t('sendText.preview.transport')}</dt>
        <dd>{facts.transport}</dd>
        <dt>{t('sendText.preview.flavor')}</dt>
        <dd>{facts.flavor}</dd>
        <dt>{t('sendText.preview.formatting')}</dt>
        <dd data-tone={facts.formatting.tone}>
          {/* A warning in two channels, the glyph and the ink, as today's. */}
          {facts.formatting.tone === 'warn' && <span className="step-icon stx-facts-warn" data-icon="triangle-alert" role="img" aria-label={t('sendText.preview.warning')} />}
          {facts.formatting.verdict}
          {facts.formatting.why && <span className="stx-facts-why">{facts.formatting.why}</span>}
        </dd>
        <dt>{t('sendText.preview.tokens')}</dt>
        <dd>{tokensLine}</dd>
      </dl>
    </div>
  );
}
