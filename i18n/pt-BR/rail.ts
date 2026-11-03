import type en from '../en-US/rail.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  nav: 'Destinos',
  backToMacros: 'Volta às macros — o Clicker para',
  automationsArmed: {
    zero: '{{>common.pages.automations}} · nenhuma armada',
    one: '{{>common.pages.automations}} · {{count}} armada',
    other: '{{>common.pages.automations}} · {{count}} armadas',
  },
} satisfies Catalogo<typeof en>;
