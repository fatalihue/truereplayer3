using System;
using System.Text;
using System.Text.RegularExpressions;
using TrueReplayer.Interop;
using TrueReplayer.Models;

namespace TrueReplayer.Helpers
{
    /// <summary>
    /// Centralised matching for <see cref="WindowTarget"/>. The hotkey gate
    /// (<c>IsForegroundWindowMatch</c>), the replay-time hwnd lookup
    /// (<c>FindTargetWindow</c>) and the bridge utilities (Convert Coordinates,
    /// Update Window Size) all need the same logic: a target matches a window when
    /// <em>both</em> ProcessName <em>and</em> WindowTitle (contains or regex) match.
    /// Keeping three copies has drifted — the replay-side variants ignored title,
    /// so title-only targets silently no-op'd and process+title matched the first
    /// visible window of the process (wrong tab in Chrome, etc.).
    /// </summary>
    public static class WindowMatcher
    {
        /// <summary>
        /// True when <paramref name="target"/> actually names something to search for. A non-null
        /// WindowTarget with both fields blank is NOT usable: <see cref="Matches"/> refuses it and
        /// <see cref="FindWindow"/> returns Zero, so it can never resolve to a window.
        ///
        /// This is the same predicate every inheritance decision in ProfileController uses to
        /// answer "does this profile own a target?". Call sites that only null-checked answered
        /// YES for a blank target, took the "use its own context" branch, and swapped the replay
        /// onto an unfindable window instead of inheriting the folder's — so keep the test here,
        /// in one place, rather than re-spelling it.
        /// </summary>
        public static bool IsUsable(WindowTarget? target) =>
            target != null
            && (!string.IsNullOrEmpty(target.ProcessName) || !string.IsNullOrEmpty(target.WindowTitle));

        /// <summary>
        /// The one rule for "was a window rect ever captured?", shared by every resolver that hands
        /// a rect to the replay engine (ProfileController.GetEffectiveGeometry and
        /// .GetFolderInheritedContext, ActionExecution's RunProfile context swap). Returns null when
        /// all four fields are still at their defaults — every capture stamps a size, so "0,0 and
        /// no size" reads as the untouched state, not a window someone parked at the top-left.
        ///
        /// Anything else is a real capture — including the size-less rect that "Convert coords →
        /// Absolute" leaves behind, where X/Y alone still says where the coordinates were measured
        /// from. On null the caller must suppress Restore Position AND Restore Size: position is
        /// deliberately not gated on having a size, so a rect of zeroes would be executed as a real
        /// move and slam the target window into the screen corner.
        ///
        /// KNOWN BLIND SPOT, accepted: those two paragraphs collide for one window. A borderless
        /// fullscreen game really does sit at 0,0, so capturing it and then running "Convert coords
        /// → Absolute" — which clears W/H and keeps X/Y on purpose — leaves (0,0,0,0), which this
        /// rule reads as untouched, and its position-only restore is dropped. Telling a captured
        /// origin from an untouched one needs a persisted "geometry captured" flag: a schema change
        /// and a version pin, deliberately out of scope here. A framed window in the corner reports
        /// -4,0 and is unaffected, and no profile on disk is in that state; the failure is a silent
        /// no-op, never a move to the wrong place.
        /// </summary>
        public static (int X, int Y, int Width, int Height)? CapturedRect(int x, int y, int width, int height)
            => x == 0 && y == 0 && width <= 0 && height <= 0 ? null : (x, y, width, height);

        /// <summary>
        /// Compile a regex for <see cref="WindowTarget.WindowTitle"/> when match mode is "regex".
        /// Returns null for contains-mode or invalid patterns. Callers should cache the result
        /// when the target is reused across many calls (replay loop, hook snapshot).
        /// </summary>
        public static Regex? CompileTitleRegex(WindowTarget? target)
        {
            if (target == null) return null;
            if (!IsRegexMode(target)) return null;
            if (string.IsNullOrEmpty(target.WindowTitle)) return null;
            try
            {
                return new Regex(target.WindowTitle,
                    RegexOptions.IgnoreCase | RegexOptions.Compiled,
                    TimeSpan.FromMilliseconds(5));
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// The one reading of <see cref="WindowTarget.TitleMatchMode"/>. The field is free text in
        /// the profile JSON, and its readers disagreed on case: TriggerService and BuildWindowTarget
        /// compared ignoring it, this file and the hook did not — so "Regex" compiled no pattern here
        /// and fell to a substring search for the pattern's literal text, which matches nothing.
        /// </summary>
        public static bool IsRegexMode(WindowTarget target) =>
            string.Equals(target.TitleMatchMode, "regex", StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// Does the image file name of a process (always with its extension, "chrome.exe") answer
        /// to the name the user gave? Exactly, or as that name plus ".exe" — "chrome" and "my.app"
        /// are how people type a process, and it is how the sidebar, the Info tab and the icon
        /// lookup already present it ("chrome.exe"). The profile's own Window Target was the one
        /// consumer that compared the raw text: "chrome" read as matched on screen, and the hotkey
        /// gate and the replay's window search never found it. BuildWindowTarget appended ".exe"
        /// only to names without ANY dot, so "my.app" never reached "my.app.exe" there either.
        /// Allocation-free: it runs for every window an enumeration visits.
        /// </summary>
        public static bool ProcessNameMatches(string imageFileName, string wanted)
        {
            if (imageFileName.Equals(wanted, StringComparison.OrdinalIgnoreCase)) return true;
            return !wanted.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                && imageFileName.Length == wanted.Length + 4
                && imageFileName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                && imageFileName.StartsWith(wanted, StringComparison.OrdinalIgnoreCase);
        }

        /// <summary>
        /// Test whether <paramref name="hwnd"/> satisfies <paramref name="target"/>. Empty
        /// fields are wildcards (target with only ProcessName matches any window of that
        /// process; target with only WindowTitle matches any window with that title).
        /// Null target returns false — caller treats "no target" as "no match".
        /// </summary>
        /// <param name="titleBuffer">Optional reusable buffer to avoid allocations on hot paths.</param>
        /// <param name="procBuffer">Optional reusable buffer to avoid allocations on hot paths.</param>
        public static bool Matches(
            IntPtr hwnd,
            WindowTarget? target,
            Regex? compiledTitleRegex,
            StringBuilder? titleBuffer = null,
            StringBuilder? procBuffer = null)
        {
            if (hwnd == IntPtr.Zero) return false;
            if (target == null) return false;
            // A target with neither criterion set would otherwise fall through both checks and
            // match EVERY window. Treat "no criteria" the same as "no target" — match nothing.
            if (string.IsNullOrEmpty(target.ProcessName) && string.IsNullOrEmpty(target.WindowTitle))
                return false;

            // Title check
            if (!string.IsNullOrEmpty(target.WindowTitle))
            {
                var buf = titleBuffer ?? new StringBuilder(512);
                buf.Clear();
                // InternalGetWindowText, not GetWindowText: the input hooks call this from their
                // own thread, and GetWindowText on one of THIS process's windows (the user pressing
                // a hotkey with TrueReplayer in front) sends WM_GETTEXT to the UI thread and waits.
                NativeMethods.InternalGetWindowText(hwnd, buf, buf.Capacity);
                string title = buf.ToString();

                if (IsRegexMode(target))
                {
                    if (compiledTitleRegex == null) return false;
                    try
                    {
                        if (!compiledTitleRegex.IsMatch(title)) return false;
                    }
                    catch (RegexMatchTimeoutException)
                    {
                        return false;
                    }
                }
                else
                {
                    if (title.IndexOf(target.WindowTitle, StringComparison.OrdinalIgnoreCase) < 0)
                        return false;
                }
            }

            // Process check
            if (!string.IsNullOrEmpty(target.ProcessName))
            {
                NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
                IntPtr hProcess = NativeMethods.OpenProcess(
                    NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
                if (hProcess == IntPtr.Zero)
                {
                    // Log the Win32 error so a failure here is diagnosable from the session log
                    // instead of being indistinguishable from "window not in foreground".
                    //
                    // This used to blame elevation, and that was measured wrong: with
                    // PROCESS_QUERY_LIMITED_INFORMATION (0x1000) an ELEVATED window of the same
                    // user opens fine — a sweep of 246 top-level windows, 24 of them visible,
                    // produced zero failures. (0x0400 and 0x0010 are the rights that get denied.)
                    // The processes that do refuse are SYSTEM and service processes, which own no
                    // window this matcher would ever be asked about.
                    //
                    // The symptom that comment was reaching for is real but has a different cause:
                    // UIPI blocks SendInput INTO an elevated window, which is what the RunAsAdmin
                    // toggle exists for. Matching is not where that fails.
                    int err = System.Runtime.InteropServices.Marshal.GetLastWin32Error();
                    TrueReplayer.Services.DiagnosticLog.Warn(
                        $"WindowMatcher: OpenProcess failed for '{target.ProcessName}' (pid {pid}), Win32 error {err}");
                    return false;
                }

                try
                {
                    var buf = procBuffer ?? new StringBuilder(512);
                    buf.Clear();
                    uint len = NativeMethods.GetProcessImageFileName(hProcess, buf, (uint)buf.Capacity);
                    if (len == 0) return false;

                    string fullPath = buf.ToString();
                    string fileName = System.IO.Path.GetFileName(fullPath);

                    if (!ProcessNameMatches(fileName, target.ProcessName))
                        return false;
                }
                finally
                {
                    NativeMethods.CloseHandle(hProcess);
                }
            }

            return true;
        }

        /// <summary>
        /// Enumerate top-level visible windows and return the first one matching the target.
        /// Returns <c>IntPtr.Zero</c> when no window matches or the target is empty.
        /// Pass <paramref name="compiledTitleRegex"/> when the caller already cached it
        /// (replay loops do).
        /// </summary>
        public static IntPtr FindWindow(WindowTarget? target, Regex? compiledTitleRegex = null)
        {
            if (target == null) return IntPtr.Zero;
            if (string.IsNullOrEmpty(target.ProcessName) && string.IsNullOrEmpty(target.WindowTitle))
                return IntPtr.Zero;

            var titleBuffer = new StringBuilder(512);
            var procBuffer = new StringBuilder(512);
            // Compile lazily if the caller didn't pre-compile.
            Regex? regex = compiledTitleRegex ?? CompileTitleRegex(target);

            IntPtr result = IntPtr.Zero;
            NativeMethods.EnumWindows((hwnd, lParam) =>
            {
                if (!NativeMethods.IsWindowVisible(hwnd)) return true;
                if (Matches(hwnd, target, regex, titleBuffer, procBuffer))
                {
                    result = hwnd;
                    return false; // stop enumeration
                }
                return true;
            }, IntPtr.Zero);
            return result;
        }

        /// <summary>
        /// Like <see cref="FindWindow"/>, but STABLE when more than one window matches, and it says
        /// how many did.
        ///
        /// FindWindow stops at the first match, and EnumWindows walks top-of-Z-order down, so with
        /// two windows of the same process the answer changes every time the user clicks between
        /// them. For "is it open?" that is harmless — any match answers it, and the answer does not
        /// move. For "WHERE is it?" it is not: an anchored automation watcher re-resolves its origin
        /// on every tick, for hours, so alt-tabbing between two Chrome windows moved the sampled
        /// point by the distance between them, the condition quietly went false, and it came back on
        /// its own when focus returned. Nothing was logged and the panel stayed green.
        ///
        /// The tie-break is the LOWEST handle, not the foreground one. Foreground would be stable in
        /// name only — it is the very thing that was moving. A handle is fixed for the window's
        /// lifetime, so this pins the anchor to one window and keeps it there; which of the two it
        /// picks is arbitrary, but arbitrary-and-still beats correct-then-wrong-then-correct.
        ///
        /// Costs a FULL enumeration instead of an early exit, which is why it is a separate method:
        /// the hot callers (replay's per-event resolve, the WindowOpen condition) keep the cheap one.
        /// </summary>
        public static IntPtr FindWindowStable(WindowTarget? target, Regex? compiledTitleRegex, out int matchCount)
        {
            matchCount = 0;
            if (target == null) return IntPtr.Zero;
            if (string.IsNullOrEmpty(target.ProcessName) && string.IsNullOrEmpty(target.WindowTitle))
                return IntPtr.Zero;

            var titleBuffer = new StringBuilder(512);
            var procBuffer = new StringBuilder(512);
            Regex? regex = compiledTitleRegex ?? CompileTitleRegex(target);

            IntPtr best = IntPtr.Zero;
            int count = 0;
            NativeMethods.EnumWindows((hwnd, lParam) =>
            {
                if (!NativeMethods.IsWindowVisible(hwnd)) return true;
                // IsWindowVisible is TRUE for a MINIMISED window — WS_VISIBLE stays set while it
                // sits parked at (-32000,-32000). Without this test the lowest-handle rule could
                // pin the anchor on the minimised one and the caller's parked-rect guard then
                // failed at EVERY tick, killing the watcher in silence while a perfectly good
                // window of the same process sat right next to it. A minimised window has no
                // usable origin, so it is not a candidate at all — that keeps the count honest
                // too, since an ambiguity the user cannot act on is not worth warning about.
                if (NativeMethods.IsIconic(hwnd)) return true;
                if (!Matches(hwnd, target, regex, titleBuffer, procBuffer)) return true;
                count++;
                if (best == IntPtr.Zero || (long)hwnd < (long)best) best = hwnd;
                return true;
            }, IntPtr.Zero);
            matchCount = count;
            return best;
        }
    }
}
