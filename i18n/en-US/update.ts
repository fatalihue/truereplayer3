// A tela de atualização (components/UpdateOverlay.tsx): cobre o app enquanto uma versão nova baixa e
// se instala, e some quando a atualização para (o motivo de um erro vem do motor, nas áreas engine-*).
// Um cartão estreito (no máximo 420 px), com o texto centralizado.
//
// Nas lacunas: app = o nome deste app (frontend/src/appIdentity.ts); version = o número da versão nova,
// "3.1.0" (o "v" fica no texto).
export default {
  // O título, em cada fase.
  title: {
    available: 'Update available',        // a versão nova espera a pessoa escolher
    downloading: 'Downloading update',
    installing: 'Updating to v{{version}}',
    complete: 'Update complete',
  },
  // A linha menor sob o título, em cada fase.
  sub: {
    available: 'A new version of {{app}} is ready',
    downloading: 'Do not close the app',
    installing: 'Closing {{app}}…',       // o app fecha para instalar
    complete: 'You are now on the latest version',
  },
  // Os quadros das versões, atual ➜ nova: um rótulo pequeno, em maiúsculas, sobre o número. Na fase
  // final, um quadro só, com a versão nova como a atual.
  currentVersion: 'Current version',
  newVersion: 'New version',
  whatsNew: "What's new",                 // título da lista das novidades, antes do botão
  progress: 'Update progress',            // nome da barra de progresso (leitor de tela)
  downloadingBar: 'Downloading…',         // sob a barra, à esquerda da porcentagem
  applying: 'Applying update, please wait…',      // sob a barra cheia, enquanto instala
  restart: 'The app will restart automatically',  // a última linha, menor
  install: 'Download and install',        // o botão, a largura toda do cartão · verbo
} as const;
