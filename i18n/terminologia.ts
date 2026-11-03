// A terminologia: palavras traduzidas sempre do mesmo jeito (plano de idiomas, §2.3). O termo é o do
// Windows em pt-BR; um sinônimo curto só entra onde a medida de largura pede (§4.2).
//
// tools/gen-i18n.mjs confere as linhas com `en` e `pt`: quando o texto em inglês tem a palavra, o
// pt-BR tem a dele. As expressões pegam a raiz ("Delet" pega Delete, Deleted, Deleting), sem
// diferença de maiúscula. Uma chave em que a palavra está em outro papel vai para ISENCOES, em
// i18n/glossario.ts. As linhas sem expressão são a regra, sem conferência: o termo do inglês tem mais
// de um sentido.

export type Termo = {
  /** Como o inglês escreve. */
  readonly ingles: string;
  /** Como o pt-BR escreve. */
  readonly portugues: string;
  /** Por quê. */
  readonly porque: string;
  /** Quando o inglês casa `en`, o pt-BR casa `pt`. */
  readonly en?: RegExp;
  readonly pt?: RegExp;
};

export const TERMINOLOGIA: readonly Termo[] = [
  { ingles: 'macro', portugues: 'a macro', porque: 'o dono decidiu em 02-11; é o gênero do Office ("Gravar Macro")' },
  { ingles: 'step', portugues: 'passo', porque: 'o passo de uma sequência; a "etapa" da Microsoft é a de um assistente', en: /\bsteps?\b/i, pt: /passo/i },
  { ingles: 'run (substantivo)', portugues: 'execução', porque: 'Microsoft: "Executar"' },
  { ingles: 'run (verbo)', portugues: 'rodar; "executar" quando o assunto é do Windows', porque: '"rodar" é curto e corrente' },
  { ingles: 'record, recording', portugues: 'gravar, gravação', porque: 'Office: "Gravar Macro"', en: /\brecord/i, pt: /grav/i },
  { ingles: 'replay, replaying', portugues: 'reproduzir, reproduzindo', porque: 'Microsoft: "Reproduzir"', en: /\breplay/i, pt: /reproduz/i },
  { ingles: 'pause', portugues: 'pausar (o passo Pause fica)', porque: 'Microsoft: "Pausar"', en: /\bpaus/i, pt: /paus/i },
  { ingles: 'resume', portugues: 'retomar', porque: 'Microsoft: "Retomar"', en: /\bresum/i, pt: /retom/i },
  { ingles: 'stop (verbo)', portugues: 'parar (o passo Stop fica)', porque: 'Microsoft: "Parar"' },
  { ingles: 'library', portugues: 'biblioteca', porque: 'Microsoft', en: /\blibrar/i, pt: /bibliotec/i },
  { ingles: 'folder', portugues: 'pasta', porque: 'Microsoft', en: /\bfolders?\b/i, pt: /pasta/i },
  { ingles: 'settings', portugues: 'Configurações', porque: 'Windows', en: /\bsettings\b/i, pt: /configura/i },
  { ingles: 'shortcuts (a chave geral)', portugues: 'atalhos ("Atalhos ativados")', porque: 'Windows: "atalho de teclado"', en: /\bshortcuts?\b/i, pt: /atalho/i },
  { ingles: 'automation', portugues: 'automação', porque: 'é nome comum ("uma automação")', en: /\bautomations?\b/i, pt: /automa/i },
  { ingles: 'check (do If)', portugues: 'condição', porque: 'é o nome comum do que um If testa' },
  { ingles: 'delete', portugues: 'excluir', porque: 'Windows: "Excluir"', en: /\bdelet/i, pt: /exclu/i },
  { ingles: 'clear', portugues: 'limpar', porque: 'Windows', en: /\bclear\b/i, pt: /limp/i },
  { ingles: 'remove', portugues: 'remover', porque: 'Windows', en: /\bremov/i, pt: /remov/i },
  { ingles: 'search', portugues: 'pesquisar', porque: 'Windows: "Pesquisar"; cabe em todos os campos de busca medidos', en: /\bsearch/i, pt: /pesquis/i },
  { ingles: 'pick', portugues: 'escolher', porque: 'a Microsoft aceita "selecionar" e "escolher" como sinônimos' },
  { ingles: 'test', portugues: 'testar', porque: 'Microsoft' },
  { ingles: 'undo / redo', portugues: 'desfazer / refazer', porque: 'Windows', en: /\bundo\b/i, pt: /desfaz/i },
  { ingles: 'redo', portugues: 'refazer', porque: 'Windows', en: /\bredo\b/i, pt: /refaz/i },
  { ingles: 'rename', portugues: 'renomear', porque: 'Windows', en: /\brenam/i, pt: /renome/i },
  { ingles: 'duplicate', portugues: 'duplicar', porque: 'Windows', en: /\bduplicat/i, pt: /duplic/i },
  { ingles: 'import', portugues: 'importar', porque: 'Windows', en: /\bimport(s|ed|ing)?\b/i, pt: /import/i },
  { ingles: 'export', portugues: 'exportar', porque: 'Windows', en: /\bexport(s|ed|ing)?\b/i, pt: /export/i },
  { ingles: 'on / off', portugues: 'ativado(s), ativada(s) / desativado(s), desativada(s)', porque: 'as chaves de ligar do Windows; concorda com o item, numa frase inteira por item' },
  { ingles: 'found / not found', portugues: 'encontrada / não encontrada', porque: 'Microsoft; concorda com a condição, numa frase por condição', en: /\bnot found\b/i, pt: /não encontrad/i },
  { ingles: 'tray', portugues: 'bandeja', porque: 'curto e corrente; a Microsoft diz "área de notificação" (19 letras)', en: /\btray\b/i, pt: /bandeja/i },
  { ingles: 'notice', portugues: 'aviso', porque: 'Microsoft', en: /\bnotices?\b/i, pt: /aviso/i },
  { ingles: 'tip', portugues: 'dica', porque: 'a "dica de ferramenta" da Microsoft é longa demais para os botões', en: /\btips?\b/i, pt: /dica/i },
  { ingles: 'trigger', portugues: 'gatilho', porque: 'nome comum do que dispara uma automação' },
  { ingles: 'window target', portugues: 'janela-alvo', porque: 'o alvo da macro', en: /\bwindow target/i, pt: /janela-alvo/i },
  { ingles: 'jitter', portugues: 'variação', porque: 'diz o que faz', en: /\bjitter\b/i, pt: /varia/i },
];
