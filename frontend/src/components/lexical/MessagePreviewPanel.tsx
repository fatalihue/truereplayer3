import { useMemo } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useTt } from '../../state/LanguageContext';
import { normalizeToken, splitTokenSegments } from './tokenNormalize';
import type { DeliveryFacts } from '../../utils/sendTextStatus';
import { useAppState } from '../../state/AppStateContext';
import { useClipboardContent } from '../../logic/useClipboardContent';
import { useRunState } from '../../logic/useReplay';
import { resolveMessagePreview, type PendingReason, type PreviewPiece } from './messagePreview';
import type { SendMethod } from '../../utils/sendTextTypes';

// Third rail tab: the message as it will actually be sent. Everything this panel cannot resolve for
// certain is drawn as a labelled placeholder, never as a value — the discipline the Advanced
// Clipboard surface set for its own preview.
//
// The placeholder styling is deliberately NOT the token-chip hue: that colour means "a token" on
// every other surface in this dialog (the editor chip, the grid chip, the surface's token line),
// and reusing it here would make one hue mean two things on the same screen.

const REASON_TIP: Record<PendingReason, [string, string]> = {
  literal: [
    'Sent verbatim, braces included — the argument is not a shape the engine accepts.',
    'Enviado literalmente, com as chaves — o argumento não está numa forma que o motor aceita.',
  ],
  'key-press': [
    'Sent as a key press between the text blocks, not as characters.',
    'Enviado como tecla entre os blocos de texto, não como caracteres.',
  ],
  delay: ['A pause in the typing, not text.', 'Uma pausa na digitação, não texto.'],
  random: ['Drawn fresh every run.', 'Sorteado a cada execução.'],
  pick: ['One of the options, drawn fresh every run.', 'Uma das opções, sorteada a cada execução.'],
  ask: [
    'The run pauses and asks you for this value.',
    'A execução pausa e pergunta este valor.',
  ],
  runtime: ['Only the engine has this value, and only while the macro runs.', 'Só o motor tem este valor, e só enquanto a macro roda.'],
  'runtime-clipreading': ['Reading the clipboard…', 'Lendo a área de transferência…'],
  'runtime-counter': ['The run repeat number — there is no value outside a run.', 'O número da repetição da execução — não existe valor fora de uma execução.'],
  'runtime-loop': ['The iteration of the innermost While / For Each block — there is no value outside a run.', 'A volta do bloco While / For Each mais interno — não existe valor fora de uma execução.'],
  'runtime-datarow': ['The number of the current data row — there is no value outside a run.', 'O número da linha de dados atual — não existe valor fora de uma execução.'],
  'runtime-row': ["The action's own grid row — there is no value outside a run.", 'A linha da action na grade — não existe valor fora de uma execução.'],
  'runtime-rowcursor': [
    'Loop over data is off: each run takes the NEXT row, and that position lives between runs.',
    'Loop over data desligado: cada execução pega a PRÓXIMA linha, e essa posição vive entre as execuções.',
  ],
  'runtime-norows': [
    'The Data table has no rows, so this resolves to nothing at replay.',
    'A tabela de dados não tem linhas, então isto resolve como vazio no replay.',
  ],
  'runtime-cursor': [
    'Auto-advancing: the line depends on how many runs came before.',
    'Auto-avança: a linha depende de quantas execuções já houve.',
  ],
  'unmodeled-chain': [
    'The builder cannot model this chain, so it shows no result. It still runs.',
    'O construtor não consegue modelar esta cadeia, então não mostra resultado. Ela roda normalmente.',
  ],
  'unknown-column': ['No column by that name in the Data table.', 'Nenhuma coluna com esse nome na tabela de dados.'],
  unset: ['Nothing stored under that name yet.', 'Nada guardado com esse nome ainda.'],
  generated: ['A fresh identifier at every use — store it in a variable to reuse one.', 'Um identificador novo a cada uso — guarde numa variável para reaproveitar.'],
  'runtime-env': [
    'Read from this machine’s environment when the macro runs; the editor cannot see it.',
    'Lido do ambiente desta máquina quando a macro roda; o editor não enxerga.',
  ],
};

const NOTE_TIP: Record<string, [string, string]> = {
  clock: [
    'Preview time. Month and day names follow the machine locale at replay.',
    'Hora da prévia. Nomes de mês e dia seguem o idioma da máquina no replay.',
  ],
  'first-data-row': [
    'The FIRST data row. A run uses the row it is on; ForEach and Run Profile can use another table.',
    'A PRIMEIRA linha de dados. A execução usa a linha em que está; ForEach e Run Profile podem usar outra tabela.',
  ],
  'last-run': [
    'From the LAST run — variables reset at every start.',
    'Da ÚLTIMA execução — as variáveis zeram a cada início.',
  ],
};

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
