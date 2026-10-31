using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using Microsoft.UI.Dispatching;
using Microsoft.Windows.AppLifecycle;
using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The tray's notices as Windows notifications with buttons (D8; the Tray board, "Avisos —
    /// notificações do Windows, com botões"): the legacy tray balloon did not show on Windows 11. They go
    /// out under the AUMID of the app's Start-menu shortcut (AppIdentity.Aumid), so they carry its name
    /// and icon. A button names an action and, when it is about a macro, the macro (OnInvoked, on the UI
    /// thread). A test run in a test house writes them to the log instead of showing them, and its
    /// script presses the buttons through notice:invoke.
    /// </summary>
    internal static class WindowsNotices
    {
        /// <summary>A click on a notification: the action ("open" for its body) and the macro, or "".</summary>
        public static Action<string, string>? OnInvoked { get; set; }

        private static DispatcherQueue? _ui;
        private static bool _registered;

        public static bool TestMode => CoexistenceGuard.Bypassed;

        /// <summary>From App.OnLaunched, before the window: a click arriving later finds the handler.</summary>
        public static void Register(DispatcherQueue ui)
        {
            _ui = ui;
            if (TestMode)
            {
                DiagnosticLog.Info("[Notice] test run: notifications go to the log, not to Windows");
                return;
            }
            try
            {
                var manager = AppNotificationManager.Default;
                manager.NotificationInvoked += (_, args) => Dispatch(args.Arguments);
                manager.Register();
                _registered = true;
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"[Notice] could not register for Windows notifications: {ex.Message}");
            }
        }

        /// <summary>The process was started by a click on one of its notifications (the app was closed).</summary>
        public static void HandleLaunchActivation()
        {
            if (TestMode) return;
            try
            {
                var args = AppInstance.GetCurrent().GetActivatedEventArgs();
                if (args.Kind == ExtendedActivationKind.AppNotification && args.Data is AppNotificationActivatedEventArgs clicked)
                    Dispatch(clicked.Arguments);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"[Notice] could not read the launch activation: {ex.Message}");
            }
        }

        /// <summary>
        /// Whether a notification would not reach the user now: notifications off for the app or for the
        /// user, or held back by Windows (a game in full screen, a presentation, do not disturb). The chime
        /// is what is left then.
        /// </summary>
        public static bool Silenced
        {
            get
            {
                if (TestMode) return false;
                try
                {
                    if (!_registered || AppNotificationManager.Default.Setting != AppNotificationSetting.Enabled) return true;
                    return SHQueryUserNotificationState(out int state) == 0 && state != QUNS_ACCEPTS_NOTIFICATIONS;
                }
                catch { return true; }
            }
        }

        /// <summary>
        /// Shows a notification: a title, a line, and buttons (label, action). <paramref name="about"/> is the
        /// macro the actions are about, or null. False when it could not be shown.
        /// </summary>
        public static bool Show(string title, string text, string? about, params (string Label, string Action)[] buttons)
        {
            string line = $"\"{title}\" · \"{text}\""
                + (buttons.Length > 0 ? $" [{string.Join(" | ", buttons.Select(b => $"{b.Label} → {b.Action}"))}]" : "")
                + (about != null ? $" about '{about}'" : "");
            if (TestMode)
            {
                DiagnosticLog.Info($"[Notice] (test run, not shown) {line}");
                return true;
            }
            if (!_registered) return false;
            try
            {
                var builder = new AppNotificationBuilder().AddArgument("action", "open").AddText(title).AddText(text);
                if (about != null) builder.AddArgument("name", about);
                foreach (var (label, action) in buttons)
                {
                    var button = new AppNotificationButton(label).AddArgument("action", action);
                    if (about != null) button.AddArgument("name", about);
                    builder.AddButton(button);
                }
                var notification = builder.BuildNotification();
                AppNotificationManager.Default.Show(notification);
                DiagnosticLog.Info($"[Notice] shown (id {notification.Id}): {line}");
                return notification.Id != 0;
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"[Notice] could not show {line}: {ex.Message}");
                return false;
            }
        }

        /// <summary>A test run's click on a button (notice:invoke): honoured only in a test run.</summary>
        public static void InvokeForTest(string action, string? name)
        {
            if (!TestMode) return;
            var arguments = new Dictionary<string, string> { ["action"] = action };
            if (!string.IsNullOrEmpty(name)) arguments["name"] = name;
            Dispatch(arguments);
        }

        /// <summary>Velopack's uninstall: the app's notification registration goes with it.</summary>
        public static void UnregisterAll()
        {
            try { AppNotificationManager.Default.UnregisterAll(); }
            catch { }
        }

        private static void Dispatch(IDictionary<string, string> arguments)
        {
            string action = arguments.TryGetValue("action", out var a) && !string.IsNullOrEmpty(a) ? a : "open";
            string name = arguments.TryGetValue("name", out var n) ? n ?? "" : "";
            DiagnosticLog.Info($"[Notice] clicked: {action}{(name.Length > 0 ? $" ('{name}')" : "")}");
            if (_ui == null || !_ui.TryEnqueue(() => OnInvoked?.Invoke(action, name)))
                OnInvoked?.Invoke(action, name);
        }

        private const int QUNS_ACCEPTS_NOTIFICATIONS = 5;
        [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int state);
    }
}
