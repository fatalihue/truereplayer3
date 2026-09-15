using System;
using System.Collections.Generic;
using System.Linq;
using TrueReplayer.Models;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Converts a profile's action list between the two input representations:
    ///   • Paired   — KeyDown+KeyUp / *ClickDown+*ClickUp          (two rows per press)
    ///   • Combined — Keystroke / HoldKey / *Click / *ClickHold    (one row per press)
    ///
    /// This is the on-demand counterpart to the record-time "Combined Actions" toggle: a
    /// profile recorded (or hand-built) in one form can be switched to the other without
    /// re-recording or editing JSON. Both methods are PURE functions over a snapshot — the
    /// caller swaps the result into the live collection (with undo) — so the transforms stay
    /// trivially testable and side-effect free.
    ///
    /// Faithfulness rules (so a converted macro keeps doing the same thing):
    ///   • A click whose Down/Up land on DIFFERENT points is a drag — left paired (a combined
    ///     *Click has a single point and can't represent a moved release).
    ///   • A held KEY (adjacent KeyDown+KeyUp whose Up delay ≥ <see cref="HoldThresholdMs"/>)
    ///     becomes a HoldKey carrying that exact duration — no timing is lost.
    ///   • A held mouse BUTTON (same test, same threshold) becomes a *ClickHold carrying that
    ///     duration. Until *ClickHold existed this branch had nowhere to put the time and
    ///     collapsed every hold into an instant click — a silent loss on a round-trip, and the
    ///     one asymmetry between the key and mouse families. Below the threshold a press is
    ///     still a tap → instant *Click, matching how record-time combined mode treats clicks.
    ///   • Overlapping / interleaved presses (KeyDown … other event … KeyUp) can't be folded,
    ///     so they are left paired exactly as-is.
    /// </summary>
    public static class ActionModeConverter
    {
        // Down/Up click coords this far apart (px, either axis) are treated as a DRAG and kept
        // paired. Real clicks record identical Down/Up coords; a couple px of slack absorbs the
        // rare 1px wobble without misreading a genuine drag as a click.
        private const int ClickCoordTolerance = 2;

        // A KeyDown+KeyUp pair whose Up delay (= how long the key stayed down) reaches this is
        // treated as a deliberate hold and mapped to HoldKey (preserving the duration) instead
        // of an instant Keystroke. Below it, the press is a tap → Keystroke.
        private const int HoldThresholdMs = 200;

        private static readonly HashSet<string> Modifiers =
            new(StringComparer.OrdinalIgnoreCase) { "Ctrl", "Shift", "Alt", "Win" };

        // Canonical modifier ORDER for building / expanding a keystroke combo (the exact
        // "Win+Ctrl+Shift+Alt+Key" sequence SimulateKeystroke parses). Distinct from the
        // Modifiers set above, which is an unordered membership test. Shared by ExpandKeystroke
        // (KeyDown order) and BuildCombo (string order) so the two never drift apart.
        private static readonly string[] ModifierOrder = { "Win", "Ctrl", "Shift", "Alt" };

        // ActionItem.Key is non-nullable by declaration, but System.Text.Json can deserialize an
        // explicit JSON null into it from a hand-edited / imported .trprofile. HashSet.Contains(null)
        // under OrdinalIgnoreCase throws, so guard here and treat a null Key as a non-modifier
        // (consistent with KeyEq, which already tolerates null).
        private static bool IsModifier(string? key) => key != null && Modifiers.Contains(key);

        // ── Paired → Combined ─────────────────────────────────────────────
        public static List<ActionItem> ToCombined(IReadOnlyList<ActionItem> input)
        {
            var result = new List<ActionItem>(input.Count);
            int i = 0;
            while (i < input.Count)
            {
                var a = input[i];

                // Click pair: *ClickDown + *ClickUp (same button, same point) → *Click, or
                // → *ClickHold when the Up carries a real dwell. The hold branch is the mouse
                // mirror of the held-KEY branch below and uses the identical threshold, so the
                // two families answer "was this a tap or a hold?" the same way.
                if (TryClickButton(a.ActionType, down: true, out string btn)
                    && i + 1 < input.Count
                    && TryClickButton(input[i + 1].ActionType, down: false, out string upBtn)
                    && upBtn == btn
                    && Math.Abs(input[i + 1].X - a.X) <= ClickCoordTolerance
                    && Math.Abs(input[i + 1].Y - a.Y) <= ClickCoordTolerance)
                {
                    var click = a.Clone();
                    bool held = input[i + 1].Delay >= HoldThresholdMs;
                    click.ActionType = held ? btn + "ClickHold" : btn + "Click";
                    // Carry the dwell, exactly as the held-key branch carries its own. Before
                    // *ClickHold existed this branch had nowhere to put the time and collapsed
                    // every hold into an instant click — a silent loss on a round-trip, and the
                    // reason the class summary above used to say a mouse hold cannot survive.
                    // The else is not redundant: the clone inherits the DOWN row's field, and a
                    // tap must not walk away carrying a dwell that nothing will ever read.
                    if (held) click.HoldDurationMs = Math.Clamp(input[i + 1].Delay, 10, 60000);
                    else click.HoldDurationMs = 0;
                    result.Add(click);
                    i += 2;
                    continue;
                }

                // Held key: adjacent non-modifier KeyDown+KeyUp whose Up carries a real hold
                // → HoldKey, preserving the exact press duration. Checked before the keystroke
                // matcher (which would otherwise flatten it into an instant tap).
                if (a.ActionType == "KeyDown" && !IsModifier(a.Key)
                    && i + 1 < input.Count
                    && input[i + 1].ActionType == "KeyUp" && KeyEq(input[i + 1].Key, a.Key)
                    && input[i + 1].Delay >= HoldThresholdMs)
                {
                    var hold = a.Clone();
                    hold.ActionType = "HoldKey";
                    hold.HoldDurationMs = Math.Clamp(input[i + 1].Delay, 10, 60000);
                    result.Add(hold);
                    i += 2;
                    continue;
                }

                // Keystroke: a clean [mods] key [mods-reversed] run (or a lone modifier tap)
                // → one Keystroke. Returns 0 when the structure isn't clean (overlap, drag
                // half, unmatched), in which case the row is emitted untouched below.
                int consumed = TryMatchKeystroke(input, i, out var ks);
                if (consumed > 0)
                {
                    result.Add(ks!);
                    i += consumed;
                    continue;
                }

                result.Add(a);
                i++;
            }
            return result;
        }

        // ── Combined → Paired ─────────────────────────────────────────────
        public static List<ActionItem> ToPaired(IReadOnlyList<ActionItem> input)
        {
            var result = new List<ActionItem>(input.Count * 2);
            foreach (var a in input)
            {
                switch (a.ActionType)
                {
                    case "LeftClick":
                    case "RightClick":
                    case "MiddleClick":
                    {
                        // A click set to repeat (RepeatCount > 1, the Click × N feature) can't be
                        // faithfully split into a single Down/Up pair — the paired-half replay cases
                        // don't loop, so splitting would SILENTLY drop the × N (fires once, not N).
                        // Pass it through whole, exactly like DoubleClick below: the combined-click
                        // replay case still honours RepeatCount via ExecuteRepeated, and ToCombined
                        // leaves an unsplit click untouched, so the round-trip stays stable and the
                        // ×N badge keeps showing in paired mode. Plain single clicks (RepeatCount 1)
                        // split as before.
                        //
                        // AtCursor is the same shape of loss for the same reason: the paired-half
                        // replay cases read action.X/Y directly and never consult the flag, so a
                        // split at-cursor click would SILENTLY revert to the stale stored point —
                        // a click somewhere else entirely, with no error. Pass it through whole.
                        if (a.RepeatCount > 1 || a.AtCursor) { result.Add(a.Clone()); break; }
                        string btn = a.ActionType[..^"Click".Length]; // "LeftClick" → "Left"
                        var down = a.Clone(); down.ActionType = btn + "ClickDown";
                        var up = a.Clone(); up.ActionType = btn + "ClickUp"; up.Delay = 0; up.Comment = "";
                        result.Add(down);
                        result.Add(up);
                        break;
                    }
                    case "LeftClickHold":
                    case "RightClickHold":
                    case "MiddleClickHold":
                    {
                        // The same two refusals as the plain clicks above, for the same two
                        // reasons: the paired halves don't loop (× N would be silently dropped)
                        // and their replay cases read X/Y directly (at-cursor would silently
                        // revert to the stale stored point).
                        if (a.RepeatCount > 1 || a.AtCursor) { result.Add(a.Clone()); break; }
                        string hbtn = a.ActionType[..^"ClickHold".Length]; // "LeftClickHold" → "Left"
                        int clickHold = a.HoldDurationMs > 0
                            ? Math.Clamp(a.HoldDurationMs, 10, 60000)
                            : ActionItem.DefaultHoldDurationMs;
                        // The dwell rides on the UP's delay — the inverse of the ToCombined
                        // mapping, so a round-trip preserves the duration exactly. Identical
                        // contract to HoldKey below; the Comment is cleared on the Up for the
                        // same reason a split plain click clears it (it describes the press).
                        var hdown = a.Clone(); hdown.ActionType = hbtn + "ClickDown"; hdown.HoldDurationMs = 0;
                        var hup = a.Clone(); hup.ActionType = hbtn + "ClickUp";
                        hup.Delay = clickHold; hup.Comment = ""; hup.HoldDurationMs = 0;
                        result.Add(hdown);
                        result.Add(hup);
                        break;
                    }
                    case "DoubleClick":
                    case "TripleClick":
                        // INTENTIONAL passthrough — do NOT expand to Down/Up/Down/Up.
                        // A Double/TripleClick is a single semantic unit (replayed directly by
                        // the engine in any mode). Expanding it would be LOSSY on a
                        // round-trip: ToCombined re-merges each Down+Up pair into ONE
                        // LeftClick, so a DoubleClick → 4 rows → 2 LeftClicks (and a
                        // TripleClick → 6 rows → 3 LeftClicks), silently
                        // losing the multi-click. Leaving it whole keeps the round-trip
                        // exact and it still replays correctly under paired mode.
                        result.Add(a);
                        break;
                    case "Keystroke":
                        ExpandKeystroke(a, result);
                        break;
                    case "HoldKey":
                    {
                        // KeyDown(key) then KeyUp(key) after the hold — the hold rides on the
                        // Up's delay (how long the key stays down), the inverse of the
                        // ToCombined hold mapping, so a round-trip preserves the duration.
                        var down = a.Clone(); down.ActionType = "KeyDown"; down.HoldDurationMs = 0;
                        int hold = a.HoldDurationMs > 0
                            ? Math.Clamp(a.HoldDurationMs, 10, 60000)
                            : ActionItem.DefaultHoldDurationMs;
                        result.Add(down);
                        result.Add(new ActionItem { ActionType = "KeyUp", Key = a.Key, Delay = hold });
                        break;
                    }
                    default:
                        result.Add(a);
                        break;
                }
            }
            return result;
        }

        // Expands a Keystroke ("Ctrl+Shift+T", "A", "Shift") into its KeyDown/KeyUp sequence:
        // modifiers down (canonical Win→Ctrl→Shift→Alt), key down, key up, modifiers up reversed.
        // Honours RepeatCount (emit the whole combo N times, the repeat gap leading each cycle).
        private static void ExpandKeystroke(ActionItem ks, List<ActionItem> result)
        {
            if (string.IsNullOrWhiteSpace(ks.Key)) { result.Add(ks.Clone()); return; }

            var parts = ks.Key.Split('+');
            string target = parts[^1].Trim();
            var prefix = parts.Take(parts.Length - 1).Select(p => p.Trim()).ToList();
            var mods = ModifierOrder
                .Where(m => prefix.Any(p => KeyEq(p, m)))
                .ToList();

            int repeats = Math.Max(1, Math.Min(999, ks.RepeatCount));
            int gap = Math.Max(0, Math.Min(5000, ks.RepeatDelayMs ?? ActionItem.DefaultRepeatDelayMs));

            // Capture the very first KeyDown of the whole expansion so we can stamp the
            // Keystroke's persisted metadata (Comment, RepeatCount, RepeatDelayMs) onto it.
            // TryMatchKeystroke clones THIS leading row when folding the run back to a
            // Keystroke, so stamping here is what makes the Keystroke->paired->combined
            // round-trip preserve those fields instead of silently dropping them.
            ActionItem? leadRow = null;
            for (int r = 0; r < repeats; r++)
            {
                // First action of the whole expansion carries the Keystroke's own delay; each
                // later cycle leads with the repeat gap; the rest of a cycle fires back-to-back.
                int leadDelay = r == 0 ? ks.Delay : gap;
                bool first = true;
                foreach (var m in mods)
                {
                    var row = new ActionItem { ActionType = "KeyDown", Key = m, Delay = first ? leadDelay : 0 };
                    leadRow ??= row;
                    result.Add(row);
                    first = false;
                }
                var targetRow = new ActionItem { ActionType = "KeyDown", Key = target, Delay = first ? leadDelay : 0 };
                leadRow ??= targetRow;
                result.Add(targetRow);
                result.Add(new ActionItem { ActionType = "KeyUp", Key = target, Delay = 0 });
                for (int m = mods.Count - 1; m >= 0; m--)
                    result.Add(new ActionItem { ActionType = "KeyUp", Key = mods[m], Delay = 0 });
            }

            // Stamp the Keystroke's carried-through fields onto the leading row so a later
            // ToCombined re-fold (TryMatchKeystroke clones this row) restores them.
            if (leadRow != null)
            {
                leadRow.Comment = ks.Comment;
                leadRow.RepeatCount = ks.RepeatCount;
                leadRow.RepeatDelayMs = ks.RepeatDelayMs;
                leadRow.RepeatDelayJitterPct = ks.RepeatDelayJitterPct;
            }
        }

        // Matches a clean keystroke run at <paramref name="start"/>:
        //   [KeyDown(mod)]*  KeyDown(key, non-mod)  KeyUp(key)  [KeyUp(mod) reversed]*
        // or a lone modifier tap:  KeyDown(mod)+  KeyUp(mod reversed)+
        // Returns the number of rows consumed (0 = no clean match → caller leaves the row as-is).
        private static int TryMatchKeystroke(IReadOnlyList<ActionItem> input, int start, out ActionItem? combined)
        {
            combined = null;
            if (input[start].ActionType != "KeyDown") return 0;

            int j = start;
            var mods = new List<string>();
            while (j < input.Count && input[j].ActionType == "KeyDown" && IsModifier(input[j].Key))
            {
                mods.Add(input[j].Key);
                j++;
            }

            bool haveKey = j < input.Count && input[j].ActionType == "KeyDown" && !IsModifier(input[j].Key);
            if (!haveKey)
            {
                // Lone modifier(s): expect a KeyUp for each held modifier, in reverse order.
                if (mods.Count == 0) return 0;
                int k = j;
                for (int m = mods.Count - 1; m >= 0; m--)
                {
                    if (k >= input.Count || input[k].ActionType != "KeyUp" || !KeyEq(input[k].Key, mods[m])) return 0;
                    k++;
                }
                // Clone the leading row so Comment (and any other persisted field) carries through,
                // matching the click + held-key folds above. Delay rides along via Clone().
                combined = input[start].Clone();
                combined.ActionType = "Keystroke";
                combined.Key = BuildCombo(mods, null);
                return k - start;
            }

            string key = input[j].Key;
            j++;
            if (j >= input.Count || input[j].ActionType != "KeyUp" || !KeyEq(input[j].Key, key)) return 0;
            j++;
            for (int m = mods.Count - 1; m >= 0; m--)
            {
                if (j >= input.Count || input[j].ActionType != "KeyUp" || !KeyEq(input[j].Key, mods[m])) return 0;
                j++;
            }
            // Clone the leading row so Comment (and any other persisted field) carries through,
            // matching the click + held-key folds above. Delay rides along via Clone().
            combined = input[start].Clone();
            combined.ActionType = "Keystroke";
            combined.Key = mods.Count > 0 ? BuildCombo(mods, key) : key;
            return j - start;
        }

        private static bool KeyEq(string? a, string? b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);

        private static bool TryClickButton(string actionType, bool down, out string button)
        {
            button = "";
            string suffix = down ? "ClickDown" : "ClickUp";
            foreach (var b in new[] { "Left", "Right", "Middle" })
                if (actionType == b + suffix) { button = b; return true; }
            return false;
        }

        // Joins modifiers (+ optional target) into the canonical "Win+Ctrl+Shift+Alt+Key" form
        // SimulateKeystroke parses — identical to what manual "Send Keystroke" / hotkey capture
        // produce, so a converted combo replays the same as a recorded one.
        private static string BuildCombo(IReadOnlyCollection<string> mods, string? target)
        {
            var parts = new List<string>();
            foreach (var m in ModifierOrder)
                if (mods.Any(x => KeyEq(x, m))) parts.Add(m);
            if (!string.IsNullOrEmpty(target)) parts.Add(target);
            return string.Join("+", parts);
        }
    }
}
