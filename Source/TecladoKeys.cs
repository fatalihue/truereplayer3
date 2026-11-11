using System;
using System.Collections.Generic;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Teclado (TrueReplayerMK as a mode of TrueReplayer 3): the physical position of each key.
    /// teclado.json keeps a key by its <c>KeyboardEvent.code</c> name ("KeyE", "CapsLock", "IntlRo"),
    /// which is the position and not what is printed on the cap, so the same game works on ABNT2
    /// and US layouts. Here it becomes the set-1 scan code plus the extended bit: what the hook
    /// receives and what the injection sends. The mouse buttons that take a function have names of
    /// their own ("MouseMiddle", "WheelUp").
    /// </summary>
    public static class TecladoKeys
    {
        /// <summary>A key's index in the hook's tables: the scan code, plus 0x100 with the extended bit (always below <see cref="MouseBase"/>).</summary>
        public static int IndexOf(ushort scan, bool extended) => (scan & 0xFF) | (extended ? 0x100 : 0);

        /// <summary>
        /// The index of what the hook received, or false when it is not a key of the table. A scan code
        /// above 0xFF is not one: the left Ctrl Windows sends ahead of AltGr arrives as 0x21D and must
        /// never read as ControlLeft (the hook filters it first, IsAltGrPhantomCtrl).
        /// </summary>
        public static bool TryIndexOf(uint scan, bool extended, out int index)
        {
            index = scan <= 0xFF ? IndexOf((ushort)scan, extended) : -1;
            return index >= 0;
        }

        /// <summary>
        /// The size of the tables: the keys indexed by <see cref="IndexOf"/> (below 0x200), then the mouse
        /// buttons from <see cref="MouseBase"/>, in the order of <see cref="MouseCodes"/>.
        /// </summary>
        public const int TableSize = 0x208;

        /// <summary>The mouse buttons that take a function: middle, the side ones and the wheel (left and right stay out).</summary>
        public static readonly IReadOnlyList<string> MouseCodes = new[] { "MouseMiddle", "MouseX1", "MouseX2", "WheelUp", "WheelDown" };

        /// <summary>The mouse buttons' indexes in the tables, after every key's.</summary>
        public const int MouseBase = 0x200;
        public const int MouseMiddle = MouseBase, MouseX1 = MouseBase + 1, MouseX2 = MouseBase + 2, WheelUp = MouseBase + 3, WheelDown = MouseBase + 4;

        /// <summary>A mouse button's index in the tables, or false for a name that is not one.</summary>
        public static bool TryMouseIndex(string code, out int index)
        {
            for (int i = 0; i < MouseCodes.Count; i++)
            {
                if (!string.Equals(MouseCodes[i], code, StringComparison.Ordinal)) continue;
                index = MouseBase + i;
                return true;
            }
            index = -1;
            return false;
        }

        private static readonly (string Code, ushort Scan, bool Ext)[] Table =
        {
            ("Escape", 0x01, false),
            ("Digit1", 0x02, false), ("Digit2", 0x03, false), ("Digit3", 0x04, false), ("Digit4", 0x05, false), ("Digit5", 0x06, false),
            ("Digit6", 0x07, false), ("Digit7", 0x08, false), ("Digit8", 0x09, false), ("Digit9", 0x0A, false), ("Digit0", 0x0B, false),
            ("Minus", 0x0C, false), ("Equal", 0x0D, false), ("Backspace", 0x0E, false), ("Tab", 0x0F, false),
            ("KeyQ", 0x10, false), ("KeyW", 0x11, false), ("KeyE", 0x12, false), ("KeyR", 0x13, false), ("KeyT", 0x14, false),
            ("KeyY", 0x15, false), ("KeyU", 0x16, false), ("KeyI", 0x17, false), ("KeyO", 0x18, false), ("KeyP", 0x19, false),
            ("BracketLeft", 0x1A, false), ("BracketRight", 0x1B, false), ("Enter", 0x1C, false), ("ControlLeft", 0x1D, false),
            ("KeyA", 0x1E, false), ("KeyS", 0x1F, false), ("KeyD", 0x20, false), ("KeyF", 0x21, false), ("KeyG", 0x22, false),
            ("KeyH", 0x23, false), ("KeyJ", 0x24, false), ("KeyK", 0x25, false), ("KeyL", 0x26, false),
            ("Semicolon", 0x27, false), ("Quote", 0x28, false), ("Backquote", 0x29, false), ("ShiftLeft", 0x2A, false), ("Backslash", 0x2B, false),
            ("KeyZ", 0x2C, false), ("KeyX", 0x2D, false), ("KeyC", 0x2E, false), ("KeyV", 0x2F, false), ("KeyB", 0x30, false),
            ("KeyN", 0x31, false), ("KeyM", 0x32, false),
            ("Comma", 0x33, false), ("Period", 0x34, false), ("Slash", 0x35, false), ("ShiftRight", 0x36, false), ("NumpadMultiply", 0x37, false),
            ("AltLeft", 0x38, false), ("Space", 0x39, false), ("CapsLock", 0x3A, false),
            ("F1", 0x3B, false), ("F2", 0x3C, false), ("F3", 0x3D, false), ("F4", 0x3E, false), ("F5", 0x3F, false),
            ("F6", 0x40, false), ("F7", 0x41, false), ("F8", 0x42, false), ("F9", 0x43, false), ("F10", 0x44, false),
            // The low-level hook gets Pause as 0x45 without the extended bit, and NumLock as 0x45 with it.
            ("Pause", 0x45, false), ("NumLock", 0x45, true), ("ScrollLock", 0x46, false),
            ("Numpad7", 0x47, false), ("Numpad8", 0x48, false), ("Numpad9", 0x49, false), ("NumpadSubtract", 0x4A, false),
            ("Numpad4", 0x4B, false), ("Numpad5", 0x4C, false), ("Numpad6", 0x4D, false), ("NumpadAdd", 0x4E, false),
            ("Numpad1", 0x4F, false), ("Numpad2", 0x50, false), ("Numpad3", 0x51, false), ("Numpad0", 0x52, false), ("NumpadDecimal", 0x53, false),
            // The two extra keys of ISO and ABNT2: "\" beside Z, and ABNT2's "/" beside the right Shift.
            ("IntlBackslash", 0x56, false), ("F11", 0x57, false), ("F12", 0x58, false), ("IntlRo", 0x73, false),
            ("NumpadEnter", 0x1C, true), ("ControlRight", 0x1D, true), ("NumpadDivide", 0x35, true), ("PrintScreen", 0x37, true),
            ("AltRight", 0x38, true), ("Home", 0x47, true), ("ArrowUp", 0x48, true), ("PageUp", 0x49, true), ("ArrowLeft", 0x4B, true),
            ("ArrowRight", 0x4D, true), ("End", 0x4F, true), ("ArrowDown", 0x50, true), ("PageDown", 0x51, true),
            ("Insert", 0x52, true), ("Delete", 0x53, true), ("MetaLeft", 0x5B, true), ("MetaRight", 0x5C, true), ("ContextMenu", 0x5D, true),
        };

        private static readonly Dictionary<string, (ushort Scan, bool Ext)> ByCode = BuildByCode();
        private static readonly string?[] ByIndex = BuildByIndex();
        private static readonly HashSet<string> Mouse = new(MouseCodes, StringComparer.Ordinal);

        private static Dictionary<string, (ushort Scan, bool Ext)> BuildByCode()
        {
            var map = new Dictionary<string, (ushort, bool)>(StringComparer.Ordinal);
            foreach (var (code, scan, ext) in Table) map[code] = (scan, ext);
            return map;
        }

        private static string?[] BuildByIndex()
        {
            var index = new string?[TableSize];
            foreach (var (code, scan, ext) in Table) index[IndexOf(scan, ext)] = code;
            return index;
        }

        /// <summary>A keyboard key the Teclado knows (not a mouse button).</summary>
        public static bool IsKey(string code) => ByCode.ContainsKey(code);

        /// <summary>A position that takes a function: a key of the table or one of the mouse buttons.</summary>
        public static bool IsKnown(string code) => IsKey(code) || Mouse.Contains(code);

        /// <summary>A key's scan code and extended bit, or false for a name the table does not have.</summary>
        public static bool TryGetScan(string code, out ushort scan, out bool extended)
        {
            if (ByCode.TryGetValue(code, out var v)) { scan = v.Scan; extended = v.Ext; return true; }
            scan = 0;
            extended = false;
            return false;
        }

        /// <summary>The name of the position the hook received, or null (the AltGr phantom included).</summary>
        public static string? CodeAt(uint scan, bool extended) => TryIndexOf(scan, extended, out var i) ? ByIndex[i] : null;
    }
}
