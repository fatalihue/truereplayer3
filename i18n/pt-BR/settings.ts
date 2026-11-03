import type en from '../en-US/settings.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  categories: {
    general: 'Geral',
    hotkeys: 'Hotkeys',
    appearance: 'Aparência',
    recording: 'Gravação e reprodução',
    screen: 'Screen Text',
    browser: 'Extensão do navegador',
    diagnostics: 'Diagnóstico',
  },
  language: {
    label: 'Idioma',
    hint: 'O idioma do app inteiro. Windows segue o idioma do Windows.',
    windows: 'Windows',
    english: 'English',
    portugues: 'Português',
  },
} satisfies Catalogo<typeof en>;
