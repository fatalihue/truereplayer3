// O Dock sob os passos (shell/dock/): a barra (Dock.tsx), com as abas, o resumo da última execução e o
// botão do painel; e o painel (DockPanel.tsx), com o Run Report, passo a passo, e as Live Variables.
// Dock, Run Report e Live Variables são recursos do glossário e ficam. Como a última execução terminou
// vem de header.outcome (shell/header/model.ts, lastRunOutcome). Os textos que o motor escreve num passo
// (o detalhe, a mensagem e a dica de uma falha) chegam prontos e não estão aqui.
//
// Nas lacunas: duration = uma duração já formatada ("450 ms", "3.4 s", "2 min 5 s"); time = a hora, no
// formato do idioma ("2:02 PM", "14:02"); row = o número de um passo na macro (sem separador de milhar,
// como a coluna do número); count = uma contagem, que escolhe a forma.
export default {
  region: 'Run Report and Live Variables',  // nome da faixa do Dock (leitor de tela) · glossário
  tabsLabel: 'Dock',                        // nome do grupo das abas (leitor de tela) · glossário
  // As abas: os nomes dos recursos, iguais nos dois idiomas.
  tabs: {
    report: 'Run Report',
    vars: 'Live Variables',
  },
  // O resumo na barra, ao lado das abas: um botão que abre o Run Report. Corta com reticências.
  summary: {
    running: 'Running',                     // com uma execução em curso
    none: 'No run yet',                     // a macro aberta ainda não rodou nesta sessão
    // A última execução da macro aberta: ok = os passos que deram certo; total = os passos contados;
    // outcome = como terminou ("no errors", "stopped by you"…). A barra está no pedaço da abertura: uma
    // frase só, que vale para qualquer total (sem plural, que pesaria três frases no pedaço).
    last: 'Last run {{time}} · {{ok}} of {{total}} steps · {{duration}} · {{outcome}}',
    tip: 'Open the run report',             // dica do resumo · verbo
  },
  open: 'Open panel',                       // o botão da ponta da barra: o nome e a dica · verbo
  close: 'Close panel',
  height: 'Panel height',                   // a borda de cima do painel, que se arrasta (leitor de tela)

  // O Run Report: a última execução, passo a passo.
  report: {
    empty: 'No run yet. Replay the macro to see each step here: what matched, how long it took and why it failed.',
    starting: 'The run is starting…',       // a execução começou, e o primeiro passo ainda não chegou
    // O cabeçalho: macro = a macro que rodou (do usuário); time = quando começou; count = os passos.
    head: { one: '{{macro}} · {{time}} · {{count}} step · {{duration}}', other: '{{macro}} · {{time}} · {{count}} steps · {{duration}}' },
    headNoTime: { one: '{{macro}} · {{count}} step · {{duration}}', other: '{{macro}} · {{count}} steps · {{duration}}' },  // sem a hora de início
    // A dica do cabeçalho: de onde vem a duração. duration = a soma do tempo dentro dos passos.
    wallTip: 'Wall clock, minus the time paused. Inside the steps: {{duration}}.',
    sumTip: 'The sum of the steps — this report predates the engine clock.',
    // As contagens à direita do cabeçalho, cada uma na cor dela · os passos (masculino em pt-BR).
    ok: '{{n}} ok',
    skipped: { one: '{{count}} skipped', other: '{{count}} skipped' },
    failed: { one: '{{count}} failed', other: '{{count}} failed' },
    firstFailed: 'step {{row}} →',          // link que rola a lista até o primeiro passo que falhou
    // Passos de navegador achados por um seletor de reserva (as alternativas do seletor, browser.ts):
    // o escolhido deixou de corresponder. count = quantos passos.
    drift: {
      one: '{{count}} step matched through a fallback selector — the one you picked no longer matches. Pick it again before the fallback drifts too.',
      other: '{{count}} steps matched through a fallback selector — the ones you picked no longer match. Pick them again before the fallbacks drift too.',
    },
    list: 'Steps of the run',               // nome da lista (leitor de tela)
    select: 'Select step {{row}}',          // dica de uma linha da macro aberta: seleciona o passo na lista
    running: 'Running…',                    // no lugar da duração, no passo em curso
    // Sob um passo achado por uma alternativa: tier = a letra dela (S, A, B, C); selector = o seletor.
    fallback: 'matched through fallback tier {{tier}}',
    fallbackSelector: 'matched through fallback tier {{tier}} · {{selector}}',
    // Os passos que passaram do limite do relatório: n = quantos, com milhar; count escolhe a forma.
    capped: { one: '+{{n}} more step not recorded (the report is capped).', other: '+{{n}} more steps not recorded (the report is capped).' },
    // O cabeçalho ao vivo, durante a execução: clock = o tempo desde o início ("0:04"); count = as
    // falhas até agora. Com Loops: current e total = a volta (total pode ser ∞) · Loop é glossário.
    live: { one: '{{clock}} elapsed · {{count}} failure', other: '{{clock}} elapsed · {{count}} failures' },
    liveLoop: {
      one: 'Loop {{current}} of {{total}} · {{clock}} elapsed · {{count}} failure',
      other: 'Loop {{current}} of {{total}} · {{clock}} elapsed · {{count}} failures',
    },
  },
  // O estado de cada passo, no ícone da linha (leitor de tela) · o passo (masculino em pt-BR).
  status: {
    ok: 'ok',
    failed: 'failed',
    skipped: 'skipped',
    running: 'in progress',
  },
  // O que querem dizer os códigos de falha de um passo de navegador: os da extensão (content.js) e os
  // dois que a ponte dá num timeout. O código aparece ao lado, como está. Um código desconhecido mostra
  // a mensagem do próprio passo.
  codes: {
    ELEMENT_NOT_FOUND: 'No element matched the selector.',
    ELEMENT_HIDDEN: 'Found, but not visible on screen.',
    ELEMENT_DISABLED: 'Found, but disabled.',
    ELEMENT_COVERED: 'Found, but something is on top of it.',
    SELECTOR_INVALID: 'The selector is not valid CSS.',
    NAVIGATION_TIMEOUT: 'The page did not finish loading in time.',
    INVALID_URL: 'That is not a URL the browser can open.',
    OPTION_NOT_FOUND: 'No option in the list matched.',
    OPTION_DISABLED: 'The option matched, but it is disabled.',
    NOT_A_SELECT: 'That element is not a dropdown list.',
    TAB_GONE: 'The tab this run was acting on was closed.',   // a aba do navegador
    NO_CONTENT_SCRIPT: 'The active Chrome tab cannot be automated.',
  },

  // As Live Variables: as variáveis da execução, os slots {clip:N} e a linha do Data Loop, enquanto mudam.
  vars: {
    // {input:} e {clip:} são tokens e ficam.
    empty: 'Nothing yet. Variables, {input:} answers and {clip:} captures show here as they happen.',
    variables: 'Variables',                 // títulos dos grupos · nome
    slots: 'Slots',                         // coringa
    row: 'Current row',                     // a linha do Data Loop em que a execução está
  },
} as const;
