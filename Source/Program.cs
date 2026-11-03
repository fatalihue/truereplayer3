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
            StartupClock.Mark("main");
            // Velopack must run before any WinUI/XAML initialization.
            // It handles install/uninstall/update hooks and exits early when
            // invoked by the updater (e.g. --velopack-install).
            VelopackApp.Build()
                .OnBeforeUninstallFastCallback(_ => RemoveSystemEntries())
                .Run();

            // A recovery relaunch: let the process that launched it finish dying first.
            WaitForPredecessor(args);

            // Prevent multiple instances. Null means another instance is running (and was asked
            // to show itself), so this one exits.
            using var mutex = ClaimSingleInstance();
            if (mutex == null) return;

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

            // The interface's language, straight from interface.json (plan of languages, §3.6): the
            // one-at-a-time dialog below speaks it.
            S.Resolve(InterfaceStore.PeekLanguage());

            // One of TrueReplayer 2 and 3 at a time (CoexistenceGuard): before any hook, hotkey,
            // automation or the extension's pipe exists. After the elevation step, so the dialog it
            // may show comes up once, in the process that stays.
            if (!CoexistenceGuard.Acquire(App.HasStartupFlag())) return;

            // The installed app's identity for the taskbar and its notifications (AppIdentity.Aumid), before
            // any window. A build run from anywhere else keeps its own.
            if (TrayIconService.IsInstalledLocation())
            {
                try { SetCurrentProcessExplicitAppUserModelID(AppIdentity.Aumid); }
                catch { /* the default identity still works; only the grouping and the notifications' name differ */ }
            }

            // An import from TrueReplayer 2 staged by the previous run is put in place now, before the
            // settings, the remaps or the library are read (Tr2Import).
            Tr2Import.FinishPending();

            // The interface's own choices (InterfaceStore), read now: an import may have just put a new
            // interface.json in place, and nothing has created the Profiles folder of a new data folder yet.
            InterfaceStore.Load();
            // Again, from what Load holds: an import may have brought another one.
            S.Resolve(InterfaceStore.Get(S.LanguageKey));

            // Check WebView2 Runtime before initializing UI
            if (!IsWebView2Available())
            {
                NativeMessageBox(
                    $"{AppIdentity.DisplayName} requires Microsoft Edge WebView2 Runtime.\n\n" +
                    "Click OK to open the download page.\n" +
                    $"After installing, restart {AppIdentity.DisplayName}.",
                    $"{AppIdentity.DisplayName} — Missing Dependency");
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
            StartupClock.Mark("ui");
            Application.Start(p =>
            {
                var context = new DispatcherQueueSynchronizationContext(
                    DispatcherQueue.GetForCurrentThread());
                SynchronizationContext.SetSynchronizationContext(context);
                // The WebView2's browser process starts now, alongside the app's XAML and the window,
                // instead of after them (D7). On this thread: the environment belongs to it.
                MainWindow.StartWebViewEnvironment();
                new App();
            });
        }

        /// <summary>Handed to a recovery relaunch by MainWindow.TryRestartProcess: "--wait-pid=&lt;pid&gt;".</summary>
        internal const string WaitForPidArg = "--wait-pid=";

        // A test run's carries its house (CoexistenceGuard.ForThisRun), so a test build never stands
        // in the way of the owner's TrueReplayer 3.
        private static readonly string InstanceMutexName = CoexistenceGuard.ForThisRun(AppIdentity.InstanceMutexName);

        /// <summary>
        /// Blocks (bounded) until the process named by <see cref="WaitForPidArg"/> has exited. The
        /// parent of a recovery relaunch still holds the instance mutex and the WebView2 data folder
        /// through its whole teardown, and a child that got there first either exited in silence (the
        /// mutex said "already running", then the parent left too — zero processes, no tray, no
        /// automations) or failed to start WebView2 on the parent's locked folder.
        /// </summary>
        private static void WaitForPredecessor(string[] args)
        {
            var arg = args.FirstOrDefault(a => a.StartsWith(WaitForPidArg, StringComparison.OrdinalIgnoreCase));
            if (arg == null || !int.TryParse(arg.AsSpan(WaitForPidArg.Length), out int pid) || pid == Environment.ProcessId)
                return;
            try
            {
                using var predecessor = Process.GetProcessById(pid);
                // A recycled pid belongs to someone else — nothing to wait for.
                if (!predecessor.ProcessName.Equals(AppIdentity.ProcessName, StringComparison.OrdinalIgnoreCase)) return;
                if (!predecessor.WaitForExit(15000))
                    DiagnosticLog.Warn($"[Startup] Predecessor {pid} still alive after 15 s; starting anyway.");
            }
            catch (ArgumentException) { /* already gone */ }
            catch (InvalidOperationException) { /* exited between the lookup and the wait */ }
            catch (System.ComponentModel.Win32Exception ex)
            {
                DiagnosticLog.Warn($"[Startup] Could not wait for predecessor {pid}: {ex.Message}");
            }
        }

        /// <summary>
        /// Takes the single-instance mutex, or asks the running instance to show itself and returns
        /// null. Retries for ~3 s because "another instance" is not always a settled one:
        ///   • it may still be BOOTING — it takes the mutex first thing and has a window only once
        ///     WinUI is up, so a second click on the shortcut (or autostart colliding with one)
        ///     found no window and exited without a trace;
        ///   • it may be DYING — then the mutex frees up on a later lap and this process becomes
        ///     the instance instead of leaving nobody running.
        /// </summary>
        private static Mutex? ClaimSingleInstance()
        {
            const int attempts = 10;
            for (int attempt = 1; attempt <= attempts; attempt++)
            {
                Mutex? mutex = null;
                bool createdNew;
                try
                {
                    mutex = new Mutex(true, InstanceMutexName, out createdNew);
                }
                catch (UnauthorizedAccessException)
                {
                    // The mutex exists and this token may not open it: an instance created it
                    // ELEVATED (RunAsAdmin), and an elevated creator's default DACL admits
                    // Administrators and SYSTEM only — which a non-elevated relaunch (a shortcut, the
                    // Run key) does not satisfy. It is still another instance; this used to be an
                    // unhandled exception that killed the relaunch before any handler or log existed.
                    createdNew = false;
                }
                if (createdNew) return mutex;
                mutex?.Dispose();

                if (SignalRunningInstance()) return null;
                if (attempt < attempts && AnotherInstanceAlive()) Thread.Sleep(300);
            }
            DiagnosticLog.Warn("[Startup] Another instance holds the single-instance mutex but never showed a window; exiting.");
            return null;
        }

        /// <summary>
        /// Brings a running instance to the front. True when some instance's window got the message.
        ///
        /// MainWindowHandle alone was not enough, and the case it missed is the NORMAL one: .NET
        /// only reports a VISIBLE top-level window there, while this app spends most of its life
        /// hidden — the X button minimises to the tray by default, and autostart opens hidden. So
        /// relaunching the exe did nothing whatsoever: no window, no message, not even a log line.
        /// That matters because relaunching is the only way back when the tray icon is gone, and
        /// without it the sole remedy is killing the process, which takes the automation daemon
        /// down with it.
        /// </summary>
        private static bool SignalRunningInstance()
        {
            bool signalled = false;
            foreach (var proc in Process.GetProcessesByName(AppIdentity.ProcessName))
            {
                using (proc) // Process objects from GetProcessesByName own a native handle — dispose them
                {
                    // TrueReplayer 2's exe has the same name, and a TrueReplayer 3 from a test house or
                    // another build is not this install: neither window is ours to restore.
                    if (proc.Id == Environment.ProcessId || !CoexistenceGuard.IsThisExe(proc.Id)) continue;
                    IntPtr hwnd = proc.MainWindowHandle;
                    if (hwnd == IntPtr.Zero) hwnd = CoexistenceGuard.FindMainWindow(proc.Id);
                    if (hwnd == IntPtr.Zero) continue;
                    ShowWindow(hwnd, 9); // SW_RESTORE
                    SetForegroundWindow(hwnd);
                    // Route through the running instance's OWN restore path — the tray
                    // double-click its WndProc already handles — because a window that was
                    // hidden through the AppWindow API does not reliably come back from
                    // ShowWindow alone. The receiver opens this message to UIPI when it creates
                    // the tray icon, so it also arrives when that instance is elevated and this
                    // one is not (self-elevation happens after this gate).
                    PostMessage(hwnd, (uint)CoexistenceGuard.TrayMessage, IntPtr.Zero, (IntPtr)CoexistenceGuard.WM_LBUTTONDBLCLK);
                    signalled = true;
                }
            }
            return signalled;
        }

        private static bool AnotherInstanceAlive()
        {
            bool alive = false;
            foreach (var proc in Process.GetProcessesByName(AppIdentity.ProcessName))
                using (proc) alive |= proc.Id != Environment.ProcessId && CoexistenceGuard.IsThisExe(proc.Id);
            return alive;
        }

        private static bool ShouldElevate()
        {
            var settings = AppSettingsManager.Load();
            if (!settings.RunAsAdmin) return false;

            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return !principal.IsInRole(WindowsBuiltInRole.Administrator);
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool PostMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

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
                  "description": "{{AppIdentity.DisplayName}} Native Messaging Host",
                  "path": "{{hostExe.Replace("\\", "\\\\")}}",
                  "type": "stdio",
                  "allowed_origins": ["chrome-extension://akbcjaimplfchfaeoedhgkebhjaeebko/"]
                }
                """;
                File.WriteAllText(manifestPath, manifest);

                // Chrome, Edge and Brave (same Chromium base) each keep their own registration.
                //
                // An INSTALLED copy always registers itself: it is the canonical host. A dev or
                // portable copy only fills a registration that is missing or dangling. Every boot of
                // a debug build used to repoint all three keys at its bin\ folder, so the installed
                // app's extension then launched a host from a folder the next rebuild or cleanup
                // removed — failing silently until the installed build ran again. That is the Run-key
                // hazard SetRunOnStartup guards with IsInstalledLocation, which never reached here.
                // Not a plain "installed only" guard: a portable copy with nothing else registered
                // would then have no extension at all. The host is a relay, so a copy running from
                // elsewhere is served just as well by the installed one's.
                bool installed = TrueReplayer.Services.TrayIconService.IsInstalledLocation();
                foreach (var subKey in NativeHostKeys)
                {
                    if (!installed && PointsAtWorkingHost(subKey)) continue;
                    using var key = Registry.CurrentUser.CreateSubKey(subKey);
                    key?.SetValue("", manifestPath);
                }
            }
            catch (Exception ex)
            {
                // Visible in release via the session log — a silent failure here means the browser
                // extension can't reach the app and the user has no clue why.
                TrueReplayer.Services.DiagnosticLog.Warn($"[NativeHost] Registry registration failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Uninstalling: what this app wrote outside its folders goes with it — its Run value, and the
        /// browser extension's host registration when it still points into this install. The host is
        /// shared with TrueReplayer 2 (the same name); left pointing here it would dangle, while
        /// removed, TrueReplayer 2 registers its own again the next time it opens. Velopack gives a
        /// fast callback 30 s and then exits the process, so this only deletes keys.
        /// </summary>
        [System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode, PreserveSig = false)]
        private static extern void SetCurrentProcessExplicitAppUserModelID(string appId);

        private static void RemoveSystemEntries()
        {
            // The notifications' registration (WindowsNotices), under the installed app's identity.
            try
            {
                SetCurrentProcessExplicitAppUserModelID(AppIdentity.Aumid);
                WindowsNotices.UnregisterAll();
            }
            catch { /* best effort: an uninstall must not fail on this */ }
            try
            {
                using var run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true);
                run?.DeleteValue(AppIdentity.RunValueName, false);
            }
            catch { /* best effort: an uninstall must not fail on this */ }
            foreach (var subKey in NativeHostKeys)
            {
                try
                {
                    using var key = Registry.CurrentUser.OpenSubKey(subKey);
                    if (key?.GetValue("") is not string manifest) continue;
                    if (!manifest.StartsWith(AppIdentity.LocalRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) continue;
                    key.Dispose();
                    Registry.CurrentUser.DeleteSubKeyTree(subKey, false);
                }
                catch { /* best effort */ }
            }
        }

        private static readonly string[] NativeHostKeys =
        {
            @"Software\Google\Chrome\NativeMessagingHosts\com.truereplayer.native",
            @"Software\Microsoft\Edge\NativeMessagingHosts\com.truereplayer.native",
            @"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\com.truereplayer.native",
        };

        // True when the key names a manifest that exists and whose "path" is a host exe that
        // exists — a registration a browser can actually use, whoever wrote it.
        private static bool PointsAtWorkingHost(string subKey)
        {
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(subKey);
                if (key?.GetValue("") is not string manifest || !File.Exists(manifest)) return false;
                using var doc = System.Text.Json.JsonDocument.Parse(File.ReadAllText(manifest));
                return doc.RootElement.TryGetProperty("path", out var path)
                    && path.ValueKind == System.Text.Json.JsonValueKind.String
                    && File.Exists(path.GetString());
            }
            catch
            {
                return false; // unreadable manifest = not a registration anything can use
            }
        }
    }
}
