using System;
using System.Collections.Concurrent;
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
    /// off this thread and swapped whole; the callback only indexes arrays. Keys go out carrying
    /// TecladoMark in dwExtraInfo; clicks and wheel notches go out through the Key Remaps' own
    /// InjectRemappedMouse, which waits for the mouse callback to return when it is called from inside
    /// it (3.0.4, _inMouseHookCallback). Both pass the hook's injected gate like every other injection.
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

        // A middle or side button whose press the Teclado swallowed and whose release has not come yet
        // (MouseMiddle, MouseX1, MouseX2). Kept after its slot is let go (the game left the front, the
        // Teclado was turned off, the mouse hook died): that release is swallowed too, or Windows turns an
        // orphan side-button release into Back/Forward in the window in front.
        private static readonly bool[] _tecladoOwedUp = new bool[3];
        private static int _tecladoOwed;

        // A key's mouse button the user's own finger already held at the press (left or right): the press
        // was not sent, so neither is the release — the remaps' AppHoldsMouseButton, for the same reason.
        private static readonly bool[] _tecladoNoButtonUp = new bool[TecladoKeys.TableSize];

        /// <summary>
        /// What the slots hold now, by VK and by button (0 left, 1 right, 2 middle). Written on this thread,
        /// read by the executor before it lets go of a key or a button, as the slots read its own counts
        /// before theirs: one holder never releases what the other still holds (Q held as Shift while a
        /// macro presses and releases Shift).
        /// </summary>
        internal static readonly int[] TecladoSlotKeys = new int[256];
        internal static readonly int[] TecladoSlotButtons = new int[3];

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

        /// <summary>
        /// The Shortcuts were turned off (their hotkey, the tray, the status bar): the general pause. What
        /// the game's keys hold is let go and their macros and texts stop at once — a Toggle macro had no
        /// other way to stop, since the pause keeps the next press of its key raw.
        /// </summary>
        internal static void TecladoPause() => PostToHookThread(TecladoReleaseAll);

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
            var previous = _tecladoActive;
            var previousId = _tecladoActiveId;
            // The new game first: a press that arrives while the old one's keys are being let go (a
            // SendInput below lets a pending callback run inside it) belongs to the game in front now.
            _tecladoActive = next;
            _tecladoActiveId = nextId;
            // The same game compiled again (its keys saved, the library reloaded by a file changing on
            // disk mid-game): what is held keeps the function frozen in its slot and is let go by its own
            // release, and the macros run on. Another game, a game turned off, the Teclado off: what the
            // old one holds is let go.
            if (next == null || previous == null || nextId != previousId) TecladoReleaseAll();
        }

        /// <summary>Lets go of everything the Teclado holds: the game left the front, the Teclado was turned off or paused, the hook stopped.</summary>
        private static void TecladoReleaseAll() => TecladoRelease(keys: true, mouse: true, stopRuns: true);

        /// <summary>
        /// Lets go of the slots of the keys, of the mouse's buttons, or both (a dead hook lets go of its own
        /// device's), and with <paramref name="stopRuns"/> stops every macro and text the keys started.
        /// Each slot is counted down as it goes: a press that opens a slot meanwhile (inside one of the
        /// SendInputs below) keeps its count, so its release is still read.
        /// </summary>
        private static void TecladoRelease(bool keys, bool mouse, bool stopRuns)
        {
            if (_tecladoHeld > 0)
            {
                for (int i = 0; i < _tecladoSlots.Length; i++)
                {
                    if (i >= TecladoKeys.MouseBase ? !mouse : !keys) continue;
                    var action = _tecladoSlots[i];
                    if (action == null) continue;
                    _tecladoSlots[i] = null;
                    _tecladoHeld--;
                    TecladoUp(action, i);
                }
                if (_tecladoHeld < 0) _tecladoHeld = 0;
            }
            // The layer goes with its key's slot (TecladoUp); with every slot let go, nothing holds it.
            if (keys && mouse && _tecladoLayer)
            {
                _tecladoLayer = false;
                TecladoFront.SetLayer(false);
            }
            if (!stopRuns) return;
            // The texts being typed stop at the next character, and the ones waiting are dropped.
            TecladoCancelTexts();
            // The macros the keys started stop too, whatever their mode, and let go of what they hold —
            // behind whatever the mouse callback queued (a macro's start after its button's own click),
            // or a start that overtook this stop would run on with nothing left to stop it.
            TecladoQueued(TecladoRunner.StopAll);
        }

        /// <summary>The session went away and came back, or the hooks stopped: no release owed from before is still coming.</summary>
        private static void TecladoForgetOwed()
        {
            Array.Clear(_tecladoOwedUp);
            _tecladoOwed = 0;
        }

        // Work behind what the mouse callback in progress (or one before it) has queued on this thread:
        // a release must never overtake its press. Outside that, at once.
        private static bool TecladoMustQueue => _inMouseHookCallback || !_hookWork.IsEmpty;

        private static void TecladoQueued(Action work)
        {
            if (TecladoMustQueue) AfterMouseHookCallback(work);
            else work();
        }

        /// <summary>Runs work on the hook thread once the callback in progress has returned (TecladoFront's layer, published from the callback).</summary>
        internal static void AfterHookCallback(Action work) => AfterMouseHookCallback(work);

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
                // Every auto-repeat of a held AltGr brings its phantom Ctrl back with it (the remap
                // pairing takes it back each time, for the same reason): left there, the layer's keys
                // would reach the game as Ctrl+key.
                NeutraliseAltGrPhantomCtrl(vk);
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
            // The same, for a press that went through raw while a gate was up (a picker of the app, the
            // Shortcuts off, a recording): none of the sets above saw it. A low-level hook reads the key
            // state as it was before this event, so a key Windows already holds down is that press's
            // auto-repeat — a slot opened now would swallow the release the game is waiting for.
            if (NativeMethods.GetAsyncKeyState(vk) < 0) return false;

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

        /// <summary>Whether the mouse callback must call <see cref="TecladoMouseRelease"/>: a slot is open, or a release is owed.</summary>
        private static bool TecladoMouseWatching => _tecladoHeld > 0 || _tecladoOwed > 0;

        /// <summary>
        /// The release of the middle or a side button the Teclado took at its press: let go of what it did,
        /// and swallow the release — also when its slot was already let go (the release is owed, see
        /// _tecladoOwedUp). A new press of a button with a release still owed means that release was lost
        /// (it came while the hook was dead): the debt is dropped and the press goes on.
        /// </summary>
        private static bool TecladoMouseRelease(int message, in NativeMethods.MSLLHOOKSTRUCT m)
        {
            int index;
            bool down;
            switch (message)
            {
                case NativeMethods.WM_MBUTTONUP: index = TecladoKeys.MouseMiddle; down = false; break;
                case NativeMethods.WM_XBUTTONUP: index = TecladoXIndex(m.mouseData); down = false; break;
                case NativeMethods.WM_MBUTTONDOWN: index = TecladoKeys.MouseMiddle; down = true; break;
                case NativeMethods.WM_XBUTTONDOWN: index = TecladoXIndex(m.mouseData); down = true; break;
                default: return false;
            }
            if (!TecladoMousePhysical(m)) return false;
            int owed = index - TecladoKeys.MouseBase;
            var action = _tecladoSlots[index];
            if (down)
            {
                if (action == null && _tecladoOwedUp[owed]) { _tecladoOwedUp[owed] = false; _tecladoOwed--; }
                return false;
            }
            bool wasOwed = _tecladoOwedUp[owed];
            if (wasOwed) { _tecladoOwedUp[owed] = false; _tecladoOwed--; }
            if (action == null) return wasOwed;
            _tecladoSlots[index] = null;
            _tecladoHeld--;
            TecladoUp(action, index);
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
                    TecladoDown(action, index);
                    TecladoUp(action, index);
                }
                return true;
            }

            _tecladoSlots[index] = action;
            _tecladoHeld++;
            // Its release is owed from now on, whatever happens to the slot.
            int owed = index - TecladoKeys.MouseBase;
            if (!_tecladoOwedUp[owed]) { _tecladoOwedUp[owed] = true; _tecladoOwed++; }
            TecladoDown(action, index);
            return true;
        }

        private static int TecladoXIndex(uint mouseData) => XButtonName(mouseData) == "XButton2" ? TecladoKeys.MouseX2 : TecladoKeys.MouseX1;

        // A click or a notch a button's function sends from inside the mouse callback needs nothing of
        // its own: InjectRemappedMouse queues it behind the callback (_inMouseHookCallback,
        // AfterMouseHookCallback), in order with the rest of that queue.

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
                    foreach (var stroke in a.Keys) TecladoHold(stroke);
                    break;
                case "mouse":
                {
                    if (a.Wheel != 0) { InjectRemappedMouse(NativeMethods.MOUSEEVENTF_WHEEL, unchecked((uint)a.Wheel)); break; }
                    int b = TecladoButtonOf(a.MouseDown);
                    // The user's own finger already holds this button (left or right): not pressed again,
                    // and so not let go at the release either — the remaps' AppHoldsMouseButton.
                    if (b is 0 or 1 && _physicalMouseDowns.Contains(b == 0 ? 0x01 : 0x02)) { _tecladoNoButtonUp[index] = true; break; }
                    if (b >= 0) TecladoSlotButtons[b]++;
                    InjectRemappedMouse(a.MouseDown, a.MouseData);
                    break;
                }
                case "layer":
                    _tecladoLayer = true;
                    TecladoFront.SetLayer(true);
                    break;
                case "text":
                    // Typed off this thread: a hook callback must return at once.
                    TecladoQueueText(a.Text, a.Enter);
                    break;
                case "macro":
                {
                    // The original first, so the game sees its key before what the macro sends. A mouse
                    // button's original goes out after the mouse callback (InjectRemappedMouse), so the
                    // macro starts behind it.
                    var binding = a.Binding!;
                    if (a.KeepOriginal && a.OriginalMouse != null)
                    {
                        TecladoDown(a.OriginalMouse, index);
                        if (TecladoMustQueue) { AfterMouseHookCallback(() => TecladoRunner.Press(index, binding)); break; }
                    }
                    else if (a.KeepOriginal) TecladoHold(a.Original);
                    TecladoRunner.Press(index, binding);
                    break;
                }
                // "off": the key does nothing.
            }
        }

        private static void TecladoRepeat(TecladoAction a)
        {
            if (a.Kind == "key" && a.Keys.Length > 0) TecladoSend(a.Keys[^1], down: true);
            else if (a.Kind == "mouse" && a.Wheel != 0) InjectRemappedMouse(NativeMethods.MOUSEEVENTF_WHEEL, unchecked((uint)a.Wheel));
            // A held macro key repeats only the original it keeps; the macro is already running.
            else if (a.Kind == "macro" && a.KeepOriginal) TecladoSend(a.Original, down: true);
        }

        private static void TecladoUp(TecladoAction a, int index)
        {
            switch (a.Kind)
            {
                case "key":
                    for (int i = a.Keys.Length - 1; i >= 0; i--) TecladoLetGo(a.Keys[i]);
                    break;
                case "mouse":
                {
                    if (a.Wheel != 0) break;
                    if (_tecladoNoButtonUp[index]) { _tecladoNoButtonUp[index] = false; break; }
                    int b = TecladoButtonOf(a.MouseDown);
                    if (b >= 0)
                    {
                        if (TecladoSlotButtons[b] > 0) TecladoSlotButtons[b]--;
                        // Another slot, or a macro of the executor, still holds it: theirs to let go.
                        if (TecladoSlotButtons[b] > 0 || TecladoRunner.HoldsButton(b)) break;
                    }
                    InjectRemappedMouse(a.MouseUp, a.MouseData);
                    break;
                }
                case "layer":
                    _tecladoLayer = false;
                    TecladoFront.SetLayer(false);
                    break;
                case "macro":
                    if (a.KeepOriginal && a.OriginalMouse != null)
                    {
                        TecladoUp(a.OriginalMouse, index);
                        // Behind the original's release and the macro's start, both queued from a mouse
                        // callback — and behind a start still waiting in that queue when this release
                        // comes from outside it (the game left the front just then).
                        if (TecladoMustQueue) { AfterMouseHookCallback(() => TecladoRunner.Release(index)); break; }
                    }
                    else if (a.KeepOriginal) TecladoLetGo(a.Original);
                    // Only a "hold" run stops at the release; the executor knows the mode.
                    TecladoRunner.Release(index);
                    break;
            }
        }

        /// <summary>A key a slot presses: counted (TecladoSlotKeys), then sent.</summary>
        private static void TecladoHold(TecladoStroke s)
        {
            TecladoSlotKeys[s.Vk & 0xFF]++;
            TecladoSend(s, down: true);
        }

        /// <summary>A key a slot lets go of: up only when no other slot and no macro of the executor still holds it.</summary>
        private static void TecladoLetGo(TecladoStroke s)
        {
            int vk = s.Vk & 0xFF;
            if (TecladoSlotKeys[vk] > 0) TecladoSlotKeys[vk]--;
            if (TecladoSlotKeys[vk] == 0 && !TecladoRunner.HoldsKey(vk)) TecladoSend(s, down: false);
        }

        // The executor's button of a down flag: 0 left, 1 right, 2 middle; -1 for a side button (it has none).
        private static int TecladoButtonOf(uint downFlags) =>
            (downFlags & NativeMethods.MOUSEEVENTF_LEFTDOWN) != 0 ? 0
            : (downFlags & NativeMethods.MOUSEEVENTF_RIGHTDOWN) != 0 ? 1
            : (downFlags & NativeMethods.MOUSEEVENTF_MIDDLEDOWN) != 0 ? 2
            : -1;

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

        // The Texto function's texts, typed one at a time and in order by one task (two quick touches type
        // one after the other, never interleaved), each with the token of the moment it was asked: letting
        // go of everything (the game left the front, the pause, the Teclado off) cancels them all.
        private static readonly ConcurrentQueue<(string Text, bool Enter, CancellationToken Token)> _tecladoTexts = new();
        private static CancellationTokenSource _tecladoTextsCts = new();
        private static int _tecladoTyping;

        private static void TecladoQueueText(string text, bool enter)
        {
            _tecladoTexts.Enqueue((text, enter, _tecladoTextsCts.Token));
            if (Interlocked.CompareExchange(ref _tecladoTyping, 1, 0) == 0) Task.Run(TecladoTypeTexts);
        }

        // On the hook thread. Nothing is registered on the token (the typing only reads it), so the cancel
        // runs no callback here.
        private static void TecladoCancelTexts()
        {
            _tecladoTextsCts.Cancel();
            _tecladoTextsCts = new CancellationTokenSource();
        }

        private static void TecladoTypeTexts()
        {
            while (true)
            {
                while (_tecladoTexts.TryDequeue(out var item)) TecladoType(item.Text, item.Enter, item.Token);
                Volatile.Write(ref _tecladoTyping, 0);
                // A text queued between the last dequeue and the flag going down is typed here, not left behind.
                if (_tecladoTexts.IsEmpty || Interlocked.CompareExchange(ref _tecladoTyping, 1, 0) != 0) return;
            }
        }

        private static void TecladoType(string text, bool enter, CancellationToken token)
        {
            try
            {
                foreach (char c in text)
                {
                    if (token.IsCancellationRequested) return;
                    TecladoSendChar(c, down: true);
                    TecladoSendChar(c, down: false);
                    Thread.Sleep(8);
                }
                if (enter && !token.IsCancellationRequested)
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
            // button has no scan code: its original is the button itself. Pause is 0x45 without the
            // extended bit in the hook, which that mapping reads as NumLock: re-sent so, it toggled NumLock.
            bool mouse = index >= TecladoKeys.MouseBase;
            ushort vk = mouse ? (ushort)0
                : scan == 0x45 && !extended ? (ushort)0x13
                : (ushort)NativeMethods.MapVirtualKeyEx(extended ? 0xE000u | scan : scan, 3, layout);
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
