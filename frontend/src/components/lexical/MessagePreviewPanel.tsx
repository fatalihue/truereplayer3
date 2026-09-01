import { useMemo } from 'react';
import { useTt } from '../../state/LanguageContext';
import { useAppState } from '../../state/AppStateContext';
import { useClipboardContent } from './useClipboardContent';
import { useRunStateSnapshot } from './useRunStateSnapshot';
import { resolveMessagePreview, type PendingReason, type PreviewPiece } from './messagePreview';

// Third rail tab: the message as it will actually paste. Everything this panel cannot resolve for
// certain is drawn as a labelled placeholder, never as a value — the discipline the Advanced
// Clipboard surface set for its own preview.
//
// The placeholder styling is deliberately NOT the token-chip hue: that colour means "a token" on
// every other surface in this dialog (the editor chip, the grid chip, the surface's token line),
// and reusing it here would make one hue mean two things on the same screen.

const REASON_TIP: Record<PendingReason, [string, string]> = {
  literal: [
    'The engine will paste this verbatim, braces and all — the name is one it resolves, but the argument is not a shape it accepts.',
    'O motor vai colar isso literalmente, chaves e tudo — o nome ele resolve, mas o argumento não está numa forma que ele aceita.',
  ],
  'key-press': [
    'Sent as a key press, not as typed text. It is dispatched between the pasted blocks rather than inside one.',
    'Enviado como uma tecla, não como texto digitado. Ele é disparado entre os blocos colados, não dentro de um.',
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
  'runtime-counter': ['The loop iteration — there is no value outside a run.', 'A iteração do loop — não existe valor fora de uma execução.'],
  'runtime-row': ["The action's own grid row — there is no value outside a run.", 'A linha da action na grade — não existe valor fora de uma execução.'],
  'runtime-rowcursor': [
    'Loop over data is off, so each run uses the NEXT row of the Data table and advances. Which row that is carries over between runs, so the editor cannot show it.',
    'O loop sobre dados está desligado, então cada execução usa a PRÓXIMA linha da tabela e avança. Qual linha é isso continua de uma execução para a outra, então o editor não tem como mostrar.',
  ],
  'runtime-norows': [
    'The Data table has no rows, so this resolves to nothing at replay.',
    'A tabela de dados não tem linhas, então isto resolve como vazio no replay.',
  ],
  'runtime-cursor': [
    'Auto-advancing: which line it takes depends on how many times it has already run, and that position lives in the run.',
    'Auto-avança: qual linha ele pega depende de quantas vezes já rodou, e essa posição fica na execução.',
  ],
  'unmodeled-chain': [
    'This builder cannot model the chain exactly as written, so it will not guess at the result. It still runs.',
    'Este construtor não consegue modelar a cadeia exatamente como está escrita, então não vai adivinhar o resultado. Ela roda normalmente.',
  ],
  'unknown-column': ['No column by that name in the Data table.', 'Nenhuma coluna com esse nome na tabela de dados.'],
  unset: ['Nothing stored under that name yet.', 'Nada guardado com esse nome ainda.'],
};

const NOTE_TIP: Record<string, [string, string]> = {
  clock: [
    'The date and time of this preview. At replay the engine formats with the machine\'s locale, so the separators can differ.',
    'A data e a hora desta prévia. No replay o motor formata com o idioma da máquina, então os separadores podem mudar.',
  ],
  'first-data-row': [
    'The FIRST row of the Data table. A run uses whichever row it is on, and a ForEach or a Run Profile sub-table can substitute a different table entirely.',
    'A PRIMEIRA linha da tabela de dados. Uma execução usa a linha em que está, e um ForEach ou uma sub-tabela de Run Profile pode trocar a tabela inteira.',
  ],
  'last-run': [
    'From the LAST run — variables are cleared at the start of every run, so this is history, not a promise.',
    'Da ÚLTIMA execução — as variáveis são apagadas no começo de cada execução, então isto é histórico, não uma promessa.',
  ],
};

export function MessagePreviewPanel({ text }: { text: string }) {
  const tt = useTt();
  const { clipRaw, clipReady } = useClipboardContent();
  const { dataTable } = useAppState();
  const runState = useRunStateSnapshot(true);

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

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="px-3 pt-2 pb-1 shrink-0">
        <div className="label-micro text-text-tertiary">
          {tt('What this will paste', 'O que isto vai colar')}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-auto px-3 pb-3">
        <div
          className="text-xs leading-relaxed whitespace-pre-wrap break-words rounded border-l-2 px-2 py-1.5"
          style={{
            background: 'color-mix(in srgb, var(--color-replay) 8%, transparent)',
            borderColor: 'color-mix(in srgb, var(--color-replay) 40%, transparent)',
            color: 'var(--color-replay-fg)',
          }}
        >
          {empty ? (
            <span className="italic text-text-disabled">
              {tt('Nothing to send yet', 'Nada para enviar ainda')}
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
                  className="inline-flex items-center px-1 mx-[1px] rounded text-[11px] font-mono align-baseline select-none border text-text-tertiary bg-bg-card border-border-default"
                  data-tip={`${tt(REASON_TIP[p.reason][0], REASON_TIP[p.reason][1])} — ${p.token}`}
                >
                  {p.label}
                </span>
              ),
            )
          )}
        </div>
      </div>
    </div>
  );
}
