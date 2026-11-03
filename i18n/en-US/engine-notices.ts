// O motor: as notificações do Windows que saem da bandeja (Source/WindowShellServices.cs; o
// construtor é Source/WindowsNotices.cs). Saem também com a janela fechada, então o texto vem
// daqui, nunca da página. Cada uma tem um título, uma linha e os botões, que dizem o verbo.
// As notificações das automações, dos remaps, da lista de dados e da execução que parou são
// montadas por quem as chama, nas áreas delas.
// Nas lacunas: app = o nome deste app (marca, igual nos dois idiomas).
export default {
  // A janela foi para a bandeja (o X dela, ou a abertura com o Windows): o app continua. Uma vez
  // por sessão, até o Got it.
  stillRunning: {
    title: '{{app}} is still running',
    text: 'Closing the window keeps shortcuts, automations and remaps working. To quit, use the tray icon.',
    gotIt: 'Got it',          // botão: não mostra mais esta notificação
    settings: 'Settings',     // botão: mostra a janela, em Settings
  },
} as const;
