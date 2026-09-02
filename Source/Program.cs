using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Principal;
using System.Threading;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.Win32;
using Velopack;
using TrueReplayer.Services;

namespace TrueReplayer
{
    public static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            // Velopack must run before any WinUI/XAML initialization.
            // It handles install/uninstall/update hooks and exits early when
            // invoked by the updater (e.g. --velopack-install).
            VelopackApp.Build().Run();

            // Prevent multiple instances
            using var mutex = new Mutex(true, "TrueReplayer_SingleInstance_Mutex", out bool createdNew);
            if (!createdNew)
            {
                // Another instance is already running — bring it to focus and exit.
                //
                // MainWindowHandle alone was not enough, and the case it missed is the NORMAL one:
                // .NET only reports a VISIBLE top-level window there, while this app spends most of
                // its life hidden — the X button minimises to the tray by default, and autostart
                // opens hidden. So relaunching the exe did nothing whatsoever: no window, no
                // message, not even a log line. That matters because relaunching is the only way
                // back when the tray icon is gone (nothing re-registers it if Explorer restarts),
                // and without it the sole remedy is killing the process, which takes the automation
                // daemon down with it.
                var existing = Process.GetProcessesByName("TrueReplayer");
                foreach (var proc in existing)
                {
                    using (proc) // Process objects from GetProcessesByName own a native handle — dispose them
                    {
                        if (proc.Id == Environment.ProcessId) continue;
                        IntPtr hwnd = proc.MainWindowHandle;
                        if (hwnd == IntPtr.Zero) hwnd = FindTopLevelWindow(proc.Id);
                        if (hwnd == IntPtr.Zero) continue;
                        ShowWindow(hwnd, 9); // SW_RESTORE
                        SetForegroundWindow(hwnd);
                        // Route through the running instance's OWN restore path — the tray
                        // double-click its WndProc already handles — because a window that was
                        // hidden through the AppWindow API does not reliably come back from
                        // ShowWindow alone. The receiver opens this message to UIPI when it creates
                        // the tray icon, so it also arrives when that instance is elevated and this
                        // one is not (self-elevation happens after this gate).
                        PostMessage(hwnd, WM_USER_TRAY, IntPtr.Zero, (IntPtr)WM_LBUTTONDBLCLK);
                    }
                }
                return;
            }

            // Self-elevate if RunAsAdmin setting is enabled and not already elevated
            if (ShouldElevate())
            {
                try
                {
                    var exe = Environment.ProcessPath ?? Process.GetCurrentProcess().MainModule?.FileName;
                    if (exe != null)
                    {
                        // Forward command-line args (e.g. --startup) so the elevated process
                        // knows it was launched by OS autostart and should start minimized
                        var currentArgs = Environment.GetCommandLineArgs().Skip(1);
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exe,
                            Arguments = string.Join(" ", currentArgs),
                            UseShellExecute = true,
                            Verb = "runas"
                        });
                    }
                    return; // elevated instance launched — this one exits
                }
                catch (System.ComponentModel.Win32Exception wex) when (wex.NativeErrorCode == 1223)
                {
                    // User explicitly declined the UAC prompt. Honour that by exiting rather than
                    // silently running un-elevated when admin was requested.
                    return;
                }
                catch (Exception ex)
                {
                    // Elevation failed for a real reason (bad exe path, AppLocker/SRP policy, blocked
                    // binary) — don't vanish with no window and no message. Log it and fall through
                    // to run un-elevated so the user still gets a working app.
                    TrueReplayer.Services.DiagnosticLog.Error("[Elevation] self-elevate failed", ex);
                }
            }

            // Check WebView2 Runtime before initializing UI
            if (!IsWebView2Available())
            {
                NativeMessageBox(
                    "TrueReplayer requires Microsoft Edge WebView2 Runtime.\n\n" +
                    "Click OK to open the download page.\n" +
                    "After installing, restart TrueReplayer.",
                    "TrueReplayer — Missing Dependency");
                Process.Start(new ProcessStartInfo
                {
                    FileName = "https://developer.microsoft.com/en-us/microsoft-edge/webview2/",
                    UseShellExecute = true
                });
                return;
            }

            // Register Native Messaging Host for Chrome Extension
            RegisterNativeMessagingHost();

            // Always boot into a consistent "ready to replay" state: Macro mode + Profile Keys ON.
            // Neither Clicker mode nor a paused-Profile-Keys state is restored from a previous
            // session. Rationale: if the user launched TrueReplayer, they want to replay macros;
            // they can switch to Clicker or pause Profile Keys in-session, but neither carries
            // across launches. Normalize the PERSISTED flags here, at the entry point, BEFORE any
            // UI / tray icon / bridge reads them, so the tray icon and the window start consistent.
            // (Doing this later — e.g. in the bridge — left the tray icon, created earlier from the
            // file, stuck on the wrong state.)
            var startupSettings = AppSettingsManager.Load();
            if (startupSettings.UseCursorClick || !startupSettings.ProfileKeyEnabled)
            {
                startupSettings.UseCursorClick = false;
                startupSettings.ProfileKeyEnabled = true;
                AppSettingsManager.Save(startupSettings);
            }

            global::WinRT.ComWrappersSupport.InitializeComWrappers();
            Application.Start(p =>
            {
                var context = new DispatcherQueueSynchronizationContext(
                    DispatcherQueue.GetForCurrentThread());
                SynchronizationContext.SetSynchronizationContext(context);
                new App();
            });
        }

        private static bool ShouldElevate()
        {
            var settings = AppSettingsManager.Load();
            if (!settings.RunAsAdmin) return false;

            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return !principal.IsInRole(WindowsBuiltInRole.Administrator);
        }

        // The tray icon's callback message and the click it answers — kept in lockstep with
        // TrayIconService (uCallbackMessage = WM_USER + 1) and its WndProc.
        private const uint WM_USER_TRAY = 0x0400 + 1;
        private const int WM_LBUTTONDBLCLK = 0x0203;

        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

        /// <summary>
        /// The first unowned top-level window belonging to <paramref name="pid"/>, visible or not.
        /// This is the part MainWindowHandle cannot do: it filters to visible windows, which is
        /// exactly wrong for an app that lives in the tray.
        /// </summary>
        private static IntPtr FindTopLevelWindow(int pid)
        {
            const uint GW_OWNER = 4;
            IntPtr found = IntPtr.Zero;
            // Held in a local so the GC cannot collect the delegate while EnumWindows is calling it.
            EnumWindowsProc callback = (hwnd, _) =>
            {
                GetWindowThreadProcessId(hwnd, out uint owner);
                if (owner != (uint)pid) return true;
                // Skip tooltips, menus and other owned popups — the main window owns them, not the
                // other way round.
                if (GetWindow(hwnd, GW_OWNER) != IntPtr.Zero) return true;
                found = hwnd;
                return false;
            };
            EnumWindows(callback, IntPtr.Zero);
            return found;
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        private static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

        private static void NativeMessageBox(string text, string caption)
        {
            // MB_OK | MB_ICONWARNING = 0x00000030
            MessageBoxW(IntPtr.Zero, text, caption, 0x00000030);
        }

        private static bool IsWebView2Available()
        {
            try
            {
                var version = Microsoft.Web.WebView2.Core.CoreWebView2Environment.GetAvailableBrowserVersionString();
                return !string.IsNullOrEmpty(version);
            }
            catch
            {
                return false;
            }
        }

        private static void RegisterNativeMessagingHost()
        {
            try
            {
                string appDir = AppContext.BaseDirectory;
                string hostExe = Path.Combine(appDir, "TrueReplayer.NativeHost.exe");
                string manifestPath = Path.Combine(appDir, "native-messaging-manifest.json");

                if (!File.Exists(hostExe)) return;

                // Write the manifest file with the correct path
                string manifest = $$"""
                {
                  "name": "com.truereplayer.native",
                  "description": "TrueReplayer Native Messaging Host",
                  "path": "{{hostExe.Replace("\\", "\\\\")}}",
                  "type": "stdio",
                  "allowed_origins": ["chrome-extension://akbcjaimplfchfaeoedhgkebhjaeebko/"]
                }
                """;
                File.WriteAllText(manifestPath, manifest);

                // Register in Chrome's NativeMessagingHosts registry
                using var key = Registry.CurrentUser.CreateSubKey(
                    @"Software\Google\Chrome\NativeMessagingHosts\com.truereplayer.native");
                key?.SetValue("", manifestPath);

                // Also register for Edge (same Chromium base)
                using var edgeKey = Registry.CurrentUser.CreateSubKey(
                    @"Software\Microsoft\Edge\NativeMessagingHosts\com.truereplayer.native");
                edgeKey?.SetValue("", manifestPath);

                // Also register for Brave
                using var braveKey = Registry.CurrentUser.CreateSubKey(
                    @"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.truereplayer.native");
                braveKey?.SetValue("", manifestPath);
            }
            catch (Exception ex)
            {
                // Visible in release via the session log — a silent failure here means the browser
                // extension can't reach the app and the user has no clue why.
                TrueReplayer.Services.DiagnosticLog.Warn($"[NativeHost] Registry registration failed: {ex.Message}");
            }
        }
    }
}
