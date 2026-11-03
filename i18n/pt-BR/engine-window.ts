import type en from '../en-US/engine-window.ts';
import type { Catalogo } from '../tipos.ts';

// Os nomes de macro vão entre aspas duplas, como nos avisos da página. "app" é masculino ("o
// TrueReplayer 3"), e o processo de uma janela "está rodando", como na página dos Key Remaps.
// Os itens do menu da bandeja citados no diálogo da recuperação chegam pelas lacunas, no idioma.
export default {
  alerts: {
    hotkeyIgnored: 'Hotkey da macro "{{name}}" ignorada — "{{process}}" não está rodando',
    hotkeyIgnoredNoProcess: 'Hotkey da macro "{{name}}" ignorada — a janela-alvo dela não está aberta',
    shortcutsOff: 'Os atalhos estão desativados — {{combo}} foi para o app em primeiro plano. Pressione {{hotkey}} para ativá-los de novo.',
    shortcutsOffNoKey: 'Os atalhos estão desativados — {{combo}} foi para o app em primeiro plano. Ative-os de novo na barra de status ou na bandeja.',
    selectionCaptured: 'Seleção capturada → {clip:{{slot}}}',
    couldNotStart: 'Não foi possível rodar a macro "{{name}}": {{reason}}',
  },

  startup: {
    macrosNotLoaded: {
      zero: 'Não foi possível carregar {{n}} macros: {{names}}',
      one: 'Não foi possível carregar {{n}} macro: {{names}}',
      other: 'Não foi possível carregar {{n}} macros: {{names}}',
    },
    manyMacrosNotLoaded: 'Não foi possível carregar {{n}} macros (as 5 primeiras: {{names}}, …)',
    settingsUnreadable: 'Não foi possível ler o arquivo de configurações (outro programa estava com ele aberto), então esta sessão usa as configurações padrão e não salva alterações nelas. Reinicie o {{app}} para carregar suas configurações.',
    dataFailed: 'Não foi possível carregar todos os dados ao abrir o app. Algumas macros ou hotkeys podem estar indisponíveis.',
  },

  dialogs: {
    webViewFailed: 'Não foi possível abrir a interface do {{app}}, porque o Microsoft Edge WebView2 Runtime não inicializou.\n\nInstale ou repare o WebView2 Runtime e reinicie o {{app}}.',
    uiFilesMissing: 'Não foi possível carregar os arquivos da interface do {{app}}.\n\nEles podem ter sido removidos ou colocados em quarentena pelo antivírus. Reinstale ou repare o {{app}} e, se o antivírus marcou a pasta de instalação dele, adicione-a às exceções.',
    uiNotFinished: 'Não foi possível terminar de abrir a interface do {{app}}.\n\nReinicie o {{app}}. Se o problema continuar, repare o Microsoft Edge WebView2 Runtime.',
    saveFailed: 'Não foi possível salvar a macro:\n{{reason}}\n\nO {{app}} continuou aberto para que suas alterações não se percam.',
    recoveryExhausted: 'A interface do {{app}} não terminou de carregar, e reiniciar o app não resolveu.\n\nO app continua rodando — clique com o botão direito no ícone dele na bandeja e escolha "{{reload}}" para tentar de novo, ou "{{logs}}" para ver o que falhou.\n\nSe isso continuar acontecendo, adicione a pasta de instalação do {{app}} às exceções do antivírus e depois reinstale ou repare o app.',
    recoveryExhaustedLogs: 'A interface do {{app}} não terminou de carregar, e reiniciar o app não resolveu.\n\nO app continua rodando — clique com o botão direito no ícone dele na bandeja e escolha "{{reload}}" para tentar de novo, ou "{{logs}}" para ver o que falhou.\n\nSe isso continuar acontecendo, adicione a pasta de instalação do {{app}} às exceções do antivírus e depois reinstale ou repare o app.\n\nLogs: {{dir}}',
  },

  missingWebView: {
    text: 'O {{app}} precisa do Microsoft Edge WebView2 Runtime.\n\nClique em OK para abrir a página de download.\nDepois de instalar, reinicie o {{app}}.',
    title: '{{app}} — Dependência ausente',
  },

  // O primeiro parágrafo é o mesmo do aviso da página quando o 2 tenta abrir (shell.coexist.why).
  coexist: {
    heading: 'O {{tr2}} está aberto',
    text: 'Só um pode ficar aberto por vez: atalhos, teclas remapeadas, automações e a extensão do navegador entrariam em conflito.\n\nFeche o {{tr2}} pelo menu da bandeja dele (o Exit pergunta sobre o que não foi salvo), e o {{app}} abre sozinho.',
    close: 'Fechar o {{tr2}}…',
    show: 'Mostrar o {{tr2}}',
    cancel: 'Cancelar',
  },
} satisfies Catalogo<typeof en>;
