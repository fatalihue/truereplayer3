using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using TrueReplayer.Helpers;
using TrueReplayer.Interop;
using TrueReplayer.Services;

namespace TrueReplayer
{
    /// <summary>
    /// Deck (branch deck; plan .claude/planos/deck-2026-11-19.md, Fase 3): the hook's part of the decks.
    ///
    /// While the engine clicks — a replay, the Clicker, a Teclado game in front — the decks let every click
    /// through (WS_EX_TRANSPARENT, the "passthrough"), so what the engine injects reaches the app under them,
    /// and the user's own clicks on a deck are taken here instead: swallowed and posted to the Deck's thread.
    /// The left and right buttons and the wheel are taken; the middle and side buttons stay with their own
    /// consumers (the Teclado, the remaps, the triggers), as they do over a deck outside the passthrough. A
    /// press taken here always has its release taken too, whatever came since (the passthrough ended, the
    /// cursor left the deck). The user's moves near a deck go there as well, one message in flight at a time,
    /// for the hover, the edge slide and a drag.
    ///
    /// Outside the passthrough the decks get their clicks the usual way, and the recorder leaves them out: a
    /// press on a deck and its release are not part of the macro.
    ///
    /// The Deck's own keys go out marked "DECK" (DeckMark) from the Deck's worker thread (DeckActions), never
    /// from this one; like every injection, the keyboard callback lets them pass untouched.
    /// </summary>
    public static partial class InputHookManager
    {
        /// <summary>The decks on screen as the hook sees them: published whole by the Deck's thread (DeckHost).</summary>
        internal sealed class DeckHits
        {
            public static readonly DeckHits None = new(IntPtr.Zero, false, Array.Empty<IntPtr>(), Array.Empty<DeckNative.RECT>());

            /// <summary>The Deck thread's hidden window, where the routed mouse goes.</summary>
            public readonly IntPtr Mailbox;
            /// <summary>The passthrough is on: the decks let clicks through, and the user's come by the hook.</summary>
            public readonly bool Pass;
            public readonly IntPtr[] Hwnds;
            public readonly DeckNative.RECT[] Rects;

            public DeckHits(IntPtr mailbox, bool pass, IntPtr[] hwnds, DeckNative.RECT[] rects)
            {
                Mailbox = mailbox;
                Pass = pass;
                Hwnds = hwnds;
                Rects = rects;
            }

            /// <summary>Is the point on a deck at all (no look at what covers it: the moves' cheap test).</summary>
            public bool Touches(int x, int y)
            {
                for (int i = 0; i < Rects.Length; i++) if (Rects[i].Contains(x, y)) return true;
                return false;
            }
        }

        private static volatile DeckHits _deckHits = DeckHits.None;

        internal static void SetDeckHits(DeckHits hits) => _deckHits = hits;
        internal static DeckHits CurrentDeckHits => _deckHits;

        // The routed mouse, to the mailbox: a button (+0 left down, +1 left up, +2 right down, +3 right up; wParam
        // the deck's window, lParam the point), the wheel (wParam the window, lParam the turn), a move (the point
        // is read with TakeDeckMove).
        internal const uint WM_DECK_BUTTON = DeckNative.WM_APP + 2, WM_DECK_WHEEL = DeckNative.WM_APP + 6, WM_DECK_MOVE = DeckNative.WM_APP + 7;

        /// <summary>What the Deck injects is marked, as the Teclado's is: "DECK".</summary>
        internal static readonly IntPtr DeckMark = (IntPtr)0x4445434B;

        // Test houses only (the probe of deck-acoes-real.mjs): with TRUEREPLAYER3_TEST_DECK=1 in the environment,
        // an injected mouse event marked "TEST" counts as the user's for the deck's routing, and for nothing else
        // in the hook. The same kind of switch as TRUEREPLAYER3_TEST_TECLADO.
        private static readonly IntPtr DeckTestMark = (IntPtr)0x54455354;
        private static readonly bool DeckTestPhysical = Environment.GetEnvironmentVariable("TRUEREPLAYER3_TEST_DECK") == "1";
        private static readonly int DeckExtraOffset = (int)Marshal.OffsetOf<NativeMethods.MSLLHOOKSTRUCT>(nameof(NativeMethods.MSLLHOOKSTRUCT.dwExtraInfo));

        // ── The hook thread's own state: no lock ──

        // The deck a routed press went to, by button (0 left, 1 right), until its release comes.
        private static readonly IntPtr[] _deckOwed = new IntPtr[2];
        private static volatile bool _deckOwedAny;
        // A press the recorder left out because it landed on a deck (1 left, 2 right, 4 middle), until its release.
        private static int _deckRecSkip;
        // The last routed move was on a deck: the next one off it goes too, so the deck sees the mouse leave.
        private static bool _deckMoveOn;

        // The latest routed move, for the Deck's thread: x in the high half, y in the low one; one message in flight.
        private static long _deckMovePoint;
        private static int _deckMovePending;

        /// <summary>The latest routed move (the Deck's thread, on WM_DECK_MOVE). The flag goes down first: a move after this read posts again.</summary>
        internal static (int X, int Y) TakeDeckMove()
        {
            Volatile.Write(ref _deckMovePending, 0);
            long p = Interlocked.Read(ref _deckMovePoint);
            return ((int)(p >> 32), unchecked((int)(p & 0xFFFFFFFF)));
        }

        private static bool DeckPhysical(uint flags, IntPtr extra) =>
            (flags & 0x1) == 0 || (DeckTestPhysical && extra == DeckTestMark);

        /// <summary>
        /// A move, from the callback's fast path: with the passthrough on and the cursor on a deck (or just off one),
        /// or with a routed press held (a drag), it goes to the Deck's thread. The engine's own moves never do.
        /// </summary>
        private static void DeckMove(IntPtr lParam)
        {
            var hits = _deckHits;
            if ((!hits.Pass && !_deckOwedAny) || hits.Mailbox == IntPtr.Zero) return;
            if (!DeckPhysical((uint)Marshal.ReadInt32(lParam, 12), Marshal.ReadIntPtr(lParam, DeckExtraOffset))) return;
            int x = Marshal.ReadInt32(lParam, 0), y = Marshal.ReadInt32(lParam, 4);
            bool on = hits.Pass && hits.Touches(x, y);
            if (!on && !_deckMoveOn && !_deckOwedAny) return;
            _deckMoveOn = on;
            Interlocked.Exchange(ref _deckMovePoint, ((long)x << 32) | (uint)y);
            if (Interlocked.Exchange(ref _deckMovePending, 1) == 0)
                DeckNative.PostMessageW(hits.Mailbox, WM_DECK_MOVE, IntPtr.Zero, IntPtr.Zero);
        }

        /// <summary>
        /// The release of a press a deck took by the hook: taken too, always — before every gate, as the Teclado's
        /// and the remaps' releases are. True when it was.
        /// </summary>
        private static bool DeckReleaseOwed(int msg, in NativeMethods.MSLLHOOKSTRUCT m)
        {
            int b = msg == NativeMethods.WM_LBUTTONUP ? 0 : msg == NativeMethods.WM_RBUTTONUP ? 1 : -1;
            if (b < 0 || _deckOwed[b] == IntPtr.Zero || !DeckPhysical(m.flags, m.dwExtraInfo)) return false;
            var hwnd = _deckOwed[b];
            _deckOwed[b] = IntPtr.Zero;
            _deckOwedAny = _deckOwed[0] != IntPtr.Zero || _deckOwed[1] != IntPtr.Zero;
            // Its press was left out of a recording; this release never reaches the recorder, so the mark goes here.
            _deckRecSkip &= ~(1 << b);
            var mailbox = _deckHits.Mailbox;
            if (mailbox != IntPtr.Zero)
                DeckNative.PostMessageW(mailbox, WM_DECK_BUTTON + (uint)(b * 2 + 1), hwnd, DeckPoint(m.pt.x, m.pt.y));
            return true;
        }

        /// <summary>
        /// The user's press of the left or right button, or turn of the wheel, on a deck in the passthrough: the
        /// deck's. Asked last, where the event would otherwise go on to the window under the cursor — which, with
        /// the deck letting clicks through, is the app under it. True when taken.
        /// </summary>
        private static bool DeckTake(int msg, in NativeMethods.MSLLHOOKSTRUCT m)
        {
            var hits = _deckHits;
            if (!hits.Pass || hits.Hwnds.Length == 0 || hits.Mailbox == IntPtr.Zero) return false;
            int b = msg == NativeMethods.WM_LBUTTONDOWN ? 0 : msg == NativeMethods.WM_RBUTTONDOWN ? 1 : msg == NativeMethods.WM_MOUSEWHEEL ? 2 : -1;
            if (b < 0 || !DeckPhysical(m.flags, m.dwExtraInfo)) return false;
            int i = DeckAt(hits, m.pt.x, m.pt.y);
            if (i < 0) return false;
            var hwnd = hits.Hwnds[i];
            if (b == 2)
            {
                DeckNative.PostMessageW(hits.Mailbox, WM_DECK_WHEEL, hwnd, (IntPtr)(short)((m.mouseData >> 16) & 0xFFFF));
                return true;
            }
            _deckOwed[b] = hwnd;
            _deckOwedAny = true;
            DeckNative.PostMessageW(hits.Mailbox, WM_DECK_BUTTON + (uint)(b * 2), hwnd, DeckPoint(m.pt.x, m.pt.y));
            return true;
        }

        /// <summary>
        /// The recorder leaves a deck's clicks out: a press that lands on a deck, its release, and a turn of the
        /// wheel on one. In the passthrough only the user's own are the deck's — an injected click goes through it
        /// to the app under it, and is recorded as before. True to leave the event out.
        /// </summary>
        private static bool DeckLeavesOut(int msg, in NativeMethods.MSLLHOOKSTRUCT m)
        {
            int bit; bool down;
            switch (msg)
            {
                case NativeMethods.WM_LBUTTONDOWN: bit = 1; down = true; break;
                case NativeMethods.WM_LBUTTONUP: bit = 1; down = false; break;
                case NativeMethods.WM_RBUTTONDOWN: bit = 2; down = true; break;
                case NativeMethods.WM_RBUTTONUP: bit = 2; down = false; break;
                case NativeMethods.WM_MBUTTONDOWN: bit = 4; down = true; break;
                case NativeMethods.WM_MBUTTONUP: bit = 4; down = false; break;
                case NativeMethods.WM_MOUSEWHEEL: bit = 0; down = true; break;
                default: return false;
            }
            if (!down)
            {
                if ((_deckRecSkip & bit) == 0) return false;
                _deckRecSkip &= ~bit;
                return true;
            }
            var hits = _deckHits;
            if (hits.Hwnds.Length == 0) return false;
            if (hits.Pass && !DeckPhysical(m.flags, m.dwExtraInfo)) return false;
            if (DeckAt(hits, m.pt.x, m.pt.y) < 0) return false;
            _deckRecSkip |= bit;
            return true;
        }

        /// <summary>
        /// The deck the point is on, or -1: on its rectangle, with no other window that takes clicks above it at
        /// that point (another deck above wins it; anything else above — a window kept on top — takes the click
        /// for itself). Only for presses: a few cheap user32 reads.
        /// </summary>
        private static int DeckAt(DeckHits hits, int x, int y)
        {
            for (int i = 0; i < hits.Hwnds.Length; i++)
            {
                if (!hits.Rects[i].Contains(x, y)) continue;
                bool underDeck = false;
                int n = 0;
                for (IntPtr h = DeckNative.GetWindow(hits.Hwnds[i], DeckNative.GW_HWNDPREV); h != IntPtr.Zero && n < 256; h = DeckNative.GetWindow(h, DeckNative.GW_HWNDPREV), n++)
                {
                    int other = Array.IndexOf(hits.Hwnds, h);
                    if (other >= 0)
                    {
                        if (hits.Rects[other].Contains(x, y)) { underDeck = true; break; }
                        continue;
                    }
                    if (!DeckNative.IsWindowVisible(h)) continue;
                    if ((DeckNative.GetWindowLongPtrW(h, DeckNative.GWL_EXSTYLE).ToInt64() & DeckNative.WS_EX_TRANSPARENT) != 0) continue;
                    if (!DeckNative.GetWindowRect(h, out var r) || !r.Contains(x, y)) continue;
                    if (DeckNative.DwmGetWindowAttribute(h, DeckNative.DWMWA_CLOAKED, out int cloaked, sizeof(int)) == 0 && cloaked != 0) continue;
                    return -1;
                }
                if (!underDeck) return i;
            }
            return -1;
        }

        private static IntPtr DeckPoint(int x, int y) => (IntPtr)(((y & 0xFFFF) << 16) | (x & 0xFFFF));

        // ── The Deck's keys (DeckActions, on the Deck's worker thread) ──

        /// <summary>
        /// A combo by its TR3 names ("Ctrl+Shift+K", "F13", "MediaPlayPause") as strokes, for the layout of the
        /// window in front — the one that receives them. False when a name is not a key that can be sent.
        /// </summary>
        internal static bool TryDeckCombo(string? combo, out TecladoStroke[] strokes)
        {
            strokes = Array.Empty<TecladoStroke>();
            var (prefix, key) = KeyUtils.SplitCombo(combo);
            if (key.Length == 0) return false;
            var front = NativeMethods.GetForegroundWindow();
            IntPtr layout = NativeMethods.GetKeyboardLayout(front == IntPtr.Zero ? 0 : NativeMethods.GetWindowThreadProcessId(front, out _));
            var list = new List<TecladoStroke>();
            foreach (var part in prefix.Append(key))
            {
                if (!TryTecladoStroke(DeckKeyName(part), layout, out var stroke)) return false;
                list.Add(stroke);
            }
            strokes = list.ToArray();
            return true;
        }

        // The media keys by the names the Deck's page writes; KeyUtils knows them by .NET's ConsoleKey names.
        private static string DeckKeyName(string name) => name.ToLowerInvariant() switch
        {
            "mediaplaypause" => "MediaPlay",
            "medianexttrack" => "MediaNext",
            "mediaprevtrack" or "mediaprevioustrack" => "MediaPrevious",
            _ => name,
        };

        /// <summary>
        /// A combo pressed and let go: the modifiers in order and the key down, a moment held (a game that polls
        /// would miss a key down and up in the same instant), then all up in reverse.
        /// </summary>
        internal static void DeckSendCombo(TecladoStroke[] strokes)
        {
            if (strokes.Length == 0) return;
            var down = new NativeMethods.INPUT[strokes.Length];
            var up = new NativeMethods.INPUT[strokes.Length];
            for (int i = 0; i < strokes.Length; i++)
            {
                down[i] = DeckKey(strokes[i], down: true);
                up[i] = DeckKey(strokes[strokes.Length - 1 - i], down: false);
            }
            NativeMethods.SendInput((uint)down.Length, down, NativeMethods.InputSize);
            Thread.Sleep(30);
            NativeMethods.SendInput((uint)up.Length, up, NativeMethods.InputSize);
        }

        private static NativeMethods.INPUT DeckKey(TecladoStroke s, bool down)
        {
            uint flags = down ? 0u : NativeMethods.KEYEVENTF_KEYUP;
            ushort vk = 0;
            // By scan code, as the Teclado sends (a game reads it); Pause, and the media, volume and browser keys,
            // by their VK — what Windows turns into the command.
            bool byVk = s.Scan == 0 || s.Vk == 0x13 || (s.Vk >= 0xA6 && s.Vk <= 0xB7);
            if (byVk) vk = s.Vk;
            else flags |= NativeMethods.KEYEVENTF_SCANCODE;
            if (s.Extended) flags |= NativeMethods.KEYEVENTF_EXTENDEDKEY;
            return new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_KEYBOARD,
                U = new NativeMethods.InputUnion { ki = new NativeMethods.KEYBDINPUT { wVk = vk, wScan = s.Scan, dwFlags = flags, dwExtraInfo = DeckMark } },
            };
        }

        /// <summary>
        /// A text typed one character at a time (a pair of UTF-16 halves goes in one call, never split): a line
        /// break is Enter, a tab is Tab.
        /// </summary>
        internal static void DeckType(string text, CancellationToken token)
        {
            var enter = new TecladoStroke(0x0D, 0x1C, false);
            var tab = new TecladoStroke(0x09, 0x0F, false);
            for (int i = 0; i < text.Length; i++)
            {
                if (token.IsCancellationRequested) return;
                char c = text[i];
                if (c == '\r') continue;
                if (c == '\n' || c == '\t')
                {
                    var key = c == '\n' ? enter : tab;
                    var pair = new[] { DeckKey(key, down: true), DeckKey(key, down: false) };
                    NativeMethods.SendInput((uint)pair.Length, pair, NativeMethods.InputSize);
                }
                else
                {
                    var units = new List<NativeMethods.INPUT>(4) { DeckUnit(c, up: false), DeckUnit(c, up: true) };
                    if (char.IsHighSurrogate(c) && i + 1 < text.Length && char.IsLowSurrogate(text[i + 1]))
                    {
                        i++;
                        units.Add(DeckUnit(text[i], up: false));
                        units.Add(DeckUnit(text[i], up: true));
                    }
                    var batch = units.ToArray();
                    NativeMethods.SendInput((uint)batch.Length, batch, NativeMethods.InputSize);
                }
                Thread.Sleep(8);
            }
        }

        private static NativeMethods.INPUT DeckUnit(char unit, bool up) => new()
        {
            type = NativeMethods.INPUT_KEYBOARD,
            // wVk must be 0 with KEYEVENTF_UNICODE.
            U = new NativeMethods.InputUnion
            {
                ki = new NativeMethods.KEYBDINPUT { wVk = 0, wScan = unit, dwFlags = NativeMethods.KEYEVENTF_UNICODE | (up ? NativeMethods.KEYEVENTF_KEYUP : 0u), dwExtraInfo = DeckMark },
            },
        };

        /// <summary>Ctrl+V, by scan code, as the engine's paste sends it; marked as the Deck's.</summary>
        internal static void DeckSendPaste()
        {
            var ctrl = new TecladoStroke(0x11, (ushort)NativeMethods.MapVirtualKey(0x11, 0), false);
            var v = new TecladoStroke(0x56, (ushort)NativeMethods.MapVirtualKey(0x56, 0), false);
            var inputs = new[] { DeckKey(ctrl, down: true), DeckKey(v, down: true), DeckKey(v, down: false), DeckKey(ctrl, down: false) };
            NativeMethods.SendInput((uint)inputs.Length, inputs, NativeMethods.InputSize);
        }
    }
}
