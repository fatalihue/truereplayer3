import type en from '../en-US/engine-automations.ts';
import type { Catalogo } from '../tipos.ts';

// A automação e a macro são femininas; o disparo, masculino ("pulado", "perdido"). "Nunca casa" é o
// termo da página para uma condição que nunca é verdadeira (automations.why). "Aparição" é a borda do
// ritmo "Uma vez por aparição" (automations.rhythm.edge). O que estava aberto (what) é sempre um nome
// feminino (engine-guards, scope), por isso "aberta". Entre o número e a unidade, um espaço inseparável.
export default {
  stopped: {
    title: '{{name}} parou de vigiar',
    body: '{{reason}} Ela continua ativada.',
    open: 'Abrir automação',
    turnOff: 'Desativar',
    notice: 'A automação de {{name}} parou. {{reason}} Ela continua armada, mas não está vigiando nada.',
  },

  stop: {
    unknownKind: {
      line: "tipo de gatilho desconhecido '{{kind}}'",
      sentence: "O tipo de gatilho '{{kind}}' não existe nesta versão do {{app}}.",
    },
    badTime: {
      line: "horário inválido '{{time}}'",
      sentence: "O horário '{{time}}' não é um horário válido.",
    },
    noImage: {
      line: 'falta a imagem de referência — parou de vigiar',
      sentence: 'Falta a imagem de referência.',
    },
    anchorEmpty: {
      line: 'as coordenadas seguem uma janela, mas não há nome de processo nem título de janela — assim, nunca casa — parou de vigiar',
      sentence: 'As coordenadas seguem uma janela, mas não há nome de processo nem título de janela — assim, nunca casa.',
    },
    anchorRegex: {
      line: 'a regex do título da janela que as coordenadas seguem não compila — assim, nunca casa — parou de vigiar',
      sentence: 'A regex do título da janela que as coordenadas seguem não compila — assim, nunca casa.',
    },
    noWindow: {
      line: 'não há nome de processo nem título de janela — assim, nunca casa — parou de vigiar',
      sentence: 'Não há nome de processo nem título de janela — assim, nunca casa.',
    },
    titleRegex: {
      line: 'a regex do título da janela não compila — assim, nunca casa — parou de vigiar',
      sentence: 'A regex do título da janela não compila — assim, nunca casa.',
    },
    noProcess: {
      line: 'não há nome de processo — assim, nunca casa — parou de vigiar',
      sentence: 'Não há nome de processo — assim, nunca casa.',
    },
    noFile: {
      line: 'não há caminho de arquivo — assim, nunca casa — parou de vigiar',
      sentence: 'Não há caminho de arquivo — assim, nunca casa.',
    },
    badColor: {
      line: "a cor do pixel '{{color}}' não tem 6 dígitos hexadecimais — assim, nunca casa — parou de vigiar",
      sentence: "A cor do pixel '{{color}}' não tem 6 dígitos hexadecimais — assim, nunca casa.",
    },
    noRegion: {
      line: 'não há região de pesquisa — ler a tela inteira a cada verificação é lento demais — parou de vigiar',
      sentence: 'Não há região de pesquisa — ler a tela inteira a cada verificação é lento demais.',
    },
    noOcr: {
      line: 'nenhum idioma de OCR está instalado neste PC — parou de vigiar',
      sentence: 'Nenhum idioma de OCR está instalado neste PC.',
    },
    notNumber: {
      line: 'o valor a comparar não é um número — assim, nunca casa — parou de vigiar',
      sentence: 'O valor a comparar não é um número — assim, nunca casa.',
    },
    noText: {
      line: 'não há texto a vigiar — assim, nunca casa — parou de vigiar',
      sentence: 'Não há texto a vigiar — assim, nunca casa.',
    },
    textRegex: {
      line: 'o padrão do texto (regex) não compila — assim, nunca casa — parou de vigiar',
      sentence: 'O padrão do texto (regex) não compila — assim, nunca casa.',
    },
    noType: {
      line: 'não há tipo de condição — assim, nunca casa — parou de vigiar',
      sentence: 'Não há tipo de condição — assim, nunca casa.',
    },
    unknownType: {
      line: "tipo de condição desconhecido '{{type}}' — esta versão não consegue vigiá-lo — parou de vigiar",
      sentence: "O tipo de condição '{{type}}' é desconhecido — esta versão não consegue vigiá-lo.",
    },
  },

  result: {
    skipped: {
      busy: 'pulado (o app estava ocupado)',
      unsaved: 'pulado (mudanças não salvas)',
      scope: 'pulado ({{what}} estava aberta)',
      dialog: 'pulado (um diálogo estava aberto)',
      hotkey: 'pulado (capturando uma hotkey)',
      dataTable: 'pulado (editando a tabela do Data Loop)',
      automation: 'pulado (editando uma automação)',
      step: 'pulado (editando um passo)',
      row: 'pulado (editando uma linha)',
      unknown: 'pulado (diálogo aberto)',
    },
    missed: {
      busy: 'perdido (o app ficou ocupado além do prazo de tolerância)',
      starting: 'perdido (o app ainda estava iniciando no fim do prazo de tolerância)',
      scope: 'perdido ({{what}} ficou aberta além do prazo de tolerância)',
      dialog: 'perdido (um diálogo ficou aberto além do prazo de tolerância)',
      hotkey: 'perdido (capturando uma hotkey além do prazo de tolerância)',
      dataTable: 'perdido (editando a tabela do Data Loop além do prazo de tolerância)',
      automation: 'perdido (editando uma automação além do prazo de tolerância)',
      step: 'perdido (editando um passo além do prazo de tolerância)',
      row: 'perdido (editando uma linha além do prazo de tolerância)',
    },
    edge: {
      hours: 'disparo pulado (fora da faixa de horas {{hours}} — aparição expirada)',
      cooldown: 'disparo pulado (a espera entre disparos ainda não tinha acabado — aparição expirada)',
      starting: 'disparo pulado (o app ainda estava iniciando — aparição expirada)',
      unsaved: 'disparo pulado (mudanças não salvas — aparição expirada)',
      busy: 'disparo pulado (o app ficou ocupado tempo demais — aparição expirada)',
      scope: 'disparo pulado ({{what}} estava aberta) — aparição expirada',
      dialog: 'disparo pulado (um diálogo estava aberto) — aparição expirada',
      hotkey: 'disparo pulado (capturando uma hotkey) — aparição expirada',
      dataTable: 'disparo pulado (editando a tabela do Data Loop) — aparição expirada',
      automation: 'disparo pulado (editando uma automação) — aparição expirada',
      step: 'disparo pulado (editando um passo) — aparição expirada',
      row: 'disparo pulado (editando uma linha) — aparição expirada',
      unknown: 'disparo pulado (um diálogo estava aberto) — aparição expirada',
    },
    waiting: 'esperando (o app está iniciando)',
    failed: 'não foi possível iniciar',
    late: 'pulado — {{minutes}} min de atraso (o computador estava suspenso ou o relógio mudou)',
    outsideHours: 'fora da faixa de horas ({{hours}})',
    clipboardIgnored: 'mudança do clipboard ignorada (logo depois de uma reprodução)',
    crashed: 'parou de vigiar por um erro: {{reason}}',
  },
} satisfies Catalogo<typeof en>;
