using System;
using System.Collections.Generic;
using System.Drawing;
using System.Globalization;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using TrueReplayer.Models;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The comparator for everything that reads the screen (Wait for Text, the Screen Text condition, the
    /// automation watcher). Pure and static so it can be probed against the DLL.
    ///
    /// Text mode — operator contains (default) | eq | regex:
    ///   contains/eq ignore case, whitespace and accents on BOTH sides: the engine inserts spaces around
    ///   separators ("1 , 234") and a pt-BR pack can eat an accent. regex runs on the raw text (lines
    ///   joined by "\n"), IgnoreCase, 50 ms timeout — a bad pattern throws, into the probe-error policy.
    /// Number mode — operator eq (default) | neq | gt | lt against the FIRST number in reading order:
    ///   letters the engine confuses with digits are mapped only INSIDE a token that already holds a
    ///   digit (O/o/D/Q/e→0, I/l/|→1, S/s→5, B→8; a leading S/s/$ is a currency sign), spaces between
    ///   a digit and a separator are dropped, and a separator followed by exactly three digits groups
    ///   thousands ("1,234" = 1234, "1,5" = 1.5). No number on screen = false, not an error; an operand
    ///   that is not a number IS an error.
    /// </summary>
    public static class ScreenTextMatcher
    {
        public sealed record Result(bool Ok, Rectangle? Rect, decimal? Number);

        public static bool IsNumberMode(string? readAs) =>
            string.Equals(readAs, "number", StringComparison.OrdinalIgnoreCase);

        /// <summary>The operator the row really means: an operator that does not fit the mode reads as the mode's default.</summary>
        public static string EffectiveOperator(string? op, bool number)
        {
            var o = (op ?? "").Trim().ToLowerInvariant();
            if (number) return o is "eq" or "neq" or "gt" or "lt" ? o : "eq";
            return o is "contains" or "eq" or "regex" ? o : "contains";
        }

        public static Result Evaluate(OcrRead read, string? op, string operand, bool number)
        {
            var words = Flatten(read);
            var effective = EffectiveOperator(op, number);
            if (number)
            {
                if (!TryParseNumber(operand, out var target))
                    throw new FormatException($"Value is not a number: '{operand}'");
                if (!TryExtractNumber(words, out var value, out var span)) return new Result(false, null, null);
                bool ok = effective switch
                {
                    "neq" => value != target,
                    "gt" => value > target,
                    "lt" => value < target,
                    _ => value == target,
                };
                return new Result(ok, ok ? Union(words, span) : null, value);
            }

            if (effective == "regex")
            {
                if (string.IsNullOrEmpty(operand)) return new Result(false, null, null);
                var raw = BuildRaw(words);
                var m = Regex.Match(raw.Text, operand, RegexOptions.IgnoreCase, TimeSpan.FromMilliseconds(50));
                if (!m.Success) return new Result(false, null, null);
                var hit = new HashSet<int>();
                for (int i = m.Index; i < m.Index + Math.Max(1, m.Length) && i < raw.Word.Count; i++)
                    if (raw.Word[i] >= 0) hit.Add(raw.Word[i]);
                return new Result(true, Union(words, hit), null);
            }

            var needle = Normalize(operand);
            if (needle.Length == 0) return new Result(false, null, null);
            var hay = BuildNormalized(words);
            if (effective == "eq")
            {
                bool ok = hay.Text == needle;
                return new Result(ok, ok ? Union(words, Enumerable.Range(0, words.Count)) : null, null);
            }
            int at = hay.Text.IndexOf(needle, StringComparison.Ordinal);
            if (at < 0) return new Result(false, null, null);
            var set = new HashSet<int>();
            for (int i = at; i < at + needle.Length; i++) set.Add(hay.Word[i]);
            return new Result(true, Union(words, set), null);
        }

        /// <summary>The value Set Variable's Screen mode stores: the text, or the first number as invariant text.</summary>
        public static string ValueForVariable(OcrRead read, bool number)
        {
            if (!number) return read.Text.Trim();
            var words = Flatten(read);
            return TryExtractNumber(words, out var v, out _) ? v.ToString("0.############################", CultureInfo.InvariantCulture) : "";
        }

        /// <summary>Grid / run-report summary: `has "Victory"`, `= "Ready"`, `regex ^Lv`, `&lt; 30`.</summary>
        public static string Summary(ActionItem a)
        {
            bool number = IsNumberMode(a.OcrReadAs);
            var op = EffectiveOperator(a.ConditionOperator, number);
            var operand = a.ConditionOperand ?? "";
            if (operand.Length > 40) operand = operand[..37] + "...";
            if (number)
            {
                var sym = op switch { "neq" => "≠", "gt" => ">", "lt" => "<", _ => "=" };
                return operand.Length == 0 ? "#" : $"{sym} {operand}";
            }
            if (operand.Length == 0) return "";
            return op switch
            {
                "eq" => $"= \"{operand}\"",
                "regex" => $"regex {operand}",
                _ => $"has \"{operand}\"",
            };
        }

        // ── internals ──────────────────────────────────────────────────────────────────────────

        private sealed class CharMap
        {
            public readonly StringBuilder Sb = new();
            public readonly List<int> Word = new();
            public string Text => Sb.ToString();
            public void Add(char c, int w) { Sb.Append(c); Word.Add(w); }
        }

        private static List<OcrWord> Flatten(OcrRead read) =>
            read.Lines.SelectMany(l => l.Words).ToList();

        private static (string Text, List<int> Word) BuildRaw(List<OcrWord> words)
        {
            // Rebuilt from the words so every char maps back to one; lines are not tracked separately
            // because OcrLine.Text is exactly its words joined with a space.
            var map = new CharMap();
            for (int i = 0; i < words.Count; i++)
            {
                if (i > 0) map.Add(' ', -1);
                foreach (var c in words[i].Text) map.Add(c, i);
            }
            return (map.Text, map.Word);
        }

        private static (string Text, List<int> Word) BuildNormalized(List<OcrWord> words)
        {
            var map = new CharMap();
            for (int i = 0; i < words.Count; i++)
                foreach (var c in NormalizeChars(words[i].Text)) map.Add(c, i);
            return (map.Text, map.Word);
        }

        public static string Normalize(string? s) => new string(NormalizeChars(s ?? "").ToArray());

        private static IEnumerable<char> NormalizeChars(string s)
        {
            foreach (var c in s.Normalize(NormalizationForm.FormD))
            {
                if (char.IsWhiteSpace(c)) continue;
                if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
                yield return char.ToLowerInvariant(c);
            }
        }

        private static Rectangle? Union(List<OcrWord> words, IEnumerable<int> indices)
        {
            Rectangle? r = null;
            foreach (var i in indices)
            {
                if (i < 0 || i >= words.Count) continue;
                r = r is Rectangle acc ? Rectangle.Union(acc, words[i].Rect) : words[i].Rect;
            }
            return r;
        }

        private static readonly Dictionary<char, char> Confusables = new()
        {
            ['O'] = '0', ['o'] = '0', ['D'] = '0', ['Q'] = '0', ['e'] = '0',
            ['I'] = '1', ['l'] = '1', ['|'] = '1',
            ['S'] = '5', ['s'] = '5',
            ['B'] = '8',
        };

        private static bool IsNumChar(char c) => char.IsDigit(c) || c == '.' || c == ',' || Confusables.ContainsKey(c);

        /// <summary>First number in reading order. <paramref name="wordSpan"/> = the words it came from.</summary>
        private static bool TryExtractNumber(List<OcrWord> words, out decimal value, out HashSet<int> wordSpan)
        {
            value = 0;
            wordSpan = new HashSet<int>();
            var raw = BuildRaw(words);
            var text = raw.Text;
            // Drop spaces sitting between a digit and a separator (either side): "1 , 234" → "1,234".
            var map = new CharMap();
            for (int i = 0; i < text.Length; i++)
            {
                if (text[i] == ' ')
                {
                    int p = map.Sb.Length - 1;
                    char prev = p >= 0 ? map.Sb[p] : '\0';
                    int n = i + 1; while (n < text.Length && text[n] == ' ') n++;
                    char next = n < text.Length ? text[n] : '\0';
                    bool glue = (char.IsDigit(prev) && (next == '.' || next == ',')) || ((prev == '.' || prev == ',') && char.IsDigit(next));
                    if (glue) continue;
                }
                map.Add(text[i], raw.Word[i]);
            }
            var s = map.Text;

            int idx = 0;
            while (idx < s.Length)
            {
                if (!IsNumChar(s[idx]) && s[idx] != '$') { idx++; continue; }
                int start = idx;
                while (idx < s.Length && (IsNumChar(s[idx]) || s[idx] == '$')) idx++;
                var token = s.Substring(start, idx - start);
                if (!token.Any(char.IsDigit)) continue;

                int offset = 0;
                // Leading currency: "$12", "S12" — a sign, not a 5.
                while (token.Length - offset > 1 && (token[offset] == '$' || token[offset] == 'S' || token[offset] == 's')
                       && char.IsDigit(token[offset + 1])) offset++;
                var sb = new StringBuilder();
                for (int i = offset; i < token.Length; i++)
                {
                    char c = token[i];
                    if (c == '$') continue;
                    sb.Append(Confusables.TryGetValue(c, out var d) ? d : c);
                }
                var cleaned = sb.ToString().Trim('.', ',');
                if (!cleaned.Any(char.IsDigit) || !TryParseNumber(cleaned, out var v)) continue;
                bool negative = start > 0 && s[start - 1] == '-';
                value = negative ? -v : v;
                for (int i = start; i < idx; i++) if (map.Word[i] >= 0) wordSpan.Add(map.Word[i]);
                return true;
            }
            return false;
        }

        /// <summary>
        /// Parses "1234", "1,234", "1.234,5", "12.50", "1,5", "-3". Both separators: the LAST is the
        /// decimal point. One kind: groups of exactly three digits after every separator = thousands,
        /// otherwise a single separator is the decimal point.
        /// </summary>
        public static bool TryParseNumber(string? input, out decimal value)
        {
            value = 0;
            var s = (input ?? "").Trim().Replace(" ", "");
            if (s.Length == 0) return false;
            bool neg = s.StartsWith('-');
            if (neg || s.StartsWith('+')) s = s[1..];
            if (s.Length == 0 || s.Any(c => !char.IsDigit(c) && c != '.' && c != ',')) return false;

            int lastDot = s.LastIndexOf('.'), lastComma = s.LastIndexOf(',');
            string normalized;
            if (lastDot >= 0 && lastComma >= 0)
            {
                char dec = lastDot > lastComma ? '.' : ',';
                char grp = dec == '.' ? ',' : '.';
                normalized = s.Replace(grp.ToString(), "").Replace(dec, '.');
            }
            else if (lastDot >= 0 || lastComma >= 0)
            {
                char sep = lastDot >= 0 ? '.' : ',';
                var parts = s.Split(sep);
                bool thousands = parts.Length > 1 && parts[0].Length is >= 1 and <= 3
                                 && parts.Skip(1).All(p => p.Length == 3)
                                 && (parts.Length > 2 || parts[0] != "0");
                normalized = thousands ? string.Concat(parts) : (parts.Length == 2 ? parts[0] + "." + parts[1] : "");
                if (normalized.Length == 0) return false;
            }
            else normalized = s;

            if (!decimal.TryParse(normalized, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value)) return false;
            if (neg) value = -value;
            return true;
        }
    }
}
