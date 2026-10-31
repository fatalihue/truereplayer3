using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.Win32;
using TrueReplayer;
using TrueReplayer.Interop;
using TrueReplayer.Models;

namespace TrueReplayer.Services
{
    /// <summary>
    /// What every way out of the process owes the machine it leaves behind. There are four exits —
    /// the window's close (WindowEventManager.ForceExit), the tray's Exit, the UI-recovery relaunch
    /// (MainWindow.TryRestartProcess) and the update restart (UpdateService.ApplyAndRestart) — and
    /// each carried its own subset of this list, so each forgot something another one did:
    ///   - none stopped a replay in flight, so a KeyDown/LeftClickDown whose up had not run yet
    ///     stayed down system-wide with no process left to release it (only a logoff clears it);
    ///   - the tray's Exit flushed nothing and unhooked nothing, and ended on Application.Exit
    ///     alone, which the other three never trust to actually end the process;
    ///   - the relaunch and the update left their tray icon behind as a ghost next to the new
    ///     process's icon until the mouse passed over it.
    /// The callers keep their own ORDER around these two calls (the relaunch must start its
    /// replacement before letting go of its hooks, the update must release before queueing the
    /// apply); what they no longer keep is their own list.
    /// </summary>
    public static class AppExit
    {
        /// <summary>The debounced sidecars — before anything else tears down.</summary>
        public static void FlushState()
        {
            Guard("run-cursor flush", RunCursorService.Flush);
            Guard("interface flush", InterfaceStore.Flush);
            Guard("automation stats flush", () => TriggerService.Instance?.Flush());
            // A settings write that failed earlier lives only in memory until a later save lands;
            // this is its last chance before the process takes it away.
            Guard("settings retry", AppSettingsManager.RetryUnwritten);
        }

        /// <summary>
        /// Everything the process holds on the SYSTEM: the keys and buttons a running replay has
        /// pressed, the automation watchers, the input hooks (and the remapped keys they hold
        /// down), the window subclass and the tray icon. Each step is guarded on its own: a throw
        /// must neither skip the steps after it nor the caller's Environment.Exit.
        /// </summary>
        public static void ReleaseSystem()
        {
            // Synchronous: cancels the run and releases what it holds on this thread.
            Guard("replay stop", () => TrueReplayer.Controllers.MainController.Instance?.StopReplayIfRunning());
            Guard("automation stop", () => TriggerService.Instance?.StopAll());
            Guard("input hooks stop", InputHookManager.Stop);
            // The original WndProc goes back before the process starts dying: with the subclass
            // left installed, the WM_DESTROY/WM_NCDESTROY still to come would re-enter a managed
            // thunk after Environment.Exit(0) has begun tearing the CLR down.
            Guard("window subclass removal", HwndHookManager.RemoveHook);
            Guard("tray icon removal", TrayIconService.RemoveTrayIcon);
        }

        private static void Guard(string step, Action action)
        {
            try { action(); }
            catch (Exception ex) { DiagnosticLog.Error($"Exit teardown: {step} threw", ex); }
        }
    }

    public static class TrayIconService
    {
        // Shell_NotifyIcon messages
        private const uint NIM_ADD = 0x00000000;
        private const uint NIM_MODIFY = 0x00000001;
        private const uint NIM_DELETE = 0x00000002;

        // NotifyIconData flags
        private const uint NIF_MESSAGE = 0x01;
        private const uint NIF_ICON = 0x02;
        private const uint NIF_TIP = 0x04;
        private const uint NIF_STATE = 0x08;
        private const uint NIF_INFO = 0x10;

        // NotifyIcon state
        private const uint NIS_HIDDEN = 0x01;

        // Balloon icon flags
        private const uint NIIF_INFO = 0x01;

        // Window messages
        private const int WM_USER = 0x0400;
        private const int WM_LBUTTONDBLCLK = 0x0203;
        private const int WM_RBUTTONUP = 0x0205;

        // LoadImage constants
        private const uint IMAGE_ICON = 1;
        private const uint LR_LOADFROMFILE = 0x00000010;

        // The notification area draws a SMALL icon at the system DPI — the size LoadIconMetric(LIM_SMALL)
        // picks for a resource icon. With no size, LoadImage took the .ico's FIRST entry (16×16) and the
        // shell stretched it on every display above 100 %; the 24/32/48/256 entries were never read.
        private static IntPtr LoadTrayIcon(string iconPath) => LoadImage(IntPtr.Zero, iconPath, IMAGE_ICON,
            NativeMethods.GetSystemMetrics(NativeMethods.SM_CXSMICON), NativeMethods.GetSystemMetrics(NativeMethods.SM_CYSMICON), LR_LOADFROMFILE);

        // Menu constants
        private const uint MF_STRING = 0x0000;
        private const uint MF_CHECKED = 0x0008;
        private const uint MF_SEPARATOR = 0x0800;
        private const uint TPM_RETURNCMD = 0x0100;

        private const string StartupRegistryKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        private const string StartupValueName = AppIdentity.RunValueName;

        private static IntPtr hwnd;
        private static NotifyIconData notifyIcon;

        /// <summary>The main window the tray icon belongs to (the tray panel is owned by it).</summary>
        internal static IntPtr MainWindow => hwnd;
        private static bool isInitialized = false;
        private static IntPtr currentIconHandle;

        public static void Initialize(object window, IntPtr windowHandle, bool showNotification = false)
        {
            if (isInitialized) return;
            hwnd = windowHandle;
            CreateTrayIcon(showNotification);
            isInitialized = true;
        }

        public static void CreateTrayIcon(bool showNotification = false)
        {
            if (isInitialized)
                Shell_NotifyIcon(NIM_DELETE, ref notifyIcon);

            // Read settings once and pass to both resolvers — avoids two disk reads (and a tiny
            // race window where a write between them could yield mismatched icon/tooltip).
            var settings = AppSettingsManager.Load();
            string iconPath = ResolveTrayIconPath(settings);

            ReleaseCurrentIcon();
            currentIconHandle = LoadTrayIcon(iconPath);
            currentIconPath = currentIconHandle == IntPtr.Zero ? "" : iconPath;
            if (currentIconHandle == IntPtr.Zero)
                DiagnosticLog.Warn($"Tray icon LoadImage failed (Win32 error {Marshal.GetLastWin32Error()}) for '{iconPath}' — tray icon will appear blank");

            notifyIcon = new NotifyIconData
            {
                cbSize = (uint)Marshal.SizeOf(typeof(NotifyIconData)),
                hWnd = hwnd,
                uID = 1,
                uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
                // Not WM_USER + 1: that one is TrueReplayer 2's, and its knock (CoexistenceGuard).
                uCallbackMessage = CoexistenceGuard.TrayMessage,
                hIcon = currentIconHandle,
                szTip = ResolveTooltip(settings)
            };

            if (!Shell_NotifyIcon(NIM_ADD, ref notifyIcon))
                DiagnosticLog.Error($"Shell_NotifyIcon(NIM_ADD) failed (Win32 error {Marshal.GetLastWin32Error()}) — tray icon was not registered");
            _loggedState = null;
            LogStateChange(settings, notifyIcon.szTip);

            // Let the tray callback through UIPI.
            //
            // Relaunching the exe while this instance sits in the tray is how a user gets the
            // window back when the icon is not reachable, and Program.cs does that by posting this
            // very message. With RunAsAdmin on, that second process is NOT elevated (the mutex gate
            // runs before self-elevation), so a medium-integrity PostMessage to this high-integrity
            // window is dropped silently by User Interface Privilege Isolation — the relaunch would
            // appear to do nothing at all, which is the state it is meant to rescue the user from.
            // Best-effort: on a non-elevated instance the call is simply a no-op that returns true.
            if (!ChangeWindowMessageFilterEx(hwnd, (uint)CoexistenceGuard.TrayMessage, MSGFLT_ALLOW, IntPtr.Zero))
                DiagnosticLog.Warn($"ChangeWindowMessageFilterEx for the tray message failed (Win32 error {Marshal.GetLastWin32Error()}) — relaunching the exe may not restore the window while elevated");
            // TrueReplayer 2's knock (CoexistenceGuard) comes the same way, and from a process that
            // has not elevated yet: 2.50 knocks before its own self-elevation.
            if (!ChangeWindowMessageFilterEx(hwnd, (uint)CoexistenceGuard.Tr2TrayMessage, MSGFLT_ALLOW, IntPtr.Zero))
                DiagnosticLog.Warn($"ChangeWindowMessageFilterEx for {AppIdentity.Tr2.DisplayName}'s knock failed (Win32 error {Marshal.GetLastWin32Error()}) — it may not reach this window while elevated");

            if (showNotification)
            {
                ShowMinimizeBalloon();
            }
        }

        // Which .ico currentIconHandle was loaded from, so a refresh that does not change the icon
        // does not re-read it. Cleared by CreateTrayIcon (which releases the handle) and by
        // ReleaseCurrentIcon.
        private static string currentIconPath = "";

        public static void UpdateTrayIcon()
        {
            var settings = AppSettingsManager.Load();
            string iconPath = ResolveTrayIconPath(settings);

            // Only three icon files exist and most callers here (run start/stop, armed-count change,
            // every settings save, profile switch — 20 sites) only change the TOOLTIP. Re-reading a
            // 150-230 KB .ico from disk to hand Shell_NotifyIcon back the same image is pure waste.
            // The IntPtr.Zero test also keeps the previous recovery behaviour: a failed load is
            // retried on the next refresh instead of being cached as "already correct".
            if (iconPath != currentIconPath || currentIconHandle == IntPtr.Zero)
            {
                ReleaseCurrentIcon();
                currentIconHandle = LoadTrayIcon(iconPath);
                currentIconPath = currentIconHandle == IntPtr.Zero ? "" : iconPath;
                notifyIcon.hIcon = currentIconHandle;
            }

            notifyIcon.szTip = ResolveTooltip(settings);
            Shell_NotifyIcon(NIM_MODIFY, ref notifyIcon);
            LogStateChange(settings, notifyIcon.szTip);
        }

        // One line when the icon's state changes (not on every tooltip refresh: a looping run moves
        // the tooltip once a second) — what the tray said, for support and for the scripts.
        private static TrayState? _loggedState;
        private static void LogStateChange(AppSettingsManager.AppSettings settings, string tooltip)
        {
            var state = ResolveState(settings);
            if (state == _loggedState) return;
            _loggedState = state;
            DiagnosticLog.Info($"[Tray] {state}: \"{tooltip}\"");
        }

        /// <summary>
        /// Where the tray icon is on the screen (physical pixels), for the tray panel to open by it.
        /// Null when the shell cannot say (no icon yet, or Explorer restarting); the panel then opens by
        /// the cursor, which has just clicked the icon.
        /// </summary>
        internal static NativeMethods.RECT? IconRect()
        {
            if (!isInitialized) return null;
            var id = new NotifyIconIdentifier { cbSize = (uint)Marshal.SizeOf<NotifyIconIdentifier>(), hWnd = hwnd, uID = 1 };
            try { return Shell_NotifyIconGetRect(ref id, out var r) == 0 ? r : null; }
            catch { return null; }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct NotifyIconIdentifier { public uint cbSize; public IntPtr hWnd; public uint uID; public Guid guidItem; }
        [DllImport("shell32.dll")] private static extern int Shell_NotifyIconGetRect(ref NotifyIconIdentifier identifier, out NativeMethods.RECT iconLocation);

        public static void ShowMinimizeBalloon() => ShowBalloon(
            $"{AppIdentity.DisplayName} is running in the background",
            // Double-click, because that is what the WndProc actually answers: a single click is
            // WM_LBUTTONUP and nothing handles it, so the old wording sent people clicking once at
            // an icon that would not respond.
            "Double-click the tray icon to restore the window.");

        /// <summary>
        /// Pop a tray balloon. The one notification surface that reaches the user while the
        /// window is minimised behind a game or browser — which is exactly when a background
        /// run has something to say.
        /// </summary>
        public static void ShowBalloon(string title, string text)
        {
            // Mutate the actual field, not a by-value copy — otherwise NIF_INFO / the balloon
            // text never persist on the static struct.
            notifyIcon.uFlags |= NIF_INFO;
            notifyIcon.szInfoTitle = title;
            notifyIcon.szInfo = text;
            notifyIcon.dwInfoFlags = NIIF_INFO;
            if (!Shell_NotifyIcon(NIM_MODIFY, ref notifyIcon))
                DiagnosticLog.Warn($"Shell_NotifyIcon(NIM_MODIFY) for balloon failed (Win32 error {Marshal.GetLastWin32Error()})");
            // Clear NIF_INFO so subsequent UpdateTrayIcon/RemoveTrayIcon NIM_MODIFY calls — which
            // reuse this field and do NOT rewrite uFlags — don't re-pop the balloon on an
            // unrelated tray refresh (mode toggle, profile-key toggle, settings change, etc.).
            notifyIcon.uFlags &= ~NIF_INFO;
        }

        /// <summary>
        /// A chime — plus a taskbar flash when there is a taskbar button to flash — for a notice
        /// raised while the user is looking at ANOTHER app: the toast it goes with lands in a window
        /// that is behind, or hidden in the tray, and the balloon alone was seen not to render on
        /// Windows 11 (no AUMID is registered). Silent when TrueReplayer is the foreground window: the toast is
        /// in view then. Not gated on RunEndFlash/RunEndSound — those govern the cue after EVERY run,
        /// which is why people switch them off, while these notices are rare and each one means
        /// something did NOT happen. MessageBeep follows the Windows sound scheme, "No Sounds"
        /// included. Best-effort; UI thread.
        /// </summary>
        public static void CueOutOfView()
        {
            try
            {
                if (hwnd == IntPtr.Zero || NativeMethods.GetForegroundWindow() == hwnd) return;
                if (NativeMethods.IsWindowVisible(hwnd))
                {
                    var fw = new NativeMethods.FLASHWINFO
                    {
                        cbSize = (uint)Marshal.SizeOf<NativeMethods.FLASHWINFO>(),
                        hwnd = hwnd,
                        // Until the window comes to the foreground — the NotifyRunEnded flash.
                        dwFlags = NativeMethods.FLASHW_TRAY | NativeMethods.FLASHW_TIMERNOFG,
                    };
                    NativeMethods.FlashWindowEx(ref fw);
                }
                NativeMethods.MessageBeep(NativeMethods.MB_ICONERROR_BEEP);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Out-of-view cue failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Explorer restarted (TaskbarCreated) and took every tray icon with it. Nothing re-added
        /// this one: every later NIM_MODIFY aimed at an icon that no longer existed, so the tooltip
        /// refreshes and — the one that matters — the "Automation stopped" balloon failed with only
        /// a log line, while the automation it was warning about stayed armed on every surface.
        /// Not after RemoveTrayIcon: that is the process leaving.
        /// </summary>
        public static void RecreateAfterShellRestart()
        {
            if (!isInitialized) return;
            CreateTrayIcon();
            DiagnosticLog.Info("Explorer recreated the taskbar — tray icon registered again");
        }

        public static void RemoveTrayIcon()
        {
            if (isInitialized)
            {
                // Hide the icon first so Windows removes it from the tray immediately
                // (without this, the ghost icon lingers until mouse hover)
                notifyIcon.uFlags |= NIF_STATE;
                notifyIcon.dwState = NIS_HIDDEN;
                notifyIcon.dwStateMask = NIS_HIDDEN;
                Shell_NotifyIcon(NIM_MODIFY, ref notifyIcon);

                Shell_NotifyIcon(NIM_DELETE, ref notifyIcon);
                ReleaseCurrentIcon();
                isInitialized = false;
            }
        }

        /// <summary>
        /// The six states the tray icon says, each with its own shape and colour (Tray board, "O ícone
        /// muda de forma e de cor"). A run outranks everything; the Clicker is a mode at sight; then
        /// what the user should look at, then the switch that holds every hotkey.
        /// </summary>
        public enum TrayState { Ready, Recording, Replaying, Clicker, ShortcutsOff, NeedsALook }

        public static TrayState ResolveState(AppSettingsManager.AppSettings settings)
        {
            // The engine reports a Clicker run as "replaying" too (one status for both loops), so
            // the mode picks the state: the Clicker's purple, not the macro's play.
            if (_runState == "recording") return TrayState.Recording;
            if (_runState == "replaying") return settings.UseCursorClick ? TrayState.Clicker : TrayState.Replaying;
            if (settings.UseCursorClick) return TrayState.Clicker;
            if (_pendingNotices > 0) return TrayState.NeedsALook;
            if (!UserProfile.Current.ProfileKeyEnabled) return TrayState.ShortcutsOff;
            return TrayState.Ready;
        }

        private static string ResolveTrayIconPath(AppSettingsManager.AppSettings settings)
        {
            string fileName = ResolveState(settings) switch
            {
                TrayState.Recording => AppIdentity.IconFileRecording,
                TrayState.Replaying => AppIdentity.IconFileReplaying,
                TrayState.Clicker => AppIdentity.IconFilePurple,
                TrayState.ShortcutsOff => AppIdentity.IconFileOff,
                TrayState.NeedsALook => AppIdentity.IconFileAlert,
                _ => AppIdentity.IconFile,
            };
            return Path.Combine(AppContext.BaseDirectory, fileName);
        }

        // Live run-state ("recording" | "replaying" | anything-else = idle), fed from
        // WebViewBridge.PushStatusChange.
        private static string _runState = "ready";

        public static void SetRunState(string status)
        {
            if (_runState == status) return;
            _runState = status;
            // A loop count and a click count belong to the run that reported them.
            _loopCurrent = _loopTotal = 0;
            _clicks = 0;
            _runStartedAt = Environment.TickCount64;
            if (isInitialized) UpdateTrayIcon();
        }

        // What the tray panel's card says about the run: its state, its loop, its clock and, for the
        // Clicker, its clicks (MainWindow feeds them from OnClickerStats).
        private static long _runStartedAt;
        private static long _clicks;
        public static string RunState => _runState;
        public static (int Current, int Total) Loop => (_loopCurrent, _loopTotal);
        public static TimeSpan RunElapsed => _runState is "replaying" or "recording"
            ? TimeSpan.FromMilliseconds(Environment.TickCount64 - _runStartedAt) : TimeSpan.Zero;
        public static long Clicks => _clicks;
        public static void SetClickerCount(long count) => _clicks = count;

        // The run's loop, for the tooltip ("loop 2 of 3"): fed from ReplayService.OnLoopProgress, which
        // only reports looping runs. Total 0 is endless. Refreshed at most once a second, and only when
        // the loop moves: every refresh re-reads the settings file.
        private static int _loopCurrent, _loopTotal;
        private static long _loopShownAt;

        public static void SetLoopProgress(int current, int total)
        {
            if (current == _loopCurrent && total == _loopTotal) return;
            bool first = _loopCurrent == 0;
            _loopCurrent = current;
            _loopTotal = total;
            long now = Environment.TickCount64;
            if (!isInitialized || _runState != "replaying" || (!first && now - _loopShownAt < 1000)) return;
            _loopShownAt = now;
            UpdateTrayIcon();
            // The first loop of a run is logged with its tooltip; the later ones would be a line a second.
            if (first) DiagnosticLog.Info($"[Tray] loop shown: \"{notifyIcon.szTip}\"");
        }

        // Notices held while nobody could see the window (WebViewBridge.ShowNoticeWhenSeen): the icon
        // says "Needs a look" and the tooltip how many, until the window shows them.
        private static int _pendingNotices;

        public static void SetPendingNotices(int count)
        {
            if (count == _pendingNotices) return;
            _pendingNotices = count;
            if (isInitialized) UpdateTrayIcon();
        }

        /// <summary>The open macro's name, or null with none (MainWindow wires it to the bridge).</summary>
        public static Func<string?>? CurrentMacro { get; set; }

        // A macro's name, cut to leave the rest of a line room: the tooltip has 127 characters and a
        // menu item reads badly past forty.
        private static string Short(string text, int max) => text.Length <= max ? text : text[..(max - 1)] + "…";

        // The tooltip of each state (Tray board): "TrueReplayer 3 — Ready · 2 automations armed",
        // "— Recording Untitled macro", "— Replaying Trade Roblox, loop 2 of 3", "— Clicker open ·
        // PgDn starts", "— Shortcuts and remaps paused", "— 2 notices while you were away". Capped at
        // 127 characters + null terminator to fit the shell's szTip buffer.
        private static string ResolveTooltip(AppSettingsManager.AppSettings settings)
        {
            const string name = AppIdentity.DisplayName;
            string? macro = CurrentMacro?.Invoke();
            string line;
            switch (ResolveState(settings))
            {
                case TrayState.Recording:
                    line = macro != null ? $"{name} — Recording {Short(macro, 60)}" : $"{name} — Recording";
                    break;
                case TrayState.Replaying:
                    line = macro != null ? $"{name} — Replaying {Short(macro, 50)}" : $"{name} — Replaying";
                    if (_loopCurrent > 0) line += $", loop {_loopCurrent} of {(_loopTotal > 0 ? _loopTotal.ToString() : "∞")}";
                    break;
                case TrayState.Clicker:
                    if (_runState == "replaying") line = $"{name} — Clicking";
                    else line = string.IsNullOrEmpty(settings.CursorClickStartHotkey)
                        ? $"{name} — Clicker open"
                        : $"{name} — Clicker open · {settings.CursorClickStartHotkey} starts";
                    break;
                case TrayState.ShortcutsOff:
                    // The Key Remaps pause with the Shortcuts (InputHookManager), when they are on at all.
                    line = RemapService.Current.Enabled ? $"{name} — Shortcuts and remaps paused" : $"{name} — Shortcuts paused";
                    break;
                case TrayState.NeedsALook:
                    line = $"{name} — {_pendingNotices} notice{(_pendingNotices == 1 ? "" : "s")} while you were away";
                    break;
                default:
                    line = $"{name} — Ready";
                    // Armed-watcher count — the tray is the daemon's only always-visible surface.
                    // Configured count (not live loops) so the "paused" hint still shows when the
                    // master switch is off.
                    int armed = TriggerService.Instance?.ConfiguredArmedCount ?? 0;
                    if (armed > 0)
                        line += settings.AutomationEnabled
                            ? $" · {armed} automation{(armed == 1 ? "" : "s")} armed"
                            : " · automations paused";
                    break;
            }
            return Short(line, 127);
        }

        private static void ReleaseCurrentIcon()
        {
            if (currentIconHandle != IntPtr.Zero)
            {
                DestroyIcon(currentIconHandle);
                currentIconHandle = IntPtr.Zero;
            }
            // Keep the "which file is loaded" note in lockstep with the handle, so the next
            // UpdateTrayIcon reloads instead of trusting a destroyed icon.
            currentIconPath = "";
        }

        /// Callback invoked when user clicks "Exit" from the tray. Should return true if exit is allowed.
        public static Func<Task<bool>>? OnTrayExitRequested { get; set; }

        public static bool IsRunOnStartup()
        {
            using var key = Registry.CurrentUser.OpenSubKey(StartupRegistryKey, false);
            return key?.GetValue(StartupValueName) != null;
        }

        public static void SetRunOnStartup(bool enable)
        {
            // Persist the user's intent regardless of where we're running from.
            var settings = AppSettingsManager.Load();
            settings.RunOnStartup = enable;
            AppSettingsManager.Save(settings);

            // Only the installed build owns the Run key. A dev/portable copy writing its own
            // (transient) path here is what previously left a dangling autostart entry when that
            // copy was later moved or deleted — guard against polluting it.
            if (!IsInstalledLocation()) return;
            WriteStartupKey(enable);
        }

        /// <summary>
        /// Startup self-heal: makes the Run key match the saved RunOnStartup intent AND point at
        /// THIS (current) exe. Rewrites a stale/missing entry — e.g. one left by a previous
        /// version, a moved install, or a now-deleted copy — so autostart can't silently break.
        /// No-op from non-installed (dev/portable) copies so they can't pollute the key.
        /// </summary>
        public static void SyncStartupRegistration(bool desired)
        {
            if (!IsInstalledLocation()) return;
            using var key = Registry.CurrentUser.OpenSubKey(StartupRegistryKey, true);
            if (key == null) return;

            string expected = StartupValue;
            string? current = key.GetValue(StartupValueName) as string;
            if (desired)
            {
                if (!string.Equals(current, expected, StringComparison.OrdinalIgnoreCase))
                    key.SetValue(StartupValueName, expected); // create or fix a stale path
            }
            else if (current != null)
            {
                key.DeleteValue(StartupValueName, false);
            }
        }

        private static string StartupValue => $"\"{Environment.ProcessPath}\" --startup";

        private static void WriteStartupKey(bool enable)
        {
            using var key = Registry.CurrentUser.OpenSubKey(StartupRegistryKey, true);
            if (key == null) return;
            if (enable)
                key.SetValue(StartupValueName, StartupValue);
            else
                key.DeleteValue(StartupValueName, false);
        }

        // True only when running from the Velopack install location
        // (%LocalAppData%\TrueReplayer3\...). Dev (bin\) and portable copies return false.
        // Also read by Program.RegisterNativeMessagingHost, the other HKCU writer with this hazard.
        internal static bool IsInstalledLocation()
        {
            var p = Environment.ProcessPath;
            if (string.IsNullOrEmpty(p)) return false;
            return p.StartsWith(AppIdentity.LocalRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        }

        /// Callback invoked after tray menu toggles a setting, so bridge can push updated state to UI.
        public static Action? OnTraySettingChanged { get; set; }

        /// Callback to switch Macro/Clicker mode from the tray menu (true = Clicker).
        public static Action<bool>? OnSetMode { get; set; }
        public static Action? OnReloadUI { get; set; }
        public static Action? OnOpenDevTools { get; set; }
        public static Action? OnOpenLogsFolder { get; set; }
        /// Restore the window + open the Automation panel (daemon usage: everything armed
        /// lives in the tray; this is the one-click way back to the manager).
        public static Action? OnOpenAutomations { get; set; }
        /// Restore the window + open the Browser extension dialog (folder path, load steps).
        public static Action? OnOpenExtensionHelp { get; set; }
        /// Flip the global automation master switch (persist-immediately handled by MainWindow).
        public static Action? OnToggleAutomations { get; set; }
        /// The window, on screen and in front.
        public static Action? OnOpenWindow { get; set; }
        /// Stop the recording or the run in progress, like its hotkey.
        public static Action? OnStopRun { get; set; }
        /// A new macro, recording from its first step (the page does it, as the first use's Record it).
        public static Action? OnRecordNew { get; set; }
        /// Flip the Shortcuts switch (the macros' hotkeys and hotstrings, and the Key Remaps with them).
        public static Action? OnToggleShortcuts { get; set; }
        /// The Clicker page: the mode on, and the window in front.
        public static Action? OnOpenClicker { get; set; }
        /// Settings, in the window.
        public static Action? OnOpenSettings { get; set; }
        /// Whether Quit has something to ask first (an editor's unapplied work, a save that failed): only
        /// then does the window come up for the question. With nothing to ask, Quit just quits.
        public static Func<bool>? QuitNeedsWindow { get; set; }

        // The right-click menu's commands (Tray board, "Clique direito"; D26 for Troubleshoot ▸).
        private const uint CmdOpen = 1, CmdStop = 2, CmdRecordNew = 3, CmdShortcuts = 4, CmdAutomations = 5,
            CmdRemaps = 6, CmdClicker = 7, CmdSettings = 8, CmdReloadUi = 9, CmdDevTools = 10, CmdLogs = 11, CmdQuit = 12;
        private const uint MF_GRAYED = 0x0001, MF_POPUP = 0x0010;

        // A menu item with its key on the right ("Stop Trade Roblox    Ctrl+F10"): the tab is how a
        // Win32 menu lays out the accelerator column.
        private static string WithKey(string text, string? key) => string.IsNullOrWhiteSpace(key) ? text : $"{text}\t{key}";

        public static async void ShowContextMenu()
        {
            var settings = AppSettingsManager.Load();
            bool isClicker = settings.UseCursorClick;
            bool recording = _runState == "recording";
            bool replaying = _runState == "replaying";
            string? macro = CurrentMacro?.Invoke();

            IntPtr hMenu = CreatePopupMenu();
            IntPtr hTroubleshoot = CreatePopupMenu();
            // Each item has a mnemonic (the underlined letter, shown when the menu is opened from the
            // keyboard); a macro's own "&" is doubled so it is not read as one.
            AppendMenu(hMenu, MF_STRING, CmdOpen, $"&Open {AppIdentity.DisplayName}");
            // Stop is there while something runs, with the key that stops it from anywhere.
            if (recording) AppendMenu(hMenu, MF_STRING, CmdStop, WithKey("&Stop recording", settings.RecordingHotkey));
            else if (replaying && isClicker) AppendMenu(hMenu, MF_STRING, CmdStop, WithKey("&Stop the Clicker", settings.CursorClickStartHotkey));
            else if (replaying) AppendMenu(hMenu, MF_STRING, CmdStop, WithKey(macro != null ? $"&Stop {Short(macro, 40).Replace("&", "&&")}" : "&Stop", settings.ReplayHotkey));
            // A recording needs the engine idle and in Macro mode, as the first use's Record it does.
            AppendMenu(hMenu, MF_STRING | (recording || replaying || isClicker ? MF_GRAYED : 0), CmdRecordNew, WithKey("&Record a new macro", settings.RecordingHotkey));
            AppendMenu(hMenu, MF_SEPARATOR, 0, null);
            // Shortcuts and Key Remaps are switches, ticked when on: the Key Remaps one is the way out
            // by mouse alone when a remap gets in the way of typing. Automations… opens its page; its
            // master switch is in the tray panel (D26). Clicker opens its page, the mode on.
            AppendMenu(hMenu, MF_STRING | (UserProfile.Current.ProfileKeyEnabled ? MF_CHECKED : 0), CmdShortcuts, "S&hortcuts");
            AppendMenu(hMenu, MF_STRING, CmdAutomations, "&Automations…");
            bool remapsEnabled = RemapService.Current.Enabled;
            AppendMenu(hMenu, MF_STRING | (remapsEnabled ? MF_CHECKED : 0), CmdRemaps, "&Key Remaps");
            AppendMenu(hMenu, MF_STRING | (isClicker ? MF_CHECKED : 0), CmdClicker, "&Clicker");
            AppendMenu(hMenu, MF_STRING, CmdSettings, "Se&ttings");
            AppendMenu(hMenu, MF_SEPARATOR, 0, null);
            // The way back when the page itself is broken, so it cannot live in the page (D26).
            AppendMenu(hTroubleshoot, MF_STRING, CmdReloadUi, "&Reload UI");
            AppendMenu(hTroubleshoot, MF_STRING, CmdDevTools, "Open &DevTools");
            AppendMenu(hTroubleshoot, MF_STRING, CmdLogs, "Open &logs folder");
            AppendMenu(hMenu, MF_STRING | MF_POPUP, (uint)hTroubleshoot, "Tro&ubleshoot");
            AppendMenu(hMenu, MF_SEPARATOR, 0, null);
            AppendMenu(hMenu, MF_STRING, CmdQuit, "&Quit");

            GetCursorPos(out NativeMethods.POINT pt);
            SetForegroundWindow(hwnd);
            uint cmd;
            try
            {
                cmd = (uint)TrackPopupMenu(hMenu, TPM_RETURNCMD, pt.x, pt.y, 0, hwnd, IntPtr.Zero);
            }
            finally
            {
                // Always free the popup menu, even if TrackPopupMenu throws — otherwise the HMENU
                // leaks. Destroying the menu destroys the submenu attached to it.
                DestroyMenu(hMenu);
            }
            DiagnosticLog.Info($"Tray menu: command {cmd}");

            switch (cmd)
            {
                case CmdOpen: OnOpenWindow?.Invoke(); break;
                case CmdStop: OnStopRun?.Invoke(); break;
                case CmdRecordNew: OnRecordNew?.Invoke(); break;
                case CmdShortcuts: OnToggleShortcuts?.Invoke(); break;
                case CmdAutomations: OnOpenAutomations?.Invoke(); break;
                case CmdRemaps:
                    // Persists + republishes the hook snapshot itself; the bridge push (so the
                    // Settings toggle mirrors) rides the same callback MainWindow wires.
                    RemapService.SetEnabled(!remapsEnabled);
                    OnTraySettingChanged?.Invoke();
                    UpdateTrayIcon();
                    break;
                case CmdClicker: OnOpenClicker?.Invoke(); break;
                case CmdSettings: OnOpenSettings?.Invoke(); break;
                case CmdReloadUi: OnReloadUI?.Invoke(); break;
                case CmdDevTools: OnOpenDevTools?.Invoke(); break;
                case CmdLogs: OnOpenLogsFolder?.Invoke(); break;
                case CmdQuit: await QuitAsync(); break;
            }
        }

        // Quit: the window comes up only when the close guard has a question to ask (nativo-015: with
        // saving as you go, it seldom has). The teardown is the window's close's (AppExit).
        public static async Task QuitAsync()
        {
            if (OnTrayExitRequested != null)
            {
                if (QuitNeedsWindow?.Invoke() == true) ShowWindow(hwnd, 9); // so the question is seen
                bool canExit = await OnTrayExitRequested();
                if (!canExit) return;
            }

            DiagnosticLog.Info("Tray Quit — terminating application");
            AppExit.FlushState();
            AppExit.ReleaseSystem();
            Microsoft.UI.Xaml.Application.Current.Exit();
            Environment.Exit(0);
        }

        /// <summary>
        /// "Switch to TrueReplayer 2", after TrueReplayer 2 knocked (CoexistenceGuard): the tray Exit,
        /// then TrueReplayer 2 started with --wait-pid, which 2.50 already understands — it waits for
        /// this process to be gone before it takes its mutex. With <paramref name="openTr2"/> false
        /// (no installed TrueReplayer 2 to open) it is just the Exit.
        /// </summary>
        public static Task SwitchToTr2Async(bool openTr2) => ExitAndStartAsync(
            openTr2 ? AppIdentity.Tr2.InstalledExe : null,
            openTr2 ? $"[Coexist] switching to {AppIdentity.Tr2.DisplayName}" : $"[Coexist] closing so {AppIdentity.Tr2.DisplayName} can open");

        /// <summary>The restart that finishes an import (Tr2Import): this exe again, after this process is gone.</summary>
        public static Task RestartAsync(string reason) => ExitAndStartAsync(Environment.ProcessPath, reason);

        /// <summary>
        /// The tray Exit — the close guard, then the same teardown — and, when <paramref name="exe"/>
        /// is given, that exe started with --wait-pid so it only takes over once this process is gone.
        /// </summary>
        private static async Task ExitAndStartAsync(string? exe, string reason)
        {
            if (OnTrayExitRequested != null && !await OnTrayExitRequested()) return;

            DiagnosticLog.Info(reason);
            AppExit.FlushState();
            AppExit.ReleaseSystem();
            if (exe != null)
            {
                try
                {
                    Process.Start(new ProcessStartInfo
                    {
                        FileName = exe,
                        Arguments = Program.WaitForPidArg + Environment.ProcessId,
                        WorkingDirectory = Path.GetDirectoryName(exe)!,
                        UseShellExecute = true,
                    });
                }
                catch (Exception ex)
                {
                    DiagnosticLog.Warn($"Could not start {exe}: {ex.Message}");
                }
            }
            Microsoft.UI.Xaml.Application.Current.Exit();
            Environment.Exit(0);
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct NotifyIconData
        {
            public uint cbSize;
            public IntPtr hWnd;
            public uint uID;
            public uint uFlags;
            public uint uCallbackMessage;
            public IntPtr hIcon;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
            public uint dwState;
            public uint dwStateMask;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
            public uint uTimeoutOrVersion;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
            public uint dwInfoFlags;
            public Guid guidItem;
            public IntPtr hBalloonIcon;
        }

        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool GetCursorPos(out NativeMethods.POINT lpPoint);
        [DllImport("user32.dll")] private static extern IntPtr CreatePopupMenu();
        [DllImport("user32.dll")] private static extern bool AppendMenu(IntPtr hMenu, uint uFlags, uint uIDNewItem, string? lpNewItem);
        [DllImport("user32.dll")]
        private static extern int

 TrackPopupMenu(IntPtr hMenu, uint uFlags, int x, int y, int nReserved, IntPtr hWnd, IntPtr prcRect);
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool Shell_NotifyIcon(uint dwMessage, ref NotifyIconData lpdata);
        private const uint MSGFLT_ALLOW = 1;
        [DllImport("user32.dll", SetLastError = true)] private static extern bool ChangeWindowMessageFilterEx(IntPtr hwnd, uint message, uint action, IntPtr pChangeFilterStruct);
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr LoadImage(IntPtr hInst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr hIcon);
        [DllImport("user32.dll")] private static extern bool DestroyMenu(IntPtr hMenu);
    }

    public static class WindowAppearanceService
    {
        public static void Configure(Window window)
        {
            var hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);
            var windowId = Win32Interop.GetWindowIdFromWindow(hwnd);
            var appWindow = AppWindow.GetFromWindowId(windowId);
            // AppWindow.Resize takes PHYSICAL pixels — scale the 1180×780 DIP design
            // size by the window's DPI (mirrors the WM_GETMINMAXINFO convention).
            // Unscaled, a 125% display opened the window at 1180 physical = 944 DIP,
            // under the React shell's ~1020px auto-collapse threshold — the app
            // started with its side panels folded for no reason.
            uint dpi = NativeMethods.GetDpiForWindowSafe(hwnd);
            appWindow.Resize(new Windows.Graphics.SizeInt32(
                (int)(1180 * dpi / 96.0),
                (int)(780 * dpi / 96.0)));
            CustomizeTitleBar(appWindow);
            CenterWindow(appWindow, windowId);
        }

        public static void CustomizeTitleBar(AppWindow appWindow)
        {
            appWindow.TitleBar.ExtendsContentIntoTitleBar = true;
            appWindow.TitleBar.ButtonBackgroundColor = Colors.Transparent;
            appWindow.TitleBar.ButtonInactiveBackgroundColor = Colors.Transparent;
        }

        public static void CenterWindow(AppWindow appWindow, WindowId windowId)
        {
            var displayArea = DisplayArea.GetFromWindowId(windowId, DisplayAreaFallback.Primary);
            var centerPosition = new Windows.Graphics.PointInt32
            {
                X = displayArea.WorkArea.X + (displayArea.WorkArea.Width - appWindow.Size.Width) / 2,
                Y = displayArea.WorkArea.Y + (displayArea.WorkArea.Height - appWindow.Size.Height) / 2
            };
            appWindow.Move(centerPosition);
        }
    }

    public class WindowEventManager
    {
        private readonly Window window;
        private readonly IntPtr hwnd;
        private readonly AppWindow appWindow;
        private bool closingConfirmed;

        // Resize-snap hysteresis state, live only during a drag. _snapWTarget: the width (physical
        // px) the drag is stuck to, or -1; _snapH: stuck to the default height. _lastSizeW/H: the
        // previous frame's raw proposed dimension, used to detect a fast drag CROSSING a target
        // between frames. Reset on WM_ENTERSIZEMOVE / WM_EXITSIZEMOVE so no state leaks between
        // drags. UI-thread only (window message loop).
        private int _snapWTarget = -1;
        private bool _snapH;
        private int _lastSizeW = -1, _lastSizeH = -1;

        // The widths (DIP) a dragged edge sticks to. The new interface says its layout's band edges
        // (window:snapWidths, D27: "o ímã da borda passa para as faixas de 1280 e 1024"): they are in
        // rem, so they move with the interface's zoom, which only the page knows. Until it says them —
        // and always for the interface of today — the width the window opens at.
        private int[] _snapWidthsDip = { BaseDefaultWidthDip };

        /// <summary>The page's layout band edges, in DIP. Anything not a sane width is dropped; none left keeps the open width.</summary>
        public void SetResizeSnapWidths(IEnumerable<int> widthsDip)
        {
            var sane = widthsDip.Where(w => w >= 320 && w <= 16384).Distinct().ToArray();
            _snapWidthsDip = sane.Length > 0 ? sane : new[] { BaseDefaultWidthDip };
        }

        /// Callback that returns true if close should proceed (no unsaved changes or user confirmed).
        /// Set from MainWindow after bridge is initialized.
        public Func<Task<bool>>? OnCloseRequested { get; set; }

        /// Raised (inside the window procedure) when the window has just become visible — from the
        /// tray, or after an autostart hid it at boot. MainWindow uses it to deliver the notices
        /// held while nobody could see them.
        public Action? OnShown { get; set; }

        private const int WM_USER = 0x0400;
        private const int WM_LBUTTONUP = 0x0202;
        private const int WM_LBUTTONDBLCLK = 0x0203;
        private const int WM_RBUTTONUP = 0x0205;
        private const int WM_GETMINMAXINFO = 0x0024;
        private const int WM_DISPLAYCHANGE = 0x007E;
        private const int WM_QUERYENDSESSION = 0x0011;
        private const int WM_INPUTLANGCHANGE = 0x0051;
        private const int WM_WINDOWPOSCHANGED = 0x0047;
        private const uint SWP_SHOWWINDOW = 0x0040;
        private const int WM_SIZING = 0x0214;
        private const int WM_ENTERSIZEMOVE = 0x0231;
        private const int WM_EXITSIZEMOVE = 0x0232;
        // WM_SIZING wParam — which resize handle the user is dragging.
        private const int WMSZ_LEFT = 1, WMSZ_RIGHT = 2, WMSZ_TOP = 3, WMSZ_TOPLEFT = 4,
            WMSZ_TOPRIGHT = 5, WMSZ_BOTTOM = 6, WMSZ_BOTTOMLEFT = 7, WMSZ_BOTTOMRIGHT = 8;
        private const int SW_RESTORE = 9;
        // Layout minimum in DIPs. WM_GETMINMAXINFO works in physical pixels, so this
        // is scaled by the window's DPI before being written to ptMinTrackSize.
        // 960 (not the 1180 the window still OPENS at — see WindowAppearanceService.
        // Configure) so the app can be snapped to HALF of a 1920×1080 display next to
        // the game being macroed — the single most common arrangement for the target
        // workflow, at 100% display scaling. (At 125%+ the DPI-scaled floor exceeds
        // the 960-physical-px half-screen slot; going lower would break the React
        // layout, so scaled displays keep a slightly-over-half minimum.) Below
        // ~1020px the React shell auto-collapses the side panels to their icon
        // rails (App.tsx), so the center grid keeps a usable width.
        private const int BaseMinWidthDip = 960;
        private const int BaseMinHeightDip = 780;
        // The size the window OPENS at (WindowAppearanceService.Configure). Used as a magnetic
        // "snap-to-original" target while a resize edge is dragged: as the proposed size nears this,
        // the edge sticks here (see the enter/exit zones below) — a soft preset that lets the user
        // restore the original dimensions without hunting for an exact pixel, while indicating "this
        // is the default." It never COMMITS the size: releasing the mouse keeps whatever is showing,
        // snapped or not. Same physical-pixel convention as ptMinTrackSize above, so the snap width
        // lines up exactly with the open size.
        private const int BaseDefaultWidthDip = 1180;
        private const int BaseDefaultHeightDip = 780;
        // Hysteresis for the snap so it holds firmly instead of a symmetric threshold that a fast
        // drag can slip past. SnapEnterDip: how close (DIP) a drag must get to GRAB the default size.
        // SnapExitDip (larger): how far PAST the target the drag must then pull to BREAK FREE — the
        // gap between them is the "stickiness", forcing a deliberate extra drag to leave. A fast drag
        // that CROSSES the target between two frames also grabs, so it catches even when the pointer
        // jumps over the enter zone in one step.
        private const int SnapEnterDip = 16;
        private const int SnapExitDip = 40;
        private const uint SWP_NOMOVE = 0x0002;
        private const uint SWP_NOSIZE = 0x0001;
        private const uint SWP_NOACTIVATE = 0x0010;
        private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
        private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);

        public WindowEventManager(Window window)
        {
            this.window = window;
            hwnd = WinRT.Interop.WindowNative.GetWindowHandle(window);

            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
            appWindow = AppWindow.GetFromWindowId(windowId);
            appWindow.Closing += OnAppWindowClosing;

            window.Closed += Window_Closed;
        }

        private async void OnAppWindowClosing(AppWindow sender, AppWindowClosingEventArgs args)
        {
            if (closingConfirmed)
                return;

            // When System Tray is enabled, close (X) minimizes to tray instead of exiting
            if (((MainWindow)window).IsMinimizeToTrayEnabled())
            {
                args.Cancel = true;

                // ...but NOT while a modal dialog is waiting for an answer. The caption buttons and
                // Alt+F4 are system surfaces: they sit outside the XamlRoot the ContentDialog dims,
                // so they stay clickable with a prompt on screen. Hiding the window there strands
                // the dialog — ShowAsync never completes, so nothing ever releases the gate, and an
                // invisible dialog goes on refusing every other one for the rest of the session
                // while nothing tells the user what happened or how to undo it. (The hotkeys it
                // used to take down with it now come back on their own: the interaction scope the
                // gate holds is swept once it expires. The stranded dialog is still worth
                // preventing.) Cancelling the hide leaves the window up with the question on it,
                // which is the only state in which the user can actually resolve this.
                if (Services.ModalGate.IsOpen)
                {
                    Services.DiagnosticLog.Info("Close-to-tray ignored: a dialog is waiting for an answer.");
                    return;
                }

                TrayIconService.Initialize((MainWindow)window, hwnd);
                TrayIconService.ShowMinimizeBalloon();
                appWindow.Hide();
                return;
            }

            if (OnCloseRequested == null)
                return;

            args.Cancel = true;

            bool canClose = await OnCloseRequested();
            if (canClose)
            {
                closingConfirmed = true;
                ForceExit();
            }
        }

        private void Window_Closed(object sender, WindowEventArgs args)
        {
            ForceExit();
        }

        private void ForceExit()
        {
            // Before anything else tears down: the cursor sidecar is debounced, so a run that
            // advanced a list in the last second still has its position only in memory. The
            // automation fire history is debounced the same way.
            AppExit.FlushState();
            // This runs from Window_Closed, i.e. WHILE the window is being destroyed — the reason
            // AppExit puts the original WndProc back before anything else can arrive.
            NativeMethods.WTSUnRegisterSessionNotification(hwnd);
            AppExit.ReleaseSystem();
            Microsoft.UI.Xaml.Application.Current.Exit();
            Environment.Exit(0);
        }

        // Explorer re-broadcasts this to every top-level window whenever it (re)creates the
        // taskbar — after a crash, an update, "Restart" from Task Manager. Every tray icon is gone
        // by then and each app must add its own again.
        private static readonly uint WM_TASKBARCREATED = NativeMethods.RegisterWindowMessage("TaskbarCreated");

        /// <summary>
        /// Session and shell notifications for this window. Called once the WndProc subclass is in
        /// place (MainWindow), since both arrive through it.
        /// </summary>
        public void RegisterShellNotifications()
        {
            // Lock/unlock and reconnects: InputHookManager.ResetAfterSessionReturn.
            if (!NativeMethods.WTSRegisterSessionNotification(hwnd, NativeMethods.NOTIFY_FOR_THIS_SESSION))
                Services.DiagnosticLog.Warn($"WTSRegisterSessionNotification failed (Win32 error {Marshal.GetLastWin32Error()}) — held keys will not be reset after an unlock");
            // TaskbarCreated comes from Explorer at medium integrity; an elevated instance (Run as
            // administrator) would have it dropped by UIPI, the same way the tray message is.
            if (WM_TASKBARCREATED != 0)
                ChangeWindowMessageFilterEx(hwnd, WM_TASKBARCREATED, 1 /* MSGFLT_ALLOW */, IntPtr.Zero);
        }

        public IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam)
        {
            if (msg == WM_GETMINMAXINFO)
            {
                MINMAXINFO mmi = Marshal.PtrToStructure<MINMAXINFO>(lParam)!;
                // ptMinTrackSize is in physical pixels — scale the DIP minimum by the
                // window's current DPI so the floor matches the layout minimum at any scale
                // (GetDpiForWindow returns 96 at 100%; falls back to 96 if it ever returns 0).
                uint dpi = GetDpiForWindow(hwnd);
                if (dpi == 0) dpi = 96;
                mmi.ptMinTrackSize.x = (int)(BaseMinWidthDip * dpi / 96.0);
                mmi.ptMinTrackSize.y = (int)(BaseMinHeightDip * dpi / 96.0);
                Marshal.StructureToPtr(mmi, lParam, true);
                return IntPtr.Zero;
            }

            if (msg == WM_ENTERSIZEMOVE || msg == WM_EXITSIZEMOVE)
            {
                // Clear the snap hysteresis at the boundaries of a drag so a fresh resize always
                // starts unstuck (and stale state never survives to the next one).
                _snapWTarget = -1;
                _snapH = false;
                _lastSizeW = _lastSizeH = -1;
                return HwndHookManager.CallOriginalWndProc(hwnd, msg, wParam, lParam);
            }

            if (msg == WM_SIZING)
            {
                // Magnetic snap to the original open size while a resize edge is dragged. When it
                // snaps we rewrite the proposed rect and return TRUE (handled) so the drag loop uses
                // it; otherwise fall through so normal resizing is completely untouched.
                if (TrySnapToDefaultSize(hwnd, (int)wParam, lParam))
                    return new IntPtr(1);
                return HwndHookManager.CallOriginalWndProc(hwnd, msg, wParam, lParam);
            }

            if (msg == CoexistenceGuard.TrayMessage)
            {
                // One click opens the tray panel (Tray board); a double-click still opens the window
                // straight away — its first click has opened the panel by then, which it closes. That
                // is also the message a second launch of the exe sends (Program.SignalRunningInstance).
                if ((int)lParam == WM_LBUTTONUP)
                {
                    TrayPanel.Toggle();
                }
                else if ((int)lParam == WM_LBUTTONDBLCLK)
                {
                    TrayPanel.Hide();
                    ShowWindow(hwnd, SW_RESTORE);
                    SetForegroundWindow(hwnd);
                }
                else if ((int)lParam == WM_RBUTTONUP)
                {
                    TrayPanel.Hide();
                    TrayIconService.ShowContextMenu();
                }
            }
            else if (msg == CoexistenceGuard.Tr2TrayMessage && (int)lParam == WM_LBUTTONDBLCLK)
            {
                // TrueReplayer 2 was launched while this app runs: it found its mutex name held
                // (CoexistenceGuard), knocked with its own tray double-click, and exited.
                CoexistenceGuard.OnKnock();
            }
            else if (msg == WM_DISPLAYCHANGE)
            {
                // Monitor/resolution/DPI change — drop the cached virtual-screen bounds so replay
                // coordinate normalization uses the new geometry instead of stale metrics.
                NativeMethods.VirtualScreen.Invalidate();
            }
            else if (msg == WM_INPUTLANGCHANGE)
            {
                // Keyboard layout changed (Alt+Shift, the language bar, a per-app layout switch).
                // Remaps whose from/to is a single character — ç [ ; - ' / , the whole ABNT2 OEM
                // row — were compiled to the vks those characters had on the PREVIOUS layout, and
                // would keep pointing at a different physical key or none at all. This message
                // arrives after the thread's layout has already changed, and KeyUtils.ActiveLayout
                // reads the UI thread's layout, so it sees the new one.
                //
                // No filtering here on purpose: RepublishForLayoutChange is idempotent and does
                // no disk I/O — it returns immediately when the layout it already compiled
                // against is still active. The app can also miss this message entirely (it goes
                // to the focused window, and TrueReplayer spends most of its life in the tray);
                // the same idempotent check is what lets the next one it DOES receive re-sync.
                RemapService.RepublishForLayoutChange();
            }
            else if (msg == WM_QUERYENDSESSION)
            {
                // Windows is shutting down, logging off or restarting. Nothing in the app noticed
                // before this: there was no session-end handling anywhere, so the process was
                // killed with both sidecars still holding debounced writes — up to two seconds of
                // automation fire history and one of run cursors, thrown away on every reboot.
                //
                // Only the flushes, and then TRUE. Never an exit from here: the user can still
                // cancel the shutdown, and a process that tore itself down on the question would
                // be gone for a shutdown that never happened. The session manager also times
                // these out, so this stays to three small file writes and returns (interface.json
                // holds half a second of the interface's own changes).
                //
                // A fire recorded but interrupted mid-replay is the right thing to keep, not a
                // duplicate risk: LastFiredAt is stamped when the replay STARTS, so the next boot
                // reading it is recovering an aborted run, not repeating a finished one.
                Services.DiagnosticLog.Info("WM_QUERYENDSESSION — flushing automation stats, run cursors and interface.json before session end");
                try { RunCursorService.Flush(); } catch (Exception ex) { Services.DiagnosticLog.Warn($"Run-cursor flush at session end failed: {ex.Message}"); }
                try { InterfaceStore.Flush(); } catch (Exception ex) { Services.DiagnosticLog.Warn($"interface.json flush at session end failed: {ex.Message}"); }
                try { Services.TriggerService.Instance?.Flush(); } catch (Exception ex) { Services.DiagnosticLog.Warn($"Automation stats flush at session end failed: {ex.Message}"); }
                return (IntPtr)1;
            }
            else if (msg == NativeMethods.WM_WTSSESSION_CHANGE)
            {
                // Back on this desktop after the lock screen, or reconnected: whatever the user held
                // when the session left was released where the hooks cannot see.
                int evt = (int)wParam;
                if (evt == NativeMethods.WTS_SESSION_UNLOCK || evt == NativeMethods.WTS_CONSOLE_CONNECT
                    || evt == NativeMethods.WTS_REMOTE_CONNECT)
                    InputHookManager.ResetAfterSessionReturn();
            }
            else if (WM_TASKBARCREATED != 0 && (uint)msg == WM_TASKBARCREATED)
            {
                TrayIconService.RecreateAfterShellRestart();
            }
            else if (msg == WM_WINDOWPOSCHANGED && OnShown != null)
            {
                // Every way of showing the window ends here with SWP_SHOWWINDOW — ShowWindow from the
                // tray, AppWindow.Show, SetWindowPos. WM_SHOWWINDOW would not do: it is skipped for
                // SW_SHOWNORMAL. WINDOWPOS.flags sits after two handles and four ints.
                uint flags = (uint)Marshal.ReadInt32(lParam, 2 * IntPtr.Size + 16);
                if ((flags & SWP_SHOWWINDOW) != 0) OnShown();
            }
            return HwndHookManager.CallOriginalWndProc(hwnd, msg, wParam, lParam);
        }

        // Snaps the in-progress WM_SIZING rect (screen coords, physical px) to the snap widths (the
        // page's band edges, else the open width) and to the default height, moving ONLY the dragged
        // edge so the opposite one stays put. Width and height snap independently (a corner drag can
        // grab one axis without forcing the other) with per-axis hysteresis (UpdateSnapAny,
        // UpdateSnap). Returns true when it rewrote the rect. A width under the min (960) is never
        // reached, so it just never grabs; the default height equals the min, so a height snap just
        // makes the floor magnetic.
        private bool TrySnapToDefaultSize(IntPtr hwnd, int edge, IntPtr lParam)
        {
            uint dpi = GetDpiForWindow(hwnd);
            if (dpi == 0) dpi = 96;
            var targetsW = _snapWidthsDip.Select(w => (int)(w * dpi / 96.0)).ToArray();
            int targetH = (int)(BaseDefaultHeightDip * dpi / 96.0);
            int enter = (int)(SnapEnterDip * dpi / 96.0);
            int exit = (int)(SnapExitDip * dpi / 96.0);

            var rect = Marshal.PtrToStructure<NativeMethods.RECT>(lParam);
            bool changed = false;

            bool left = edge is WMSZ_LEFT or WMSZ_TOPLEFT or WMSZ_BOTTOMLEFT;
            bool right = edge is WMSZ_RIGHT or WMSZ_TOPRIGHT or WMSZ_BOTTOMRIGHT;
            if (left || right)
            {
                int w = rect.Right - rect.Left;
                int targetW = UpdateSnapAny(ref _snapWTarget, ref _lastSizeW, w, targetsW, enter, exit);
                if (targetW > 0)
                {
                    if (left) rect.Left = rect.Right - targetW;
                    else rect.Right = rect.Left + targetW;
                    changed = true;
                }
            }

            bool top = edge is WMSZ_TOP or WMSZ_TOPLEFT or WMSZ_TOPRIGHT;
            bool bottom = edge is WMSZ_BOTTOM or WMSZ_BOTTOMLEFT or WMSZ_BOTTOMRIGHT;
            if (top || bottom)
            {
                int h = rect.Bottom - rect.Top;
                if (UpdateSnap(ref _snapH, ref _lastSizeH, h, targetH, enter, exit))
                {
                    if (top) rect.Top = rect.Bottom - targetH;
                    else rect.Bottom = rect.Top + targetH;
                    changed = true;
                }
            }

            if (changed) Marshal.StructureToPtr(rect, lParam, false);
            return changed;
        }

        // UpdateSnap for an axis with several targets (the widths): stuck to one until the drag pulls
        // more than `exit` past it — and, as in UpdateSnap, the frame that frees it grabs nothing;
        // free, it grabs the target it nears or crosses, the closest one when a fast drag crossed
        // two. Returns the target it is stuck to, or -1.
        private static int UpdateSnapAny(ref int snapped, ref int lastSize, int size, int[] targets, int enter, int exit)
        {
            if (snapped >= 0)
            {
                if (Math.Abs(size - snapped) > exit) snapped = -1;
            }
            else
            {
                foreach (int target in targets)
                {
                    bool near = Math.Abs(size - target) <= enter;
                    bool crossed = lastSize >= 0 && (long)(lastSize - target) * (size - target) < 0;
                    if ((near || crossed) && (snapped < 0 || Math.Abs(size - target) < Math.Abs(size - snapped))) snapped = target;
                }
            }
            lastSize = size;
            return snapped;
        }

        // Advances one axis's snap state for a single resize frame and returns whether it is snapped
        // (should be pinned to target). Not snapped → GRAB when within `enter` of target, or when the
        // drag CROSSED the target since the last frame (opposite signs → catches a fast drag that
        // jumped the enter zone). Snapped → HOLD until the raw proposed size pulls more than `exit`
        // past target, then release. `exit > enter` is what makes it stick. Records the raw size for
        // next-frame crossing detection.
        private static bool UpdateSnap(ref bool snapped, ref int lastSize, int size, int target, int enter, int exit)
        {
            if (snapped)
            {
                if (Math.Abs(size - target) > exit) snapped = false;
            }
            else
            {
                bool near = Math.Abs(size - target) <= enter;
                bool crossed = lastSize >= 0 && (long)(lastSize - target) * (size - target) < 0;
                if (near || crossed) snapped = true;
            }
            lastSize = size;
            return snapped;
        }

        public void BringToForeground()
        {
            // Make the window on-screen FIRST (unhide from tray, un-minimize) so the activation
            // below has a visible target regardless of prior state.
            if (!IsWindowVisible(hwnd))
                appWindow.Show();
            // Only restore if minimized — preserves maximized state.
            if (IsIconic(hwnd))
                ShowWindow(hwnd, SW_RESTORE);

            // Already the foreground window? Skip the activation dance entirely.
            if (GetForegroundWindow() == hwnd)
                return;

            uint currentThread = GetCurrentThreadId();
            IntPtr foregroundHwnd = GetForegroundWindow();
            // GetForegroundWindow returns NULL during focus transitions (menu just closed, an app
            // releasing fullscreen, etc.). Passing that to GetWindowThreadProcessId yields thread 0,
            // and AttachThreadInput(0, …) silently fails — so SetForegroundWindow gets rejected by
            // Windows' foreground lock and the window doesn't come up. That is the intermittent
            // "pressed the hotkey and nothing happened, worked next time" bug. Guard the 0 case so
            // we skip the (useless) attach instead of poisoning the whole call.
            uint foregroundThread = foregroundHwnd != IntPtr.Zero
                ? GetWindowThreadProcessId(foregroundHwnd, out _)
                : 0;

            // AttachThreadInput trick: share the foreground thread's input queue so Windows treats
            // our SetForegroundWindow as coming from the active thread. Track success so we only
            // detach what we actually attached (and always detach, via finally).
            bool attached = false;
            if (foregroundThread != 0 && foregroundThread != currentThread)
                attached = AttachThreadInput(foregroundThread, currentThread, true);

            // Belt-and-suspenders: temporarily zero the foreground-lock timeout so Windows honours
            // SetForegroundWindow from a background process even when the attach trick alone isn't
            // enough. The user's real value is saved and restored in finally so this can't leak.
            uint prevLockTimeout = 0;
            bool lockTimeoutZeroed = false;
            try
            {
                if (NativeMethods.SystemParametersInfo(NativeMethods.SPI_GETFOREGROUNDLOCKTIMEOUT, 0, ref prevLockTimeout, 0))
                    lockTimeoutZeroed = NativeMethods.SystemParametersInfo(NativeMethods.SPI_SETFOREGROUNDLOCKTIMEOUT, 0, IntPtr.Zero, NativeMethods.SPIF_SENDCHANGE);

                BringWindowToTop(hwnd);
                SetForegroundWindow(hwnd);
            }
            finally
            {
                if (lockTimeoutZeroed)
                    NativeMethods.SystemParametersInfo(NativeMethods.SPI_SETFOREGROUNDLOCKTIMEOUT, 0, new IntPtr(prevLockTimeout), NativeMethods.SPIF_SENDCHANGE);
                if (attached)
                    AttachThreadInput(foregroundThread, currentThread, false);
            }
        }

        public void UpdateAlwaysOnTop(bool isAlwaysOnTop)
        {
            SetWindowPos(hwnd,
                isAlwaysOnTop ? HWND_TOPMOST : HWND_NOTOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MINMAXINFO
        {
            public NativeMethods.POINT ptReserved;
            public NativeMethods.POINT ptMaxSize;
            public NativeMethods.POINT ptMaxPosition;
            public NativeMethods.POINT ptMinTrackSize;
            public NativeMethods.POINT ptMaxTrackSize;
        }

        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
        [DllImport("user32.dll")] private static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
        [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern bool BringWindowToTop(IntPtr hWnd);
        [DllImport("user32.dll", SetLastError = true)] private static extern bool ChangeWindowMessageFilterEx(IntPtr hwnd, uint message, uint action, IntPtr pChangeFilterStruct);
        // SystemParametersInfo and the foreground-lock constants come from NativeMethods, as in
        // WindowActivation: this class used to carry a byte-for-byte private copy of both.
    }
}