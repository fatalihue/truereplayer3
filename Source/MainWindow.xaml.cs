using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System;
using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using TrueReplayer.Controllers;
using TrueReplayer.Interop;
using TrueReplayer.Models;
using TrueReplayer.Services;
using WinRT.Interop;

namespace TrueReplayer
{
    public sealed partial class MainWindow : Window
    {
        public ObservableCollection<ActionItem> Actions { get; } = new();

        private ActionRecorder actionRecorder;
        private ReplayService replayService;
        private RecordingService recordingService;
        private MainController mainController;
        private TriggerService triggerService = null!;
        // Last tray-tooltip inputs pushed — the automation state-change handler only
        // refreshes the (disk-reading) tray icon when these actually moved.
        private int _lastTrayArmedCount = -1;
        private bool _lastTrayAutomationEnabled = true;
        private ProfileController profileController;
        private WindowEventManager windowEventManager;
        private WebViewBridge? bridge;
        private readonly BrowserBridgeService browserBridge = new();
        private System.Threading.Timer? _uiReadyWatchdog;
        private int _uiReloadAttempts = 0;
        private const int MaxReloadAttempts = 5;
        // Recoveries spent on FAILED navigations, capped separately from the watchdog's. A dead
        // wwwroot (quarantined by AV, virtual-host mapping refused) fails every single time, and
        // RecoverWebView's level 3 restarts the process — which resets every counter, fails again
        // and restarts again, forever. Two is exactly RecoverWebView's Reload + Navigate: the two
        // levels that can plausibly fix a transient load failure. Past that we stop and tell the
        // user, because a process restart cannot conjure back missing files. UI-thread-only
        // (NavigationCompleted), so unlike _uiReloadAttempts it needs no marshalling.
        private int _navFailureRecoveries = 0;
        private const int MaxNavFailureRecoveries = 2;
        // Navigation target is stored on first init so recovery doesn't depend on
        // CoreWebView2.Source, which can return an empty string after the renderer crashes.
        private string _targetUrl = "";
        // The interface script's registration, until the first load has checked that the script ran.
        private Task? _interfaceScript;
        // Tracks how many recovery attempts happened since the last successful ui:ready.
        // If we exhaust levels 1 → 2 repeatedly, level 3 (process restart) is triggered.
        private int _consecutiveRecoveryAttempts = 0;

        // ---- ui:ready watchdog policy ------------------------------------------------------
        // This was a flat 5000 ms one-shot, and blowing it walked Reload → Navigate → process
        // restart in about fifteen seconds. A cold start can legitimately cost more than that:
        // the startup path builds the whole profile list (~81 files for a real user) and publishes
        // it on this same dispatcher, and the first run after an update is also the run where
        // antivirus scans the app-X.Y.Z folder Velopack just extracted. A merely slow machine was
        // being diagnosed as a hung one and killed mid-load — an app that "won't open".
        //
        // Two changes make the deadline honest rather than merely bigger:
        //   1. The FIRST ui:ready of a process gets a cold-start allowance. Every load after one
        //      has already succeeded is warm — WebView2 processes spawned, profiles in memory,
        //      files scanned — so it gets the short budget. 20 s is chosen against the cost of
        //      being wrong in each direction: too long means the user waits a few extra seconds
        //      for an automatic reload they never asked for; too short means we kill a load that
        //      was going to finish. Only the second one is unrecoverable, so we err long.
        //   2. Time in which OUR dispatcher was blocked does not count against the page. The
        //      timer ticks on the pool and marshals to the UI thread; the gap between the two is
        //      exactly how long the UI thread was unavailable, and during that gap WebView2's
        //      handshake message could not have been serviced anyway. Crediting it back is what
        //      makes this "fires when nothing is progressing" instead of "fires on a clock".
        //      (The profile reads themselves now run on the pool, so what lands on the dispatcher
        //      is the publish, the hook/daemon arming and the image sweep — fewer, chunkier lags
        //      than the old file-by-file yielding, and the generous base grace still covers them.)
        private const int WatchdogTickMs = 1000;
        private const int FirstLoadReadyGraceMs = 20000;
        private const int ReloadReadyGraceMs = 8000;
        // A tick that lands within half a period of when it fired means the UI thread was free;
        // anything beyond that is starvation and gets credited back, capped per tick so one
        // pathological stall can't buy an unbounded extension in a single step.
        private const int StarvationLagFloorMs = 500;
        private const int StarvationCreditPerTickMs = 3000;
        // Total credit ceiling per load. Past a minute of accumulated starvation the app is
        // broken in a way no reload fixes, and letting the ladder run gets the user to the
        // actionable dialog instead of to a window that waits forever in silence.
        private const int MaxStarvationCreditMs = 60000;
        private long _uiReadyDeadlineTicks = 0;
        private long _starvationCreditUsedMs = 0;
        // Bumped on every arm and every cancel. Timer.Dispose() cannot recall a tick that has
        // already marshalled itself onto the dispatcher, so without this stamp a watchdog that
        // fired microseconds before ui:ready would reload a UI that had just come up fine.
        private int _watchdogEpoch = 0;
        private bool _uiReadyEverReceived = false;

        // Opened exactly once, when the one-shot startup data load below finishes — on success,
        // on failure, and on the bridge-is-null bail alike. A gate that never opens is a UI that
        // never initialises, so every exit path of that lambda has to release it.
        // RunContinuationsAsynchronously so completing it can never run a waiter's work inline on
        // whichever thread happened to finish the load.
        private readonly TaskCompletionSource<bool> _initialDataLoaded =
            new(TaskCreationOptions.RunContinuationsAsynchronously);

        /// <summary>
        /// Completes when the startup data load has finished (or given up). Exists for the
        /// bridge's ui:ready handler: React sends ui:ready the instant it mounts, which on a cold
        /// start is well before the profile list exists, and state:init is a WHOLESALE reset of
        /// the frontend store — so a projection taken at that instant ships an empty sidebar, no
        /// hotkey chips and no automation badges as the app's first frame, corrected only by the
        /// profiles:updated push that lands afterwards. Gating the projection on this makes the
        /// first frame the real one. Already completed for every later ui:ready in the process,
        /// so a UI reload or a crash recovery sees no deferral at all.
        /// </summary>
        public Task InitialDataLoaded => _initialDataLoaded.Task;

        // Level 3 (process restart) is the one recovery step that outlives the process, so its
        // budget has to outlive the process too. Every counter above is an instance field the
        // replacement cannot see — which is exactly how a slow start became an endless relaunch
        // loop: restart, reset to zero, be slow again, restart again. The generation rides in on
        // the command line rather than in a marker file because it is scoped to the relaunch
        // chain by construction: a launch the user started themselves cannot inherit it, a crash
        // or a kill cannot leave one behind stale, and there is no disk write on the one code
        // path where the disk is already the prime suspect. Cleared on ui:ready — see
        // CancelUIWatchdog — so a renderer crash hours into a healthy session still gets the
        // full budget, restart included.
        //
        // One relaunch, because one is what a relaunch can actually fix: a wedged WebView2
        // user-data folder or a zombie renderer that survived Reload and Navigate. A second
        // relaunch has no new information to act on; it is just the loop.
        private const string RelaunchArgPrefix = "--ui-recovery-relaunch=";
        private const int MaxWatchdogRelaunches = 1;
        private int _uiRelaunchGeneration = ReadRelaunchGeneration();
        // Terminal state: the actionable dialog is shown once, not once per retry.
        private bool _uiRecoveryExhausted = false;

        private IntPtr hwnd;

        // Hotkey-routing prefixes emitted by InputHookManager and matched at every dispatch
        // site below. Named consts replace repeated magic strings so a rename can't silently
        // desync one branch from the rest of the routing.
        private const string ProfilePrefix = "PROFILE::";
        private const string ProfileHoldPrefix = "PROFILE_HOLD::";
        private const string ProfileTogglePrefix = "PROFILE_TOGGLE::";
        private const string ProfileStopPrefix = "PROFILE_STOP::";

        public MainWindow()
        {
            StartupClock.Mark("window");
            this.InitializeComponent();
            // The theme's canvas, not a fixed black, from the first frame: the window is shown by
            // Activate() long before the WebView2 has painted anything (it stays at Opacity 0 until
            // NavigationCompleted, and again during every recovery), so a light preset launched on
            // #0a0a0a and flashed to white. The boot mirror inside index.html cannot reach this far.
            ApplyWindowBackground(AppSettingsManager.Load().WindowBackground);
            // Before RemapService.Load and the input hooks below: every key name the app records
            // or resolves is read against THIS thread's layout, from whichever thread asks.
            Helpers.KeyUtils.BindUiThread();
            this.Title = AppIdentity.DisplayName;

            AppSettingsManager.ApplyGlobalSettings(UserProfile.Current);

            hwnd = WindowNative.GetWindowHandle(this);

            windowEventManager = new WindowEventManager(this);
            HwndHookManager.SetupHook(hwnd, windowEventManager.WndProc);
            windowEventManager.RegisterShellNotifications();
            // The compact view (rule 10 of the plan): the page switches its layout when the window does.
            windowEventManager.OnCompactChanged = (on, inset) => bridge?.SendMessage("window:compactChanged", new { compact = on, captionInset = inset });
            // A replayed click about to land on the compact window moves it to another corner first.
            // The replay runs off this thread: it waits (briefly) for the move before it clicks.
            ActionReplayer.BeforePointer = (x, y) =>
            {
                var manager = windowEventManager;
                if (manager == null || !manager.IsCompact) return;
                if (DispatcherQueue.HasThreadAccess) { manager.MoveCompactAwayFrom(x, y); return; }
                using var moved = new System.Threading.ManualResetEventSlim();
                if (DispatcherQueue.TryEnqueue(() => { try { manager.MoveCompactAwayFrom(x, y); } finally { moved.Set(); } }))
                    moved.Wait(300);
            };
            // Compact view while a macro runs: switching to another app during a run turns the window compact.
            this.Activated += (_, e) =>
            {
                if (e.WindowActivationState == WindowActivationState.Deactivated && mainController?.IsReplayInProgress() == true)
                    OnRunStatus("replaying");
            };

            TrayIconService.Initialize(this, hwnd);
            // Wired with the icon, not with the bridge: it needs neither, and when WebView2 fails
            // to start — the case where the log is the only diagnosis — the bridge never exists and
            // "Open Logs Folder" was a dead menu item.
            TrayIconService.OnOpenLogsFolder = OpenLogsFolder;
            // A click on one of the app's Windows notifications (WindowsNotices; D8).
            WindowsNotices.OnInvoked = OnNoticeClicked;

            string iconPath = Path.Combine(AppContext.BaseDirectory, AppIdentity.IconFile);
            // LR_LOADFROMFILE returns an HICON the window holds for its lifetime via WM_SETICON.
            // Not DestroyIcon'd: the OS reclaims per-process GDI handles on exit (each launch is a
            // fresh process), and a Closed-handler free would be preempted by WindowEventManager's
            // Environment.Exit anyway. Just guard a null handle and log a load failure.
            // One handle per slot, each at the size that slot is drawn at for this window's DPI.
            // With no size LoadImage takes the .ico's FIRST entry — 16×16 — so the taskbar and
            // Alt+Tab stretched a 16 px bitmap while the 24/32/48/256 entries sat unused.
            uint iconDpi = NativeMethods.GetDpiForWindowSafe(hwnd);
            IntPtr hSmallIcon = LoadImage(IntPtr.Zero, iconPath, 1,
                NativeMethods.GetSystemMetricsForDpi(NativeMethods.SM_CXSMICON, iconDpi),
                NativeMethods.GetSystemMetricsForDpi(NativeMethods.SM_CYSMICON, iconDpi), 0x00000010);
            IntPtr hBigIcon = LoadImage(IntPtr.Zero, iconPath, 1,
                NativeMethods.GetSystemMetricsForDpi(NativeMethods.SM_CXICON, iconDpi),
                NativeMethods.GetSystemMetricsForDpi(NativeMethods.SM_CYICON, iconDpi), 0x00000010);
            const int WM_SETICON = 0x80;
            if (hBigIcon != IntPtr.Zero) SendMessage(hwnd, WM_SETICON, (IntPtr)1, hBigIcon);
            if (hSmallIcon != IntPtr.Zero) SendMessage(hwnd, WM_SETICON, (IntPtr)0, hSmallIcon);
            if (hBigIcon == IntPtr.Zero || hSmallIcon == IntPtr.Zero)
            {
                Services.DiagnosticLog.Warn($"Window icon failed to load from '{iconPath}' — using default icon");
            }

            mainController = null!;

            // What to record and with which delay, as SAVED — until the bridge exists and takes
            // over. The global hotkeys arm in this constructor, well before WebView2 is up and the
            // bridge is built, and a recording started in that window used fixed defaults
            // (everything recorded, 100 ms) instead of the user's choices, then switched to them
            // mid-take once the bridge arrived.
            var bootSettings = AppSettingsManager.Load();

            actionRecorder = new ActionRecorder(
                Actions,
                () => mainController.GetDelay(),
                () => bridge?.UseCustomDelay ?? bootSettings.UseCustomDelay,
                () => mainController.ScrollToLastAction()
            );

            recordingService = new RecordingService(
                actionRecorder,
                () => bridge?.RecordMouse ?? bootSettings.RecordMouse,
                () => bridge?.RecordScroll ?? bootSettings.RecordScroll,
                () => bridge?.RecordKeyboard ?? bootSettings.RecordKeyboard,
                () => bridge?.RecordCombinedInput ?? bootSettings.RecordCombinedInput,
                time => mainController.SetLastActionTime(time),
                status => bridge?.PushStatusChange(status),
                (text, isActive) => bridge?.PushButtonStates()
            );

            browserBridge.Start();

            replayService = new ReplayService(
                Actions,
                DispatcherQueue,
                () => mainController.UpdateButtonStates(),
                status => bridge?.PushStatusChange(status),
                (text, isActive) => bridge?.PushButtonStates(),
                index => bridge?.PushActionHighlight(index),
                browserBridge
            );

            mainController = new MainController(
                Actions,
                actionRecorder,
                recordingService,
                replayService,
                () =>
                {
                    if (bridge == null) return bootSettings.UseCustomDelay ? bootSettings.CustomDelay : 100;
                    return bridge.UseCustomDelay && int.TryParse(bridge.CustomDelay, out int d) ? d : 100;
                },
                () => bridge?.PushButtonStates()
            );

            // ── Automation daemon ──
            // Constructed BEFORE ProfileController so the first profile-list load can arm
            // persisted triggers. Loops live on the thread pool; every fire marshals back
            // here (FireProfileFromTriggerAsync) where the busy gates are re-checked on the
            // UI thread — the dispatcher serializes them against hotkey dispatch.
            triggerService = new TriggerService(DispatcherQueue);
            triggerService.IsReplayActive = () => replayService.IsReplaying;
            triggerService.FireProfile = FireProfileFromTriggerAsync;
            triggerService.OnStateChanged = () => DispatcherQueue.TryEnqueue(() =>
            {
                bridge?.PushAutomationState();
                // Tray refresh re-reads appsettings.json + reloads the .ico from disk —
                // only worth it when the tooltip's armed-count line actually changed
                // (condition flips and fire-stat updates don't move it).
                int armed = triggerService.ConfiguredArmedCount;
                bool enabled = triggerService.GlobalEnabled;
                if (armed != _lastTrayArmedCount || enabled != _lastTrayAutomationEnabled)
                {
                    _lastTrayArmedCount = armed;
                    _lastTrayAutomationEnabled = enabled;
                    TrayIconService.UpdateTrayIcon();   // "N automations armed" tooltip line
                }
            });
            // A watcher that took itself out of service. Already on the dispatcher (the daemon
            // marshals it); held like the boot notices, since it can happen at an autostart boot.
            triggerService.OnNotice = message => bridge?.ShowNoticeWhenSeen(message);
            // The ctor's ApplyGlobalSettings (line above) ran before this instance existed —
            // seed the master switch now so a disabled-on-disk setting is honored before the
            // first profile-list load can arm anything.
            triggerService.SetGlobalEnabled(AppSettingsManager.Load().AutomationEnabled);

            // The window's size, place and title bar (WindowAppearanceService.Configure) come from App, just
            // before it is shown: the title bar alone costs ~120 ms on this thread, and App lets the WebView2's
            // controller be asked for first, so the two overlap (D7).

            // Key remap layer — loaded BEFORE the hooks start so remaps are live from the
            // first keystroke, independent of WebView2 (which may never come up in
            // tray-daemon usage). The bridge only edits + republishes.
            RemapService.Load();

            // Run cursors (data-loop row position, SetVariable cycle position) — loaded here for
            // the same reason as the remaps: an automation or a hotkey can fire a replay long
            // before WebView2 is up, and it must resume where the last session stopped rather than
            // silently restarting the list.
            RunCursorService.Load();
            // Automation fire history — restored BEFORE the first Reload, because the interval
            // loop anchors its first tick to LastFiredAt: without this the countdown restarts on
            // every launch, and a long interval on a machine rebooted nightly never comes due.
            triggerService.LoadStats();

            SetupInputHooks();

            mainController.UpdateButtonStates();

            profileController = new ProfileController(this);

            // ── Profile chaining wiring ──
            // Sub-profile resolver: RunProfile actions look up other profiles by name.
            replayService.SetProfileLookup(name => profileController.LoadProfileByNameAsync(name));
            // Folder-inherited context resolver: when a sub-profile has no target of its own,
            // HandleRunProfile needs the folder's target/flags/geometry so the sub actually
            // switches into that context instead of running against the caller's window.
            replayService.SetFolderInheritedContextLookup(name => profileController.GetFolderInheritedContext(name));
            // Chain-status callback: keeps the status bar's "Running A → B" display in sync.
            replayService.SetChainChangedCallback(stack =>
            {
                bridge?.PushReplayChainUpdate(stack);
            });
            // Chain step counter — the "(4/11)" tail on that same read-out. Separate push from
            // the stack above because it arrives ~4×/s (throttled at the engine) and lands in a
            // different React reducer; see PushReplayChainStep.
            replayService.OnChainStep = (current, total) =>
            {
                bridge?.PushReplayChainStep(current, total);
            };

            // ── Pause action wiring ──
            // ExecutePause raises these events; the bridge pushes them to React so the status
            // bar shows "PAUSED — Press F4 or wait Ns" with a manual Resume button.
            replayService.OnReplayPaused += (hotkey, timeoutMs) =>
            {
                bridge?.PushReplayPaused(hotkey, timeoutMs);
            };
            replayService.OnReplayResumed += () =>
            {
                bridge?.PushReplayResumed();
            };
            // {input:Label} Ask-Input modal — the resolver raises these; the bridge shows / hides the
            // prompt in React, and replay:inputResult routes the answer back to ReplayService.
            replayService.OnInputRequested += (requestId, label, menu) =>
            {
                // Surface the app so the prompt is actually visible — otherwise a minimized/behind
                // TrueReplayer shows the input modal where nobody can see it. Best-effort, and a
                // no-op (skips the activation dance) when the window is already in front.
                _ = SurfaceAppForInputAsync();
                bridge?.PushInputRequest(requestId, label, menu);
            };
            replayService.OnInputDismissed += (requestId) =>
            {
                bridge?.PushInputDismiss(requestId);
            };
            // Live-variables pane — the replayer raises snapshots (already dispatcher-marshalled
            // with copied dictionaries); the bridge forwards them as replay:variables.
            replayService.OnVariablesChanged += (vars, slots, rowData) =>
            {
                bridge?.PushVariablesUpdate(vars, slots, rowData);
            };

            // Clicker v2 — forward click stats (count + elapsedMs) to the React StatusBar so
            // the user sees "Clicked 1,234 · 8.3/s · 02:14" live during Clicker runs. Throttled
            // to ~4 Hz inside ToggleCursorClickReplay so this isn't called every click.
            replayService.OnClickerStats = (count, elapsedMs, capMs) =>
            {
                bridge?.PushClickerStats(count, elapsedMs, capMs);
                TrayIconService.SetClickerCount(count);
            };
            // Button-start countdown ticks and the end-of-run reason — both dashboard-only
            // signals, same channel discipline as the stats (a handful of messages per run).
            replayService.OnClickerCountdown = remainingMs =>
            {
                bridge?.PushClickerCountdown(remainingMs);
            };
            replayService.OnClickerEnded = (reason, blocked) =>
            {
                bridge?.PushClickerEnded(reason, blocked);
            };
            replayService.OnClickerWarning = code =>
            {
                bridge?.PushClickerWarning(code);
            };

            // Macro loop counter — forward "Loop X/Y" progress for looping replays. Same
            // throttle story as OnClickerStats; only fires on multi-iteration or infinite
            // runs, so a single-shot macro never triggers this path.
            replayService.OnLoopProgress = (current, total) =>
            {
                bridge?.PushLoopProgress(current, total);
                // The tray's tooltip says it too: "Replaying Trade Roblox, loop 2 of 3".
                TrayIconService.SetLoopProgress(current, total);
            };

            // Data-list lap notice (cursor mode) — the bridge arms it here and presents it
            // when the run's own end-of-run cue fires, so the chime/balloon arrive together
            // with the "run finished" signal instead of racing it.
            replayService.OnDataLapCompleted = rows =>
            {
                bridge?.ArmDataLapNotice(rows);
            };

            // Row-cursor marker (cursor mode). Pushed straight through rather than armed for the
            // end-of-run cue like the lap notice above: this is not a notification, it is the Data
            // panel's marker following the run that just consumed a row, and it should move when
            // the row is consumed.
            replayService.OnRowCursorChanged = row =>
            {
                bridge?.PushRowCursor(row);
            };

            // Replay pre-flight: the run needs the Chrome extension and the bridge is down.
            // Straight to the toast rather than through the run-end cue the lap notice waits
            // for — this is worth acting on NOW, not when the run finishes.
            replayService.OnBrowserExtensionMissing = rows =>
            {
                bridge?.PushBrowserExtensionMissing(rows);
            };

            // End-of-run tally ("N row(s) skipped after errors"). Straight to the toast, like the
            // pre-flight notice above: it is information about the run that just ended, and it
            // must not travel through the error channel, which decides the run's outcome.
            replayService.OnRunSummary = text =>
            {
                bridge?.PushRunSummary(text);
            };

            this.Closed += (_, _) =>
            {
                Services.DiagnosticLog.Info("Window closing — disposing bridge and controllers");
                // Bump before disposing: Dispose can't recall a tick already queued to the
                // dispatcher, and a watchdog escalation firing mid-shutdown could reach level 3
                // and Process.Start a replacement for a window the user just closed.
                _watchdogEpoch++;
                _uiReadyWatchdog?.Dispose();
                _uiReadyWatchdog = null;
                bridge?.Dispose();
                profileController.Dispose();
            };

            StartupClock.Mark("window built");
            InitializeWebView();
        }

        // Done once InitializeWebView has asked for the WebView2's controller, or given up: App shows the
        // window after it, so the title bar's ~120 ms run while the controller is made (D7).
        private readonly TaskCompletionSource _webViewStarted = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public Task WebViewStarted => _webViewStarted.Task;

        // The WebView2 environment asked for at the start of the UI thread (Program), before the app's
        // XAML and this window exist, so its browser process starts in parallel with them (D7). The
        // first InitializeWebView takes it; a retry asks again.
        private static Task<Microsoft.Web.WebView2.Core.CoreWebView2Environment>? _earlyEnvironment;

        /// <summary>Starts creating the WebView2 environment; never throws (InitializeWebView retries).</summary>
        public static void StartWebViewEnvironment()
        {
            try
            {
                _earlyEnvironment = CreateWebViewEnvironmentAsync();
                StartupClock.Mark("env asked");
            }
            catch { _earlyEnvironment = null; }
        }

        private static Task<Microsoft.Web.WebView2.Core.CoreWebView2Environment> CreateWebViewEnvironmentAsync()
        {
            // Pin the WebView2 UserDataFolder to a stable location OUTSIDE Velopack's
            // versioned app directory. The default location is adjacent to the executable,
            // which the Velopack updater discards when it swaps in a new version directory —
            // taking the theme, SendText snippets, and any other localStorage with it. Pinning
            // to LocalAppData means the data survives every update. (TrueReplayer 2 still
            // migrates a folder left there by versions before 2.2.1; this app has none.)
            var userDataFolder = Path.Combine(AppIdentity.LocalRoot, "WebView2");
            // WebView2 makes a missing folder itself; one it cannot use fails the creation below, which
            // InitializeWebView retries and reports (this may run before the log exists).
            try { Directory.CreateDirectory(userDataFolder); } catch { }
            var envOptions = new Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions
            {
                // The eyedropper inside Chromium's colour popup (an <input type="color">'s) needs a
                // picker the browser shell draws, and WebView2 has none: the button did nothing.
                // Off, the popup shows no eyedropper; the theme editor's rows carry the app's own
                // pick (pixel:pickColor) beside their swatch.
                AdditionalBrowserArguments = "--disable-features=EyeDropper",
            };
            // CreateWithOptionsAsync is the WinRT projection's name for the 3-arg factory
            // (the net462 dll exposes plain CreateAsync, but the .NET 8 WinMD-backed
            // projection renamed it with the "WithOptions" suffix per WinRT convention).
            return Microsoft.Web.WebView2.Core.CoreWebView2Environment.CreateWithOptionsAsync(null, userDataFolder, envOptions).AsTask();
        }

        // The interface's own choices (InterfaceStore): filled into localStorage from
        // Documents\TrueReplayer3\interface.json before the page's first script — the boot mirror in
        // index.html paints the saved theme from there before React loads — and every later write of
        // them sent back to the file. An import from TrueReplayer 2 arrives the same way. Never throws.
        private async Task RegisterInterfaceScriptAsync()
        {
            try { await WebView.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(Services.InterfaceStore.DocumentScript()); }
            catch (Exception ex) { Services.DiagnosticLog.Warn($"[Interface] could not hand interface.json to the page: {ex.Message}"); }
        }

        // The registration is not awaited before the first navigation: at startup it takes ~50 ms,
        // which sat in front of the page (C2 slice). WebView2 promises the script only to pages that
        // start after the registration completes, so the first load checks that it ran, and loads the
        // page once more if it did not.
        private async Task EnsureInterfaceScriptRanAsync(Task registration)
        {
            await registration;
            try
            {
                if (await WebView.CoreWebView2.ExecuteScriptAsync("window.__trInterface === true") == "true") return;
                Services.DiagnosticLog.Warn("[Interface] the first page loaded before its script was in place — loading it again");
                WebView.CoreWebView2.Reload();
            }
            catch (Exception ex) { Services.DiagnosticLog.Warn($"[Interface] could not check the page's script: {ex.Message}"); }
        }

        private async void InitializeWebView()
        {
            // Creating the WebView2 environment can fail hard (Edge WebView2 Runtime missing or
            // corrupt, user-data folder locked). The global UnhandledException handler keeps the
            // process alive, but every recovery affordance below (tray Reload UI, ProcessFailed,
            // watchdog) is wired AFTER this await — so a failure here would otherwise leave a
            // silent blank window with no way back. Surface an actionable message and bail.
            //
            // Retried before that message, because not every failure here is the runtime. The
            // user-data folder is shared by every process of this app, and a recovery relaunch or a
            // post-update restart can reach this point while the previous process's msedgewebview2
            // children are still letting go of it — a lock that clears by itself a moment later,
            // which the message used to diagnose as a runtime to reinstall.
            const int envAttempts = 3;
            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    // The first attempt takes the environment started with the UI thread, when there is one.
                    var early = attempt == 1 ? _earlyEnvironment : null;
                    _earlyEnvironment = null;
                    var env = await (early ?? CreateWebViewEnvironmentAsync());
                    StartupClock.Mark("env");
                    var controller = WebView.EnsureCoreWebView2Async(env);
                    _webViewStarted.TrySetResult();
                    await controller;
                    StartupClock.Mark("controller");
                    break;
                }
                catch (Exception ex) when (attempt < envAttempts)
                {
                    Services.DiagnosticLog.Warn($"InitializeWebView: WebView2 environment creation failed (attempt {attempt}/{envAttempts}), retrying: {ex.GetType().Name}: {ex.Message}");
                    _webViewStarted.TrySetResult();   // the window shows while this retries
                    await Task.Delay(1500);
                }
                catch (Exception ex)
                {
                    Services.DiagnosticLog.Error("InitializeWebView: WebView2 environment creation failed", ex);
                    _webViewStarted.TrySetResult();
                    NativeMethods.MessageBoxW(hwnd,
                        $"{AppIdentity.DisplayName} couldn't start its UI because the Microsoft Edge WebView2 Runtime " +
                        $"failed to initialize.\n\nInstall or repair the WebView2 Runtime, then restart {AppIdentity.DisplayName}.",
                        AppIdentity.DisplayName, NativeMethods.MB_ICONERROR);
                    // The rest of the tray menu is wired only with the bridge, which will never
                    // exist. "Reload UI" becomes the restart the message asks for, so a repaired
                    // runtime is one click away (Open Logs Folder is already wired, and Exit never
                    // needed a handler).
                    TrayIconService.OnReloadUI = TryRestartProcess;
                    // No load will ever run from here, so nothing else would open the gate. Releasing
                    // it on a path where the UI is already dead costs nothing and keeps the invariant
                    // whole: InitialDataLoaded always completes.
                    _initialDataLoaded.TrySetResult(true);
                    return;
                }
            }

            // Everything past the env-creation await wires up the bridge, tray callbacks,
            // ProcessFailed/NavigationCompleted recovery and navigation. In an async void method
            // any throw here escapes only to the global handler, which keeps the process alive but
            // leaves the UI half-wired with no recovery affordance. Guard the whole block so a
            // failure surfaces the same actionable message as the env-creation failure above.
            try
            {
            // Create bridge and register message handler BEFORE navigation
            // to ensure no messages from React are missed
            bridge = new WebViewBridge(
                WebView.CoreWebView2,
                Actions,
                mainController,
                profileController,
                recordingService,
                replayService,
                DispatcherQueue,
                this,
                browserBridge);

            replayService.SetProfileNameProvider(() => bridge.CurrentProfileName != "No Profile" ? bridge.CurrentProfileName : "default");

            WebView.CoreWebView2.Settings.IsZoomControlEnabled = false;

            // Block browser-like keys (F3=Find, F5=Refresh, F7=Caret, F12=DevTools)
            WebView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;

            // Suppress WebView2's built-in permission prompts. The WebView hosts ONLY our own
            // trusted local UI, so any permission request necessarily comes from the app's own
            // code. ClipboardRead is auto-granted because the "paste" buttons (Sheet coords,
            // theme import) call navigator.clipboard.readText() on an explicit user click —
            // without this, WebView2 shows its native "allow clipboard?" dialog the first time
            // and remembers the choice (a stray Block then silently breaks paste). Every other
            // permission kind (camera, mic, geolocation, notifications, file access, …) is
            // denied: the app uses none of them, and handling the event guarantees NO permission
            // prompt of any kind ever surfaces. Note: this does not affect downloads (theme
            // export) — those are a separate DownloadStarting flow and remain as normal feedback.
            WebView.CoreWebView2.PermissionRequested += (s, e) =>
            {
                e.State = e.PermissionKind == Microsoft.Web.WebView2.Core.CoreWebView2PermissionKind.ClipboardRead
                    ? Microsoft.Web.WebView2.Core.CoreWebView2PermissionState.Allow
                    : Microsoft.Web.WebView2.Core.CoreWebView2PermissionState.Deny;
                e.Handled = true;
            };

            WebView.CoreWebView2.WebMessageReceived += (s, e) =>
            {
                // A file dropped on the first-run screen rides along with its message as a
                // CoreWebView2File (postMessageWithAdditionalObjects): its path is what the import reads.
                string? droppedFile = null;
                if (e.AdditionalObjects is { Count: > 0 } extra)
                    foreach (var item in extra)
                        if (item is Microsoft.Web.WebView2.Core.CoreWebView2File file) { droppedFile = file.Path; break; }
                bridge.HandleMessage(e.WebMessageAsJson, droppedFile);
            };

            // Wire up unsaved changes guard for window close and tray exit
            windowEventManager.OnCloseRequested = HandleCloseGuardAsync;
            // The notices held while the window was hidden go out once it is on screen. Enqueued:
            // this runs inside the window procedure, before the show has finished.
            windowEventManager.OnShown = () => DispatcherQueue.TryEnqueue(() => bridge?.FlushPendingNotices());
            // Rule 12 of the plan: hidden in the tray, the page stops drawing and the WebView2 aims low.
            windowEventManager.OnVisibilityChanged = SetPageVisible;
            TrayIconService.OnTrayExitRequested = HandleCloseGuardAsync;
            TrayIconService.OnTraySettingChanged = () =>
            {
                DispatcherQueue.TryEnqueue(() => bridge.PushSettingsLoaded());
            };
            // ── The tray's menu (Tray board, "Clique direito") ──
            TrayIconService.CurrentMacro = () =>
                bridge?.CurrentProfileName is { Length: > 0 } open && open != "No Profile" ? open : null;
            TrayIconService.OnOpenWindow = () => DispatcherQueue.TryEnqueue(() => windowEventManager?.BringToForeground());
            // Stop does what the hotkey that stops it does: the recording toggles off, a run stops.
            TrayIconService.OnStopRun = () => DispatcherQueue.TryEnqueue(() =>
            {
                if (mainController.IsRecording()) mainController.ToggleRecording();
                else mainController.StopReplayIfRunning();
            });
            // The page makes the macro and starts recording once the engine opens it, as the first use's
            // Record it does; the window stays where it is, since the task is in another app.
            TrayIconService.OnRecordNew = () => DispatcherQueue.TryEnqueue(() => bridge?.SendMessage("tray:command", new { command = "recordNew" }));
            TrayIconService.OnToggleShortcuts = () => DispatcherQueue.TryEnqueue(() => SetShortcutsEnabled(!UserProfile.Current.ProfileKeyEnabled, "the tray"));
            TrayIconService.OnOpenClicker = () => DispatcherQueue.TryEnqueue(() =>
            {
                if (bridge?.UseCursorClick == false) TrayIconService.OnSetMode?.Invoke(true);
                windowEventManager?.BringToForeground();
            });
            TrayIconService.OnOpenSettings = () => DispatcherQueue.TryEnqueue(() =>
            {
                windowEventManager?.BringToForeground();
                bridge?.SendMessage("tray:command", new { command = "settings" });
            });
            // The close guard asks only about an editor's unapplied work, or about pending changes it
            // cannot save as you go: only then does Quit show the window. Saving as you go, it asks the
            // page for the editors' work first and shows the window itself if a question is left.
            TrayIconService.QuitNeedsWindow = () => bridge is not { AutoSaveEnabled: true }
                && (Services.AutomationGuard.HeldEditors().Count > 0 || (bridge != null && (bridge.HasUnsavedLoopChange || bridge.HasUnsavedActionWork)));
            // ── The tray panel (Tray board, "A bandeja — um clique abre o painel") ──
            TrayPanel.Read = BuildTrayPanelSnapshot;
            TrayPanel.OnOpenWindow = () => windowEventManager?.BringToForeground();
            // The card's button: Stop while something runs, else Replay of the open macro (as its key).
            TrayPanel.OnMacroAction = () =>
            {
                if (mainController.IsRecording() || mainController.IsReplayInProgress()) TrayIconService.OnStopRun?.Invoke();
                else bridge?.ToggleReplayFromTray();
            };
            TrayPanel.OnRunMacro = RunMacroFromTray;
            TrayPanel.OnAllMacros = () =>
            {
                windowEventManager?.BringToForeground();
                bridge?.SendMessage("tray:command", new { command = "macros" });
            };
            TrayPanel.OnSetShortcuts = on => SetShortcutsEnabled(on, "the tray panel");
            TrayPanel.OnSetAutomations = on => { if (on != AppSettingsManager.Load().AutomationEnabled) TrayIconService.OnToggleAutomations?.Invoke(); };
            TrayPanel.OnSetRemaps = on =>
            {
                RemapService.SetEnabled(on);
                bridge?.PushSettingsLoaded();
                TrayIconService.UpdateTrayIcon();
            };
            TrayPanel.OnOpenClicker = () => TrayIconService.OnOpenClicker?.Invoke();
            TrayPanel.OnOpenSettings = () => TrayIconService.OnOpenSettings?.Invoke();
            TrayPanel.OnQuit = () => _ = TrayIconService.QuitAsync();
            TrayPanel.OnClearNotices = () => bridge?.ClearPendingNotices();
            // Macro/Clicker switch from the tray — same path as the ScrollLock hotkey
            // and the in-app toggle: flip+cancel via SetCursorClickMode, persist, push
            // to React, refresh the tray icon/tooltip.
            TrayIconService.OnSetMode = (useClicker) =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    if (bridge == null) return;
                    bridge.SetCursorClickMode(useClicker);
                    var saved = AppSettingsManager.Load();
                    saved.UseCursorClick = bridge.UseCursorClick;
                    AppSettingsManager.Save(saved);
                    bridge.PushSettingsLoaded();
                    // Mode drives the Replay/Click button's enabled-state + label, which live in
                    // the separate 'button:states' message — without this the button stays
                    // disabled/mislabeled until some later event refreshes it (matches the
                    // in-app settings:change handler, which calls this for useCursorClick).
                    bridge.PushButtonStates();
                    TrayIconService.UpdateTrayIcon();
                });
            };
            TrayIconService.OnReloadUI = () =>
            {
                // User-initiated recovery from the tray. Start at level 1 by default, but if
                // the UI is already in an attempting-recovery state (black screen), escalate.
                RecoverWebView("tray Reload UI");
            };

            // ── Automation tray items ──
            TrayIconService.OnOpenAutomations = () =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    windowEventManager?.BringToForeground();
                    bridge?.SendMessage("automation:open", new { });
                });
            };
            TrayIconService.OnOpenExtensionHelp = () =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    windowEventManager?.BringToForeground();
                    bridge?.SendMessage("extension:openHelp", new { });
                });
            };
            // TrueReplayer 2 was launched while this app runs (CoexistenceGuard): the page asks
            // whether to switch. Raised from the window procedure, so already on this thread.
            CoexistenceGuard.Tr2Knocked = () =>
            {
                windowEventManager?.BringToForeground();
                bridge?.SendMessage("coexist:tr2Knocked", new { tr2Installed = CoexistenceGuard.Tr2Installed });
            };
            TrayIconService.OnToggleAutomations = () =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    // Persist immediately — ApplyGlobalSettings re-reads appsettings.json on
                    // every profile-hotkey activation, so a runtime-only flip would silently
                    // auto-revert (the ProfileKeyToggle hotkey learned this the hard way).
                    var saved = AppSettingsManager.Load();
                    saved.AutomationEnabled = !saved.AutomationEnabled;
                    AppSettingsManager.Save(saved);
                    UserProfile.Current.AutomationEnabled = saved.AutomationEnabled;
                    triggerService.SetGlobalEnabled(saved.AutomationEnabled);
                    bridge?.PushSettingsLoaded();
                    bridge?.PushAutomationState();
                    TrayIconService.UpdateTrayIcon();
                });
            };

            TrayIconService.OnOpenDevTools = () =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    try
                    {
                        WebView?.CoreWebView2?.OpenDevToolsWindow();
                    }
                    catch (Exception ex)
                    {
                        Services.DiagnosticLog.Error("OpenDevTools failed", ex);
                    }
                });
            };

            // (OnOpenLogsFolder is wired in the constructor, with the tray icon.)

            // Recover from any WebView2 process failure — renderer exit, unresponsive renderer,
            // GPU crash, etc. We do NOT try to recover from BrowserProcessExited because that
            // means the entire WebView2 runtime died; Reload/Navigate won't help, we'd need a
            // full process restart, which RecoverWebView handles at level 3.
            WebView.CoreWebView2.ProcessFailed += (s, e) =>
            {
                Services.DiagnosticLog.Warn($"WebView2 ProcessFailed: Kind={e.ProcessFailedKind}, Reason={e.Reason}, ExitCode={e.ExitCode}, ProcessDescription={e.ProcessDescription}");
                RecoverWebView($"ProcessFailed:{e.ProcessFailedKind}");
            };

            // Reveal WebView and push state after page load (covers initial load + crash recovery)
            WebView.CoreWebView2.NavigationCompleted += (s, e) =>
            {
                // Frontend mount is fresh — zero out any hotkey-capture owner IDs left over
                // from the previous mount (refcount slots are tied to React refs / dialog
                // instances, both gone after navigation). Without this, a reload during an
                // active capture would leave immortal owners that keep the hook armed forever.
                // Runs before the failure guard below: a failed navigation replaced the old
                // document with an error page, so those owners are just as gone.
                InputHookManager.ClearAllCaptures();

                // A FAILED navigation used to fall straight through to Opacity = 1 while the
                // watchdog — the only thing that calls RecoverWebView from here — was armed
                // inside the success branch only. The user was shown WebView2's blank error page
                // and nothing ever tried again: no reload, no navigate, no log line naming the
                // cause. Recover instead, and keep the WebView hidden while we do, so a dead page
                // is never what gets revealed.
                if (!e.IsSuccess)
                {
                    Services.DiagnosticLog.Error(
                        $"Navigation to '{_targetUrl}' failed: {e.WebErrorStatus} " +
                        $"(recovery {_navFailureRecoveries + 1}/{MaxNavFailureRecoveries})");

                    if (_navFailureRecoveries >= MaxNavFailureRecoveries)
                    {
                        // Out of attempts: this install is broken, not glitching. Reveal the
                        // error page — a visible failure the user can screenshot beats a blank
                        // window — and say what to do about it.
                        Services.DiagnosticLog.Error("Navigation recovery exhausted — leaving the error page visible");
                        WebView.Opacity = 1;
                        NativeMethods.MessageBoxW(hwnd,
                            $"{AppIdentity.DisplayName} couldn't load its UI files.\n\nThey may have been removed or " +
                            $"quarantined by antivirus. Reinstall or repair {AppIdentity.DisplayName}, and allow-list " +
                            "its install folder if your antivirus flagged it.",
                            AppIdentity.DisplayName, NativeMethods.MB_ICONERROR);
                        return;
                    }

                    _navFailureRecoveries++;
                    RecoverWebView($"navigation failed: {e.WebErrorStatus}");
                    return;
                }

                // The page loaded — the install is intact, so a LATER transient failure gets a
                // fresh budget rather than inheriting this run's spent attempts.
                _navFailureRecoveries = 0;
                WebView.Opacity = 1;
                StartupClock.Write("loaded");
                // Loaded while the window is hidden (an autostart into the tray, a recovery there): the
                // page starts out not drawing, as a hide would have left it.
                if (!NativeMethods.IsWindowVisible(hwnd)) SetPageVisible(false);
                if (_interfaceScript is { } registration)
                {
                    _interfaceScript = null;
                    _ = EnsureInterfaceScriptRanAsync(registration);
                }
                if (bridge != null)
                {
                    DispatcherQueue.TryEnqueue(() =>
                    {
                        bridge.PushFullState();
                    });

                    // Start the ui:ready watchdog: if the UI doesn't report in before its
                    // deadline, escalate via the shared recovery path (Reload → Navigate →
                    // one process restart → actionable dialog).
                    ArmUIReadyWatchdog();
                }
            };

            // Handed over now and checked after the first load (EnsureInterfaceScriptRanAsync).
            _interfaceScript = RegisterInterfaceScriptAsync();

#if DEBUG
            WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            _targetUrl = "http://localhost:5173";
            StartupClock.Mark("navigate");
            WebView.CoreWebView2.Navigate(_targetUrl);
#else
            // DevTools enabled so the "Open DevTools" tray item works in Release too.
            // F12 remains blocked (AreBrowserAcceleratorKeysEnabled = false above) — the only
            // way to open DevTools is via the tray menu, which keeps it out of games' way.
            WebView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;

            // Use virtual host mapping instead of file:// to avoid CORS issues with CSS/JS
            string wwwrootPath = Path.Combine(AppContext.BaseDirectory, "wwwroot");
            WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "app.local", wwwrootPath,
                Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);
            _targetUrl = "https://app.local/index.html";
            StartupClock.Mark("navigate");
            WebView.CoreWebView2.Navigate(_targetUrl);
#endif

            // Load initial data. This lambda runs on a LATER dispatcher tick (after
            // InitializeWebView has already returned), so the outer try/catch can't cover it —
            // it needs its own guard. An unobserved throw here silently skips hotkey
            // registration and the collision/failure toasts, so wrap the body and best-effort
            // surface the failure. bridge is also null-checked: it's assigned above, but a
            // failed wiring path could leave it null by the time this runs.
            bool initialLoadQueued = DispatcherQueue.TryEnqueue(async () =>
            {
                if (bridge == null)
                {
                    Services.DiagnosticLog.Warn("Initial-data load skipped: bridge is null");
                    _initialDataLoaded.TrySetResult(true);
                    return;
                }

                try
                {
                // The ACTIVE profile first, and on its own. This reads one fixed file
                // (Profiles/profile.json) and touches neither ProfileEntries nor anything the
                // list pass produces, yet it used to be sequenced strictly behind all ~80 of
                // them — so the single most valuable thing in the first frame, the action grid
                // of the profile the user was last in, waited on eighty files whose only job is
                // to fill the sidebar.
                //
                // The reorder was checked, not assumed. The list pass reads no
                // UserProfile.Current. ApplyGlobalSettings' one outward effect is
                // TriggerService.SetGlobalEnabled, which was already seeded from the same
                // appsettings value when the daemon was constructed above, so it early-returns
                // in either order. Hotkey registration reads only ProfileEntries. What DOES
                // need both halves is the tray tooltip — see below.
                var defaultProfile = await SettingsManager.LoadProfileAsync();
                if (defaultProfile != null)
                {
                    AppSettingsManager.ActivateProfile(defaultProfile);
                    bridge.ApplyProfile(defaultProfile);
                    bridge.PushProfileLoop();
                }

                // Belongs with the block above rather than after the sweep: it reports
                // actions.Count, which ApplyProfile just filled, and the profile name — nothing
                // from the list.
                bridge.PushStatusBarUpdate();

                await profileController.RefreshProfileListAsync(true);

                // Sweep WaitImage PNGs that aren't referenced by any action across all profiles.
                // Runs once at startup (before user can trigger any undo) so we never delete a
                // file the in-memory undo stack would still need. No-ops when no profile loaded,
                // like the cursor prune below: a missing Profiles folder is not a deleted library.
                ImageStorageService.CleanupOrphanImages(profileController.ReferencedImagesByProfile, profileController.FailedLoadFolders);

                // Same one-shot startup sweep for run cursors: drop positions belonging to
                // profiles that no longer exist, so a deleted profile can't rot in the sidecar
                // (or hand its old position to a NEW profile that reuses the name). No-ops on an
                // empty list, so a failed profile load never wipes the user's positions.
                // AllKnownProfileNames, not ProfileEntries: a profile whose JSON failed to parse
                // never enters that collection, so the prune read "failed to read" as "deleted"
                // and — since it writes through immediately — permanently discarded that profile's
                // saved row position for a file still sitting on disk and usually readable on the
                // next pass. Identical to the defect fixed for the automation sidecar; the shared
                // property exists so the two prunes cannot drift again.
                RunCursorService.PruneMissingProfiles(profileController.AllKnownProfileNames);

                // The one item that genuinely needs BOTH halves, which is why it did not travel
                // up with the profile it describes: ResolveTooltip reads
                // UserProfile.Current.ProfileKeyEnabled *and* the daemon's armed-watcher count,
                // and the watchers are armed by the list pass.
                TrayIconService.UpdateTrayIcon();

                bridge.PushProfilesUpdate();

                // Surface any profile.json files that failed to parse. Caught silently
                // inside LoadProfileListAsync; if we don't tell the user, missing profiles
                // look like a bug or data loss. One toast per startup, listing all failures
                // at once.
                var failures = profileController.GetAndClearLoadFailures();
                if (failures.Count > 0)
                {
                    var names = string.Join(", ", failures.Take(5));
                    var msg = failures.Count <= 5
                        ? $"{failures.Count} macro(s) couldn't load: {names}"
                        : $"{failures.Count} macros couldn't load (first 5: {names}, …)";
                    // Held until the window is on screen — an autostart boot hides it first
                    // (see WebViewBridge.ShowNoticeWhenSeen). Same for every notice below.
                    bridge.ShowNoticeWhenSeen(msg);
                }

                // appsettings.json was present but locked for the whole read — this session runs
                // on defaults and will not write the file (AppSettingsManager.WriteLocked).
                if (AppSettingsManager.IsUnreadableThisSession)
                    bridge.ShowNoticeWhenSeen(
                        "Your settings file couldn't be read (another program was holding it), so this session " +
                        $"runs on default settings and won't save changes to them. Restart {AppIdentity.DisplayName} to load your settings.");

                // Hotkeys and trigger modes are deliberately NOT re-registered here.
                // LoadProfileListAsync arms both as the last thing it does, off the same
                // ProfileEntries, and nothing between there and here mutates that collection —
                // the second pass re-ran the whole collision analysis (a LINQ grouping that
                // rewrites HotkeyConflict on every entry) only to hand InputHookManager a map
                // identical to the one already installed. The toasts below are unaffected:
                // GetProfileHotkeys is what fills _hotkeyCollisions and only
                // GetAndClearHotkeyCollisions drains it, so what the controller's pass found is
                // still sitting there waiting to be read.
                //
                // Two profiles bound to the same combo would otherwise silently fight (only one
                // fires, and which one depends on Dictionary iteration order).
                foreach (var msg in profileController.GetAndClearHotkeyCollisions())
                {
                    bridge.ShowNoticeWhenSeen(msg);
                }
                }
                catch (Exception ex)
                {
                    Services.DiagnosticLog.Error("Initial-data load failed", ex);
                    try { bridge.ShowNoticeWhenSeen("Startup data couldn't load fully. Some macros or hotkeys may be unavailable."); }
                    catch { /* toast is best-effort — never let the failure handler throw */ }
                }
                finally
                {
                    // Release the ui:ready gate no matter how we got here. A partially loaded
                    // list is still the truth about this session; a state:init that never
                    // arrives is a frontend stuck on its empty defaults with nothing to
                    // correct it.
                    _initialDataLoaded.TrySetResult(true);
                }
            });

            // The queue refused the work — it is shutting down, or already drained. The lambda's
            // finally will never run, so open the gate from here instead of leaving a waiter
            // holding a promise nobody kept.
            if (!initialLoadQueued)
            {
                Services.DiagnosticLog.Warn("Initial-data load was not queued: dispatcher refused the enqueue");
                _initialDataLoaded.TrySetResult(true);
            }
            }
            catch (Exception ex)
            {
                Services.DiagnosticLog.Error("InitializeWebView: post-environment wiring failed", ex);
                NativeMethods.MessageBoxW(hwnd,
                    $"{AppIdentity.DisplayName} couldn't finish starting its UI.\n\nPlease restart {AppIdentity.DisplayName}. " +
                    "If the problem persists, repair the Microsoft Edge WebView2 Runtime.",
                    AppIdentity.DisplayName, NativeMethods.MB_ICONERROR);
                // Same reason as the enqueue guard: a throw before (or during) the enqueue leaves
                // nothing that would ever complete it.
                _initialDataLoaded.TrySetResult(true);
            }
        }

        private async Task<bool> HandleCloseGuardAsync()
        {
            Services.DiagnosticLog.Info("Close requested — checking unsaved changes");

            // Work that lives only in an open EDITOR comes first, and it has its own question. The
            // two flags below see only what reached the backend, so a Data table or an Automation
            // draft typed into a clean profile closed without a word, and with the profile dirty
            // for another reason the prompt's "Save" wrote the profile and still dropped the open
            // Sheet's fields — "saved" over work that was not in the file. Declining keeps the
            // window; accepting moves on to the profile's own prompt, which still guards the rest.
            var editors = Services.AutomationGuard.HeldEditors();
            // Save as you go: what is typed goes in with the rest, and nothing is asked. The page puts
            // in what its editors hold and lets go of their claims (editor:commit); the question is
            // left for a page that does not answer in time (gone, or stuck).
            if (editors.Count > 0 && bridge is { AutoSaveEnabled: true }) editors = await CommitEditorsAsync();
            if (editors.Count > 0)
            {
                // A Quit from the tray comes with the window hidden, and the question must be seen.
                if (bridge is { AutoSaveEnabled: true }) await SurfaceAppForInputAsync();
                if (!await profileController.ShowUnappliedEditsDialogAsync(Services.AutomationGuard.DescribeUnappliedEdits(editors)))
                {
                    Services.DiagnosticLog.Info($"Close guard resolved: canClose=False (unapplied edits in {string.Join(", ", editors)})");
                    return false;
                }
            }

            // Save as you go writes what is still pending, and the prompt below has nothing to ask.
            // Without a file, or when the write fails, it asks as before.
            if (bridge is { AutoSaveEnabled: true }) await bridge.FlushAutoSaveAsync();

            bool canClose;
            // A pending Loops/Interval edit is unsaved work by itself. Same two readers as
            // WebViewBridge.CheckUnsavedChangesAsync — see HasUnsavedActionWork for the grid half.
            if (bridge == null || (!bridge.HasUnsavedLoopChange && !bridge.HasUnsavedActionWork))
            {
                canClose = true;
            }
            else
            {
                bool loopOnly = bridge.HasUnsavedLoopChange && !bridge.HasUnsavedActionWork;
                // Saving as you go, this question comes only when the write failed (or, with no
                // macro open, there is no file): a Quit from the tray may have the window hidden.
                if (bridge.AutoSaveEnabled) await SurfaceAppForInputAsync();
                var result = await profileController.ShowUnsavedChangesDialogAsync(loopOnly);

                if (result == ContentDialogResult.Primary) // Save
                {
                    if (bridge.CurrentProfilePath != null)
                    {
                        // The save has to be guarded exactly like its sibling below. Writes fail
                        // for reasons that have nothing to do with us — the file locked by an
                        // antivirus scan or a OneDrive sync, a full disk, a folder that lost its
                        // permissions. Unguarded, the exception escaped an async Task on the close
                        // path: the user asked to save, was told nothing, and the app shut down and
                        // destroyed the work anyway. Report it and refuse to close, so the user
                        // still has the window (and the unsaved actions) in front of them.
                        try
                        {
                            var profile = bridge.CreateProfileForSave();
                            await SettingsManager.SaveProfileAsync(bridge.CurrentProfilePath, profile);
                            canClose = true;
                            // Cleared where the write lands, like every other save path (the note
                            // in CheckUnsavedChangesAsync says why). Tray Exit ends in
                            // Application.Exit, not the ForceExit teardown, so a process that
                            // lingers must not keep reading this profile as dirty and park every
                            // automation in SkippedDirty.
                            bridge.HasUnsavedChanges = false;
                            bridge.ClearLoopEdit();
                        }
                        catch (Exception ex)
                        {
                            Services.DiagnosticLog.Error($"Close-guard save to '{bridge.CurrentProfilePath}' failed", ex);
                            NativeMethods.MessageBoxW(hwnd,
                                $"Error saving macro:\n{ex.Message}\n\n{AppIdentity.DisplayName} stayed open so your changes aren't lost.",
                                AppIdentity.DisplayName, NativeMethods.MB_ICONERROR);
                            canClose = false;
                        }
                    }
                    else
                    {
                        canClose = await profileController.SaveProfileAsync();
                        if (canClose)
                        {
                            bridge.HasUnsavedChanges = false;
                            bridge.ClearLoopEdit();
                        }
                    }
                }
                else if (result == ContentDialogResult.Secondary) // Discard
                    canClose = true;
                else
                    canClose = false; // Cancel
            }

            Services.DiagnosticLog.Info($"Close guard resolved: canClose={canClose}");
            return canClose;
        }

        /// <summary>
        /// Asks the page to put in what its editors hold (editor:commit: a field applies on leaving it,
        /// an open Data Loop cell too, and a paste box not applied closes) and waits up to 1.5 s for
        /// their editor:pendingEdits claims to go. The edits arrive before the claims are let go, so
        /// the auto-save flush that follows writes them. Returns the claims still held.
        /// </summary>
        private async Task<System.Collections.Generic.IReadOnlyList<string>> CommitEditorsAsync()
        {
            bridge?.SendMessage("editor:commit", new { });
            var held = Services.AutomationGuard.HeldEditors();
            for (int i = 0; i < 30 && held.Count > 0; i++)
            {
                await Task.Delay(50);
                held = Services.AutomationGuard.HeldEditors();
            }
            Services.DiagnosticLog.Info(held.Count == 0
                ? "Close guard: the page put in what its editors held"
                : $"Close guard: still held after asking the page ({string.Join(", ", held)})");
            return held;
        }

        // Brings TrueReplayer forward so an {input:} Ask-Input modal is visible. Handles all three
        // hidden states: closed-to-TRAY (AppWindow.Hide → not iconic, so it must be SHOWN first or
        // SetForegroundWindow no-ops on a hidden window), MINIMIZED and merely BEHIND (both handled by
        // ActivateAsync). Best-effort: if Windows still refuses (a fullscreen-exclusive app holding
        // focus), log it so the "I never saw the prompt" case is diagnosable instead of silent.
        private async Task SurfaceAppForInputAsync()
        {
            try
            {
                // Un-hide from the system tray first. SW_SHOW (not SW_RESTORE) so a maximized window
                // isn't un-maximized; ActivateAsync below still un-minimizes + foregrounds.
                if (!NativeMethods.IsWindowVisible(hwnd))
                    NativeMethods.ShowWindow(hwnd, NativeMethods.SW_SHOW);
                bool surfaced = await TrueReplayer.Helpers.WindowActivation.ActivateAsync(hwnd);
                if (!surfaced)
                    Services.DiagnosticLog.Info("Ask-Input: could not bring the window to the foreground (a fullscreen app may be holding focus) — the input prompt may be hidden");
            }
            catch (Exception ex) { Services.DiagnosticLog.Warn($"Ask-Input surface failed: {ex.Message}"); }
        }

        private void SetupInputHooks()
        {
            // InputHookManager.Start() is at the END: the hooks run on a thread of their own, so
            // an event can arrive the moment they are installed, and every handler below must be
            // subscribed by then — a hotkey swallowed with no OnHotkeyPressed handler is a key
            // press that did nothing.

            // Profile hotkey was pressed but its target window isn't running anywhere on
            // the system. Surface a toast so the user knows why nothing happened — the
            // hook silently swallowed the hotkey otherwise (legit when target is just
            // not foreground, confusing when target is closed entirely). The hook side
            // cooldowns per-profile so a mashed key doesn't flood.
            InputHookManager.OnProfileTargetMissing += (profileName) =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    var target = profileController.GetEffectiveWindowTarget(profileName);
                    var procName = target?.ProcessName ?? "target window";
                    bridge?.SendMessage("alert:show", new
                    {
                        message = $"Macro '{profileName}' hotkey ignored — '{procName}' isn't running"
                    });
                    // The toast alone is in the wrong place: a profile hotkey (or its hotstring) is
                    // pressed while the user is in ANOTHER app, which is exactly when this window is
                    // not in front — so "my hotkey did nothing" came with no signal they could notice.
                    TrayIconService.CueOutOfView();
                });
            };

            // Profile Keys are off and the user pressed Record / Replay / Capture-slot, so the key
            // went to whatever app is in front instead. The tray icon (red) and the Hotkeys rail
            // already say the switch is off, but neither is where the user is looking at the
            // moment nothing happens — and "my Replay hotkey broke" is the support ticket that
            // writes itself. The hook throttles it, so mashing the key gives one toast.
            InputHookManager.OnGlobalHotkeyPassedThrough += (combo) =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    bridge?.SendMessage("alert:show", new
                    {
                        message = $"Shortcuts are off — {combo} went to the app in front. "
                                + $"Press {UserProfile.Current.ProfileKeyToggleHotkey} to turn them back on."
                    });
                });
            };

            InputHookManager.OnHotkeyPressed += (key) =>
            {
                DispatcherQueue.TryEnqueue(async () =>
                {
                    // Single anchor covering all hotkey dispatch sites — lets support confirm a
                    // hotkey was actually received + dispatched (vs. gated, which the hook logs).
                    Services.DiagnosticLog.Info($"Hotkey dispatched: {key}");

                    if (key == UserProfile.Current.ProfileKeyToggleHotkey)
                    {
                        SetShortcutsEnabled(!UserProfile.Current.ProfileKeyEnabled, "toggle hotkey");
                        mainController.SetLastHotkeyPressed(key);
                        return;
                    }

                    if (key == UserProfile.Current.ForegroundHotkey)
                    {
                        windowEventManager?.BringToForeground();
                        return;
                    }

                    // Capture-selection → slot: synthetic Ctrl+C on the FOREGROUND app, store
                    // into the next sequential slot (1..9, wrapping), restore the clipboard.
                    // The injected keys are LLKHF_INJECTED so the hook can't re-enter here.
                    if (!string.IsNullOrEmpty(UserProfile.Current.CaptureSlotHotkey)
                        && key == UserProfile.Current.CaptureSlotHotkey)
                    {
                        // Not during a replay: the capture releases physically held modifiers
                        // (breaking WhilePressed holds / HoldKey presses), injects Ctrl+C into
                        // whatever the run is driving, and races the run's own clipboard pastes.
                        // Use the Copy to Slot ACTION to capture as part of a macro.
                        if (mainController.IsReplayInProgress())
                        {
                            Services.DiagnosticLog.Info("Capture to Slot: ignored — a replay is running (use the Copy to Slot action instead)");
                            return;
                        }
                        try
                        {
                            // The synthetic Ctrl+C + clipboard restore below bump the clipboard
                            // sequence number — invisible to ClipboardChanged watchers.
                            triggerService.NotifyAppClipboardActivity();
                            var (slot, value) = await replayService.CaptureSelectionToNextSlotAsync();
                            if (value != null)
                            {
                                Services.DiagnosticLog.Info($"Capture to Slot: {value.Length} char(s) → {{clip:{slot}}}");
                                bridge?.SendMessage("alert:show", new { message = $"Selection captured → {{clip:{slot}}}" });
                            }
                            else
                            {
                                Services.DiagnosticLog.Info("Capture to Slot: nothing copied (empty selection?)");
                            }
                        }
                        catch (Exception ex)
                        {
                            // async-void dispatcher lambda — an escaped exception here would
                            // crash the app, and clipboard COM is exactly the kind of thing
                            // that throws transiently.
                            Services.DiagnosticLog.Error("Capture to Slot failed", ex);
                        }
                        return;
                    }

                    // Copy screen text: OCR a region (dragged now, or the saved fixed one) onto the
                    // clipboard. Refused during a replay or recording for the Capture Slot reason —
                    // the run owns the clipboard for its own pastes.
                    if (!string.IsNullOrEmpty(UserProfile.Current.CopyScreenTextHotkey)
                        && key == UserProfile.Current.CopyScreenTextHotkey)
                    {
                        if (mainController.IsReplayInProgress() || mainController.IsRecording())
                        {
                            Services.DiagnosticLog.Info("Copy screen text: ignored — a replay or recording is running");
                            return;
                        }
                        try { if (bridge != null) await bridge.RunCopyScreenTextAsync(); }
                        catch (Exception ex) { Services.DiagnosticLog.Error("Copy screen text failed", ex); }
                        return;
                    }

                    if (key == UserProfile.Current.ModeToggleHotkey)
                    {
                        // Same code path as the UI mode toggle — flip + cancel any running
                        // ops, persist, push to React, refresh tray. SetCursorClickMode
                        // handles flip+cancel; we own the persist+push+tray here because
                        // the settings:change handler does those at the end of its switch —
                        // including PushButtonStates(), which carries the Replay/Click button's
                        // enabled-state + label (separate 'button:states' message).
                        if (bridge != null)
                        {
                            bridge.SetCursorClickMode(!bridge.UseCursorClick);
                            var saved = AppSettingsManager.Load();
                            saved.UseCursorClick = bridge.UseCursorClick;
                            AppSettingsManager.Save(saved);
                            bridge.PushSettingsLoaded();
                            bridge.PushButtonStates();
                            TrayIconService.UpdateTrayIcon();
                        }
                        return;
                    }

                    // PROFILE_STOP:: is fired by WhilePressed release to cancel a running replay.
                    // Must run even when IsReplayInProgress (that's the whole point).
                    // We intentionally do NOT call ClearActiveHold here — the hook thread already
                    // cleared its own state before dispatching PROFILE_STOP. Touching those fields
                    // from the UI thread would race with any later hook-thread keydown writes.
                    if (key.StartsWith(ProfileStopPrefix))
                    {
                        if (mainController.IsReplayInProgress())
                            mainController.StopReplayIfRunning();
                        return;
                    }

                    // Clicker-exclusive hotkeys (fired by the hook only while in Clicker mode).
                    // CLICKER_START toggles the click loop; CLICKER_PAUSE toggles pause/resume.
                    if (key == "CLICKER_START")
                    {
                        mainController.SetLastHotkeyPressed(key);
                        mainController.ToggleCursorClickReplay(
                            bridge?.BuildClickerConfig() ?? ClickerRunConfig.Default);
                        return;
                    }
                    if (key == "CLICKER_PAUSE")
                    {
                        mainController.TogglePauseClicker();
                        return;
                    }

                    bool isProfileTrigger = key.StartsWith(ProfilePrefix) || key.StartsWith(ProfileHoldPrefix) || key.StartsWith(ProfileTogglePrefix);
                    if (isProfileTrigger && (!UserProfile.Current.ProfileKeyEnabled || mainController.IsRecording()))
                    {
                        return;
                    }

                    // Clicker mode is exclusive: profile triggers (PROFILE/HOLD/TOGGLE) and the
                    // Recording hotkey are suppressed. PROFILE_STOP is intentionally NOT suppressed
                    // (handled earlier above) so a WhilePressed key released after a mid-replay mode
                    // switch still cancels its replay. The ProfileKeyToggle, Foreground and
                    // ModeToggle hotkeys continue to work normally. The Replay hotkey never arrives
                    // here in Clicker mode — the hook gates it on IsCursorClickMode, and the
                    // Clicker's run key is CLICKER_START above (the guard in the Replay branch below
                    // only covers a mode flip racing an already-queued press).
                    if (bridge?.UseCursorClick == true)
                    {
                        if (isProfileTrigger || key == UserProfile.Current.RecordingHotkey)
                            return;
                    }

                    // Re-triggering OnPress / OnRelease during an active replay stops it —
                    // otherwise a user running an infinite-loop profile in OnRelease mode has
                    // no way to stop without using the global replay hotkey.
                    if (key.StartsWith(ProfilePrefix) && mainController.IsReplayInProgress())
                    {
                        mainController.StopReplayIfRunning();
                        return;
                    }

                    // PROFILE_HOLD:: during active replay: ignored (WhilePressed shouldn't re-enter).
                    // PROFILE_TOGGLE:: passes through — ToggleReplay handles the "press again = stop".
                    if (key.StartsWith(ProfileHoldPrefix) && mainController.IsReplayInProgress())
                    {
                        return;
                    }

                    if (key == UserProfile.Current.RecordingHotkey)
                    {
                        if (mainController.ShouldSuppressDuplicateRecordingHotkey())
                            return;

                        // With no macro open, a new one records it (WebViewBridge.RecordIntoNewMacro).
                        if (bridge?.RecordIntoNewMacro() == true) return;

                        foreach (var action in Actions)
                        {
                            action.IsInsertionPoint = false;
                            action.IsVisuallyDeselected = false;
                        }

                        mainController.EnableInsertMode(bridge?.SelectedInsertIndex);
                        mainController.SetLastHotkeyPressed(key);
                        mainController.ToggleRecording();
                    }
                    else if (key == UserProfile.Current.ReplayHotkey)
                    {
                        if (mainController.ShouldSuppressDuplicateReplayHotkey())
                            return;

                        mainController.SetLastHotkeyPressed(key);

                        if (bridge?.UseCursorClick == true)
                        {
                            // Unreachable in practice: the hook only dispatches ReplayHotkey in
                            // Macro mode — the keyboard path and the mouse ladder are both gated
                            // on IsCursorClickMode, and the Clicker's own run key arrives as
                            // CLICKER_START above. The one way a press can still land here is a
                            // mode flip racing a dispatch already queued on the UI thread, and
                            // then the right answer is to drop it, not to start a macro replay
                            // underneath the Clicker dashboard. This branch used to start the
                            // click loop, which claimed a "Replay hotkey = Click" path that
                            // never fired.
                            return;
                        }
                        else
                        {
                            var curName = bridge?.CurrentProfileName ?? "";
                            bool hasCurName = curName != "No Profile" && !string.IsNullOrEmpty(curName);
                            var effTarget = hasCurName ? profileController.GetEffectiveWindowTarget(curName) : UserProfile.Current.TargetWindow;
                            // The grid on screen, in the space its coordinates are in — see the
                            // matching line in WebViewBridge.HandleReplayToggle.
                            var effRelCoords = UserProfile.Current.UseRelativeCoordinates;
                            var effBringFocus = hasCurName ? profileController.GetEffectiveBringToFocus(curName) : UserProfile.Current.BringToFocus;
                            // Geometry + Restore flags: profile's own takes priority when its target is
                            // set; otherwise the FOLDER's apply — geometry whole, never mixed with the
                            // profile's own numbers (see ProfileController.GetEffectiveGeometry).
                            var effRestorePos = hasCurName ? profileController.GetEffectiveRestorePosition(curName) : UserProfile.Current.RestorePosition;
                            var effRestoreSz = hasCurName ? profileController.GetEffectiveRestoreSize(curName) : UserProfile.Current.RestoreSize;
                            int effW = UserProfile.Current.WindowWidth;
                            int effH = UserProfile.Current.WindowHeight;
                            int effGX = UserProfile.Current.WindowX;
                            int effGY = UserProfile.Current.WindowY;
                            if (hasCurName)
                            {
                                var geom = profileController.GetEffectiveGeometry(curName, effGX, effGY, effW, effH);
                                if (geom is null) { effGX = effGY = effW = effH = 0; effRestorePos = false; effRestoreSz = false; }
                                else (effGX, effGY, effW, effH) = geom.Value;
                            }
                            // Loop settings via the shared resolver — this path has no profile
                            // instance of its own, so it resolves "whatever is loaded now"
                            // (profile's own values, or the global fallback under No Profile).
                            // Reading bridge.EnableLoop/LoopCount directly here is what made the
                            // global Replay hotkey ignore the loaded profile's loop count.
                            var globalLoop = bridge?.BuildLoopConfig() ?? new LoopRunConfig(false, "1", false, "0");
                            var jitter = bridge?.EffectiveDelayVariation() ?? (false, 20);
                            mainController.ToggleReplay(
                                globalLoop.Enabled,
                                globalLoop.Count,
                                globalLoop.IntervalEnabled,
                                globalLoop.Interval,
                                // Same resolver as the loop, same "whatever is loaded now".
                                bridge?.ResolveGameMode(),
                                bridge?.ResolveRestoreCursor(),
                                bridge?.ResolveFastApproach(),
                                jitter.Use,
                                jitter.Percent,
                                effRelCoords,
                                effTarget,
                                effBringFocus,
                                effW,
                                effH,
                                effGX,
                                effGY,
                                effRestorePos,
                                effRestoreSz);
                            // Save as you go, as the Replay button does (WebViewBridge.HandleReplayToggle).
                            bridge?.FlushAutoSaveInBackground();
                        }
                    }
                    else if (key.StartsWith(ProfilePrefix) || key.StartsWith(ProfileHoldPrefix) || key.StartsWith(ProfileTogglePrefix))
                    {
                        string prefix = key.StartsWith(ProfileHoldPrefix) ? ProfileHoldPrefix
                            : key.StartsWith(ProfileTogglePrefix) ? ProfileTogglePrefix
                            : ProfilePrefix;
                        string profileName = key.Substring(prefix.Length);
                        // Toggle and WhilePressed both force infinite-loop replay regardless of
                        // the profile's own LoopCount: WhilePressed because the key stays held
                        // (re-entry would re-trigger the same press), Toggle because otherwise
                        // it'd be indistinguishable from OnPress + Loop — the whole point of
                        // Toggle is "press once → loops until I press again to stop". The Toggle
                        // *stop* path doesn't read this flag (second press goes through ToggleReplay
                        // → StopReplay), so over-applying here is harmless.
                        bool forceInfiniteLoop = prefix == "PROFILE_HOLD::" || prefix == "PROFILE_TOGGLE::";
                        // Only WhilePressed has the race window the next two guards protect against —
                        // its trigger is tied to a key being physically held when the async handler
                        // runs, so the user can release between dispatch and start. Toggle is fire-
                        // and-forget on each press (two discrete events), so these guards must NOT
                        // fire for it — checking IsHoldActiveForProfile for a Toggle prefix would
                        // always be false and silently swallow every Toggle start.
                        bool isWhilePressedHold = prefix == "PROFILE_HOLD::";

                        // async-void dispatcher lambda, and the profile load inside is real I/O. The
                        // automation dispatch of this same function has always had this catch; the
                        // hotkey path had none, so a locked or unreadable profile.json ended in the
                        // app-wide UnhandledException net, which keeps the process alive and says
                        // nothing — the key simply did nothing, every time it was pressed.
                        try
                        {
                            await RunProfileTriggerAsync(profileName, forceInfiniteLoop, isWhilePressedHold, key, startOnly: false);
                        }
                        catch (Exception ex)
                        {
                            Services.DiagnosticLog.Error($"Profile hotkey '{profileName}' failed", ex);
                            bridge?.SendMessage("alert:show", new { message = $"Could not start \"{profileName}\": {ex.Message}", type = "error" });
                            TrayIconService.CueOutOfView();
                        }
                    }
                });
            };

            // Forward captured combos straight to the frontend chip. The hook has already
            // swallowed the OS event by the time we get here, so the dialog can simply mirror
            // whatever the user pressed — including Win+letter combos that the WebView2
            // JS layer never sees because the Shell intercepts them first.
            InputHookManager.OnHotkeyCaptured += (combo) =>
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    // owner = most recent registrant, so a non-modal chip (Settings remaps)
                    // can stand down when a later-opened dialog is the intended recipient.
                    bridge?.SendMessage("hotkey:captured", new { combo, owner = InputHookManager.LastCaptureOwner });
                });
            };

            // The two recording events arrive on the hook thread (InputHookManager, "Hook thread")
            // and are handled HERE, on the UI thread: the recorder writes the Actions collection,
            // whose CollectionChanged handlers renumber the rows and push them to the WebView —
            // work that used to run inside the low-level hook while the system's input waited.
            // TryEnqueue keeps them in order, and each carries the tick the hook stamped, so a
            // delay or a double-click is measured from the event, not from when the queue drained.
            InputHookManager.OnMouseEvent += (button, x, y, isDown, scrollDelta, ticks) =>
            {
                // Read on the hook thread too, so a click outside a recording queues nothing.
                if (!mainController.IsRecording()) return;
                DispatcherQueue.TryEnqueue(() =>
                {
                    if (!mainController.IsRecording()) return;
                    actionRecorder.RecordMouseAction(button, x, y, isDown, scrollDelta, ticks);
                });
            };

            // Pairs the Escape KeyUp with a cancel-gesture Escape KeyDown so the orphan up
            // doesn't leak into the recording. Mutated only on the UI thread, in queue order.
            bool suppressNextEscapeUp = false;
            InputHookManager.OnKeyEvent += (key, isDown, isPassThroughFeed, ticks) =>
                DispatcherQueue.TryEnqueue(() => HandleHookKeyEvent(key, isDown, isPassThroughFeed, ticks));

            // Every key is queued, recording or not: Escape also cancels insert mode, which can be
            // armed before a recording starts.
            void HandleHookKeyEvent(string key, bool isDown, bool isPassThroughFeed, long ticks)
            {
                // A pass-through FEED is not a gesture: it means "the foreground app is getting
                // this key, write it into the recording". The Escape branch below cancels insert
                // mode, and the feed carries the BARE main key, so a hotkey of "Ctrl+Escape"
                // reached it looking exactly like a lone Escape press.
                if (isDown && !isPassThroughFeed && key == "Escape")
                {
                    if (mainController.IsInsertMode())
                    {
                        mainController.CancelInsertMode();
                        foreach (var action in Actions)
                        {
                            action.IsInsertionPoint = false;
                            action.IsVisuallyDeselected = true;
                        }
                        // Insert-mode cancel keeps recording active, so swallow this Escape's
                        // matching KeyUp too — otherwise a lone Escape KeyUp leaks into the macro.
                        suppressNextEscapeUp = true;
                        return;
                    }
                    // If not in any special mode, fall through to recording
                }

                // Drop the KeyUp paired with a cancel-gesture Escape down (handled above) so the
                // cancel keystroke leaves no trace in the recording.
                if (!isDown && key == "Escape" && suppressNextEscapeUp)
                {
                    suppressNextEscapeUp = false;
                    return;
                }

                if (!mainController.IsRecording()) return;
                actionRecorder.RecordKeyboardAction(key, isDown, ticks);
            }

            InputHookManager.Start();
        }

        /// <summary>
        /// Shared tail of the PROFILE:: hotkey dispatch — "load profile by name, apply
        /// effective folder context, swap the visible profile, start the replay". Also the
        /// body of an automation-trigger fire. startOnly gives it start-only semantics:
        /// re-check the busy state right before ToggleReplay and bail instead of falling
        /// into its stop-toggle branch (a trigger must never stop a run it didn't start;
        /// the LoadProfileByNameAsync await yields the dispatcher, so a user hotkey can
        /// start a replay between our UI-thread gates and this point).
        /// hotkeyKey is the raw dispatch string for the hotkey path (null for triggers —
        /// there is no physical key to track for duplicate suppression).
        /// Returns true when a replay was actually started.
        /// </summary>
        private async Task<TriggerFireResult> RunProfileTriggerAsync(
            string profileName, bool forceInfiniteLoop, bool isWhilePressedHold, string? hotkeyKey, bool startOnly)
        {
            // Save as you go: the open macro's pending edit reaches its file before anything reads
            // the disk. The fired macro may be that one, and the swap below replaces the grid either
            // way, which without this drops the edit with no word.
            if (bridge is { AutoSaveEnabled: true }) await bridge.FlushAutoSaveAsync();

            var profile = await profileController.LoadProfileByNameAsync(profileName);

            // Race guard for WhilePressed: user may have already released the key
            // before this async handler reached here. In that case the key-up already
            // fired a PROFILE_STOP, the hold state was cleared, and we should NOT
            // start the replay — otherwise it would loop forever with no keyup to
            // stop it.
            if (isWhilePressedHold && !InputHookManager.IsHoldActiveForProfile(profileName))
            {
                return TriggerFireResult.SkippedBusy;
            }

            if (profile == null) return TriggerFireResult.Failed;

            // startOnly (trigger path): the LoadProfileByNameAsync await above yields the
            // dispatcher, so EVERY gate the caller checked can have flipped underneath us —
            // a replay/recording started, an edit dirtied the grid, a modal opened. Re-check
            // them ALL here (synchronous UI-thread reads) before mutating any global state;
            // the profile swap below force-clears the dirty flag, which for an autonomous
            // fire would be exactly the silent data loss the caller's gate exists to prevent.
            // The ORDER mirrors FireProfileFromTriggerAsync's gate exactly, and the reason is an
            // invariant rather than a scenario: this block exists only to RE-ASK that gate's
            // question after the yield above. Asked in a different order it answers a DIFFERENT
            // question, and that is a defect by construction — no estimate of how often the state
            // actually flips is needed to see it. It used to test the dirty flag before Clicker
            // mode, so the same state could be classified two ways depending on which side of the
            // await saw it, and the two classifications are not interchangeable: SkippedBusy is
            // retriable, SkippedDirty is terminal for that queued request (TriggerService excludes
            // it from the retry paths).
            //
            // Honest about reach and about cost, because both were overstated before:
            //  • Reach is narrow. The caller already proved every flag false on this same UI thread,
            //    so the block can only disagree if Clicker mode AND the dirty flag both flip inside
            //    the one yield — the LoadProfileByNameAsync await. Real (that await hits the disk and
            //    the dispatcher drains the mode-toggle hotkey there), but it is a double flip, not a
            //    coin toss.
            //  • It costs the early exit. A non-terminal verdict keeps the request at the HEAD of the
            //    fire pump, retried every FireRetryCadenceMs until it expires, and the pump attempts
            //    only the head. The old order let this one case leave early. That was luck, not
            //    design: whenever Clicker mode was already on at the caller's gate — the ordinary
            //    case — the request holds the head exactly like this anyway.
            // And "terminal" is per-request, not per-automation: an interval or condition watcher
            // asks again on its next tick. A SCHEDULE is the one that really loses the occurrence.
            //
            // The bridge null-check moving up is not part of the fix; it is mechanically required
            // now that the busy line dereferences bridge.UseCursorClick. That branch is unreachable
            // here (bridge is assigned once and never returns to null, and the caller proved it).
            if (startOnly)
            {
                if (bridge == null)
                    return TriggerFireResult.NotReady;
                if (mainController.IsReplayInProgress() || mainController.IsRecording() || bridge.UseCursorClick)
                    return TriggerFireResult.SkippedBusy;
                // Same composed reader as the gate in FireProfileFromTriggerAsync — see
                // AutomationGuard.
                if (Services.AutomationGuard.BlockedReason() != null)
                    return TriggerFireResult.SkippedModal;
                // The same reader as the switch prompt and the close guard (see
                // HasUnsavedActionWork): the gates must agree on what "unsaved" means. With save as
                // you go the edit landed during the load above and is on its way to the file, so
                // this is a retriable "not yet", not the terminal skip.
                if (bridge.HasUnsavedActionWork)
                    return bridge.SavesAsYouGo ? TriggerFireResult.SkippedBusy : TriggerFireResult.SkippedDirty;
            }

            var entry = profileController.ProfileEntries.FirstOrDefault(p => p.Name == profileName);
            if (hotkeyKey != null)
                mainController.SetLastHotkeyPressed(hotkeyKey);
            // The coordinate flag has to come from the SAME place as the coordinates. With its own
            // target the profile's flag lives in the file just loaded, and the list entry is only a
            // mirror of it, refreshed when something re-reads the list. A save that did not (the
            // switch prompt's Save used to be one) left the mirror on the old flag while the file
            // held converted coordinates, and every fire replayed them in the wrong space.
            // Inherited: the folder's flag, as before.
            bool effectiveRelCoords = profileController.HasOwnWindowTarget(profileName)
                ? profile.UseRelativeCoordinates
                : profileController.GetEffectiveRelativeCoordinates(profileName);
            AppSettingsManager.ActivateProfile(profile);
            // Apply effective folder-inherited values
            UserProfile.Current.UseRelativeCoordinates = effectiveRelCoords;
            UserProfile.Current.BringToFocus = profileController.GetEffectiveBringToFocus(profileName);
            if (bridge == null) return TriggerFireResult.NotReady;
            // Set CurrentProfileName BEFORE the action-grid push: the push reads each
            // WaitImage/IF-Image thumbnail's base64 keyed by CurrentProfileName. With the
            // old order the push ran under the STALE name (e.g. a previous profile, or
            // "No Profile" → "default"), so the reference PNG resolved to the wrong dir,
            // missed, and showed a placeholder. Setting the name first also clears the
            // base64 cache so the push re-reads cleanly. Still holds with the deferral
            // below — the push now runs even later, in the post-start block.
            bridge.CurrentProfileName = profileName;
            // Fill-only, no visual push: serializing the grid (thumbnails included) here
            // would sit between the hotkey and the first replayed action. The grid/button
            // pushes are deferred to the post-start block below.
            bridge.ApplyProfileActions(profile);
            bridge.CurrentProfilePath = entry?.FilePath;
            bridge.HasUnsavedChanges = false;
            // A hotkey / hotstring / automation fire swaps the visible profile just like a click
            // does, so the panel and the chip must hear about the new loop values here too. Any
            // pending edit belonged to the profile we just left.
            bridge.ClearLoopEdit();

            var effectiveTarget = profileController.GetEffectiveWindowTarget(profileName);
            var effectiveBringToFocus = profileController.GetEffectiveBringToFocus(profileName);
            // Effective Restore + geometry — same inheritance rule as the global Replay path.
            var effectiveRestorePos = profileController.GetEffectiveRestorePosition(profileName);
            var effectiveRestoreSz = profileController.GetEffectiveRestoreSize(profileName);
            int profGX = 0, profGY = 0, profW = 0, profH = 0;
            var profGeom = profileController.GetEffectiveGeometry(
                profileName,
                UserProfile.Current.WindowX, UserProfile.Current.WindowY,
                UserProfile.Current.WindowWidth, UserProfile.Current.WindowHeight);
            // No rect on either side → nothing to restore. Suppress both flags rather than pass a
            // zero rect: Restore Position is not size-gated, so (0,0) would be executed as a move.
            if (profGeom is null) { effectiveRestorePos = false; effectiveRestoreSz = false; }
            else (profGX, profGY, profW, profH) = profGeom.Value;
            // Loop settings come from the profile we just loaded, not from the bridge's global
            // mirrors — this method reloads the profile at the top and then used to read
            // bridge.EnableLoop/LoopCount anyway, so every profile hotkey, hotstring, DoubleTap,
            // Hold, OnRelease and automation fire ran the GLOBAL count. Passing the instance (not
            // the name) keeps it correct regardless of when UserProfile.Current is assigned.
            //
            // The old "an autonomous fire can never be infinite" coercion that lived here is gone:
            // BuildLoopConfig clamps to 1..999, so a macro loop count can no longer BE zero, and
            // the only remaining source of an endless run is forceInfiniteLoop — which the daemon
            // passes as false by construction. The guard also only ever covered this method, i.e.
            // never the Replay button or the global Replay hotkey; the clamp covers all four.
            var loop = bridge.BuildLoopConfig(profile);
            var jitter = bridge.EffectiveDelayVariation(profile);
            mainController.ToggleReplay(
                loop.Enabled,
                loop.Count,
                loop.IntervalEnabled,
                loop.Interval,
                // The FIRED instance, like the loop: its Game Mode, not whatever was loaded.
                bridge.ResolveGameMode(profile),
                bridge.ResolveRestoreCursor(profile),
                bridge.ResolveFastApproach(profile),
                jitter.Use,
                jitter.Percent,
                effectiveRelCoords,
                effectiveTarget,
                effectiveBringToFocus,
                profW,
                profH,
                profGX,
                profGY,
                effectiveRestorePos,
                effectiveRestoreSz,
                forceInfiniteLoop);

            // Post-start safety net for WhilePressed: if the user released the
            // key between the race guard above and the moment IsReplayInProgress
            // became true, the STOP handler would have seen no running replay
            // and done nothing — leaving an infinite-loop replay with no way to
            // stop it. Re-check hold state right after starting and stop if the
            // key is no longer held. Skipped for Toggle: there's no held-key
            // state to check (Toggle stops via a second discrete press).
            if (isWhilePressedHold && !InputHookManager.IsHoldActiveForProfile(profileName))
            {
                mainController.StopReplayIfRunning();
            }

            profileController.UpdateProfileColors(profileName);
            bridge.PushProfileLoop();
            // Deferred from the ApplyProfileActions call above: the replay is already running,
            // so the grid/button serialization no longer costs hotkey→first-action latency.
            bridge.PushActionsUpdate();
            bridge.PushButtonStates();
            bridge.PushProfilesUpdate();
            bridge.PushToolbarUpdate();
            bridge.PushStatusBarUpdate();
            TrayIconService.UpdateTrayIcon();

            // "Fired" used to be returned unconditionally, but ToggleReplay is a NO-OP for an
            // empty action list and StartReplay bails out when loop-over-data is on with an empty
            // table. Both cases then reported a successful fire: the panel counted it, stamped a
            // last-fired time, and Run now said "the profile is running now" — for a profile that
            // did nothing at all. A WhilePressed hold that was released just above also lands here
            // with the replay already stopped. Report what actually happened.
            if (!mainController.IsReplayInProgress())
            {
                DiagnosticLog.Warn($"Automation '{profileName}': start produced no replay (empty profile, or an empty data table with loop-over-data on)");
                return TriggerFireResult.Failed;
            }
            return TriggerFireResult.Fired;
        }

        /// <summary>
        /// Automation-trigger fire entry (TriggerService.FireProfile). The watcher loop
        /// awaits the result; the decision happens INSIDE the enqueued lambda so every
        /// gate reads UI-thread truth — a loop-thread check would race hotkey dispatch.
        /// </summary>
        private Task<TriggerFireResult> FireProfileFromTriggerAsync(string profileName)
        {
            var tcs = new TaskCompletionSource<TriggerFireResult>(TaskCreationOptions.RunContinuationsAsynchronously);
            bool enqueued = DispatcherQueue.TryEnqueue(async () =>
            {
                try
                {
                    // The bridge is only up after WebView2 init — at boot this is a RETRIABLE
                    // "not yet", never a failure (an edge watcher would otherwise drop its
                    // pending edge and an armed automation would silently never run).
                    if (bridge == null)
                    {
                        tcs.TrySetResult(TriggerFireResult.NotReady);
                        return;
                    }
                    if (mainController.IsReplayInProgress() || mainController.IsRecording() || bridge.UseCursorClick)
                    {
                        tcs.TrySetResult(TriggerFireResult.SkippedBusy);
                        return;
                    }
                    // One composed reader — see AutomationGuard for why the two trigger gates must
                    // not drift apart, and why the refusal carries a reason.
                    if (Services.AutomationGuard.BlockedReason() != null)
                    {
                        tcs.TrySetResult(TriggerFireResult.SkippedModal);
                        return;
                    }
                    // An autonomous fire must never discard unsaved edits: the shared body
                    // below force-clears the dirty flag when it swaps profiles (fine for a
                    // deliberate hotkey press, silent data loss for a timer). Re-checked
                    // inside RunProfileTriggerAsync too — its profile-load await yields the
                    // dispatcher, so these gates can flip in the window. HasUnsavedActionWork, not
                    // the bare flag: the prompt that would rescue the edit reads the same thing.
                    // Save as you go writes the edit first, and the fire goes ahead; what stays is
                    // what it cannot write (No Profile, a failed write).
                    if (bridge.HasUnsavedActionWork && bridge.AutoSaveEnabled) await bridge.FlushAutoSaveAsync();
                    if (bridge.HasUnsavedActionWork)
                    {
                        tcs.TrySetResult(TriggerFireResult.SkippedDirty);
                        return;
                    }

                    // Belt and suspenders for an invariant the code asserts elsewhere but does not
                    // guarantee: "the daemon can never fire a disabled profile, GetProfileTriggers
                    // drops those". True only AFTER a reload, and the disable handlers did not do
                    // one until this batch — so a stale watcher could reach here. Cheap, and it
                    // makes the claim true regardless of who forgets to resync next.
                    var disabledCheck = profileController.ProfileEntries
                        .FirstOrDefault(p => string.Equals(p.Name, profileName, StringComparison.OrdinalIgnoreCase));
                    if (disabledCheck is { IsDisabled: true })
                    {
                        Services.DiagnosticLog.Warn($"Automation '{profileName}': profile is disabled — fire refused");
                        tcs.TrySetResult(TriggerFireResult.Failed);
                        return;
                    }

                    Services.DiagnosticLog.Info($"Automation dispatch: '{profileName}'");
                    var result = await RunProfileTriggerAsync(
                        profileName, forceInfiniteLoop: false, isWhilePressedHold: false, hotkeyKey: null, startOnly: true);
                    tcs.TrySetResult(result);
                }
                catch (Exception ex)
                {
                    // async-void dispatcher lambda — an escaped exception would crash the app.
                    Services.DiagnosticLog.Error($"Automation dispatch '{profileName}' failed", ex);
                    tcs.TrySetResult(TriggerFireResult.Failed);
                }
            });
            if (!enqueued) tcs.TrySetResult(TriggerFireResult.Failed);
            return tcs.Task;
        }

        /// <summary>True while the window is shown (not hidden to the tray). Minimized still counts.</summary>
        /// <summary>
        /// What the tray panel shows (TrayPanel.Snapshot): the open macro with its state and button, the
        /// pinned macros and those with a hotkey (five at most), the three switches and the held notices.
        /// </summary>
        private TrayPanel.Snapshot BuildTrayPanelSnapshot()
        {
            var settings = AppSettingsManager.Load();
            string? macro = bridge?.CurrentProfileName is { Length: > 0 } open && open != "No Profile" ? open : null;
            bool recording = mainController.IsRecording();
            bool replaying = mainController.IsReplayInProgress();
            bool clicker = settings.UseCursorClick;
            static string StepsOf(int n) => $"{n} step{(n == 1 ? "" : "s")}";
            var elapsed = TrayIconService.RunElapsed;
            string clock = $"{(int)elapsed.TotalMinutes}:{elapsed.Seconds:00}";
            string line;
            string? action = null, key = null;
            bool stops = false;
            if (recording) { line = $"Recording · {StepsOf(Actions.Count)} · {clock}"; action = "Stop"; key = settings.RecordingHotkey; stops = true; }
            else if (replaying && clicker) { line = $"Clicking · {TrayIconService.Clicks:N0} · {clock}"; action = "Stop"; key = settings.CursorClickStartHotkey; stops = true; }
            else if (replaying)
            {
                var (cur, tot) = TrayIconService.Loop;
                line = "Replaying" + (cur > 0 ? $" · loop {cur} of {(tot > 0 ? tot.ToString() : "∞")}" : "") + $" · {clock}";
                action = "Stop"; key = settings.ReplayHotkey; stops = true;
            }
            else if (clicker) line = string.IsNullOrEmpty(settings.CursorClickStartHotkey) ? "Clicker open" : $"Clicker open · {settings.CursorClickStartHotkey} starts";
            else if (macro != null) { line = $"Ready · {StepsOf(Actions.Count)}"; action = "Replay"; key = settings.ReplayHotkey; }
            else line = "Open a macro in the window to run it from here.";

            var entries = profileController.ProfileEntries.Where(e => !e.IsDisabled).ToList();
            var pinned = profileController.PinnedNames;
            var rows = entries.Where(e => pinned.Contains(e.Name)).OrderBy(e => pinned.ToList().IndexOf(e.Name))
                .Concat(entries.Where(e => !pinned.Contains(e.Name) && !string.IsNullOrEmpty(e.Hotkey)).OrderBy(e => e.Name, StringComparer.CurrentCultureIgnoreCase))
                .Take(5)
                .Select(e => new TrayPanel.MacroRow(e.Name, string.IsNullOrEmpty(e.Hotkey) ? null : e.Hotkey, replaying && !clicker && e.Name == macro))
                .ToList();
            return new TrayPanel.Snapshot(macro, line, action, key, stops, rows,
                UserProfile.Current.ProfileKeyEnabled, settings.AutomationEnabled, triggerService?.ConfiguredArmedCount ?? 0,
                RemapService.Current.Enabled, RemapService.Current.Remaps.Count(r => r.Enabled), clicker,
                bridge?.PendingNotices ?? Array.Empty<(string, DateTime)>());
        }

        /// <summary>
        /// A macro row of the tray panel: runs it as its hotkey would, without the window. Nothing while
        /// something runs or in Clicker mode. A pending edit is saved first, as before any switch.
        /// </summary>
        // A notification's click that needs the page, held until the page is ready (a click that started
        // the app, or one in the moments before the page came up).
        private (string Action, string Name)? _pendingNotice;

        /// <summary>
        /// A click on one of the app's Windows notifications (WindowsNotices; the Tray board): Got it of
        /// "still running" puts that notice away for good, Turn it off disarms the macro's automation, Run
        /// again runs the macro as its hotkey would; anything else brings the window, at the page the
        /// button names (tray:command for the page).
        /// </summary>
        private void OnNoticeClicked(string action, string name)
        {
            switch (action)
            {
                case "still-running-done":
                    var settings = AppSettingsManager.Load();
                    settings.StillRunningNoticeDone = true;
                    AppSettingsManager.Save(settings);
                    return;
                case "automation-off":
                    if (bridge != null) bridge.DisarmAutomation(name);
                    else _pendingNotice = (action, name);
                    return;
                case "run-again":
                    RunMacroFromTray(name);
                    return;
            }
            windowEventManager?.BringToForeground();
            string? command = action switch
            {
                "settings" => "settings",
                "automation-open" => "automations",
                "dataloop-open" => "dataLoop",
                "remaps-open" => "remaps",
                "report-open" => "report",
                _ => null,
            };
            if (command == null) return;
            if (bridge == null || !_uiReadyEverReceived) { _pendingNotice = (action, name); return; }
            bridge.SendMessage("tray:command", new { command, name });
        }

        private void RunMacroFromTray(string name)
        {
            DispatcherQueue.TryEnqueue(async () =>
            {
                try
                {
                    if (bridge == null || mainController.IsReplayInProgress() || mainController.IsRecording() || bridge.UseCursorClick) return;
                    if (bridge.HasUnsavedActionWork && bridge.AutoSaveEnabled) await bridge.FlushAutoSaveAsync();
                    Services.DiagnosticLog.Info($"Tray panel: run '{name}'");
                    await RunProfileTriggerAsync(name, forceInfiniteLoop: false, isWhilePressedHold: false, hotkeyKey: null, startOnly: true);
                }
                catch (Exception ex)
                {
                    // async-void dispatcher lambda — an escaped exception would crash the app.
                    Services.DiagnosticLog.Error($"Tray panel run '{name}' failed", ex);
                }
            });
        }

        /// <summary>
        /// The Shortcuts switch — the macros' hotkeys and hotstrings, and the Key Remaps with them — from
        /// its hotkey or the tray. The status bar's switch goes through settings:change instead.
        /// </summary>
        private void SetShortcutsEnabled(bool newValue, string via)
        {
            UserProfile.Current.ProfileKeyEnabled = newValue;
            Services.DiagnosticLog.Info($"Profile Keys {(newValue ? "ENABLED" : "DISABLED")} via {via}");

            // Persist immediately. Without this, AppSettingsManager.ApplyGlobalSettings
            // (called whenever a profile is loaded — including the next profile-hotkey
            // press) reads the still-stale disk value and overwrites the in-memory toggle,
            // making the hotkey appear to "auto-revert" right after running a profile.
            var saved = AppSettingsManager.Load();
            saved.ProfileKeyEnabled = newValue;
            AppSettingsManager.Save(saved);

            if (bridge != null)
            {
                bridge.ProfileKeyEnabled = newValue;
                bridge.PushSettingsLoaded();
            }
            TrayIconService.UpdateTrayIcon();
        }

        public bool IsOnScreen => hwnd != IntPtr.Zero && NativeMethods.IsWindowVisible(hwnd);

        /// <summary>
        /// Rule 12 of the plan: with the window hidden in the tray, the WebView2 is hidden too and aims at
        /// low memory, and the page is told: it reads document.hidden, so its timers stand down, and every
        /// animation on it pauses (shell.css, data-window-hidden). Shown, all of it comes back. The page has
        /// to be told: under WinAppSDK 2.x an invisible WebView2 (IsVisible false, which collapsing the
        /// control gives) no longer turns the page hidden — it read "visible" in the tray and its
        /// animations ran on. Never TrySuspendAsync: the page keeps receiving the engine's messages while
        /// hidden. Called inside the window procedure (WindowEventManager).
        /// </summary>
        private void SetPageVisible(bool visible)
        {
            var core = WebView?.CoreWebView2;
            if (core == null) return;   // not up yet: NavigationCompleted applies the window's state
            try
            {
                WebView!.Visibility = visible ? Visibility.Visible : Visibility.Collapsed;
                core.MemoryUsageTargetLevel = visible ? Microsoft.Web.WebView2.Core.CoreWebView2MemoryUsageTargetLevel.Normal : Microsoft.Web.WebView2.Core.CoreWebView2MemoryUsageTargetLevel.Low;
                _ = core.ExecuteScriptAsync(PageHiddenScript + (visible ? "(false)" : "(true)"));
                Services.DiagnosticLog.Info(visible ? "[Window] shown: the page draws again, normal memory" : "[Window] hidden: the page stops drawing, low memory");
            }
            catch (Exception ex)
            {
                Services.DiagnosticLog.Warn($"[Window] page {(visible ? "shown" : "hidden")} with the window failed: {ex.Message}");
            }
        }

        // Makes document.hidden and document.visibilityState say whether the window is hidden (on top of
        // what the browser says), fires visibilitychange when that flips, and marks the root
        // (data-window-hidden). Installed by its first call, so a page loaded while hidden gets it too.
        private const string PageHiddenScript = @"((h) => {
  if (!window.__trWindowHidden) {
    let hidden = false;
    const real = (name) => Object.getOwnPropertyDescriptor(Document.prototype, name).get;
    const realHidden = real('hidden'), realState = real('visibilityState');
    Object.defineProperty(document, 'hidden', { configurable: true, get() { return hidden || realHidden.call(document); } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get() { return hidden ? 'hidden' : realState.call(document); } });
    window.__trWindowHidden = (next) => {
      if (next === hidden) return;
      hidden = next;
      document.documentElement.toggleAttribute('data-window-hidden', next);
      document.dispatchEvent(new Event('visibilitychange'));
    };
  }
  window.__trWindowHidden(h);
})";

        /// <summary>The compact view (WindowEventManager.SetCompact): the title bar's button, Ctrl+K, a run.</summary>
        public void SetCompact(bool on) => windowEventManager?.SetCompact(on);
        public void SetCompactRem(double remDip) => windowEventManager?.SetCompactRem(remDip);
        public bool IsCompact => windowEventManager?.IsCompact == true;
        public int CompactCaptionInset => windowEventManager?.CompactCaptionInset ?? 0;

        /// <summary>The compact layout's ×: the window to the tray, everything else still running.</summary>
        public void HideToTray() => windowEventManager?.HideToTray();

        /// <summary>
        /// Settings › General › Compact view while a macro runs (CompactWindow board): a macro run that
        /// starts while the user is in another app — or a switch to another app during one — turns the
        /// window compact. Not the Clicker's run (its page is the way to watch it), not a hidden or
        /// minimised window.
        /// </summary>
        public void OnRunStatus(string status)
        {
            if (status != "replaying" || bridge?.CompactWhileRunning != true || bridge.UseCursorClick) return;
            if (!IsOnScreen || IsCompact || NativeMethods.IsIconic(hwnd) || NativeMethods.GetForegroundWindow() == hwnd) return;
            Services.DiagnosticLog.Info("[Window] a macro runs with the window behind another app: compact view");
            SetCompact(true);
        }

        public void CancelUIWatchdog()
        {
            // Bump first: a tick may already be sitting on the dispatcher queue behind us, and
            // disposing the timer does nothing about that one. The stamp is what makes it a
            // no-op instead of a reload of the UI that just finished coming up.
            _watchdogEpoch++;
            _uiReadyWatchdog?.Dispose();
            _uiReadyWatchdog = null;
            _uiReloadAttempts = 0;
            _starvationCreditUsedMs = 0;
            // Every later load in this process is a warm one — see FirstLoadReadyGraceMs.
            _uiReadyEverReceived = true;
            // A notification's click that came before the page could take it.
            if (_pendingNotice is { } notice)
            {
                _pendingNotice = null;
                DispatcherQueue.TryEnqueue(() => OnNoticeClicked(notice.Action, notice.Name));
            }
            // UI is alive — reset the escalation counter so future crashes start back at level 1
            _consecutiveRecoveryAttempts = 0;
            _uiRecoveryExhausted = false;
            // ...and the counter that outlives the process. This chain of relaunches ended in a
            // working UI, so whatever goes wrong next is a new failure and deserves a full
            // budget rather than inheriting the spent one from an unrelated slow start.
            if (_uiRelaunchGeneration != 0)
            {
                Services.DiagnosticLog.Info(
                    $"UI ready after recovery relaunch #{_uiRelaunchGeneration} — restart budget restored");
                _uiRelaunchGeneration = 0;
            }
        }

        /// <summary>
        /// Arms (or re-arms) the ui:ready watchdog for the load that just completed. Periodic
        /// rather than one-shot: a tick that finds the deadline intact costs one enqueue, and
        /// keeping the heartbeat means a recovery level that never produces a NavigationCompleted
        /// still gets re-examined instead of leaving the app with no watchdog at all.
        /// </summary>
        private void ArmUIReadyWatchdog()
        {
            _uiReadyWatchdog?.Dispose();

            int epoch = ++_watchdogEpoch;
            int grace = _uiReadyEverReceived ? ReloadReadyGraceMs : FirstLoadReadyGraceMs;
            _uiReadyDeadlineTicks = Environment.TickCount64 + grace;
            _starvationCreditUsedMs = 0;

            _uiReadyWatchdog = new System.Threading.Timer(_ =>
            {
                // Pool thread. Stamp the moment the tick fired; the difference against the
                // dispatcher's clock below is the UI thread's unavailability, which is the
                // whole starvation measurement.
                long firedAtTicks = Environment.TickCount64;

                // Marshal onto the UI thread so every counter here (also touched by
                // CancelUIWatchdog and RecoverWebView) stays single-threaded — no data race
                // on the non-volatile fields.
                DispatcherQueue.TryEnqueue(() =>
                {
                    // Superseded by a newer arm, or cancelled by ui:ready, after this tick was
                    // already queued. Nothing to do.
                    if (epoch != _watchdogEpoch) return;

                    long nowTicks = Environment.TickCount64;
                    long lagMs = nowTicks - firedAtTicks;
                    if (lagMs >= StarvationLagFloorMs && _starvationCreditUsedMs < MaxStarvationCreditMs)
                    {
                        long credit = Math.Min(lagMs, StarvationCreditPerTickMs);
                        credit = Math.Min(credit, MaxStarvationCreditMs - _starvationCreditUsedMs);
                        long extended = nowTicks + credit;
                        // Max, not +=: when a backlog of stale ticks drains at once they all
                        // compute nearly the same target, so the extension collapses to one
                        // instead of compounding once per queued tick.
                        if (extended > _uiReadyDeadlineTicks)
                        {
                            _starvationCreditUsedMs += credit;
                            _uiReadyDeadlineTicks = extended;
                            Services.DiagnosticLog.Info(
                                $"ui:ready watchdog extended {credit} ms — UI thread was blocked " +
                                $"(total credit {_starvationCreditUsedMs}/{MaxStarvationCreditMs} ms)");
                        }
                    }

                    if (nowTicks < _uiReadyDeadlineTicks) return;

                    // Deadline blown with the app responsive. Re-arm the deadline BEFORE
                    // escalating: the timer is periodic, so without this the next tick one
                    // second later would escalate again and race straight down the ladder.
                    // A recovery level that does produce a NavigationCompleted re-arms with a
                    // fresh epoch anyway; this only bounds the case where it doesn't.
                    _uiReadyDeadlineTicks = nowTicks + (_uiReadyEverReceived ? ReloadReadyGraceMs : FirstLoadReadyGraceMs);
                    _starvationCreditUsedMs = 0;

                    if (_uiReloadAttempts >= MaxReloadAttempts)
                    {
                        // Exhausted watchdog attempts without a ui:ready — go nuclear.
                        RecoverWebView("watchdog max attempts — forcing restart");
                        return;
                    }
                    _uiReloadAttempts++;
                    RecoverWebView($"watchdog ({_uiReloadAttempts}/{MaxReloadAttempts}, {grace} ms grace)");
                });
            }, null, WatchdogTickMs, WatchdogTickMs);
        }

        /// <summary>
        /// Escalating WebView2 recovery. Triggered by ProcessFailed, watchdog timeout, or the
        /// tray "Reload UI" menu item. Goes through increasingly disruptive levels until the UI
        /// comes back or we give up and restart the process.
        ///   Level 1: CoreWebView2.Reload() — respawns renderer, preserves WebView state.
        ///   Level 2: CoreWebView2.Navigate(_targetUrl) — forces a fresh page load.
        ///   Level 3: Process.Start TrueReplayer.exe and exit current — nuclear option.
        /// Each level is tried once per recovery; if this is called while a previous recovery
        /// hasn't produced a ui:ready yet, we escalate to the next level.
        /// </summary>
        private void RecoverWebView(string reason)
        {
            // THIS request's level, taken now. The body below runs later, from the queue, and it
            // used to read the shared counter there: a crash reports itself twice (ProcessFailed,
            // then the failed navigation) before either body runs, so both read 2 — Level 1 was
            // skipped and Navigate issued twice — and a third near-simultaneous trigger (the
            // watchdog) sent every body straight to a process restart on the first real failure.
            int attempt = ++_consecutiveRecoveryAttempts;
            Services.DiagnosticLog.Warn($"Recovery requested — reason='{reason}', attempt #{attempt}");

            DispatcherQueue.TryEnqueue(() =>
            {
                // Level 1: Reload (cheapest)
                if (attempt == 1 && TryReload())
                {
                    Services.DiagnosticLog.Info("Recovery level 1 (Reload) issued");
                    return;
                }

                // Level 2: Navigate to stored URL
                if (attempt <= 2 && TryNavigate())
                {
                    Services.DiagnosticLog.Info("Recovery level 2 (Navigate) issued");
                    return;
                }

                // Level 3: Restart the entire process. The user's profile is already on disk,
                // so a fresh process reopens to the same state.
                if (_uiRelaunchGeneration >= MaxWatchdogRelaunches)
                {
                    // The replacement would inherit the same machine, the same install and the
                    // same slow disk, and it would come up with every counter in this class
                    // zeroed — which is precisely how "restart once more" becomes a relaunch
                    // loop the user experiences as an app that never opens. Stop restarting;
                    // say something the user can act on, then keep retrying the one step that
                    // costs nothing. Navigate churns no process and loses no state (the UI
                    // never came up, so there is nothing to lose), and the watchdog only lets
                    // us back here once per grace window — so this is a paced retry, not a
                    // spin, and it heals by itself if the cause clears (AV finishes its scan,
                    // a network share comes back).
                    ReportRecoveryExhausted(reason);
                    if (TryNavigate())
                        Services.DiagnosticLog.Info("Recovery: re-navigating instead of restarting (restart budget spent)");
                    return;
                }

                Services.DiagnosticLog.Warn("Recovery level 3: restarting process");
                TryRestartProcess();
            });
        }

        /// <summary>
        /// Terminal state for UI recovery: the ladder is spent and we will not restart the
        /// process again this session. Shown once — every later exhausted escalation just logs,
        /// so an automatic source such as ProcessFailed can't turn this into modal spam.
        /// </summary>
        private void ReportRecoveryExhausted(string reason)
        {
            if (_uiRecoveryExhausted) return;
            _uiRecoveryExhausted = true;

            Services.DiagnosticLog.Error(
                $"UI recovery exhausted (relaunch generation {_uiRelaunchGeneration}) — reason='{reason}'. " +
                "No further automatic process restarts this session.");

            // Whatever the page did manage to render beats an invisible window: a visible
            // failure is something the user can describe or screenshot.
            try { if (WebView != null) WebView.Opacity = 1; }
            catch (Exception ex) { Services.DiagnosticLog.Warn($"Reveal-on-exhaustion failed: {ex.Message}"); }

            var logsLine = string.IsNullOrEmpty(Services.DiagnosticLog.LogDirectory)
                ? ""
                : $"\n\nLogs: {Services.DiagnosticLog.LogDirectory}";

            // Native box, matching the navigation-failure path above: at this point the React
            // UI is exactly the thing that isn't working, so it can't be asked to render this.
            NativeMethods.MessageBoxW(hwnd,
                $"{AppIdentity.DisplayName}'s interface didn't finish loading, and restarting the app didn't help.\n\n" +
                "The app is still running — right-click its tray icon and choose \"Reload UI\" to try " +
                "again, or \"Open logs folder\" to see what failed.\n\n" +
                $"If it keeps happening, allow-list {AppIdentity.DisplayName}'s install folder in your antivirus, " +
                "then reinstall or repair the app." + logsLine,
                AppIdentity.DisplayName, NativeMethods.MB_ICONERROR);
        }

        /// <summary>
        /// Reads the relaunch generation this process was started with, if any. Zero means a
        /// normal launch — user, autostart, or Velopack after an update — and therefore a full
        /// recovery budget. See the RelaunchArgPrefix declaration for why the command line.
        /// </summary>
        private static int ReadRelaunchGeneration()
        {
            try
            {
                foreach (var arg in Environment.GetCommandLineArgs())
                {
                    if (!arg.StartsWith(RelaunchArgPrefix, StringComparison.OrdinalIgnoreCase)) continue;
                    if (int.TryParse(arg.Substring(RelaunchArgPrefix.Length), out var generation) && generation > 0)
                    {
                        Services.DiagnosticLog.Warn(
                            $"Started as UI-recovery relaunch #{generation} — " +
                            $"{(generation >= MaxWatchdogRelaunches ? "no further automatic restarts" : "restart budget remaining")}");
                        return generation;
                    }
                }
            }
            catch (Exception ex)
            {
                Services.DiagnosticLog.Warn($"Relaunch-generation parse failed: {ex.Message}");
            }
            return 0;
        }

        private bool TryReload()
        {
            try
            {
                var cw2 = WebView?.CoreWebView2;
                if (cw2 == null)
                {
                    Services.DiagnosticLog.Warn("Reload() skipped: CoreWebView2 is null");
                    return false;
                }
                cw2.Reload();
                return true;
            }
            catch (Exception ex)
            {
                Services.DiagnosticLog.Error("Reload() threw", ex);
                return false;
            }
        }

        private bool TryNavigate()
        {
            try
            {
                var cw2 = WebView?.CoreWebView2;
                if (cw2 == null || string.IsNullOrEmpty(_targetUrl))
                {
                    Services.DiagnosticLog.Warn($"Navigate() skipped: cw2Null={cw2 == null}, urlEmpty={string.IsNullOrEmpty(_targetUrl)}");
                    return false;
                }
                cw2.Navigate(_targetUrl);
                return true;
            }
            catch (Exception ex)
            {
                Services.DiagnosticLog.Error("Navigate() threw", ex);
                return false;
            }
        }

        private static void OpenLogsFolder()
        {
            try
            {
                var dir = Services.DiagnosticLog.LogDirectory;
                if (string.IsNullOrEmpty(dir) || !Directory.Exists(dir))
                {
                    Services.DiagnosticLog.Warn("Open Logs: directory missing");
                    return;
                }
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "explorer.exe",
                    Arguments = $"\"{dir}\"",
                    UseShellExecute = true,
                });
            }
            catch (Exception ex)
            {
                Services.DiagnosticLog.Error("Open Logs Folder failed", ex);
            }
        }

        private void TryRestartProcess()
        {
            try
            {
                string? exePath = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName;
                if (string.IsNullOrEmpty(exePath))
                {
                    Services.DiagnosticLog.Error("Restart aborted: can't resolve exe path");
                    return;
                }

                // Hand the recovery generation to the replacement. Nothing else survives this
                // boundary: every attempt counter in this class is an instance field, so without
                // the argument the new process starts its ladder at zero, meets the same
                // slowness, and relaunches again — forever.
                int nextGeneration = _uiRelaunchGeneration + 1;
                var startInfo = new System.Diagnostics.ProcessStartInfo
                {
                    FileName = exePath,
                    // --startup travels with the relaunch for the same reason it travels with the
                    // update restart: the flag is produced only by the Run registry key and is the
                    // sole input to "start hidden in the tray", so a recovery relaunch without it
                    // reopens the window over whatever the user is doing — and an open window
                    // breaks any pixel or image watcher whose region it covers. The update path
                    // learned this; this one was left behind.
                    Arguments = RelaunchArgPrefix + nextGeneration.ToString(System.Globalization.CultureInfo.InvariantCulture)
                                + (App.HasStartupFlag() ? " --startup" : "")
                                // The replacement waits for THIS process to be gone before it
                                // claims the instance (Program.WaitForPredecessor): the flush below
                                // closed one race for the mutex, but everything after Process.Start
                                // — the teardown, the log's own exit flush, the CLR going down — is
                                // still a window in which the child found the mutex held and exited
                                // in silence, and in which our WebView2 still held the data folder.
                                + " " + Program.WaitForPidArg + Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    UseShellExecute = true,
                };
                // Bypasses ForceExit — flush the debounced run cursors before the process dies,
                // and BEFORE the replacement gets far enough to read the sidecar. Same for the
                // debounced automation stats.
                //
                // These run BEFORE the launch, not after it. Each flush goes through MoveWithRetry,
                // whose backoff ladder sleeps up to 3.81 s when the target is held — and the very
                // conditions that drive the watchdog to a level-3 restart (antivirus scanning a
                // freshly extracted folder, a stalled disk) are the same ones that make the move
                // retry. Launching first therefore raced the child to the single-instance mutex
                // across a window seconds wide; the child that wins sees createdNew false and exits
                // in silence, and the parent then exits too. Zero TrueReplayer processes, no tray
                // icon, no daemon, and a last log line reading "Launched replacement process".
                //
                // Flushing first also makes the sentence above literally true rather than a hope.
                Services.AppExit.FlushState();
                System.Diagnostics.Process.Start(startInfo);
                Services.DiagnosticLog.Info($"Launched replacement process (recovery relaunch #{nextGeneration}), exiting current");
                // Everything this process holds on the system — the replay's pressed keys, the
                // remap layer's injected ones, the hooks, the tray icon the replacement is about to
                // add its own next to. Deliberately AFTER Process.Start: if the launch throws we
                // return without exiting and this process keeps running, and it needs all of them.
                // Each step is guarded inside, so nothing here can skip Environment.Exit(0) and
                // leave two live processes.
                Services.AppExit.ReleaseSystem();
                Environment.Exit(0);
            }
            catch (Exception ex)
            {
                Services.DiagnosticLog.Error("Restart failed", ex);
            }
        }

        public void UpdateAlwaysOnTop(bool isAlwaysOnTop)
        {
            windowEventManager?.UpdateAlwaysOnTop(isAlwaysOnTop);
        }

        /// <summary>The widths (DIP) a dragged edge sticks to: the page's layout band edges (window:snapWidths).</summary>
        public void SetResizeSnapWidths(System.Collections.Generic.IEnumerable<int> widthsDip)
        {
            windowEventManager?.SetResizeSnapWidths(widthsDip);
        }

        public bool IsMinimizeToTrayEnabled()
        {
            return UserProfile.Current.MinimizeToTray;
        }

        /// <summary>
        /// Paints the native layer under the WebView2 — the root Grid and the WebView2's own default
        /// background — with the theme's base colour (#rrggbb). Called with the colour saved from the
        /// last session at construction, and again on every theme push (WebViewBridge.HandleThemeColors),
        /// so a recovery that hides the WebView shows the current theme too. Anything unreadable
        /// leaves the XAML default.
        /// </summary>
        public void ApplyWindowBackground(string? hex)
        {
            if (ProfileController.ParseCssHex(hex) is not { } c) return;
            var color = Microsoft.UI.ColorHelper.FromArgb(255, c.R, c.G, c.B);
            RootGrid.Background = new Microsoft.UI.Xaml.Media.SolidColorBrush(color);
            WebView.DefaultBackgroundColor = color;
        }

        [DllImport("user32.dll")]
        private static extern IntPtr LoadImage(IntPtr hInst, string lpszName, uint uType, int cxDesired, int cyDesired, uint fuLoad);

        [DllImport("user32.dll")]
        private static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);
    }
}
