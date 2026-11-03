import type en from '../en-US/ocr.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  none: 'Nenhum idioma de OCR neste PC',
  installing: 'Instalando…',
  restart: 'Instalado — reinicie o {{app}}',
  missingUses: 'Ausente — usa {{name}}',
  missingNone: 'Ausente — ainda sem OCR',
} satisfies Catalogo<typeof en>;
