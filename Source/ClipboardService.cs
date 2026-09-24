using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Linq;
using System.Text;
using TrueReplayer.Models;
using Windows.ApplicationModel.DataTransfer;

namespace TrueReplayer.Services
{
    public static class ClipboardService
    {
        /// <summary>Plain text to the clipboard — the palette's "Copy Diagnostics" (2026-09-05).</summary>
        public static void CopyText(string text)
        {
            var dataPackage = new Windows.ApplicationModel.DataTransfer.DataPackage();
            dataPackage.SetText(text);
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(dataPackage);
        }

        public static void CopyActions(ObservableCollection<ActionItem> actions)
        {
            if (actions == null || actions.Count == 0) return;

            var (tsv, html) = BuildFlavors(actions);
            var dataPackage = new DataPackage();
            dataPackage.SetText(tsv);
            dataPackage.SetHtmlFormat(HtmlFormatHelper.CreateHtmlFormat(html));
            Clipboard.SetContent(dataPackage);
        }

        // The two clipboard flavors, built apart from the clipboard itself.
        private static (string Tsv, string Html) BuildFlavors(IList<ActionItem> actions)
        {
            var headers = new[] { "#", "Action", "Key", "X", "Y", "Delay", "Notes" };
            var rows = new List<string[]>(actions.Count);
            for (int i = 0; i < actions.Count; i++)
            {
                var a = actions[i];
                rows.Add(new[]
                {
                    (i + 1).ToString(),
                    FriendlyActionType(a.ActionType),
                    FriendlyKey(a),
                    a.DisplayX ?? "",
                    a.DisplayY ?? "",
                    FormatDuration(a.Delay),
                    a.Comment ?? ""
                });
            }
            // The TSV flavor is one line per row and one tab per column, so a cell may carry
            // neither. Notes is a multi-line textarea and a SendText key can hold anything: an
            // Enter typed in a note split the row in two and shifted every column after it in
            // whatever the plain text was pasted into. The HTML flavor below keeps the originals.
            static string TsvCell(string cell) => cell.IndexOfAny(TsvBreakers) < 0 ? cell
                : cell.Replace("\r\n", " ").Replace('\r', ' ').Replace('\n', ' ').Replace('\t', ' ');

            int totalDelay = actions.Sum(a => a.Delay);
            string summary = $"Actions: {actions.Count} | Total delay: {FormatDuration(totalDelay)}";

            // TSV format (for spreadsheets)
            var tsv = new StringBuilder();
            tsv.AppendLine($"# {summary}");
            tsv.AppendLine(string.Join("\t", headers));
            foreach (var row in rows)
                tsv.AppendLine(string.Join("\t", row.Select(TsvCell)));

            // HTML table (for rich-text editors)
            var html = new StringBuilder();
            html.AppendLine("<table>");
            html.AppendLine("<caption style=\"text-align:left;font-size:11px;color:#888;padding:2px 4px\">" +
                System.Net.WebUtility.HtmlEncode(summary) + "</caption>");
            html.Append("<tr>");
            foreach (var h in headers)
                html.Append($"<th style=\"text-align:left;padding:2px 8px;border-bottom:1px solid #555\">{System.Net.WebUtility.HtmlEncode(h)}</th>");
            html.AppendLine("</tr>");
            foreach (var row in rows)
            {
                html.Append("<tr>");
                foreach (var cell in row)
                    html.Append($"<td style=\"padding:2px 8px\">{System.Net.WebUtility.HtmlEncode(cell)}</td>");
                html.AppendLine("</tr>");
            }
            html.AppendLine("</table>");

            return (tsv.ToString(), html.ToString());
        }

        private static readonly char[] TsvBreakers = { '\t', '\r', '\n' };

        private static string FormatDuration(int totalMs)
        {
            if (totalMs < 1000) return $"{totalMs}ms";
            double seconds = totalMs / 1000.0;
            if (seconds < 60) return $"{seconds:F1}s";
            int minutes = (int)(seconds / 60);
            double remainingSeconds = seconds - (minutes * 60);
            return $"{minutes}m {remainingSeconds:F1}s";
        }

        // Every explicit case is the grid's own pill label (ActionTable.tsx actionPillLabel),
        // copied VERBATIM — a hand-kept list that covered ten of them had already drifted
        // ("Wait Pixel Color" pasted for the grid's "Pixel Color", "If" for its "if"). Keep the two
        // in step. Types the grid shows raw (KeyDown, LeftClickDown, ScrollUp, etc.) get their
        // CamelCase split into words instead, for readability in spreadsheets/emails.
        private static string FriendlyActionType(string? type)
        {
            if (string.IsNullOrEmpty(type)) return "";
            return type switch
            {
                "WaitImage" => "Wait Image",
                "WaitPixelColor" => "Pixel Color",
                "BrowserClick" => "Click Element",
                "BrowserRightClick" => "Right Click Element",
                "BrowserType" => "Type Text",
                "BrowserSelectOption" => "Select Option",
                "BrowserAssert" => "Assert Element",
                "Assert" => "Assert",
                "BrowserWaitElement" => "Wait Element",
                "BrowserNavigate" => "Open URL",
                "SendText" => "Send Text",
                "RunProfile" => "Run Profile",
                "Pause" => "Pause",
                "HoldKey" => "Hold Key",
                "SetVariable" => "Set Variable",
                "CopyToSlot" => "Copy to Slot",
                "ActivateWindow" => "Activate Window",
                "DoubleClick" => "Double Click",
                "TripleClick" => "Triple Click",
                "LeftClickHold" => "Hold Left Click",
                "RightClickHold" => "Hold Right Click",
                "MiddleClickHold" => "Hold Middle Click",
                "If" => "if",
                "ElseIf" => "else if",
                "Else" => "else",
                "EndIf" => "endif",
                "Stop" => "stop",
                "Return" => "return",
                "While" => "while",
                "EndLoop" => "end loop",
                "BreakLoop" => "break",
                "ContinueLoop" => "next",
                "ForEachRow" => "each row",
                _ => SplitCamelCase(type)
            };
        }

        private static string SplitCamelCase(string s)
        {
            if (string.IsNullOrEmpty(s)) return s;
            var sb = new StringBuilder(s.Length + 4);
            sb.Append(s[0]);
            for (int i = 1; i < s.Length; i++)
            {
                if (char.IsUpper(s[i]) && char.IsLower(s[i - 1])) sb.Append(' ');
                sb.Append(s[i]);
            }
            return sb.ToString();
        }

        // Browser actions store the full CSS selector in Key. DisplayKey truncates selectors
        // longer than 40 chars with "..." for the grid, but the clipboard should preserve the
        // full text so users can paste it elsewhere intact. Other action types use DisplayKey
        // (which formats Pause as "F4 / 5s", RunProfile as "Name ×3", etc).
        private static string FriendlyKey(ActionItem a)
        {
            if (a.ActionType?.StartsWith("Browser") == true)
                return a.Key ?? "";
            return a.DisplayKey ?? "";
        }
    }
}
