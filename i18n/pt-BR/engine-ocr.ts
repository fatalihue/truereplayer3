import type en from '../en-US/engine-ocr.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  // Os rótulos da página em pt-BR (Configurações, Screen Text, Instalar) e os nomes das Configurações
  // do Windows em pt-BR (Hora e idioma, Idioma e região, Reconhecimento óptico de caracteres).
  noLanguage: 'Nenhum idioma de OCR instalado. Configurações → Screen Text → Instalar, ou Configurações do Windows → Hora e idioma → Idioma e região → adicione um idioma com "Reconhecimento óptico de caracteres".',

  // Depois de dois-pontos: começa em minúscula, como o "erro desconhecido" da página.
  install: {
    notOffered: "'{{tag}}' não é um idioma que o {{app}} instala.",
    dismNotStarted: 'o DISM não iniciou.',
    stillInstalling: 'o Windows ainda está instalando depois de 20 minutos. Confira de novo mais tarde em Configurações.',
    failed: 'o Windows não conseguiu adicionar o pacote (DISM 0x{{code}}).',
  },

  variant: {
    double: '2×',
    doubleStretch: '2× contraste',
    doubleKey: '2× filtro de cor',
    tripleKey: '3× filtro de cor',
    doubleLabel: '2× + rótulo',
    tripleKeyLabel: '3× filtro de cor + rótulo',
    offScreen: 'fora da tela',
  },

  notNumber: "O valor não é um número: '{{value}}'",

  // Como a coluna Details da lista (list.details.textHas: "tem").
  summary: {
    has: 'tem "{{text}}"',
    regex: 'regex {{text}}',
  },
} satisfies Catalogo<typeof en>;
