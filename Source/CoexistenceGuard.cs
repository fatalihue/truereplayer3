using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using WinForms = System.Windows.Forms;

namespace TrueReplayer.Services
{
    /// <summary>
    /// One of TrueReplayer 2 and TrueReplayer 3 open at a time (plan
    /// .claude/planos/truereplayer3-paralelo-2026-10-30.md, decision 5). Global hotkeys, the input
    /// hooks, remaps, automations and the browser extension's pipe cannot be shared by two apps, and
    /// TrueReplayer 2.50 cannot be closed from outside without losing what it has not saved: its X
    /// hides it in the tray and its Exit is an item of a menu. So this side does all the work, and
    /// TrueReplayer 2 needs no change:
    ///  • This app holds TrueReplayer 2's single-instance mutex name for as long as it runs. 2.50,
    ///    launched meanwhile, finds it taken, posts its tray double-click (WM_USER+1) to the window of
    ///    the running process called TrueReplayer — this one, whose exe keeps that name — and exits.
    ///    <see cref="OnKnock"/> answers that.
    ///  • Launched while TrueReplayer 2 runs, this app waits in <see cref="Acquire"/>, before any hook
    ///    or hotkey exists, on a dialog that opens TrueReplayer 2's own tray menu (its Exit asks about
    ///    anything unsaved) and carries on by itself once TrueReplayer 2 is gone.
    /// </summary>
    internal static class CoexistenceGuard
    {
        /// <summary>
        /// TrueReplayer 2's tray callback, which 2.50 also posts to a running instance to bring it
        /// back — kept in lockstep with its TrayIconService (uCallbackMessage = WM_USER + 1).
        /// </summary>
        public const int Tr2TrayMessage = 0x0400 + 1;

        /// <summary>
        /// This app's own tray callback, and the message a second launch of it posts to bring the
        /// first back. Off WM_USER+1, so a WM_USER+1 reaching this window can only be TrueReplayer 2.
        /// </summary>
        public const int TrayMessage = 0x0400 + 2;

        public const int WM_LBUTTONDBLCLK = 0x0203;
        public const int WM_RBUTTONUP = 0x0205;

        // Set by the test scripts, which run builds next to the owner's TrueReplayer 2 and must not
        // stop on a dialog. Honoured only outside the install folder.
        private const string TestBypassVariable = "TRUEREPLAYER3_TEST_NOGUARD";

        // A knock in the first minute of a session started by Windows is the other app's Run entry
        // racing this one at login: logged, not asked about.
        private static readonly TimeSpan LoginGrace = TimeSpan.FromSeconds(60);

        private static Mutex? _tr2Name;

        /// <summary>Called on the UI thread when TrueReplayer 2 was launched while this app runs.</summary>
        public static Action? Tr2Knocked { get; set; }

        public static bool Bypassed =>
            Environment.GetEnvironmentVariable(TestBypassVariable) == "1" && !TrayIconService.IsInstalledLocation();

        /// <summary>Whether Velopack's TrueReplayer 2 is installed, so a switch can open it.</summary>
        public static bool Tr2Installed => File.Exists(AppIdentity.Tr2.InstalledExe);

        /// <summary>
        /// Takes TrueReplayer 2's mutex name for the life of this process. When TrueReplayer 2 is open,
        /// waits on the dialog — or, at login (<paramref name="startup"/>), leaves without one: the
        /// app that got there first keeps running. False means this process must exit.
        /// </summary>
        public static bool Acquire(bool startup)
        {
            if (Bypassed)
            {
                DiagnosticLog.Info("[Coexist] guard skipped for a test run");
                return true;
            }
            if (TryTakeTr2Name()) return true;
            if (startup)
            {
                LogAndLeave($"[Coexist] {AppIdentity.Tr2.DisplayName} is already open at login; this instance leaves");
                return false;
            }
            if (WaitWithDialog()) return true;
            LogAndLeave($"[Coexist] cancelled while {AppIdentity.Tr2.DisplayName} is open");
            return false;
        }

        // A process that leaves here never reaches App, which is where the log starts: without this
        // its one line stayed in the pre-start queue and went with it.
        private static void LogAndLeave(string message)
        {
            DiagnosticLog.Initialize(typeof(App).Assembly.GetName().Version?.ToString() ?? "unknown");
            DiagnosticLog.Info(message);
            DiagnosticLog.Flush();
        }

        /// <summary>Whether TrueReplayer 2 holds its mutex now, without taking it.</summary>
        public static bool Tr2Running()
        {
            try
            {
                if (!Mutex.TryOpenExisting(AppIdentity.Tr2.InstanceMutexName, out var m)) return false;
                m.Dispose();
                return true;
            }
            catch (UnauthorizedAccessException) { return true; } // created elevated: it exists
        }

        private static bool TryTakeTr2Name()
        {
            try
            {
                var m = new Mutex(true, AppIdentity.Tr2.InstanceMutexName, out bool created);
                if (created) { _tr2Name = m; return true; }
                m.Dispose();
            }
            catch (UnauthorizedAccessException)
            {
                // It exists and this token may not open it: TrueReplayer 2 created it elevated.
            }
            return false;
        }

        private static bool WaitWithDialog()
        {
            DiagnosticLog.Info($"[Coexist] {AppIdentity.Tr2.DisplayName} is open; waiting for it to close");
            WinForms.Application.EnableVisualStyles(); // TaskDialog is comctl32 v6
            bool gone = false;
            var closeTr2 = new WinForms.TaskDialogButton($"Close {AppIdentity.Tr2.DisplayName}…") { AllowCloseDialog = false };
            var showTr2 = new WinForms.TaskDialogButton($"Show {AppIdentity.Tr2.DisplayName}") { AllowCloseDialog = false };
            var page = new WinForms.TaskDialogPage
            {
                Caption = AppIdentity.DisplayName,
                Heading = $"{AppIdentity.Tr2.DisplayName} is open",
                Text = "Only one can run at a time: shortcuts, remapped keys, automations and the browser extension would clash.\n\n"
                     + $"Close {AppIdentity.Tr2.DisplayName} from its tray menu (Exit asks about anything unsaved), "
                     + $"and {AppIdentity.DisplayName} opens by itself.",
                Icon = WinForms.TaskDialogIcon.Information,
                AllowCancel = true,
            };
            page.Buttons.Add(closeTr2);
            page.Buttons.Add(showTr2);
            page.Buttons.Add(WinForms.TaskDialogButton.Cancel);
            // Its own menu, under the cursor, which is on this button: the user picks Exit there.
            closeTr2.Click += (_, _) => PostToTr2(WM_RBUTTONUP);
            showTr2.Click += (_, _) => PostToTr2(WM_LBUTTONDBLCLK);
            using var poll = new WinForms.Timer { Interval = 250 };
            poll.Tick += (_, _) =>
            {
                if (!TryTakeTr2Name()) return;
                gone = true;
                poll.Stop();
                page.BoundDialog?.Close();
            };
            page.Created += (_, _) => poll.Start();
            WinForms.TaskDialog.ShowDialog(page, WinForms.TaskDialogStartupLocation.CenterScreen);
            poll.Stop();
            if (gone) DiagnosticLog.Info($"[Coexist] {AppIdentity.Tr2.DisplayName} closed; starting");
            return gone;
        }

        /// <summary>Posts a tray mouse message to TrueReplayer 2's window, letting it take the foreground.</summary>
        private static void PostToTr2(int mouseMessage)
        {
            foreach (var proc in Process.GetProcessesByName(AppIdentity.ProcessName))
            {
                using (proc)
                {
                    if (IsThisApp(proc.Id)) continue;
                    IntPtr hwnd = FindMainWindow(proc.Id);
                    if (hwnd == IntPtr.Zero) continue;
                    AllowSetForegroundWindow((uint)proc.Id);
                    PostMessage(hwnd, Tr2TrayMessage, IntPtr.Zero, (IntPtr)mouseMessage);
                }
            }
        }

        /// <summary>
        /// Called from the window procedure when a WM_USER+1 double-click arrives: TrueReplayer 2 was
        /// launched and knocked. Quiet in the first minute of a session Windows started.
        /// </summary>
        public static void OnKnock()
        {
            using var self = Process.GetCurrentProcess();
            var uptime = DateTime.Now - self.StartTime;
            if (App.HasStartupFlag() && uptime < LoginGrace)
            {
                DiagnosticLog.Info($"[Coexist] {AppIdentity.Tr2.DisplayName} tried to open at login; it left, this one stays");
                return;
            }
            DiagnosticLog.Info($"[Coexist] {AppIdentity.Tr2.DisplayName} tried to open; asking whether to switch");
            Tr2Knocked?.Invoke();
        }

        /// <summary>
        /// Whether the process is this app (TrueReplayer 3), by its exe's product name — the exe's
        /// file name is the same for both apps. Works across elevation: the limited query right is
        /// all it needs.
        /// </summary>
        public static bool IsThisApp(int pid)
        {
            if (pid == Environment.ProcessId) return true;
            string? path = ImagePath(pid);
            if (path == null) return false;
            try { return FileVersionInfo.GetVersionInfo(path).ProductName == AppIdentity.DisplayName; }
            catch { return false; }
        }

        private static string? ImagePath(int pid)
        {
            IntPtr h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, (uint)pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var sb = new StringBuilder(1024);
                int len = sb.Capacity;
                return QueryFullProcessImageName(h, 0, sb, ref len) ? sb.ToString(0, len) : null;
            }
            finally { CloseHandle(h); }
        }

        /// <summary>
        /// The first unowned top-level WinUI window of <paramref name="pid"/>, visible or not. The
        /// process also owns invisible helper windows (GDI+, the WinForms pump), and restoring one of
        /// those does nothing — matching the WinUI class is what finds the real one.
        /// </summary>
        public static IntPtr FindMainWindow(int pid)
        {
            const uint GW_OWNER = 4;
            IntPtr found = IntPtr.Zero;
            var cls = new StringBuilder(256);
            // Held in a local so the GC cannot collect the delegate while EnumWindows is calling it.
            EnumWindowsProc callback = (hwnd, _) =>
            {
                GetWindowThreadProcessId(hwnd, out uint owner);
                if (owner != (uint)pid) return true;
                if (GetWindow(hwnd, GW_OWNER) != IntPtr.Zero) return true;
                cls.Clear();
                if (GetClassName(hwnd, cls, cls.Capacity) == 0) return true;
                if (cls.ToString() != "WinUIDesktopWin32WindowClass") return true;
                found = hwnd;
                return false;
            };
            EnumWindows(callback, IntPtr.Zero);
            return found;
        }

        private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("user32.dll")]
        private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

        [DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        private static extern bool AllowSetForegroundWindow(uint dwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool QueryFullProcessImageName(IntPtr hProcess, int dwFlags, StringBuilder lpExeName, ref int lpdwSize);

        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr hObject);
    }
}
