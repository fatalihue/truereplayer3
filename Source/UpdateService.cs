using System;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Velopack;
using Velopack.Sources;

namespace TrueReplayer.Services
{
    public static class UpdateService
    {
        /// <summary>
        /// The release feed: a folder on this machine that the previews are packed into
        /// (<see cref="AppIdentity.UpdateFeedDir"/>; plan truereplayer3-paralelo-2026-10-30.md,
        /// decision 2). TrueReplayer 3 has no public release while it runs beside TrueReplayer 2, and
        /// it must never read TrueReplayer 2's feed: every installed TrueReplayer 2 reads the newest
        /// release of TrueReplayer-releases, so that repository can only ever carry TrueReplayer 2.
        /// A missing folder is an ordinary "no update": SimpleFileSource reads it as an empty feed and
        /// says so only to Velopack's own logger, so <see cref="CheckForUpdateAsync"/> logs which
        /// folder it reads.
        /// </summary>
        private static readonly UpdateManager _manager = new(
            new SimpleFileSource(new DirectoryInfo(AppIdentity.UpdateFeedDir)));

        private static UpdateInfo? _pendingUpdate;

        public static bool IsInstalled => _manager.IsInstalled;

        public static string? CurrentVersion => _manager.IsInstalled
            ? _manager.CurrentVersion?.ToString()
            : null;

        /// <summary>
        /// Checks the feed for a newer version.
        /// Returns the new version string, or null if up-to-date.
        /// </summary>
        // Bounds the GitHub round-trip. Velopack's CheckForUpdatesAsync has no hard ceiling, so a
        // slow/unreachable release server could leave the check pending indefinitely. With the
        // startup splash now non-blocking this is no longer user-visible, but a bounded check keeps
        // the manual "Check for Updates" responsive and stops a wedged background task lingering.
        private static readonly TimeSpan CheckTimeout = TimeSpan.FromSeconds(10);

        // One retry, and only after a THROWN failure. The check runs once per launch with no timer
        // and no poll behind it (see the note in WebViewBridge), so a single 504 from the release
        // host used to cost the whole session — and the minutes right after a release, when an
        // update actually exists, are exactly when that host is most likely to hiccup.
        //
        // A TIMEOUT deliberately does not retry. CheckForUpdatesAsync takes no CancellationToken,
        // so a timed-out attempt is still in flight; starting a second would stack two
        // uncancellable calls against the same host rather than replace one.
        private const int CheckAttempts = 2;
        private static readonly TimeSpan RetryDelay = TimeSpan.FromSeconds(3);

        public static async Task<string?> CheckForUpdateAsync()
        {
            // The feed, whether it is there, and whether this copy is the installed one: a preview
            // packed where this copy cannot see it is otherwise a silent "up to date".
            DiagnosticLog.Info($"[UpdateService] Feed {AppIdentity.UpdateFeedDir} ({(Directory.Exists(AppIdentity.UpdateFeedDir) ? "present" : "missing")}); Velopack install: {_manager.IsInstalled}; install location: {TrayIconService.IsInstalledLocation()}");
            if (!_manager.IsInstalled)
                return null;

            for (int attempt = 1; ; attempt++)
            {
                try
                {
                    using var timeoutCts = new CancellationTokenSource();
                    var checkTask = _manager.CheckForUpdatesAsync();
                    var timeoutTask = Task.Delay(CheckTimeout, timeoutCts.Token);
                    if (await Task.WhenAny(checkTask, timeoutTask) != checkTask)
                    {
                        // Velopack's CheckForUpdatesAsync exposes no CancellationToken overload, so the
                        // round-trip can't be aborted — but observe its eventual outcome so a late
                        // fault doesn't bubble up as a noisy UnobservedTaskException.
                        _ = checkTask.ContinueWith(
                            t => DiagnosticLog.Warn(
                                $"[UpdateService] Update check finished after timeout: {t.Exception?.GetBaseException().Message ?? "completed"}"),
                            TaskScheduler.Default);
                        DiagnosticLog.Warn("[UpdateService] Update check timed out — release server slow/unreachable; treating as up-to-date this run");
                        return null;
                    }
                    timeoutCts.Cancel(); // check won the race — stop the pending Task.Delay timer
                    _pendingUpdate = await checkTask; // already completed
                    return _pendingUpdate?.TargetFullRelease?.Version?.ToString();
                }
                catch (Exception ex) when (attempt < CheckAttempts)
                {
                    DiagnosticLog.Warn($"[UpdateService] Check attempt {attempt} failed ({ex.Message}) — retrying in {RetryDelay.TotalSeconds:0}s");
                    await Task.Delay(RetryDelay).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    DiagnosticLog.Warn($"[UpdateService] Check failed after {attempt} attempt(s): {ex.Message}");
                    return null;
                }
            }
        }

        /// <summary>
        /// The pending update's markdown release notes, which travel inside the package
        /// (<c>vpk pack --releaseNotes</c>), parsed into a list of bullet points suitable for the
        /// changelog panel. Empty when the package carries none. Still a Task, so the callers that
        /// awaited the network fetch this replaced need no change.
        /// </summary>
        public static Task<List<string>> GetPendingReleaseNotesAsync()
        {
            var notes = _pendingUpdate?.TargetFullRelease?.NotesMarkdown;
            return Task.FromResult(string.IsNullOrWhiteSpace(notes)
                ? new List<string>()
                : ParseMarkdownBullets(notes));
        }

        /// <summary>
        /// Parses markdown body into plain bullet items. Strips common markdown
        /// bullet prefixes (-, *, +, numbered) and trims. Empty lines, headings
        /// and horizontal rules are skipped.
        /// </summary>
        private static List<string> ParseMarkdownBullets(string markdown)
        {
            var result = new List<string>();
            if (string.IsNullOrWhiteSpace(markdown)) return result;

            foreach (var rawLine in markdown.Replace("\r\n", "\n").Split('\n'))
            {
                var line = rawLine.Trim();
                if (line.Length == 0) continue;
                if (line.StartsWith('#')) continue;          // heading
                // Horizontal rule / setext underline only — a line made up entirely of '-' or '='.
                // (StartsWith would also drop real content like "--- note" or "===> arrow".)
                if ((line[0] == '-' || line[0] == '=') && IsRuleLine(line)) continue;

                // Strip bullet prefix
                if (line.StartsWith("- ") || line.StartsWith("* ") || line.StartsWith("+ "))
                    line = line.Substring(2).Trim();
                else if (line.Length > 2 && char.IsDigit(line[0]))
                {
                    // Numbered list like "1. foo": require real ordered-list syntax —
                    // digits, then a dot, then whitespace. This avoids mangling content such as a
                    // version "1.5x faster" (digit + dot but no space after the dot).
                    var dot = line.IndexOf('.');
                    if (dot > 0 && dot < 4
                        && dot + 1 < line.Length && char.IsWhiteSpace(line[dot + 1])
                        && AllDigits(line, dot))
                        line = line.Substring(dot + 1).Trim();
                }

                // Strip simple markdown emphasis
                line = line.Replace("**", "").Replace("__", "");

                if (line.Length > 0)
                    result.Add(line);
            }
            return result;
        }

        // True when the line is a markdown horizontal rule / setext underline: 3+ identical
        // '-' or '=' characters and nothing else.
        private static bool IsRuleLine(string line)
        {
            if (line.Length < 3) return false;
            var c = line[0];
            if (c != '-' && c != '=') return false;
            foreach (var ch in line)
                if (ch != c) return false;
            return true;
        }

        // True when every character in line[0..dot) is a digit (the marker of an ordered-list item).
        private static bool AllDigits(string line, int dot)
        {
            for (var i = 0; i < dot; i++)
                if (!char.IsDigit(line[i])) return false;
            return true;
        }

        /// <summary>
        /// Downloads the pending update, reporting progress (0–100).
        /// </summary>
        public static async Task<bool> DownloadUpdateAsync(Action<int>? onProgress = null)
        {
            if (_pendingUpdate == null)
                return false;

            try
            {
                await _manager.DownloadUpdatesAsync(_pendingUpdate, progress =>
                {
                    onProgress?.Invoke(progress);
                });
                return true;
            }
            catch (Exception ex)
            {
                DiagnosticLog.Error($"[UpdateService] Download failed: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Applies the downloaded update and restarts the app.
        ///
        /// Uses <c>WaitExitThenApplyUpdates(silent: true, restart: true)</c> + an
        /// <c>Environment.Exit(0)</c> instead of <c>ApplyUpdatesAndRestart</c> because the
        /// latter spawns Velopack's native "Installing update X.Y.Z…" progress window with
        /// a Hide button — a jarring duplicate next to our own React splash overlay. The
        /// `silent: true` flag suppresses that native UI; Update.exe still applies the
        /// patch + restarts, but invisibly. Replicates ApplyUpdatesAndRestart's internal
        /// structure (queue → Environment.Exit) minus the dialog.
        /// </summary>
        public static void ApplyAndRestart()
        {
            if (_pendingUpdate?.TargetFullRelease == null) return;
            // This path bypasses ForceExit, so it runs the same teardown here: the debounced run
            // cursors and automation history (an update must not cost the user their place in a
            // list), then everything the process holds on the system — the remap layer's injected
            // keys above all, which stay logically DOWN system-wide with no process left to release
            // them, and the tray icon the updated process will add its own next to. The updated
            // app relaunches into a fresh process that installs its own hooks, so letting go here
            // costs nothing.
            AppExit.FlushState();
            // Carry --startup across the restart, and ONLY that flag.
            //
            // It is produced exclusively by the Run registry key, and it is the sole input to the
            // "start hidden in the tray" decision. So a machine that boots to the tray, updates,
            // and restarts came back with the window open on top of whatever the user was doing —
            // and with the window up, a pixel or ROI watcher it covers stops matching.
            //
            // Not the whole command line: forwarding --ui-recovery-relaunch=N would hand the
            // post-update process a spent recovery budget, defeating the ladder that argument
            // exists to bound.
            string[]? restartArgs = TrueReplayer.App.HasStartupFlag() ? new[] { "--startup" } : null;
            // The system is let go AFTER this call, not before. It is the one step here that can
            // throw without ending the process — a corrupt staged package, an antivirus lock,
            // install-folder permissions — and releasing first left the survivor without global
            // hotkeys, automations or tray icon, while the caller's toast said it was "still
            // running the current version". Nothing can come between the queued apply and the Exit
            // either: ReleaseSystem guards every step, so a throw there cannot skip Exit(0) and
            // leave Update.exe waiting on a process that never leaves.
            _manager.WaitExitThenApplyUpdates(_pendingUpdate.TargetFullRelease, silent: true, restart: true, restartArgs);
            AppExit.ReleaseSystem();
            Environment.Exit(0);
        }
    }
}
