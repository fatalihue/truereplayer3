using System;
using System.Security.Principal;
using TrueReplayer.Interop;

namespace TrueReplayer.Services
{
    /// <summary>
    /// One question, asked by the Clicker: is the window under the cursor elevated while this
    /// process is not? SendInput cannot tell — against a higher-integrity foreground window it
    /// returns 1 and the event silently never enters the input stream (measured 2026-08-08), so
    /// the run reports a healthy rate while nothing lands. This is the explicit integrity
    /// comparison that measurement note said was needed.
    /// </summary>
    internal static class ProcessIntegrity
    {
        private static readonly Lazy<bool> SelfElevatedLazy = new(() =>
        {
            try
            {
                using var identity = WindowsIdentity.GetCurrent();
                return new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch
            {
                return false;
            }
        });

        /// <summary>True when this process runs elevated — UIPI never blocks a high-integrity sender, so no probe is needed.</summary>
        public static bool SelfElevated => SelfElevatedLazy.Value;

        /// <summary>
        /// The root window at a screen point, or IntPtr.Zero. Cheap (two user32 calls); the token
        /// query below is not, so callers compare roots and only re-query when the root changes.
        /// </summary>
        public static IntPtr RootWindowAt(int x, int y)
        {
            var hwnd = NativeMethods.WindowFromPoint(new NativeMethods.POINT { x = x, y = y });
            if (hwnd == IntPtr.Zero) return IntPtr.Zero;
            var root = NativeMethods.GetAncestor(hwnd, NativeMethods.GA_ROOT);
            return root == IntPtr.Zero ? hwnd : root;
        }

        /// <summary>
        /// Whether the process owning <paramref name="hwnd"/> runs elevated. Null = could not tell
        /// (the process or its token refused to open); callers must read that as "no warning",
        /// never as "yes" — a false alarm here would send people to "Run as admin" for nothing,
        /// which is exactly the hint the old SendInput counter used to give wrongly.
        /// </summary>
        public static bool? IsWindowElevated(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return null;
            NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0) return null;
            if (pid == (uint)Environment.ProcessId) return false;

            IntPtr process = NativeMethods.OpenProcess(NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return null;
            IntPtr token = IntPtr.Zero;
            try
            {
                if (!NativeMethods.OpenProcessToken(process, NativeMethods.TOKEN_QUERY, out token)) return null;
                if (!NativeMethods.GetTokenInformation(token, NativeMethods.TokenElevation, out uint elevated, sizeof(uint), out _)) return null;
                return elevated != 0;
            }
            finally
            {
                if (token != IntPtr.Zero) NativeMethods.CloseHandle(token);
                NativeMethods.CloseHandle(process);
            }
        }
    }
}
