// O motor: o que as automações dizem (Source/TriggerService.cs) — a linha do último resultado de cada
// automação (automation:state.lastResult), o porquê de um vigia que parou sozinho e o aviso disso (a
// notificação do Windows e o aviso na janela).
//
// A linha do último resultado aparece sozinha em Activity › Last result e dentro de "On, but not
// watching: {{reason}}." (área automations): começa em minúscula e termina sem ponto. "fired" não está
// aqui: é um código que a página compara (automationModel.ts) e nunca mostra. O motor diz a linha quando
// a página pede o estado, no idioma de agora, e o arquivo das estatísticas guarda só o código.
//
// Nas lacunas: name = o nome da macro da automação; what = o nome do que estava aberto (engine-guards,
// scope: em pt-BR sempre feminino singular, e por isso "aberta"); hours = a faixa de horas como o usuário
// a escreveu ("09:00-18:00"); minutes = um número já formatado (S.Num); reason = uma frase do motor ou o
// texto do .NET; app = o nome do app (TrueReplayer 3). Em pt-BR, "a macro" e "a automação" no feminino;
// o disparo é masculino ("pulado", "perdido").
export default {
  // Quando um vigia sai de serviço sozinho (a condição nunca casa, a imagem de referência sumiu, um
  // horário inválido): a notificação do Windows, com dois botões, e o aviso guardado até a janela
  // aparecer. reason = uma frase de stop.*.sentence.
  stopped: {
    title: '{{name}} stopped watching',
    body: "{{reason}} It's still turned on.",
    open: 'Open automation',          // botão da notificação: abre Automations com esta automação aberta
    turnOff: 'Turn it off',           // botão da notificação: desativa a automação
    notice: 'Automation stopped: {{name}}. {{reason}} The automation is still armed, but it is not watching for anything.',
  },

  // Por que um vigia parou, em duas formas: line, a linha do último resultado; sentence, a frase da
  // notificação e do aviso (maiúscula e ponto final).
  stop: {
    unknownKind: {
      line: "unknown trigger kind '{{kind}}'",   // kind = o tipo de gatilho gravado por uma versão mais nova
      sentence: "Its trigger kind '{{kind}}' is not known to this version of {{app}}.",
    },
    badTime: {
      line: "invalid schedule time '{{time}}'",  // time = o horário gravado, que não é HH:mm
      sentence: "Its schedule time '{{time}}' is not a valid time.",
    },
    noImage: {
      line: 'reference image missing — watcher stopped',
      sentence: 'Its reference image is missing.',
    },
    // As condições que, como estão, nunca casam (TriggerService.DescribeUnfireable).
    anchorEmpty: {
      line: 'coordinates are anchored to a window, but no process name or window title is set — this can never match — watcher stopped',
      sentence: 'Coordinates are anchored to a window, but no process name or window title is set — this can never match.',
    },
    anchorRegex: {
      line: 'the anchor window-title regex does not compile — this can never match — watcher stopped',
      sentence: 'The anchor window-title regex does not compile — this can never match.',
    },
    noWindow: {
      line: 'no process name or window title set — this can never match — watcher stopped',
      sentence: 'No process name or window title set — this can never match.',
    },
    titleRegex: {
      line: 'the window-title regex does not compile — this can never match — watcher stopped',
      sentence: 'The window-title regex does not compile — this can never match.',
    },
    noProcess: {
      line: 'no process name set — this can never match — watcher stopped',
      sentence: 'No process name set — this can never match.',
    },
    noFile: {
      line: 'no file path set — this can never match — watcher stopped',
      sentence: 'No file path set — this can never match.',
    },
    badColor: {
      // color = o valor gravado, que não tem seis dígitos hexadecimais
      line: "the pixel colour '{{color}}' is not a 6-digit hex value — this can never match — watcher stopped",
      sentence: "The pixel colour '{{color}}' is not a 6-digit hex value — this can never match.",
    },
    noRegion: {
      line: 'no search region set — reading the whole screen every check is too slow — watcher stopped',
      sentence: 'No search region set — reading the whole screen every check is too slow.',
    },
    noOcr: {
      line: 'no OCR language is installed on this PC — watcher stopped',
      sentence: 'No OCR language is installed on this PC.',
    },
    notNumber: {
      line: 'the value to compare with is not a number — this can never match — watcher stopped',
      sentence: 'The value to compare with is not a number — this can never match.',
    },
    noText: {
      line: 'no text to watch for — this can never match — watcher stopped',
      sentence: 'No text to watch for — this can never match.',
    },
    textRegex: {
      line: 'the text pattern (regex) does not compile — this can never match — watcher stopped',
      sentence: 'The text pattern (regex) does not compile — this can never match.',
    },
    noType: {
      line: 'no condition type set — this can never match — watcher stopped',
      sentence: 'No condition type set — this can never match.',
    },
    unknownType: {
      // type = o tipo de condição gravado por uma versão mais nova
      line: "unknown condition type '{{type}}' — this version cannot watch for it — watcher stopped",
      sentence: "Unknown condition type '{{type}}' — this version cannot watch for it.",
    },
  },

  // A linha do último resultado, fora as paradas acima.
  result: {
    // Um disparo que não rodou (os contadores de Activity › Skipped). Quando algo estava aberto, a linha
    // diz o quê: what (um scope), um diálogo da página, a captura de uma hotkey ou um editor com mudanças.
    skipped: {
      busy: 'skipped (busy)',                        // outra macro rodando, uma gravação ou o Clicker
      unsaved: 'skipped (unsaved changes)',
      scope: 'skipped ({{what}} is open)',
      dialog: 'skipped (a dialog is open)',          // um diálogo da página
      hotkey: 'skipped (capturing a hotkey)',        // o campo de uma hotkey esperando a tecla
      dataTable: 'skipped (editing the data table)', // a tabela do Data Loop com mudanças
      automation: 'skipped (editing an automation)',
      step: 'skipped (editing a step)',              // o Inspector com mudanças
      row: 'skipped (editing a row)',                // outro editor com mudanças
      unknown: 'skipped (dialog open)',              // algo aberto, sem registro do quê
    },
    // Um intervalo ou um horário que esperou o prazo de tolerância inteiro e não rodou.
    missed: {
      busy: 'missed (busy past the grace window)',
      starting: 'missed (app was still starting past the grace window)',
      scope: 'missed ({{what}} was open past the grace window)',
      dialog: 'missed (a dialog was open past the grace window)',
      hotkey: 'missed (capturing a hotkey past the grace window)',
      dataTable: 'missed (editing the data table past the grace window)',
      automation: 'missed (editing an automation past the grace window)',
      step: 'missed (editing a step past the grace window)',
      row: 'missed (editing a row past the grace window)',
    },
    // Uma condição que apareceu (a borda, "uma vez por aparição") e esperou demais para disparar.
    edge: {
      hours: 'fire skipped (outside active hours {{hours}} — edge expired)',
      cooldown: 'fire skipped (cooldown from the previous fire still running — edge expired)',
      starting: 'fire skipped (app was still starting — edge expired)',
      unsaved: 'fire skipped (unsaved changes — edge expired)',
      busy: 'fire skipped (busy too long — edge expired)',
      scope: 'fire skipped ({{what}} is open) — edge expired',
      dialog: 'fire skipped (a dialog is open) — edge expired',
      hotkey: 'fire skipped (capturing a hotkey) — edge expired',
      dataTable: 'fire skipped (editing the data table) — edge expired',
      automation: 'fire skipped (editing an automation) — edge expired',
      step: 'fire skipped (editing a step) — edge expired',
      row: 'fire skipped (editing a row) — edge expired',
      unknown: 'fire skipped (a dialog was open) — edge expired',
    },
    waiting: 'waiting (app starting)',
    failed: 'failed to start',
    // Um intervalo ou horário que passou com o computador dormindo, e foi pulado em vez de rodar atrasado.
    late: 'skipped — {{minutes}} min late (machine asleep or clock changed)',
    outsideHours: 'outside active hours ({{hours}})',
    clipboardIgnored: 'clipboard change ignored (just after a replay)',
    crashed: 'watcher crashed: {{reason}}',          // reason = o erro (S.Reason)
  },
} as const;
