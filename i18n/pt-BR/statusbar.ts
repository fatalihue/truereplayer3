import type en from '../en-US/statusbar.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  switches: 'Chaves gerais',

  shortcutsOn: 'Atalhos ativados',
  shortcutsOff: 'Atalhos desativados',
  shortcutsPaused: 'Atalhos pausados pelo Clicker',
  shortcutsOnTip: 'As hotkeys e as hotstrings das macros disparam. Desativar pausa todas elas, os Key Remaps e as hotkeys de gravar, reproduzir e copiar.',
  shortcutsOffTip: 'Desativados: as hotkeys e as hotstrings das macros, os Key Remaps e as hotkeys de gravar, reproduzir e copiar ficam pausados — as de gravar e reproduzir só param o que já está rodando.',
  shortcutsPausedTip: 'Pausados enquanto a página do Clicker está aberta: as hotkeys e as hotstrings das macros esperam ela fechar.',

  automationsOn: 'Automações ativadas',
  automationsArmed: {
    zero: '0 armadas',
    one: '{{count}} armada',
    other: '{{count}} armadas',
  },
  automationsOff: 'Automações desativadas',
  automationsOnTip: 'As automações armadas rodam suas macros quando o gatilho chega. Desativadas, todas esperam.',
  automationsOffTip: 'Desativadas: nenhuma automação roda, armada ou não.',

  remapsOn: 'Key Remaps ativados',
  remapsActive: {
    zero: '0 ativos',
    one: '{{count}} ativo',
    other: '{{count}} ativos',
  },
  remapsOff: 'Key Remaps desativados',
  remapsPaused: 'Key Remaps pausados',
  remapsOnTip: 'Os Key Remaps valem. Também pausam durante a gravação.',
  remapsOffTip: 'Desativados: cada tecla faz o que sempre fez.',
  remapsPausedTip: 'Ativados, mas pausados enquanto os atalhos estão desativados.',

  extensionConnected: 'Extensão conectada',
  extensionNotConnected: 'Extensão desconectada',
  extensionReload: 'Extensão desatualizada',
  extensionConnectedTip: 'A extensão do navegador está conectada',
  extensionNotConnectedTip: 'As ações de navegador falham, e as condições de navegador leem como não encontradas. Conecte a extensão.',
  extensionReloadTip: 'A versão {{current}} está carregada, e este app espera a {{expected}}. Recarregue em chrome://extensions.',

  saved: 'Salvo às {{time}}',
  savedTip: 'As alterações são salvas na hora',
  notSaved: 'Não salvo',
} satisfies Catalogo<typeof en>;
