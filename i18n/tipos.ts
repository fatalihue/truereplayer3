// Os tipos do catálogo de textos (plano de idiomas, .claude/planos/idiomas-tr3-2026-11-02.md, §3.1 e §3.2).
//
// Cada área é um arquivo em i18n/en-US/ e outro em i18n/pt-BR/, com o mesmo nome. O en-US dá a forma;
// o pt-BR declara `satisfies Catalogo<typeof en>`, e uma chave a mais ou a menos é erro no `tsc -b`.
// O que o tipo não pega (as mesmas lacunas, o glossário, a terminologia, os rótulos citados) o
// tools/gen-i18n.mjs confere no build.
//
// - Lacuna: `{{nome}}`. As chaves simples são dos tokens ({clipboard}, {row:Nome}) e ficam como texto.
// - Rótulo citado: `{{>área.chave}}` vira, no build, o texto da chave no mesmo idioma.
// - Plural: um objeto com `one` e `other`, mais `zero` quando o 0 pede outra frase. A lacuna `count`
//   escolhe a forma. O CLDR do português conta 0 como "one" ("0 segundo"), então em pt-BR todo
//   plural leva `zero`.
// - Os nomes `zero`, `one` e `other` são só do plural; um grupo de chaves nunca os usa.

/** Um plural em en-US: "1 step", "2 steps"; com `zero` quando o 0 tem frase própria. */
export type Plural = { readonly zero?: string; readonly one: string; readonly other: string };

/** Um plural em pt-BR: sempre com `zero` ("Nenhum passo" ou "0 passos"). */
export type PluralPt = { readonly zero: string; readonly one: string; readonly other: string };

/** A forma que o catálogo pt-BR tem de ter, tirada do en-US. */
export type Catalogo<T> = {
  readonly [K in keyof T]: T[K] extends string ? string
    : T[K] extends { readonly one: string; readonly other: string } ? PluralPt
    : Catalogo<T[K]>;
};
