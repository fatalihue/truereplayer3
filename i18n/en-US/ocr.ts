// O estado do idioma da leitura de texto (OCR) quando o escolhido não é o que as leituras vão usar
// (utils/ocrLanguages.ts): a linha sob o idioma em Settings › Screen Text, ao lado de Install. O
// Inspector usa o mesmo estado para dizer o que falta (shell/inspector/missing.tsx, área inspector).
// Orçamento: uma linha de 148 px a 11 px ao lado de Install; o pt-BR fica do tamanho do inglês.
//
// Nas lacunas: name = o idioma em uso, como a lista de Settings › Screen Text o escreve ("Português",
// "English"); app = o nome deste app (frontend/src/appIdentity.ts).
export default {
  none: 'No OCR language on this PC',      // nenhum idioma escolhido e nenhum pacote para o Auto
  installing: 'Installing…',               // o pacote do idioma escolhido está sendo instalado
  restart: 'Installed — restart {{app}}',  // instalado, esperando o app reiniciar (o pacote)
  missingUses: 'Missing — uses {{name}}',  // falta o pacote; as leituras usam outro idioma (o pacote)
  missingNone: 'Missing — no OCR yet',     // falta o pacote, e não há outro
} as const;
