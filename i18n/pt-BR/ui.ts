import type en from '../en-US/ui.ts';
import type { Catalogo } from '../tipos.ts';

export default {
  number: {
    increase: 'Aumentar',
    decrease: 'Diminuir',
  },
  toast: {
    dismiss: 'Fechar aviso',
    showInFolder: 'Mostrar na pasta',
  },
  // A exportação parcial vira rótulo e números ("Macros exportadas: 2 de 3"): o particípio não concorda
  // com duas contagens ao mesmo tempo. O zero não acontece (o aviso só sai com uma macro ou mais).
  export: {
    done: { zero: 'Nenhuma macro exportada.', one: '{{n}} macro exportada.', other: '{{n}} macros exportadas.' },
    doneTo: { zero: 'Nenhuma macro exportada para {{file}}.', one: '{{n}} macro exportada para {{file}}.', other: '{{n}} macros exportadas para {{file}}.' },
    partial: { zero: 'Macros exportadas: {{n}} de {{total}}.', one: 'Macros exportadas: {{n}} de {{total}}.', other: 'Macros exportadas: {{n}} de {{total}}.' },
    partialTo: { zero: 'Macros exportadas para {{file}}: {{n}} de {{total}}.', one: 'Macros exportadas para {{file}}: {{n}} de {{total}}.', other: 'Macros exportadas para {{file}}: {{n}} de {{total}}.' },
    notLoaded: 'Não foi possível carregar {{n}}.',
    included: { zero: 'Nenhuma macro que elas rodam foi incluída.', one: 'Também foi incluída {{n}} macro que elas rodam: {{names}}.', other: 'Também foram incluídas {{n}} macros que elas rodam: {{names}}.' },
    missingImages: { zero: 'Nenhuma imagem de referência ficou de fora.', one: '{{n}} imagem de referência não foi encontrada e ficou de fora.', other: '{{n}} imagens de referência não foram encontradas e ficaram de fora.' },
  },
  crash: {
    title: 'A interface encontrou um erro',
    body: 'Suas macros e gravações estão seguras — isso só afetou a exibição da janela. Recarregue para continuar; se acontecer de novo, o texto abaixo diz onde.',
    reload: 'Recarregar interface',
  },
} satisfies Catalogo<typeof en>;
