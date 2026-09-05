using System;
using TrueReplayer.Interop;

namespace TrueReplayer
{
    /// <summary>What a remapped key turns into.</summary>
    public enum RemapTargetKind : byte
    {
        /// <summary>Swallow the key and inject nothing ("disable the key"). Also the encoding a
        /// pairing takes when a hotkey consumed the logical key: nothing to release.</summary>
        Disable = 0,
        /// <summary>A keyboard key — the classic CapsLock → Esc. Down and up are injected.</summary>
        Key = 1,
        /// <summary>A mouse button. Down and up are injected through SendInput's MOUSE path; a
        /// keyboard injection of VK_XBUTTON1 is a no-op, which is why these used to be refused as
        /// targets altogether.</summary>
        Mouse = 2,
        /// <summary>One wheel notch per press (and per auto-repeat, so holding the key keeps
        /// scrolling). Nothing to release.</summary>
        Wheel = 3,
    }

    /// <summary>
    /// The compiled TO side of one remap rule. A value type so the hook's pairing table can hold it
    /// by value and compare two pairings' targets for "another FROM still holds this TO" — the
    /// refcount that keeps a shared target from being released while a second finger is on it.
    /// </summary>
    public readonly struct RemapTarget : IEquatable<RemapTarget>
    {
        public readonly RemapTargetKind Kind;
        /// <summary>Kind == Key: the virtual key to inject.</summary>
        public readonly ushort Vk;
        /// <summary>Kind == Mouse: the MOUSEEVENTF_*DOWN flag; Kind == Wheel: MOUSEEVENTF_WHEEL.</summary>
        public readonly uint MouseDownFlags;
        /// <summary>Kind == Mouse: the MOUSEEVENTF_*UP flag.</summary>
        public readonly uint MouseUpFlags;
        /// <summary>Kind == Mouse: XBUTTON1/2 for the X flags, 0 otherwise; Kind == Wheel: the
        /// signed notch delta stored as the uint SendInput wants.</summary>
        public readonly uint MouseData;

        private RemapTarget(RemapTargetKind kind, ushort vk, uint down, uint up, uint data)
        {
            Kind = kind; Vk = vk; MouseDownFlags = down; MouseUpFlags = up; MouseData = data;
        }

        public static readonly RemapTarget Disable = default;
        public static RemapTarget ForKey(ushort vk) => new(RemapTargetKind.Key, vk, 0, 0, 0);
        public static RemapTarget ForMouse(uint downFlags, uint upFlags, uint mouseData = 0)
            => new(RemapTargetKind.Mouse, 0, downFlags, upFlags, mouseData);
        public static RemapTarget ForWheel(int notchDelta)
            => new(RemapTargetKind.Wheel, 0, NativeMethods.MOUSEEVENTF_WHEEL, 0, unchecked((uint)notchDelta));

        public bool Equals(RemapTarget other)
            => Kind == other.Kind && Vk == other.Vk && MouseDownFlags == other.MouseDownFlags && MouseData == other.MouseData;
        public override bool Equals(object? obj) => obj is RemapTarget t && Equals(t);
        public override int GetHashCode() => HashCode.Combine((int)Kind, Vk, MouseDownFlags, MouseData);
        public static bool operator ==(RemapTarget a, RemapTarget b) => a.Equals(b);
        public static bool operator !=(RemapTarget a, RemapTarget b) => !a.Equals(b);
    }

    /// <summary>
    /// One compiled remap rule for a FROM key: the target, and the app it is limited to. Several
    /// rules can share a FROM — "F in the game" and "F everywhere else" — so the hook's snapshot is
    /// fromVk → RemapRule[] and the pick happens at DOWN time (see InputHookManager.TryPickRemap).
    /// </summary>
    public sealed class RemapRule
    {
        /// <summary>Process name the rule is limited to — lower-case, without ".exe" — or null for
        /// "any app". Normalised once at compile time (RemapService.NormalizeProcess), so the hook's
        /// per-keystroke comparison is one ordinal string compare.</summary>
        public string? Process { get; }
        public RemapTarget Target { get; }

        public RemapRule(string? process, RemapTarget target)
        {
            Process = process;
            Target = target;
        }
    }
}
