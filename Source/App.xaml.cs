using System;
using System.Linq;
using Microsoft.UI.Xaml;
using TrueReplayer.Models;
using TrueReplayer.Services;
using WinRT.Interop;

namespace TrueReplayer
{
    public sealed partial class App : Application
    {
        public App()
        {
            // Initialize the diagnostic log FIRST so any startup errors are captured — before
            // InitializeComponent too, which loads the compiled XAML resources and can throw on a
            // damaged install, the one failure that used to leave the log empty.
            var appVersion = typeof(App).Assembly.GetName().Version?.ToString() ?? "unknown";
            DiagnosticLog.Initialize(appVersion);

            this.InitializeComponent();
            DiagnosticLog.Info("App constructor: UnhandledException handler attached");

            // Record this session's elevation up-front. The 'admin target while TrueReplayer
            // isn't elevated' failure (hotkeys/replay silently no-op) is otherwise only
            // inferable after-the-fact from an OpenProcess error deep in the log.
            try
            {
                bool elevated = new System.Security.Principal.WindowsPrincipal(
                        System.Security.Principal.WindowsIdentity.GetCurrent())
                    .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator);
                DiagnosticLog.Info($"Process elevation: {(elevated ? "ADMIN (elevated)" : "standard (not elevated)")}");
            }
            catch (Exception ex) { DiagnosticLog.Warn($"Elevation check failed: {ex.Message}"); }

            // Prevent app termination from unhandled exceptions in async void handlers
            // (common in WebViewBridge profile/file I/O handlers). Log and continue —
            // individual operations may fail but the app stays responsive.
            this.UnhandledException += (_, e) =>
            {
                DiagnosticLog.Error("Application.UnhandledException", e.Exception);
                e.Handled = true;
            };

            // .NET unhandled exceptions (e.g., from fire-and-forget tasks before a dispatcher
            // catches them) — last-chance log before process terminates.
            AppDomain.CurrentDomain.UnhandledException += (_, e) =>
            {
                if (e.ExceptionObject is Exception ex)
                    DiagnosticLog.Error($"AppDomain.UnhandledException (terminating={e.IsTerminating})", ex);
                else
                    DiagnosticLog.Error($"AppDomain.UnhandledException (non-Exception object, terminating={e.IsTerminating})");
                // Written NOW, on this thread. The line above only queues, the drain thread wakes
                // up to a second later, and ProcessExit — the other flush — is not raised for an
                // unhandled exception: the line saying why the app died was the likeliest to be lost.
                DiagnosticLog.Flush();
            };

            System.Threading.Tasks.TaskScheduler.UnobservedTaskException += (_, e) =>
            {
                DiagnosticLog.Error("UnobservedTaskException", e.Exception);
                e.SetObserved();
            };
        }

        protected override void OnLaunched(Microsoft.UI.Xaml.LaunchActivatedEventArgs args)
        {
            m_window = new MainWindow();
            m_window.Activate();

            // Only minimize if launched by OS autostart via --startup flag,
            // not when the user opens the app manually.
            if (UserProfile.Current.StartMinimized && HasStartupFlag())
            {
                var hwnd = WindowNative.GetWindowHandle(m_window);
                var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(hwnd);
                Microsoft.UI.Windowing.AppWindow.GetFromWindowId(windowId).Hide();
                TrayIconService.ShowMinimizeBalloon();
            }
        }

        /// <summary>
        /// Checks if the app was launched with the --startup flag
        /// (added to the Run registry key by SetRunOnStartup).
        ///
        /// internal rather than private because the update restart has to ask it too: the flag is
        /// produced ONLY by the Run key, so a process that relaunches itself loses it and comes
        /// back with the window open — see UpdateService.
        /// </summary>
        internal static bool HasStartupFlag()
        {
            return Environment.GetCommandLineArgs()
                .Any(a => a.Equals("--startup", StringComparison.OrdinalIgnoreCase));
        }

        private Window? m_window;
    }
}
