// Settings (shell/pages/settings/). Por enquanto só a linha do idioma, em General › Interface (fatia
// I1); o resto da página vem para o catálogo na fatia I4.
export default {
  language: {
    label: 'Language',  // rótulo da linha e nome da lista (o leitor de tela lê) · nome
    hint: 'The language of the whole app. Windows follows the language of Windows.',  // sob o rótulo
    // As três opções da lista: cada idioma no próprio nome, para quem caiu no idioma errado achar o seu.
    windows: 'Windows',
    english: 'English',
    portugues: 'Português',
  },
} as const;
