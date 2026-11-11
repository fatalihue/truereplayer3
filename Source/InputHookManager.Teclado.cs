using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using TrueReplayer.Controllers;
using TrueReplayer.Helpers;
using TrueReplayer.Interop;
using TrueReplayer.Models;
using TrueReplayer.Services;

namespace TrueReplayer
{
    /// <summary>
    /// Teclado (branch teclado; plan .claude/planos/teclado-no-tr3-2026-11-10.md), phase 3: with a game
    /// in front, its keys do what the Keyboard page says, ahead of the Key Remaps (the game's function
    /// wins). Two entry points in KeyboardHookCallbackCore:
    ///   - the RELEASE, before every gate, as the remap pairing's: a key the Teclado took at its press is
    ///     let go by the Teclado whatever came up since (a dialog, the Shortcuts off, a recording);
    ///   - the PRESS, after the capture and before the Key Remaps. A new slot opens only on a genuine
    ///     first press, with the Shortcuts on, outside a recording and with no modal gate up.
    /// The function chosen at the press is frozen in the key's slot, and its release uses the slot, never
    /// the table: a change of game or of layer mid-hold never leaves a key stuck. Everything is compiled
    /// off this thread and swapped whole; the callback only indexes arrays. Injections carry TecladoMark
    /// in dwExtraInfo and pass the hook's injected gate like every other injection of the app.
    /// The mouse's middle and side buttons and its wheel are sources too (phase 7), with the same two
    /// entry points in MouseHookCallbackCore and the same slots, after the keys' in the tables.
    /// </summary>
    public static partial class InputHookManager
    {
        /// <summary>One key's function, compiled: nothing to parse or allocate in the callback.</summary>
        internal sealed class TecladoAction
        {
            public string Kind = "";
            /// <summary>key: modifiers first, the key last.</summary>
            public TecladoStroke[] Keys = Array.Empty<TecladoStroke>();
            /// <summary>mouse: a button's down and up flags (and which side button), or a wheel notch.</summary>
            public uint MouseDown, MouseUp, MouseData;
            public int Wheel;
            /// <summary>text: what is typed, and whether Enter follows.</summary>
            public string Text = "";
            public bool Enter;
            /// <summary>macro: the library macro and its mode, for the Teclado's executor (phase 4).</summary>
            public TecladoRunner.Binding? Binding;
            /// <summary>macro: the game also gets the key itself ("Manter a tecla original"), re-sent by scan code.</summary>
            public bool KeepOriginal;
            public TecladoStroke Original;
            /// <summary>macro on a mouse button: the button itself, re-sent when the original is kept.</summary>
            public TecladoAction? OriginalMouse;
        }

        internal readonly record struct TecladoStroke(ushort Vk, ushort Scan, bool Extended);

        internal sealed class TecladoGameTable
        {
            public readonly TecladoAction?[] Base = new TecladoAction?[TecladoKeys.TableSize];
            public readonly TecladoAction?[] Layer = new TecladoAction?[TecladoKeys.TableSize];
            public bool On;
        }

        internal sealed class TecladoTables
        {
            public bool Enabled;
            public readonly Dictionary<string, TecladoGameTable> Games = new(StringComparer.Ordinal);
        }

        // The compiled config: swapped whole, read by reference.
        private static volatile TecladoTables? _tecladoTables;

        // ── The hook thread's own state: no lock ──
        private static string? _tecladoFrontId;
        private static TecladoGameTable? _tecladoActive;
        private static string? _tecladoActiveId;
        private static readonly TecladoAction?[] _tecladoSlots = new TecladoAction?[TecladoKeys.TableSize];
        private static int _tecladoHeld;
        private static bool _tecladoLayer;

        // What the Teclado injects is marked, as the plan asks: "TEKD". The executor marks its own too.
        internal static readonly IntPtr TecladoMark = (IntPtr)0x54454B44;

        // Test houses only (the probe of teclado-f3-real.mjs): with TRUEREPLAYER3_TEST_TECLADO=1 in the
        // environment, an injected key marked "TEST" counts as physical for the Teclado's two entry
        // points, and for nothing else in the hook. The same kind of switch as TRUEREPLAYER3_TEST_NOGUARD.
        private static readonly IntPtr TecladoTestMark = (IntPtr)0x54455354;
        private static readonly bool TecladoTestPhysical = Environment.GetEnvironmentVariable("TRUEREPLAYER3_TEST_TECLADO") == "1";

        /// <summary>What the last compile learned about each macro a key points to (the page shows it).</summary>
        internal static IReadOnlyDictionary<string, TecladoMacros.Report> TecladoMacroReports => _tecladoMacroReports;
        private static volatile IReadOnlyDictionary<string, TecladoMacros.Report> _tecladoMacroReports = new Dictionary<string, TecladoMacros.Report>();

        /// <summary>Compiles and publishes the config (TecladoService, after every load and save, and when the library changes).</summary>
        internal static void PublishTeclado(TecladoService.Config config)
        {
            var reports = new Dictionary<string, TecladoMacros.Report>(StringComparer.Ordinal);
            var tables = CompileTeclado(config, reports, out bool anyMacro);
            _tecladoMacroReports = reports;
            // The executor's thread is started here, off the hook thread, before a key can need it.
            if (anyMacro) TecladoRunner.EnsureStarted();
            _tecladoTables = tables;
            if (_hookThreadId != 0) PostToHookThread(TecladoRecompute);
        }

        /// <summary>The game in front changed (TecladoFront, on this thread).</summary>
        internal static void SetTecladoFront(string? gameId)
        {
            _tecladoFrontId = gameId;
            TecladoRecompute();
        }

        private static void TecladoRecompute()
        {
            var tables = _tecladoTables;
            TecladoGameTable? next = null;
            if (tables != null && tables.Enabled && _tecladoFrontId != null
                && tables.Games.TryGetValue(_tecladoFrontId, out var game) && game.On)
                next = game;
            if (ReferenceEquals(next, _tecladoActive)) return;
            string? nextId = next != null ? _tecladoFrontId : null;
            // The same game compiled again (its keys saved, the library reloaded by a file changing on
            // disk mid-game): what is held keeps the function frozen in its slot and is let go by its own
            // release, and the macros run on. Another game, a game turned off, the Teclado off: what the
            // old one holds is let go first.
            if (next == null || _tecladoActive == null || nextId != _tecladoActiveId) TecladoReleaseAll();
            _tecladoActive = next;
            _tecladoActiveId = nextId;
        }

        /// <summary>Lets go of everything the Teclado holds: the game left the front, the hook stopped, the session came back.</summary>
        private static void TecladoReleaseAll()
        {
            if (_tecladoHeld > 0)
            {
                for (int i = 0; i < _tecladoSlots.Length; i++)
                {
                    var action = _tecladoSlots[i];
                    if (action == null) continue;
                    _tecladoSlots[i] = null;
                    TecladoUp(action, i);
                }
                _tecladoHeld = 0;
            }
            if (_tecladoLayer)
            {
                _tecladoLayer = false;
                TecladoFront.SetLayer(false);
            }
            // The macros the keys started stop too, whatever their mode, and let go of what they hold.
            TecladoRunner.StopAll();
        }

        // ── The two entry points ──

        /// <summary>A release of a key the Teclado took: let go of what it did, and swallow the release.</summary>
        private static bool TecladoKeyUp(IntPtr wParam, IntPtr lParam)
        {
            if (wParam == (IntPtr)NativeMethods.WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN) return false;
            if (!TecladoPhysical(lParam, out _) || !TecladoIndex(lParam, out int index)) return false;
            var action = _tecladoSlots[index];
            if (action == null) return false;
            _tecladoSlots[index] = null;
            _tecladoHeld--;
            TecladoUp(action, index);
            return true;
        }

        /// <summary>A press: an open slot's repeat, or a new slot for a key the game in front changes.</summary>
        private static bool TecladoKeyDown(IntPtr wParam, IntPtr lParam, bool gated, bool profileKeysOn)
        {
            if (wParam != (IntPtr)NativeMethods.WM_KEYDOWN && wParam != (IntPtr)WM_SYSKEYDOWN) return false;
            var active = _tecladoActive;
            if (active == null && _tecladoHeld == 0) return false;
            if (!TecladoPhysical(lParam, out int vk) || !TecladoIndex(lParam, out int index)) return false;

            // An open slot continues whatever is up now: its repeats are its own, never the raw key's.
            var held = _tecladoSlots[index];
            if (held != null)
            {
                TecladoRepeat(held);
                return true;
            }

            if (active == null || gated || !profileKeysOn) return false;
            if (MainController.Instance?.IsRecording() == true) return false;
            // Only a genuine first press: a key already held raw (pressed before the game came to the
            // front) or by a remap pairing keeps going as it started, or its release would be lost.
            if (_vkCodesCurrentlyDown.Contains(vk) || _activeRemapDowns.ContainsKey(vk) || _remapBypassedDowns.Contains(vk)) return false;

            var action = (_tecladoLayer ? active.Layer[index] : null) ?? active.Base[index];
            if (action == null) return false;
            // The app's own hotkeys win over a game's key: the key goes on to them.
            if (TecladoYields(vk)) return false;

            _tecladoSlots[index] = action;
            _tecladoHeld++;
            // Swallowing the right Alt of an AltGr layout: take back the phantom Ctrl that went ahead of it.
            NeutraliseAltGrPhantomCtrl(vk);
            TecladoDown(action, index);
            return true;
        }

        /// <summary>
        /// Whether the press is one of the app's own hotkeys, which a game's key never shadows: the
        /// Shortcuts toggle is the general pause, and Record, Replay, the Clicker's two, Foreground,
        /// the mode switch, the two captures and a Pause step's resume key must answer in any game.
        /// The same comparisons, in the same modes, as the hotkey block of KeyboardHookCallbackCore.
        /// Composed only for a key the game in front changes; every other key never gets here.
        /// </summary>
        private static bool TecladoYields(int vk) => TecladoYieldsTo(BuildComposedKey(vk));

        /// <summary>The same, for a press already composed (a side button or a wheel notch, by ComposeMouseCombo).</summary>
        private static bool TecladoYieldsTo(string key)
        {
            if (key.Length == 0) return false;
            var p = UserProfile.Current;
            if (IsCursorClickMode)
            {
                if (key == CursorClickStartHotkey || key == CursorClickPauseHotkey) return true;
            }
            else if (key == p.RecordingHotkey || key == p.ReplayHotkey) return true;
            if (key == p.ProfileKeyToggleHotkey || key == p.ForegroundHotkey || key == p.ModeToggleHotkey) return true;
            if (key == p.CaptureSlotHotkey || key == p.CopyScreenTextHotkey) return true;
            return key == _pauseResumeHotkey;
        }

        private static bool TecladoPhysical(IntPtr lParam, out int vk)
        {
            vk = Marshal.ReadInt32(lParam);
            uint flags = (uint)Marshal.ReadInt32(lParam, 8);
            if ((flags & LLKHF_INJECTED) != 0 && !(TecladoTestPhysical && Marshal.ReadIntPtr(lParam, 16) == TecladoTestMark)) return false;
            return !IsAltGrPhantomCtrl(vk, lParam);
        }

        private static bool TecladoIndex(IntPtr lParam, out int index)
        {
            uint scan = (uint)Marshal.ReadInt32(lParam, 4);
            bool extended = ((uint)Marshal.ReadInt32(lParam, 8) & 0x01) != 0;
            return TecladoKeys.TryIndexOf(scan, extended, out index);
        }

        // ── The mouse's two entry points (phase 7), in MouseHookCallbackCore ──

        // A wheel turned by less than a notch per message (a free-spinning or high-resolution one) adds
        // up here: the function fires once per whole notch, in the direction of the turn.
        private static int _tecladoWheel;
        private const int WheelNotch = 120;
        // At most this many notches in one message: a wheel let spin fires its function, not a flood.
        private const int MaxNotchesPerMessage = 8;

        /// <summary>A release of the middle or a side button the Teclado took: let go of what it did, and swallow the release.</summary>
        private static bool TecladoMouseUp(int message, in NativeMethods.MSLLHOOKSTRUCT m)
        {
            int index = message switch
            {
                NativeMethods.WM_MBUTTONUP => TecladoKeys.MouseMiddle,
                NativeMethods.WM_XBUTTONUP => TecladoXIndex(m.mouseData),
                _ => -1,
            };
            if (index < 0 || !TecladoMousePhysical(m)) return false;
            var action = _tecladoSlots[index];
            if (action == null) return false;
            _tecladoSlots[index] = null;
            _tecladoHeld--;
            TecladoMouseFunction(action, index, down: false);
            return true;
        }

        /// <summary>
        /// A press of the middle or a side button, or a wheel notch, with a game in front that changes it.
        /// The same verdicts as a key's first press: the Shortcuts on, no modal gate up, no recording, and
        /// the app's own hotkeys win. Left and right never come here: they stay out, so a click is never lost.
        /// </summary>
        private static bool TecladoMouseDown(int message, in NativeMethods.MSLLHOOKSTRUCT m, bool gated, bool profileKeysOn)
        {
            int index;
            string? combo;
            int delta = 0;
            switch (message)
            {
                case NativeMethods.WM_MBUTTONDOWN:
                    index = TecladoKeys.MouseMiddle;
                    // The middle button is no hotkey of the app's: nothing to yield to.
                    combo = null;
                    break;
                case NativeMethods.WM_XBUTTONDOWN:
                    index = TecladoXIndex(m.mouseData);
                    combo = XButtonName(m.mouseData);
                    break;
                case NativeMethods.WM_MOUSEWHEEL:
                    delta = (short)((m.mouseData >> 16) & 0xffff);
                    if (delta == 0) return false;
                    index = delta > 0 ? TecladoKeys.WheelUp : TecladoKeys.WheelDown;
                    combo = delta > 0 ? "ScrollUp" : "ScrollDown";
                    break;
                default:
                    return false;
            }
            var active = _tecladoActive;
            if (active == null || !TecladoMousePhysical(m)) return false;
            // A button already taken (a second press with no release between, which a mouse does not
            // send): it stays the slot's, and the press is swallowed.
            if (_tecladoSlots[index] != null) return true;
            if (gated || !profileKeysOn) return false;
            if (MainController.Instance?.IsRecording() == true) return false;
            var action = (_tecladoLayer ? active.Layer[index] : null) ?? active.Base[index];
            if (action == null) return false;
            if (combo != null && TecladoYieldsTo(ComposeMouseCombo(combo))) return false;

            if (delta != 0)
            {
                // A notch is a touch: down and up at once, never a slot (no "while held" on a wheel).
                if (Math.Sign(delta) != Math.Sign(_tecladoWheel)) _tecladoWheel = 0;
                _tecladoWheel += delta;
                int whole = Math.Abs(_tecladoWheel) / WheelNotch;
                _tecladoWheel -= Math.Sign(_tecladoWheel) * whole * WheelNotch;
                for (int i = 0; i < Math.Min(whole, MaxNotchesPerMessage); i++)
                {
                    TecladoMouseFunction(action, index, down: true);
                    TecladoMouseFunction(action, index, down: false);
                }
                return true;
            }

            _tecladoSlots[index] = action;
            _tecladoHeld++;
            TecladoMouseFunction(action, index, down: true);
            return true;
        }

        private static int TecladoXIndex(uint mouseData) => XButtonName(mouseData) == "XButton2" ? TecladoKeys.MouseX2 : TecladoKeys.MouseX1;

        // Set while a mouse callback runs a button's function (TecladoMouseDown, TecladoMouseUp).
        private static bool _tecladoInMouseHook;

        private static void TecladoMouseFunction(TecladoAction action, int index, bool down)
        {
            _tecladoInMouseHook = true;
            try
            {
                if (down) TecladoDown(action, index);
                else TecladoUp(action, index);
            }
            finally { _tecladoInMouseHook = false; }
        }

        /// <summary>
        /// A mouse event the Teclado injects. Inside the mouse hook's own callback it goes out once the
        /// callback has returned: a mouse SendInput made there let the very event the hook was swallowing
        /// through to the app as well (measured: the middle button turned into the left one reached the
        /// window as both). Queued on this thread, in order; a keyboard injection has no such problem.
        /// </summary>
        private static void TecladoMouse(uint flags, uint data)
        {
            if (_tecladoInMouseHook) TecladoAfterMouseHook(() => InjectRemappedMouse(flags, data));
            else InjectRemappedMouse(flags, data);
        }

        // Runs on this thread after the callback in progress, behind whatever is queued already
        // (PostToHookThread would run it at once, from here).
        private static void TecladoAfterMouseHook(Action work)
        {
            _hookWork.Enqueue(work);
            if (!NativeMethods.PostThreadMessage(_hookThreadId, WM_HOOK_WORK, IntPtr.Zero, IntPtr.Zero))
                DiagnosticLog.Error($"Teclado: the hook thread refused a queued click (PostThreadMessage error {Marshal.GetLastWin32Error()}).");
        }

        // Physical only (LLMHF_INJECTED clear), or the test probe's mark in a test house: the Teclado's own
        // clicks, the remaps' and a macro's never come back in as a source.
        private static bool TecladoMousePhysical(in NativeMethods.MSLLHOOKSTRUCT m) =>
            (m.flags & 0x1) == 0 || (TecladoTestPhysical && m.dwExtraInfo == TecladoTestMark);

        // ── What a function does ──

        private static void TecladoDown(TecladoAction a, int index)
        {
            switch (a.Kind)
            {
                case "key":
                    foreach (var stroke in a.Keys) TecladoSend(stroke, down: true);
                    break;
                case "mouse":
                    if (a.Wheel != 0) TecladoMouse(NativeMethods.MOUSEEVENTF_WHEEL, unchecked((uint)a.Wheel));
                    else TecladoMouse(a.MouseDown, a.MouseData);
                    break;
                case "layer":
                    _tecladoLayer = true;
                    TecladoFront.SetLayer(true);
                    break;
                case "text":
                {
                    // Typed off this thread: a hook callback must return at once.
                    var text = a.Text;
                    var enter = a.Enter;
                    Task.Run(() => TecladoType(text, enter));
                    break;
                }
                case "macro":
                {
                    // The original first, so the game sees its key before what the macro sends. A mouse
                    // button's original goes out after the mouse callback (TecladoMouse), so the macro
                    // starts behind it.
                    var binding = a.Binding!;
                    if (a.KeepOriginal && a.OriginalMouse != null)
                    {
                        TecladoDown(a.OriginalMouse, index);
                        if (_tecladoInMouseHook) { TecladoAfterMouseHook(() => TecladoRunner.Press(index, binding)); break; }
                    }
                    else if (a.KeepOriginal) TecladoSend(a.Original, down: true);
                    TecladoRunner.Press(index, binding);
                    break;
                }
                // "off": the key does nothing.
            }
        }

        private static void TecladoRepeat(TecladoAction a)
        {
            if (a.Kind == "key" && a.Keys.Length > 0) TecladoSend(a.Keys[^1], down: true);
            else if (a.Kind == "mouse" && a.Wheel != 0) TecladoMouse(NativeMethods.MOUSEEVENTF_WHEEL, unchecked((uint)a.Wheel));
            // A held macro key repeats only the original it keeps; the macro is already running.
            else if (a.Kind == "macro" && a.KeepOriginal) TecladoSend(a.Original, down: true);
        }

        private static void TecladoUp(TecladoAction a, int index)
        {
            switch (a.Kind)
            {
                case "key":
                    for (int i = a.Keys.Length - 1; i >= 0; i--) TecladoSend(a.Keys[i], down: false);
                    break;
                case "mouse":
                    if (a.Wheel == 0) TecladoMouse(a.MouseUp, a.MouseData);
                    break;
                case "layer":
                    _tecladoLayer = false;
                    TecladoFront.SetLayer(false);
                    break;
                case "macro":
                    if (a.KeepOriginal && a.OriginalMouse != null)
                    {
                        TecladoUp(a.OriginalMouse, index);
                        // Behind the original's release and the macro's start, both queued from a mouse callback.
                        if (_tecladoInMouseHook) { TecladoAfterMouseHook(() => TecladoRunner.Release(index)); break; }
                    }
                    else if (a.KeepOriginal) TecladoSend(a.Original, down: false);
                    // Only a "hold" run stops at the release; the executor knows the mode.
                    TecladoRunner.Release(index);
                    break;
            }
        }

        /// <summary>One key, by scan code (the plan: "por scan code, com o bit de estendida"), marked as the Teclado's.</summary>
        internal static void TecladoSend(TecladoStroke s, bool down)
        {
            uint flags = down ? 0u : NativeMethods.KEYEVENTF_KEYUP;
            ushort vk = 0;
            // Pause has no set-1 code a SendInput can carry (it is E1 1D 45): it goes by its VK.
            if (s.Scan != 0 && s.Vk != 0x13) flags |= NativeMethods.KEYEVENTF_SCANCODE;
            else vk = s.Vk;
            if (s.Extended) flags |= NativeMethods.KEYEVENTF_EXTENDEDKEY;
            var input = new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_KEYBOARD,
                U = new NativeMethods.InputUnion
                {
                    ki = new NativeMethods.KEYBDINPUT { wVk = vk, wScan = s.Scan, dwFlags = flags, dwExtraInfo = TecladoMark },
                },
            };
            NativeMethods.SendInput(1, ref input, NativeMethods.InputSize);
        }

        private static void TecladoType(string text, bool enter)
        {
            try
            {
                foreach (char c in text)
                {
                    TecladoSendChar(c, down: true);
                    TecladoSendChar(c, down: false);
                    Thread.Sleep(8);
                }
                if (enter)
                {
                    var key = new TecladoStroke(0x0D, 0x1C, false);
                    TecladoSend(key, down: true);
                    TecladoSend(key, down: false);
                }
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Teclado: typing the text failed: {ex.GetType().Name}: {ex.Message}");
            }
        }

        internal static void TecladoSendChar(char c, bool down)
        {
            var input = new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_KEYBOARD,
                U = new NativeMethods.InputUnion
                {
                    ki = new NativeMethods.KEYBDINPUT
                    {
                        wVk = 0,
                        wScan = c,
                        dwFlags = NativeMethods.KEYEVENTF_UNICODE | (down ? 0u : NativeMethods.KEYEVENTF_KEYUP),
                        dwExtraInfo = TecladoMark,
                    },
                },
            };
            NativeMethods.SendInput(1, ref input, NativeMethods.InputSize);
        }

        // ── Compiling, off the hook thread ──

        internal static TecladoTables CompileTeclado(TecladoService.Config config, Dictionary<string, TecladoMacros.Report> reports, out bool anyMacro)
        {
            anyMacro = false;
            var tables = new TecladoTables { Enabled = config.Enabled };
            // The layout of the window in front (the game's, with a game there), not the calling
            // thread's: a compile runs on whichever thread saved, and a pool thread has its own.
            var front = NativeMethods.GetForegroundWindow();
            IntPtr layout = NativeMethods.GetKeyboardLayout(front == IntPtr.Zero ? 0 : NativeMethods.GetWindowThreadProcessId(front, out _));
            foreach (var game in config.Games)
            {
                var table = new TecladoGameTable { On = game.On };
                CompileLayer(table.Base, game.Base, layout, reports, ref anyMacro);
                CompileLayer(table.Layer, game.Layer, layout, reports, ref anyMacro);
                tables.Games[game.Id] = table;
            }
            return tables;
        }

        private static void CompileLayer(TecladoAction?[] into, Dictionary<string, TecladoService.KeyFunction> keys, IntPtr layout,
            Dictionary<string, TecladoMacros.Report> reports, ref bool anyMacro)
        {
            foreach (var (code, fn) in keys)
            {
                // A keyboard key by its scan code, or one of the mouse's buttons after the keys (phase 7).
                int index;
                if (TecladoKeys.TryGetScan(code, out var scan, out var extended)) index = TecladoKeys.IndexOf(scan, extended);
                else if (!TecladoKeys.TryMouseIndex(code, out index)) continue;
                var action = fn.Kind == "macro"
                    ? MacroAction(fn, index, scan, extended, layout, reports)
                    : CompileAction(fn, layout);
                if (action == null) continue;
                if (action.Kind == "macro") anyMacro = true;
                into[index] = action;
            }
        }

        private static TecladoAction? CompileAction(TecladoService.KeyFunction fn, IntPtr layout) => fn.Kind switch
        {
            "off" => new TecladoAction { Kind = "off" },
            "layer" => new TecladoAction { Kind = "layer" },
            "text" => string.IsNullOrEmpty(fn.Text) && fn.Enter != true ? null
                : new TecladoAction { Kind = "text", Text = fn.Text ?? "", Enter = fn.Enter == true },
            "mouse" => MouseAction(fn.Mouse),
            "key" => KeyAction(fn.Combo, layout),
            _ => null,
        };

        /// <summary>
        /// A macro key: the library macro compiled for the executor. A macro that cannot run from a key
        /// (missing, empty, or with steps the Teclado does not run) compiles to nothing, so the key does
        /// what it always did, and the page says why.
        /// </summary>
        private static TecladoAction? MacroAction(TecladoService.KeyFunction fn, int index, ushort scan, bool extended, IntPtr layout,
            Dictionary<string, TecladoMacros.Report> reports)
        {
            if (string.IsNullOrEmpty(fn.Macro)) return null;
            var macro = TecladoMacros.Resolve(fn.Macro, layout, reports);
            if (macro == null) return null;
            // MAPVK_VSC_TO_VK_EX: the original key's VK (only Pause needs it to be re-sent). A mouse
            // button has no scan code: its original is the button itself.
            bool mouse = index >= TecladoKeys.MouseBase;
            ushort vk = mouse ? (ushort)0 : (ushort)NativeMethods.MapVirtualKeyEx(extended ? 0xE000u | scan : scan, 3, layout);
            return new TecladoAction
            {
                Kind = "macro",
                Binding = new TecladoRunner.Binding
                {
                    Macro = macro,
                    Mode = fn.Mode ?? "once",
                    Times = fn.Times ?? 1,
                    IntervalMs = fn.Interval ?? 0,
                },
                KeepOriginal = fn.KeepOriginal == true,
                Original = mouse ? default : new TecladoStroke(vk, scan, extended),
                OriginalMouse = mouse ? MouseAction(index switch
                {
                    TecladoKeys.MouseMiddle => "MiddleClick",
                    TecladoKeys.MouseX1 => "XButton1",
                    TecladoKeys.MouseX2 => "XButton2",
                    TecladoKeys.WheelUp => "ScrollUp",
                    _ => "ScrollDown",
                }) : null,
            };
        }

        private static TecladoAction? KeyAction(string? combo, IntPtr layout)
        {
            var (prefix, key) = KeyUtils.SplitCombo(combo);
            if (key.Length == 0) return null;
            var strokes = new List<TecladoStroke>();
            foreach (var part in prefix.Append(key))
            {
                if (!TryTecladoStroke(part, layout, out var stroke)) return null;
                strokes.Add(stroke);
            }
            return new TecladoAction { Kind = "key", Keys = strokes.ToArray() };
        }

        /// <summary>A key by its TR3 name, as the Teclado sends it: the VK, its scan code and the extended bit.</summary>
        internal static bool TryTecladoStroke(string name, IntPtr layout, out TecladoStroke stroke)
        {
            stroke = default;
            // Mouse buttons are not keys to inject (0x01–0x06).
            if (!KeyUtils.TryResolveVirtualKeyCode(name, out var vk) || vk <= 0x06) return false;
            // MAPVK_VK_TO_VSC_EX: the scan code, with 0xE0 in the high byte for an extended key.
            uint sc = NativeMethods.MapVirtualKeyEx(vk, 4, layout);
            bool extended = (sc & 0xFF00) == 0xE000 || _extendedVkCodes.Contains(vk);
            stroke = new TecladoStroke(vk, (ushort)(sc & 0xFF), extended);
            return true;
        }

        // The same targets as RemapService.MouseTargets, by the same names.
        private static TecladoAction? MouseAction(string? name) => name switch
        {
            "LeftClick" => new TecladoAction { Kind = "mouse", MouseDown = NativeMethods.MOUSEEVENTF_LEFTDOWN, MouseUp = NativeMethods.MOUSEEVENTF_LEFTUP },
            "RightClick" => new TecladoAction { Kind = "mouse", MouseDown = NativeMethods.MOUSEEVENTF_RIGHTDOWN, MouseUp = NativeMethods.MOUSEEVENTF_RIGHTUP },
            "MiddleClick" => new TecladoAction { Kind = "mouse", MouseDown = NativeMethods.MOUSEEVENTF_MIDDLEDOWN, MouseUp = NativeMethods.MOUSEEVENTF_MIDDLEUP },
            "XButton1" => new TecladoAction { Kind = "mouse", MouseDown = NativeMethods.MOUSEEVENTF_XDOWN, MouseUp = NativeMethods.MOUSEEVENTF_XUP, MouseData = NativeMethods.XBUTTON1 },
            "XButton2" => new TecladoAction { Kind = "mouse", MouseDown = NativeMethods.MOUSEEVENTF_XDOWN, MouseUp = NativeMethods.MOUSEEVENTF_XUP, MouseData = NativeMethods.XBUTTON2 },
            "ScrollUp" => new TecladoAction { Kind = "mouse", Wheel = 120 },
            "ScrollDown" => new TecladoAction { Kind = "mouse", Wheel = -120 },
            _ => null,
        };
    }
}
