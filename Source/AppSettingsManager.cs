using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using TrueReplayer.Models;

namespace TrueReplayer.Services
{
    public static class AppSettingsManager
    {
        private const string FileName = "appsettings.json";

        public class AppSettings
        {
            // Window
            public bool AlwaysOnTop { get; set; } = false;
            public bool MinimizeToTray { get; set; } = true;
            public bool RunOnStartup { get; set; } = true;
            public bool StartMinimized { get; set; } = true;
            // Notifications — out-of-window run-end cues (UI Wave 3). The window is
            // usually BEHIND the game while a replay runs, so the in-window status
            // pills are invisible exactly when they matter. Both opt-in (owner
            // decision) — some users find a taskbar flash intrusive.
            public bool RunEndFlash { get; set; } = false;
            public bool RunEndSound { get; set; } = false;
            // Execution
            public bool UseCustomDelay { get; set; } = true;
            public int CustomDelay { get; set; } = 100;
            public bool UseDelayVariation { get; set; } = false;
            public int DelayVariation { get; set; } = 1;
            // Loop settings are the "No Profile" FALLBACK only — every real profile carries its
            // own EnableLoop/LoopCount/LoopIntervalEnabled/LoopInterval (serialized in its
            // profile.json). ApplyGlobalSettings deliberately does NOT stamp these onto the
            // loaded profile; WebViewBridge's mirrors are their live home. LoopCount defaults to
            // 1, not 0: the engine reads 0 as "forever", and an unattended forever-run owns the
            // single replay engine with no reachable Stop. Infinite is now reachable ONLY via
            // the WhilePressed / Toggle trigger modes.
            public bool EnableLoop { get; set; } = false;
            public int LoopCount { get; set; } = 1;
            public bool LoopIntervalEnabled { get; set; } = false;
            public int LoopInterval { get; set; } = 200;
            // Smooth mouse movement (Game Mode) — interpolated cursor path so games that reject a
            // single large "teleport" (e.g. Roblox) follow the cursor. See ActionReplayer.SmoothMovement.
            // The default every profile without its own follows, OFF like RestoreCursor: a game
            // profile turns it on for itself. A file written by an older build always carries the
            // key (it serializes every field), so this only reaches a new install and Reset.
            public bool SmoothMovement { get; set; } = false;
            // Cursor return at the end of a macro run — the default every profile without its own
            // follows. Off = today's behaviour. See ActionReplayer.RestoreCursorDefault.
            public bool RestoreCursor { get; set; } = false;
            public int MoveStepPx { get; set; } = 20;
            public int MoveStepDelayMs { get; set; } = 2;
            public int MoveClickDelayMs { get; set; } = 10;
            // Fast approach (jump-and-settle): teleport far moves, smooth only the final
            // SettleDistancePx. See ActionReplayer.FastApproach.
            public bool FastApproach { get; set; } = true;
            public int SettleDistancePx { get; set; } = 80;
            public bool UseCursorClick { get; set; } = false;
            public string CursorClickButton { get; set; } = "Left";
            // Clicker v2 — dedicated Clicker settings, independent of the active profile.
            // The -1 sentinel on the delay field marks "not yet migrated"; on first load the
            // bridge will copy the active profile's customDelay/jitter/loops/interval into
            // these fields so upgrading users see no behavioural change.
            public int CursorClickDelayMs { get; set; } = -1;
            public int CursorClickDelayJitterPct { get; set; } = 1;
            public bool CursorClickUseJitter { get; set; } = false;
            public int CursorClickHoldMs { get; set; } = 10;
            public int CursorClickPositionJitter { get; set; } = 1;
            public bool CursorClickUsePositionJitter { get; set; } = false;
            // Click area — rectangle on screen where each click lands at a random point inside.
            // Mutually exclusive with CursorClickUsePositionJitter (UI enforces). Coordinates are
            // virtual-desktop pixels (top-left origin, can be negative on multi-monitor setups).
            public bool CursorClickUseArea { get; set; } = false;
            public int CursorClickAreaX { get; set; } = 0;
            public int CursorClickAreaY { get; set; } = 0;
            public int CursorClickAreaW { get; set; } = 0;
            public int CursorClickAreaH { get; set; } = 0;
            // Fixed-point click mode. UseFixed is the on/off toggle; PointSet distinguishes a
            // picked coordinate (click exactly at X,Y) from "lock on start" (PointSet=false →
            // capture the cursor at the first click). Both preserved independently so toggling
            // off / clearing the point don't lose the other.
            public bool CursorClickUseFixed { get; set; } = false;
            public bool CursorClickFixedPointSet { get; set; } = false;
            public int CursorClickFixedX { get; set; } = 0;
            public int CursorClickFixedY { get; set; } = 0;
            public int CursorClickLoops { get; set; } = 0;
            public bool CursorClickUseLoops { get; set; } = false;
            public int CursorClickIntervalMs { get; set; } = 200;
            public bool CursorClickUseInterval { get; set; } = false;
            // Wall-clock cap on a run, paired with its own enable like every other clicker
            // limit. Stored in MS for consistency with the rate; the panel shows seconds.
            // 0 (or the toggle off) means no cap. An absent property on an older
            // appsettings.json falls through to these initializers, so no migration.
            public int CursorClickMaxDurationMs { get; set; } = 60000;
            public bool CursorClickUseMaxDuration { get; set; } = false;
            // Game-compatible cursor movement for the Clicker (interpolated path + fast
            // approach). OFF by default: it only matters when the cursor actually moves —
            // Fixed and especially Area — and it costs time inside every tick that does.
            public bool CursorClickGameMove { get; set; } = false;
            // Clicker-exclusive hotkeys — fully decoupled from the global macro hotkeys.
            // Default PageDown = Start/Stop, PageUp = Pause/Resume. Active only in Clicker mode.
            public string CursorClickStartHotkey { get; set; } = "PageDown";
            public string CursorClickPauseHotkey { get; set; } = "PageUp";
            // Named snapshots of the Clicker settings above (WebViewBridge.HandleSaveClickerPreset).
            // Absent on an older appsettings.json → empty list, no migration.
            public List<ClickerPreset> ClickerPresets { get; set; } = new();
            // Recording
            public bool RecordMouse { get; set; } = true;
            public bool RecordScroll { get; set; } = true;
            public bool RecordKeyboard { get; set; } = true;
            // Combined recording: when ON, a key press / mouse click is captured as a SINGLE
            // Keystroke / *Click action instead of the paired Down+Up. Default ON — turning the
            // toggle OFF restores the exact legacy paired behaviour. Consumed by ActionRecorder's
            // combined branch. Also the value the Reset-settings flow restores (it reads this
            // class default), so resetting returns to combined recording.
            public bool RecordCombinedInput { get; set; } = true;
            // Hotkeys
            public string RecordingHotkey { get; set; } = HotkeyDefaults.Recording;
            public string ReplayHotkey { get; set; } = HotkeyDefaults.Replay;
            public string ProfileKeyToggleHotkey { get; set; } = HotkeyDefaults.ProfileKeyToggle;
            public string ForegroundHotkey { get; set; } = HotkeyDefaults.Foreground;
            public string ModeToggleHotkey { get; set; } = HotkeyDefaults.ModeToggle;
            // Capture-selection → clipboard slot. Win+Ctrl+C by owner request (2026-07-19):
            // a three-key Win combo is safe to claim by default — nothing in the shell binds
            // it out of the box, and the low-level hook suppresses the shell's own handling
            // anyway. (It used to default to empty precisely to avoid swallowing a key
            // system-wide; a Win-modified combo is the compromise.) Clearable in
            // Settings → Keys → Hotkeys, where empty still means disabled.
            public string CaptureSlotHotkey { get; set; } = HotkeyDefaults.CaptureSlot;
            // Copy screen text (OCR → clipboard): Win+F12 by default, empty = disabled. Region "" = drag each time,
            // "x,y,w,h" (absolute) = always read that region.
            public string CopyScreenTextHotkey { get; set; } = HotkeyDefaults.CopyScreenText;
            public string CopyScreenTextRegion { get; set; } = "";
            // OCR recognizer language tag. "" = Auto (the user's profile languages). Português by
            // default (OcrService.DefaultLanguage); a file from an older build keeps the "" it wrote.
            public string OcrLanguage { get; set; } = OcrService.DefaultLanguage;
            public bool ProfileKeyEnabled { get; set; } = true;
            public bool BrowserSelectorEnabled { get; set; } = true;
            // Automation master switch — armed per-profile triggers only run while this is on.
            // Default ON: the per-trigger Armed flag is the real opt-in.
            public bool AutomationEnabled { get; set; } = true;
            public bool RunAsAdmin { get; set; } = false;
            // Sharing — first-time warning shown before importing any .trprofile so the user
            // knows imported profiles execute arbitrary input. Flips to true permanently once
            // the user ticks "Don't show again" on the warning dialog. Saved to appsettings.json
            // so it survives reinstalls (same Documents folder as the rest of the file).
            public bool HasAcknowledgedImportWarning { get; set; } = false;
            // The last theme's base colour as opaque #rrggbb (the frontend's theme:colors push).
            // Painted by the native window before the WebView2 has loaded anything — see
            // MainWindow.ApplyWindowBackground. Null until a theme has been seen once.
            public string? WindowBackground { get; set; }
        }

        // One saved Clicker setup. Ints and bools like AppSettings (the bridge mirrors are strings
        // for the textbox-backed fields; a preset stores what the engine reads). The "where" modes
        // are stored as saved — the bridge re-applies the Area > Fixed > Position mutex on apply,
        // so a hand-edited file cannot switch two of them on at once. Serialized through the same
        // source-generated context as AppSettings (the generator follows property types).
        public class ClickerPreset
        {
            public string Name { get; set; } = "";
            public string Button { get; set; } = "Left";
            public int DelayMs { get; set; } = 100;
            public int DelayJitterPct { get; set; } = 1;
            public bool UseJitter { get; set; }
            public int HoldMs { get; set; } = 10;
            public int PositionJitter { get; set; } = 1;
            public bool UsePositionJitter { get; set; }
            public bool UseArea { get; set; }
            public int AreaX { get; set; }
            public int AreaY { get; set; }
            public int AreaW { get; set; }
            public int AreaH { get; set; }
            public bool UseFixed { get; set; }
            public bool FixedPointSet { get; set; }
            public int FixedX { get; set; }
            public int FixedY { get; set; }
            public int Loops { get; set; }
            public bool UseLoops { get; set; }
            public int IntervalMs { get; set; } = 200;
            public bool UseInterval { get; set; }
            public int MaxDurationMs { get; set; } = 60000;
            public bool UseMaxDuration { get; set; }
            public bool GameMove { get; set; }
        }

        // The settings as they should be on disk while the last write FAILED; null when the disk is
        // current. Load() answers from it, because callers treat Load() as the truth: every profile
        // activation re-stamps the hotkeys from it (ApplyGlobalSettings), and SaveGlobalSettings
        // rebuilds the next write from those stamped values. A hotkey change whose write lost to a
        // OneDrive lock therefore reverted in memory at the next activation — the old hotkey armed,
        // the panel still showing the new one — and the next unrelated settings change wrote the
        // old one back for good.
        private static readonly object _writeLock = new();
        private static string? _unwrittenJson;

        // The last file text this session read AND parsed. A later read that fails on a lock
        // answers from it instead of from class defaults: every settings write here is a
        // read-modify-write (SaveGlobalSettings, the theme colour, the tray toggles), and a
        // defaults answer turned one unrelated change into a write of defaults over everything.
        private static string? _lastGoodJson;

        // The file was PRESENT but could not be read, before any read of it had succeeded: what
        // the app then built from Load() is class defaults, not the user's settings. For the rest
        // of the session nothing is written over the file — see WriteLocked. Not cleared by a later
        // successful read: the state seeded from defaults at boot stays in memory regardless.
        private static bool _unreadableThisSession;

        // The corrupt file is copied aside once per session, before anything can overwrite it.
        private static bool _corruptBackedUp;

        /// <summary>True while a failed write is pending (see <see cref="Save"/>).</summary>
        public static bool HasUnwrittenSettings { get { lock (_writeLock) return _unwrittenJson != null; } }

        /// <summary>
        /// True when appsettings.json existed but could not be read before any successful read this
        /// session — the app is running on defaults and will not write the file (see WriteLocked).
        /// The boot sequence reports it; the WebViewBridge ctor skips its migration save on it.
        /// </summary>
        public static bool IsUnreadableThisSession { get { lock (_writeLock) return _unreadableThisSession; } }

        /// <summary>
        /// Persists <paramref name="settings"/>. False when the write failed: the values are then
        /// kept in memory — Load() returns them — and the next Save (or RetryUnwritten on exit)
        /// tries again.
        /// </summary>
        public static bool Save(AppSettings settings)
        {
            string json;
            try { json = JsonSerializer.Serialize(settings, AppSettingsJsonContext.Default.AppSettings); }
            catch (Exception ex)
            {
                TrueReplayer.Services.DiagnosticLog.Error("Failed to serialize appsettings.json", ex);
                return false;
            }
            lock (_writeLock) return WriteLocked(json);
        }

        /// <summary>Retries a pending failed write. Exit paths call it; a no-op when nothing is pending.</summary>
        public static void RetryUnwritten()
        {
            lock (_writeLock)
            {
                if (_unwrittenJson != null) WriteLocked(_unwrittenJson);
            }
        }

        // Caller holds _writeLock.
        private static bool WriteLocked(string json)
        {
            if (_unreadableThisSession)
            {
                // Kept in memory like a failed write — Load() answers from it, so the session stays
                // consistent with its own changes — but never put on disk: it was built on defaults,
                // and writing it would replace the user's real settings with them.
                _unwrittenJson = json;
                TrueReplayer.Services.DiagnosticLog.Warn(
                    "appsettings.json NOT written: it could not be read when this session started, so these values " +
                    "were built on defaults. Restart TrueReplayer to load the file.");
                return false;
            }
            try
            {
                string path = GetPath();
                // GetPath used to CreateDirectory on every call, which is what guaranteed the write
                // below had somewhere to land even if the folder was removed mid-session. The path
                // is cached now, so the guarantee moves here — to the write path that actually needs
                // it, instead of being paid by every read.
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                FileHelper.WriteAllTextAtomic(path, json);
                _unwrittenJson = null;
                _lastGoodJson = json;   // what is on disk now — a later locked read answers with THIS
                return true;
            }
            catch (Exception ex)
            {
                _unwrittenJson = json;
                TrueReplayer.Services.DiagnosticLog.Error("Failed to save appsettings.json — the new values are kept in memory and the next save retries", ex);
                return false;
            }
        }

        public static AppSettings Load()
        {
            string? unwritten;
            lock (_writeLock) unwritten = _unwrittenJson;
            if (unwritten != null)
            {
                try { return JsonSerializer.Deserialize(unwritten, AppSettingsJsonContext.Default.AppSettings) ?? new AppSettings(); }
                catch { /* cannot happen for JSON this class serialized; fall through to the disk */ }
            }

            string path = GetPath();

            if (!File.Exists(path))
                return new AppSettings();

            // UNREADABLE and CORRUPT are different answers. A lock (a scanner, OneDrive, the indexer
            // at boot) used to land in the same catch as bad JSON and come back as class defaults —
            // and the WebViewBridge ctor saves on a default it recognises (CursorClickDelayMs = -1),
            // so the user's hotkeys, presets and RunAsAdmin were replaced within the same boot.
            if (!TrueReplayer.Services.FileHelper.TryReadAllTextShared(path, out var json, out var readError))
            {
                string? lastGood;
                lock (_writeLock)
                {
                    lastGood = _lastGoodJson;
                    if (lastGood == null) _unreadableThisSession = true;
                }
                if (lastGood != null)
                {
                    TrueReplayer.Services.DiagnosticLog.Warn(
                        $"appsettings.json could not be read ({readError?.Message}) — answering with the values last read this session");
                    try { return JsonSerializer.Deserialize(lastGood, AppSettingsJsonContext.Default.AppSettings) ?? new AppSettings(); }
                    catch { return new AppSettings(); } // cannot happen: it parsed when it was cached
                }
                TrueReplayer.Services.DiagnosticLog.Error(
                    "appsettings.json exists but could not be read — running on defaults this session, and the file " +
                    "will NOT be written until TrueReplayer is restarted", readError ?? new IOException("unknown read failure"));
                return new AppSettings();
            }

            try
            {
                var parsed = JsonSerializer.Deserialize(json, AppSettingsJsonContext.Default.AppSettings) ?? new AppSettings();
                lock (_writeLock) _lastGoodJson = json;
                return parsed;
            }
            catch (Exception ex)
            {
                // Corrupt appsettings.json → fallback to defaults resets hotkeys, RunAsAdmin,
                // ProfileKeyEnabled, etc. Make that durable in the session log, not just the debugger,
                // and copy the file aside first: it is hand-editable, the next save replaces it, and a
                // typo should not cost the rest of what was in it.
                TrueReplayer.Services.DiagnosticLog.Error(
                    "Failed to load appsettings.json — falling back to defaults (hotkeys / RunAsAdmin / ProfileKeyEnabled reset)", ex);
                BackupCorrupt(path);
                return new AppSettings();
            }
        }

        private static void BackupCorrupt(string path)
        {
            lock (_writeLock)
            {
                if (_corruptBackedUp) return;
                _corruptBackedUp = true;
            }
            string backup = path + ".corrupt";
            try
            {
                File.Copy(path, backup, overwrite: true);
                TrueReplayer.Services.DiagnosticLog.Warn($"The unreadable appsettings.json was copied to {backup}");
            }
            catch (Exception ex)
            {
                TrueReplayer.Services.DiagnosticLog.Error($"Could not copy the corrupt appsettings.json to {backup}", ex);
            }
        }

        /// <summary>
        /// Makes <paramref name="profile"/> the current one with the global settings already on it.
        /// The order matters: the input hooks read UserProfile.Current from their own thread, and
        /// publishing first left a window — while Load() read appsettings.json from disk — in which
        /// a key press saw the class defaults: Profile Keys on, and the factory Record and Replay
        /// keys, whatever the user had set.
        /// </summary>
        public static void ActivateProfile(UserProfile profile)
        {
            ApplyGlobalSettings(profile);
            UserProfile.Current = profile;
        }

        public static void ApplyGlobalSettings(UserProfile profile)
        {
            var s = Load();
            profile.AlwaysOnTop = s.AlwaysOnTop;
            profile.MinimizeToTray = s.MinimizeToTray;
            profile.StartMinimized = s.StartMinimized;
            profile.RunEndFlash = s.RunEndFlash;
            profile.RunEndSound = s.RunEndSound;
            profile.RecordMouse = s.RecordMouse;
            profile.RecordScroll = s.RecordScroll;
            profile.RecordKeyboard = s.RecordKeyboard;
            profile.UseCustomDelay = s.UseCustomDelay;
            profile.CustomDelay = s.CustomDelay;
            // Loop/Interval are NOT stamped here. They used to be — which is why removing
            // [JsonIgnore] from UserProfile.LoopCount alone was a no-op: this method runs on
            // EVERY profile activation (ActivateProfile), so the global overwrote the value
            // that had just been read off disk. The profile's own values now survive activation;
            // the "No Profile" fallback lives in the WebViewBridge mirrors (see BuildLoopConfig).
            // Smooth-movement settings live on ActionReplayer statics (global runtime config),
            // not on the profile — load them straight into those statics.
            ActionReplayer.SmoothMovement = s.SmoothMovement;
            ActionReplayer.RestoreCursorDefault = s.RestoreCursor;
            ActionReplayer.MoveStepPx = s.MoveStepPx;
            ActionReplayer.MoveStepDelayMs = s.MoveStepDelayMs;
            ActionReplayer.MoveClickDelayMs = s.MoveClickDelayMs;
            ActionReplayer.FastApproach = s.FastApproach;
            ActionReplayer.SettleDistancePx = s.SettleDistancePx;
            profile.RecordingHotkey = s.RecordingHotkey;
            profile.ReplayHotkey = s.ReplayHotkey;
            profile.ProfileKeyToggleHotkey = s.ProfileKeyToggleHotkey;
            profile.ForegroundHotkey = s.ForegroundHotkey;
            profile.ModeToggleHotkey = s.ModeToggleHotkey;
            profile.CaptureSlotHotkey = s.CaptureSlotHotkey;
            profile.CopyScreenTextHotkey = s.CopyScreenTextHotkey ?? "";
            profile.CopyScreenTextRegion = s.CopyScreenTextRegion ?? "";
            OcrService.PreferredLanguage = s.OcrLanguage ?? "";
            profile.ProfileKeyEnabled = s.ProfileKeyEnabled;
            profile.AutomationEnabled = s.AutomationEnabled;
            // Keep the daemon's runtime master in lockstep with every settings reload —
            // there is no change-notification mechanism to deliver it otherwise.
            TriggerService.Instance?.SetGlobalEnabled(s.AutomationEnabled);

            // Sync the Run on Startup registry key with the saved setting on every launch. Uses a
            // value-aware reconcile (not just "does the key exist") so a stale entry — e.g. one
            // left by an older version or a moved/deleted copy — is rewritten to point at the
            // current exe instead of silently failing to autostart.
            Services.TrayIconService.SyncStartupRegistration(s.RunOnStartup);
        }

        // Resolved once per process. Load() is not cached and is called from ~25 sites (seven of
        // them before the window is even interactive), and every one of those paid the
        // CreateDirectory + two File.Exists below — for a path that cannot change and a one-shot
        // migration that can only ever fire on the FIRST call: once the file has moved, or was
        // already at the new location, File.Exists(oldPath) && !File.Exists(newPath) is false
        // forever. Lazy, not a field initializer, so the directory work still happens on first
        // use rather than at type load.
        private static string? _cachedPath;

        private static string GetPath() => _cachedPath ??= ResolvePath();

        private static string ResolvePath()
        {
            // Store in Documents/TrueReplayer so settings survive app updates
            string dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                "TrueReplayer");
            Directory.CreateDirectory(dir);

            // Migrate from old location (app install folder) if exists
            string oldPath = Path.Combine(AppContext.BaseDirectory, FileName);
            string newPath = Path.Combine(dir, FileName);
            if (File.Exists(oldPath) && !File.Exists(newPath))
            {
                try { File.Move(oldPath, newPath); }
                catch { /* best effort */ }
            }

            return newPath;
        }
    }
}
