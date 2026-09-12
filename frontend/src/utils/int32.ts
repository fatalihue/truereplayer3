/**
 * `int.TryParse(s, out n)` under the default NumberStyles.Integer: AllowLeadingSign plus
 * AllowLeadingWhite/AllowTrailingWhite, no group separators, and FAILURE outside Int32.
 *
 * The whitespace class is spelled out rather than written as \s: JS \s also matches U+00A0,
 * U+FEFF, U+1680, U+2000-200A, U+2028/9, U+202F, U+205F and U+3000, none of which C# accepts —
 * it allows only U+0009-U+000D and U+0020. With \s, `{enter:U+00A0 5}` would repeat 5 times on
 * this side and once in the engine.
 *
 * Lives in utils/ because more than one mirror needs it and they must not drift: the Send Text
 * grammar (lexical/tokenNormalize.ts) and the Test action's own budget (utils/typeBudget.ts).
 * MOVED here rather than re-exported from the Lexical module on purpose — the sheet loads that
 * editor lazily, and importing a helper out of it would drag the whole editor into the panel's
 * first chunk.
 */
export function tryParseInt32(s: string): number | null {
  if (!/^[ \t\n\v\f\r]*[+-]?[0-9]+[ \t\n\v\f\r]*$/.test(s)) return null;
  const n = Number(s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, ''));
  if (!Number.isSafeInteger(n) || n < -2147483648 || n > 2147483647) return null;
  return n;
}
