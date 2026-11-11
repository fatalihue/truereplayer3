using System;
using System.Collections.Generic;
using System.IO;
using TrueReplayer.Helpers;
using TrueReplayer.Models;

namespace TrueReplayer.Services
{
    /// <summary>One primitive the Teclado's executor sends: what, and the wait before it.</summary>
    internal enum TecladoOpKind : byte { KeyDown, KeyUp, ButtonDown, ButtonUp, Wheel, Char, MoveTo, Nop }

    /// <param name="DelayMs">Waited before the operation, from the previous one's deadline (the engine's cadence).</param>
    /// <param name="Button">0 left, 1 right, 2 middle.</param>
    /// <param name="AtCursor">A button at the live cursor: no move, no point carried.</param>
    /// <param name="Data">Wheel: the delta. Char: the UTF-16 unit.</param>
    internal readonly record struct TecladoOp(
        TecladoOpKind Kind,
        int DelayMs,
        InputHookManager.TecladoStroke Stroke = default,
        int Button = 0,
        int X = 0,
        int Y = 0,
        bool AtCursor = false,
        int Data = 0);

    /// <summary>A library macro, flattened for the executor. Immutable once built.</summary>
    internal sealed class TecladoMacro
    {
        public required string Name { get; init; }
        public required TecladoOp[] Ops { get; init; }
        /// <summary>X/Y are relative to the window in front (the game), as the macro's effective target makes them.</summary>
        public bool Relative { get; init; }
        /// <summary>The macro's own Game Mode and Fast approach, or null to follow the app's.</summary>
        public bool? GameMode { get; init; }
        public bool? FastApproach { get; init; }
    }

    /// <summary>
    /// Teclado, phase 4 (plan .claude/planos/teclado-no-tr3-2026-11-10.md, decision 2): the library
    /// macros a game key runs, compiled for the Teclado's own executor (<see cref="TecladoRunner"/>),
    /// which runs them by name, several at once, without touching the macro open in the grid or the
    /// engine's replay.
    ///
    /// A macro is read once per version of its file and flattened into primitive operations, each with
    /// the wait before it, in the steps the MK's v1 knows: keys (down, up, combination, hold), the three
    /// buttons (paired, combined, held, double and triple; at a point or at the cursor), the wheel, and
    /// Send Text, typed. The timings are the engine's (ActionReplayer): the step's Delay before it, the
    /// 10 ms after a combination's modifiers, MoveClickDelayMs before each button, DoubleClickGapMs
    /// between the pairs, the repeat count and gap. Not carried over: the delay and position jitter,
    /// the focus click, and the clipboard (a Send Text is always typed).
    ///
    /// A macro with any other step (Wait Image, If, a loop, a browser step, Run Macro…) or with a
    /// {token} does not run from a key: the page lists those steps, and the macro's hotkey still runs it.
    /// </summary>
    public static class TecladoMacros
    {
        /// <summary>A library macro: its file, and whether its coordinates are window-relative once its folder's target is applied.</summary>
        public readonly record struct LibraryEntry(string Path, bool Relative);

        /// <summary>What the page is told about a macro a key points to.</summary>
        public sealed record Report(bool Found, bool Empty, string[] Unsupported)
        {
            public bool Runnable => Found && !Empty && Unsupported.Length == 0;
        }

        /// <summary>The pseudo step reported for a {token} in a key or a text (the engine resolves them; the Teclado does not).</summary>
        public const string TokensStep = "tokens";

        private sealed record CacheEntry(DateTime Stamp, bool Relative, IntPtr Layout, TecladoMacro? Macro, Report Report);

        private static readonly object _lock = new();
        private static IReadOnlyDictionary<string, LibraryEntry> _library = new Dictionary<string, LibraryEntry>(StringComparer.Ordinal);
        private static bool _libraryKnown;
        private static readonly Dictionary<string, CacheEntry> _cache = new(StringComparer.OrdinalIgnoreCase);
        private static readonly Report NotFound = new(false, false, Array.Empty<string>());

        /// <summary>The library changed (ProfileController, after every list load): name → file, as the list holds it.</summary>
        internal static void SetLibrary(IReadOnlyDictionary<string, LibraryEntry> library)
        {
            lock (_lock)
            {
                _library = library;
                _libraryKnown = true;
                // Files no macro points to any more leave the cache.
                var live = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var e in library.Values) live.Add(e.Path);
                var stale = new List<string>();
                foreach (var path in _cache.Keys) if (!live.Contains(path)) stale.Add(path);
                foreach (var path in stale) _cache.Remove(path);
            }
        }

        /// <summary>
        /// The macro a key points to, compiled, or null when it cannot run from a key (missing, empty, or
        /// with steps the Teclado does not run). Its report goes into <paramref name="reports"/>. Before
        /// the library's first load nothing is reported: the page must not say "not found" while the list
        /// is still on its way.
        /// </summary>
        internal static TecladoMacro? Resolve(string name, IntPtr layout, Dictionary<string, Report> reports)
        {
            lock (_lock)
            {
                if (!_libraryKnown) return null;
                if (!_library.TryGetValue(name, out var entry))
                {
                    reports[name] = NotFound;
                    return null;
                }
                DateTime stamp;
                try { stamp = File.GetLastWriteTimeUtc(entry.Path); }
                catch { stamp = default; }
                if (stamp != default && _cache.TryGetValue(entry.Path, out var hit)
                    && hit.Stamp == stamp && hit.Relative == entry.Relative && hit.Layout == layout)
                {
                    reports[name] = hit.Report;
                    return hit.Macro;
                }

                UserProfile? profile = null;
                try { profile = SettingsManager.LoadProfile(entry.Path); }
                catch (Exception ex) { DiagnosticLog.Warn($"Teclado: reading the macro '{name}' failed: {ex.GetType().Name}: {ex.Message}"); }
                // A failed read is not cached: the next pass tries again.
                if (profile == null)
                {
                    reports[name] = NotFound;
                    return null;
                }

                var macro = Compile(name, profile, entry.Relative, layout, out var report);
                if (stamp != default) _cache[entry.Path] = new CacheEntry(stamp, entry.Relative, layout, macro, report);
                reports[name] = report;
                return macro;
            }
        }

        // ── The compiler ──

        /// <summary>Collects the operations, carrying the wait of a step that sends nothing to the next one sent.</summary>
        private sealed class Builder
        {
            public readonly List<TecladoOp> Ops = new();
            private int _carry;

            public void Wait(int ms) => _carry += Math.Max(0, ms);

            public void Add(TecladoOp op)
            {
                Ops.Add(op with { DelayMs = op.DelayMs + _carry });
                _carry = 0;
            }

            /// <summary>The wait of trailing steps that send nothing still counts: it is part of the macro's length.</summary>
            public TecladoOp[] Finish()
            {
                if (_carry > 0 && Ops.Count > 0) Add(new TecladoOp(TecladoOpKind.Nop, 0));
                return Ops.ToArray();
            }
        }

        internal static TecladoMacro? Compile(string name, UserProfile profile, bool relative, IntPtr layout, out Report report)
        {
            var b = new Builder();
            var unsupported = new SortedSet<string>(StringComparer.Ordinal);
            int clickGap = Math.Max(0, ActionReplayer.MoveClickDelayMs);

            foreach (var a in profile.Actions)
            {
                if (a.IsSkipped) continue;
                var type = a.ActionType ?? "";
                int delay = Math.Max(0, a.Delay);
                var key = a.Key ?? "";
                switch (type)
                {
                    case "KeyDown":
                    case "KeyUp":
                    {
                        if (HasToken(key)) { unsupported.Add(TokensStep); break; }
                        b.Wait(delay);
                        // The engine presses one key per row and skips a name it cannot resolve.
                        if (InputHookManager.TryTecladoStroke(key, layout, out var s))
                            b.Add(new TecladoOp(type == "KeyDown" ? TecladoOpKind.KeyDown : TecladoOpKind.KeyUp, 0, s));
                        break;
                    }
                    case "HoldKey":
                    {
                        if (HasToken(key)) { unsupported.Add(TokensStep); break; }
                        b.Wait(delay);
                        if (!InputHookManager.TryTecladoStroke(key, layout, out var s)) break;
                        int hold = a.HoldDurationMs > 0 ? Math.Clamp(a.HoldDurationMs, 10, 60000) : ActionItem.DefaultHoldDurationMs;
                        b.Add(new TecladoOp(TecladoOpKind.KeyDown, 0, s));
                        b.Wait(hold);
                        b.Add(new TecladoOp(TecladoOpKind.KeyUp, 0, s));
                        break;
                    }
                    case "Keystroke":
                    {
                        if (HasToken(key)) { unsupported.Add(TokensStep); break; }
                        b.Wait(delay);
                        if (!TryCombo(key, layout, out var mods, out var main)) break;
                        Repeat(a, b, () =>
                        {
                            // SimulateKeystroke: the modifiers down (Win, Ctrl, Shift, Alt), 10 ms for the
                            // target to see them, the key tapped, the modifiers up in reverse.
                            foreach (var m in mods) b.Add(new TecladoOp(TecladoOpKind.KeyDown, 0, m));
                            b.Wait(10);
                            b.Add(new TecladoOp(TecladoOpKind.KeyDown, 0, main));
                            b.Add(new TecladoOp(TecladoOpKind.KeyUp, 0, main));
                            for (int i = mods.Count - 1; i >= 0; i--) b.Add(new TecladoOp(TecladoOpKind.KeyUp, 0, mods[i]));
                        });
                        break;
                    }
                    case "LeftClickDown":
                    case "LeftClickUp":
                    case "RightClickDown":
                    case "RightClickUp":
                    case "MiddleClickDown":
                    case "MiddleClickUp":
                    {
                        // A paired half always has its point (no at-cursor), like SimulateMouse(action.X, action.Y).
                        int button = type.StartsWith("Right", StringComparison.Ordinal) ? 1 : type.StartsWith("Middle", StringComparison.Ordinal) ? 2 : 0;
                        bool down = type.EndsWith("Down", StringComparison.Ordinal);
                        b.Wait(delay);
                        b.Add(new TecladoOp(TecladoOpKind.MoveTo, 0, X: a.X, Y: a.Y));
                        b.Wait(clickGap);
                        b.Add(new TecladoOp(down ? TecladoOpKind.ButtonDown : TecladoOpKind.ButtonUp, 0, Button: button, X: a.X, Y: a.Y));
                        break;
                    }
                    case "LeftClick":
                    case "RightClick":
                    case "MiddleClick":
                    case "LeftClickHold":
                    case "RightClickHold":
                    case "MiddleClickHold":
                    {
                        int button = type.StartsWith("Right", StringComparison.Ordinal) ? 1 : type.StartsWith("Middle", StringComparison.Ordinal) ? 2 : 0;
                        bool held = type.EndsWith("Hold", StringComparison.Ordinal);
                        int hold = !held ? 0 : a.HoldDurationMs > 0 ? Math.Clamp(a.HoldDurationMs, 10, 60000) : ActionItem.DefaultHoldDurationMs;
                        b.Wait(delay);
                        Repeat(a, b, () =>
                        {
                            Point(a, b);
                            b.Wait(clickGap);
                            b.Add(new TecladoOp(TecladoOpKind.ButtonDown, 0, Button: button, X: a.X, Y: a.Y, AtCursor: a.AtCursor));
                            b.Wait(hold + clickGap);
                            b.Add(new TecladoOp(TecladoOpKind.ButtonUp, 0, Button: button, X: a.X, Y: a.Y, AtCursor: a.AtCursor));
                        });
                        break;
                    }
                    case "DoubleClick":
                    case "TripleClick":
                    {
                        int pairs = type == "DoubleClick" ? 2 : 3;
                        b.Wait(delay);
                        Repeat(a, b, () =>
                        {
                            Point(a, b);
                            for (int p = 0; p < pairs; p++)
                            {
                                if (p > 0) b.Wait(Math.Max(0, ActionReplayer.DoubleClickGapMs));
                                b.Wait(clickGap);
                                b.Add(new TecladoOp(TecladoOpKind.ButtonDown, 0, Button: 0, X: a.X, Y: a.Y, AtCursor: a.AtCursor));
                                b.Wait(clickGap);
                                b.Add(new TecladoOp(TecladoOpKind.ButtonUp, 0, Button: 0, X: a.X, Y: a.Y, AtCursor: a.AtCursor));
                            }
                        });
                        break;
                    }
                    case "ScrollUp":
                    case "ScrollDown":
                        b.Wait(delay);
                        b.Add(new TecladoOp(TecladoOpKind.Wheel, 0, Data: type == "ScrollUp" ? 120 : -120));
                        break;
                    case "SendText":
                    {
                        // ResolveSendTextDelivery's choice of text; the delivery is always typed here
                        // (a game key never borrows the clipboard). Typed rows keep their own pace.
                        bool markdown = string.Equals(a.SendMode, "markdown", StringComparison.OrdinalIgnoreCase)
                            || string.Equals(a.SendMode, "discord", StringComparison.OrdinalIgnoreCase);
                        var text = markdown && !string.IsNullOrEmpty(a.KeyMarkdown) ? a.KeyMarkdown! : key;
                        if (HasToken(text)) { unsupported.Add(TokensStep); break; }
                        bool typed = string.Equals(a.SendMethod, "type", StringComparison.OrdinalIgnoreCase);
                        int charDelay = typed ? Math.Clamp(a.SendCharDelay ?? 0, 0, 200) : DefaultCharDelayMs;
                        b.Wait(delay);
                        bool first = true;
                        foreach (char c in text)
                        {
                            if (c == '\r') continue;
                            if (!first) b.Wait(charDelay);
                            first = false;
                            if (c == '\n') Tap(b, EnterStroke);
                            else if (c == '\t') Tap(b, TabStroke);
                            else b.Add(new TecladoOp(TecladoOpKind.Char, 0, Data: c));
                        }
                        break;
                    }
                    default:
                        // A block's markers live only inside the block its opener already names (If, While,
                        // For Each Row): listing End If next to If says nothing more.
                        if (!BlockMarkers.Contains(type)) unsupported.Add(type.Length == 0 ? "?" : type);
                        break;
                }
            }

            var ops = b.Finish();
            report = new Report(true, ops.Length == 0, new List<string>(unsupported).ToArray());
            if (!report.Runnable) return null;
            return new TecladoMacro
            {
                Name = name,
                Ops = ops,
                Relative = relative,
                GameMode = profile.GameMode,
                FastApproach = profile.FastApproach,
            };
        }

        private static readonly HashSet<string> BlockMarkers = new(StringComparer.Ordinal)
        {
            "ElseIf", "Else", "EndIf", "EndLoop", "BreakLoop", "ContinueLoop",
        };

        /// <summary>The pace of a pasted Send Text once it is typed: the Texto function's.</summary>
        internal const int DefaultCharDelayMs = 8;

        private static readonly InputHookManager.TecladoStroke EnterStroke = new(0x0D, 0x1C, false);
        private static readonly InputHookManager.TecladoStroke TabStroke = new(0x09, 0x0F, false);

        private static bool HasToken(string text) => text.IndexOf('{') >= 0;

        private static void Tap(Builder b, InputHookManager.TecladoStroke s)
        {
            b.Add(new TecladoOp(TecladoOpKind.KeyDown, 0, s));
            b.Add(new TecladoOp(TecladoOpKind.KeyUp, 0, s));
        }

        /// <summary>A combined click's point: a move to it, or nothing when it is at the cursor.</summary>
        private static void Point(ActionItem a, Builder b)
        {
            if (!a.AtCursor) b.Add(new TecladoOp(TecladoOpKind.MoveTo, 0, X: a.X, Y: a.Y));
        }

        /// <summary>ExecuteRepeatedCore's count and gap (600 ms by default between double and triple clicks).</summary>
        private static void Repeat(ActionItem a, Builder b, Action body)
        {
            int repeats = Math.Clamp(a.RepeatCount, 1, 999);
            int defaultGap = a.ActionType is "DoubleClick" or "TripleClick"
                ? ActionItem.DefaultDoubleClickRepeatDelayMs
                : ActionItem.DefaultRepeatDelayMs;
            int gap = Math.Clamp(a.RepeatDelayMs ?? defaultGap, 0, 5000);
            for (int r = 0; r < repeats; r++)
            {
                if (r > 0) b.Wait(gap);
                body();
            }
        }

        /// <summary>A combination: its modifiers in the engine's order (Win, Ctrl, Shift, Alt) and the key.</summary>
        private static bool TryCombo(string combo, IntPtr layout, out List<InputHookManager.TecladoStroke> mods, out InputHookManager.TecladoStroke main)
        {
            mods = new List<InputHookManager.TecladoStroke>();
            main = default;
            var (prefix, target) = KeyUtils.SplitCombo(combo);
            if (target.Length == 0 || !InputHookManager.TryTecladoStroke(target, layout, out main)) return false;
            foreach (var canonical in new[] { "Win", "Ctrl", "Shift", "Alt" })
            {
                foreach (var p in prefix)
                {
                    if (!string.Equals(p, canonical, StringComparison.OrdinalIgnoreCase)) continue;
                    if (InputHookManager.TryTecladoStroke(canonical, layout, out var m)) mods.Add(m);
                    break;
                }
            }
            return true;
        }
    }
}
