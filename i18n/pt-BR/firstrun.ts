import type en from '../en-US/firstrun.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  title: 'Crie sua primeira macro',
  lead: 'Uma macro é uma lista de passos — cliques, teclas, texto e esperas — que o {{app}} reproduz para você, quantas vezes você quiser.',

  record: {
    title: 'Gravar a tarefa',
    text: 'Faça a tarefa uma vez. Cada clique e cada tecla que você apertar vira um passo.',
  },
  build: {
    title: 'Montar passo a passo',
    text: 'Escolha passos no catálogo — clique, tecla, texto, espera, condição — e preencha cada um.',
    button: 'Novo passo',
  },
  example: {
    title: 'Começar de um exemplo',
    text: '19 macros curtas que mostram tokens de texto, variáveis, condições e tabelas. Cada uma digita no Bloco de Notas, para você ver funcionando.',
    button: 'Ver exemplos',
  },

  tr2: {
    text: 'Traz {{parts}}, como cópia: o {{tr2}} fica como está.',
    list: '{{first}} e {{last}}',
    settings: 'configurações',
    remaps: 'Key Remaps',
    theme: 'tema',
  },

  drop: 'Tem um arquivo de macro? Solte aqui ou',
  dropOnly: 'Só um arquivo .trprofile, uma exportação de macro, entra aqui.',
  dropUnreadable: 'Não foi possível ler esse arquivo daqui. Salve-o em uma pasta antes ou use {{>common.actions.importEllipsis}}.',

  how: {
    label: 'Como uma macro roda',
    record: 'Inicia e para a gravação, de qualquer app.',
    replay: 'Reproduz a macro. Aperte de novo para parar.',
    shortcut: 'Atalho',
    shortcutText: 'Dê à macro uma tecla própria para rodá-la de qualquer app.',
  },
} satisfies Catalogo<typeof en>;
