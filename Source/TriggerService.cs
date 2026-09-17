using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using TrueReplayer.Interop;
using TrueReplayer.Models;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Outcome of one trigger fire attempt, decided ON THE UI THREAD so the busy checks
    /// can't race hotkey dispatch (both are serialized by the dispatcher queue).
    /// </summary>
    public enum TriggerFireResult
    {
        Fired,
        SkippedBusy,     // replay / recording / clicker mode active — retriable
        SkippedDirty,    // unsaved edits in the grid — an autonomous fire must never discard them
        SkippedModal,    // user mid-interaction: dialog, overlay, file picker, or hotkey capture
        NotReady,        // WebView2/bridge not up yet (app boot) — retriable, NOT a failure
        Failed,          // profile missing or the start path threw — permanent for this edge
    }

    /// <summary>
    /// The automation daemon: one lightweight watcher loop per ARMED profile trigger
    /// (interval / schedule / condition), each with its own CancellationTokenSource —
    /// deliberately decoupled from the replay engine's single _cts. Loops only OBSERVE;
    /// every fire is marshalled to the UI thread where MainWindow re-checks the busy
    /// gates and starts the replay through the same path a profile hotkey uses.
    /// Reload() is DIFF-BASED: loops whose serialized config is unchanged keep running
    /// (interval anchors, schedule dedup and condition edge state survive the constant
    /// profile-list refreshes the app does on every save/import/toggle).
    /// </summary>
    public class TriggerService
    {
        public static TriggerService? Instance { get; private set; }

        private readonly DispatcherQueue dispatcherQueue;
        private readonly object _lock = new();
        private readonly Dictionary<string, TriggerRuntime> _runtimes = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<string, TriggerStats> _stats = new(StringComparer.OrdinalIgnoreCase);
        // Profiles this process has SEEN in any reload — armed or not, enabled or not.
        //
        // This is the cold-start discriminator, and the distinction it draws is deliberately not
        // "a watcher loop for this name has run". That was the old rule, and it read three
        // ordinary user actions as "the app just started": arming a profile that booted disarmed,
        // renaming an armed one, and flipping the master switch on when it booted off — each of
        // which then took mouse and keyboard 15 s after the click, with the user still in the
        // panel. In all three the profile was already on this process's books; only a genuine cold
        // start has never been seen before.
        //
        // Seeded from allProfileNames as well as from the trigger list, because GetProfileTriggers
        // drops DISABLED profiles: without that, re-enabling one would look like a first sighting
        // and produce exactly the ambush this replaced.
        private readonly HashSet<string> _everSeen = new(StringComparer.OrdinalIgnoreCase);
        // Last fire outcome actually written to the diagnostic log, per profile — so a blocked
        // watcher retrying every few seconds logs once, not forever. See RequestFireAsync.
        private readonly Dictionary<string, string?> _lastLoggedOutcome = new(StringComparer.OrdinalIgnoreCase);
        // Last full config list seen (armed or not) — used by SetGlobalEnabled(true) to
        // re-arm without waiting for the next profile-list refresh, and by GetStatus().
        private List<(string Name, ProfileTriggerConfig Config)> _lastConfigs = new();
        private volatile bool _globalEnabled = true;
        // App-originated clipboard traffic window: while a replay runs (and shortly after),
        // and after a capture-slot use, clipboard watchers rebaseline instead of firing —
        // SendText paste/restore bumps the sequence number twice per action.
        private long _clipboardSuppressUntilTicks;

        /// <summary>UI-thread fire entry — set by MainWindow (gates + shared dispatch body).</summary>
        public Func<string, Task<TriggerFireResult>>? FireProfile { get; set; }
        /// <summary>True while the single engine is replaying (clipboard rebaseline uses it).</summary>
        public Func<bool>? IsReplayActive { get; set; }
        /// <summary>Raised (on the calling thread) whenever status meaningfully changed — arm,
        /// fire, skip, condition flip. The bridge coalesces + pushes automation:state.</summary>
        public Action? OnStateChanged { get; set; }

        public bool GlobalEnabled => _globalEnabled;

        public TriggerService(DispatcherQueue dispatcherQueue)
        {
            this.dispatcherQueue = dispatcherQueue;
            Instance = this;
            // One pump for the whole app — see the fire-queue region. Started here rather than
            // lazily so there is exactly one, created before any watcher loop can exist.
            _ = Task.Run(() => RunFirePumpAsync(_pumpCts.Token));
        }

        private sealed class TriggerRuntime
        {
            public string ConfigKey = "";                 // serialized config — diff identity
            public ProfileTriggerConfig Config = null!;
            public CancellationTokenSource Cts = null!;
            public volatile bool ConditionTrue;           // last probe result (status display)
            public long NextDueTicks;                     // interval/schedule: next planned fire (DateTime ticks, local)
            /// True when this loop was created by the reload that first showed us the profile —
            /// i.e. the app had just started with it already armed on disk. Decided in Reload,
            /// where the "have we seen this name before" answer actually lives, rather than by the
            /// loop asking after the fact. See _everSeen.
            public bool ColdStart;
        }

        private sealed class TriggerStats
        {
            public DateTime? LastFiredAt;
            public int FireCount;
            public int SkippedBusy;
            public int SkippedDirty;
            public int SkippedModal;
            // Clipboard changes swallowed by the app-traffic window. Deliberately NOT SkippedBusy:
            // these were never fire ATTEMPTS, so folding them in would corrupt the number that
            // means "the engine was busy".
            public int SkippedSuppressed;
            public string? LastResult;                    // short human-readable outcome line
            public long LastScheduleOccurrenceTicks;      // double-fire guard across loop restarts
            // Cooldown survives loop restarts (config edits) — a loop-local copy would let an
            // edit right after a fire re-fire immediately, voiding the cooldown the user set.
            public long CooldownUntilTicks;
        }

        public sealed class AutomationStatusEntry
        {
            public string Profile = "";
            public bool Running;                          // loop currently armed + alive
            public bool ConditionTrue;
            public DateTime? NextDueAt;
            public DateTime? LastFiredAt;
            public int FireCount;
            public int SkippedBusy;
            public int SkippedDirty;
            public int SkippedModal;
            public int SkippedSuppressed;
            public string? LastResult;
        }

        /// <summary>Armed triggers in CONFIG (independent of the global master switch) —
        /// lets the tray show "automations paused" instead of silently dropping the count.</summary>
        public int ConfiguredArmedCount
        {
            get { lock (_lock) return _lastConfigs.Count(c => c.Config is { Armed: true }); }
        }

        /// <summary>
        /// Sync the watcher pool to the current profile list. Called from the profile-list
        /// registration choke point (every reload) and from SetGlobalEnabled — must stay
        /// cheap and diff-based (see class doc). UI thread.
        /// </summary>
        /// <param name="allProfileNames">
        /// EVERY profile that exists, armed or not, enabled or not. Used ONLY to prune stats for
        /// profiles that are genuinely gone. It cannot be derived from <paramref name="configs"/>:
        /// that list is GetProfileTriggers(), which drops disabled profiles and profiles whose
        /// JSON failed to load — so pruning against it would read "merely disabled" as "deleted"
        /// and, now that the prune is written through to the sidecar, permanently destroy that
        /// automation's fire history and its interval anchor. Null = do not prune.
        /// </param>
        public void Reload(List<(string Name, ProfileTriggerConfig Config)> configs,
                           IReadOnlyCollection<string>? allProfileNames = null)
        {
            List<string> started = new(), stopped = new();
            bool prunedStats = false;
            lock (_lock)
            {
                _lastConfigs = configs;

                // Which names this reload is showing us for the FIRST time. Computed before any
                // loop is created, because creating one is what needs the answer. Note the order:
                // the trigger list is consulted first so a profile that arrives armed on the very
                // first reload still counts as first-seen, and allProfileNames then covers
                // everything GetProfileTriggers drops (disabled profiles, unreadable JSON) so
                // those cannot masquerade as a cold start later.
                var firstSighting = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var (name, _) in configs)
                    if (_everSeen.Add(name)) firstSighting.Add(name);
                if (allProfileNames != null)
                    foreach (var n in allProfileNames) _everSeen.Add(n);

                var desired = new Dictionary<string, (string Key, ProfileTriggerConfig Config)>(StringComparer.OrdinalIgnoreCase);
                if (_globalEnabled)
                {
                    foreach (var (name, config) in configs)
                    {
                        if (config is { Armed: true })
                            desired[name] = (SerializeConfig(config), config);
                    }
                }

                // Stop loops that vanished or whose config changed.
                foreach (var name in _runtimes.Keys.ToList())
                {
                    if (!desired.TryGetValue(name, out var d) || d.Key != _runtimes[name].ConfigKey)
                    {
                        _runtimes[name].Cts.Cancel();
                        _runtimes.Remove(name);
                        stopped.Add(name);
                    }
                }

                // Start loops that are new or changed. Unchanged loops keep their state.
                foreach (var (name, d) in desired)
                {
                    if (_runtimes.ContainsKey(name)) continue;
                    var rt = new TriggerRuntime
                    {
                        ConfigKey = d.Key,
                        Config = d.Config.Clone(),        // loop owns a snapshot — later edits can't mutate mid-poll
                        Cts = new CancellationTokenSource(),
                        ColdStart = firstSighting.Contains(name),
                    };
                    _runtimes[name] = rt;
                    var stats = GetStatsLocked(name);
                    _ = Task.Run(() => RunLoopSafeAsync(name, rt, stats, rt.Cts.Token));
                    started.Add(name);
                }

                // Drop stats for profiles that no longer EXIST. Not "no longer carry a trigger",
                // which the old wording claimed and this loop never did — deleting a trigger from a
                // profile that stays on disk leaves the name in allProfileNames, so its history
                // outlived it until ClearStats was wired into the delete path. Renames are migrated
                // explicitly via RenameStats before the refresh lands here.
                // Only when the caller could tell us what actually exists, and never on an empty
                // set (a failed/partial profile-list load must not read as "everything is gone").
                if (allProfileNames is { Count: > 0 })
                {
                    var known = new HashSet<string>(allProfileNames, StringComparer.OrdinalIgnoreCase);
                    foreach (var name in _stats.Keys.ToList())
                        if (!known.Contains(name))
                        {
                            _stats.Remove(name);
                            _lastLoggedOutcome.Remove(name);
                            _everSeen.Remove(name);
                            prunedStats = true;
                        }
                }
            }
            // The prune has to reach the SIDECAR as well, or a deleted profile's stats live in the
            // file forever and are read back on the next launch — an entry for a profile that no
            // longer exists, growing without bound as profiles come and go.
            if (prunedStats) MarkStatsDirty();
            if (started.Count > 0 || stopped.Count > 0)
            {
                DiagnosticLog.Info($"Automation: armed [{string.Join(", ", started)}], disarmed [{string.Join(", ", stopped)}]");
                NotifyStateChanged();
            }
        }

        public void SetGlobalEnabled(bool enabled)
        {
            if (_globalEnabled == enabled) return;
            _globalEnabled = enabled;
            List<(string, ProfileTriggerConfig)> configs;
            lock (_lock) configs = _lastConfigs;
            DiagnosticLog.Info($"Automation: global master {(enabled ? "ENABLED" : "DISABLED")}");
            Reload(configs);
            NotifyStateChanged();
        }

        /// <summary>
        /// Migrate a profile's automation bookkeeping across a rename. ALL of it: the stats, the
        /// log-dedupe key, and the cold-start sighting.
        ///
        /// Leaving the last two behind was not cosmetic. _everSeen decides whether an overdue
        /// interval catches up 15 s after the loop starts, so a renamed profile looked like one
        /// this process had never met — the rename itself became an ambush. And the orphaned keys
        /// were unreachable afterwards: the prune only removes names the caller says are gone, and
        /// the old name is gone from disk the moment the rename lands.
        ///
        /// Written through synchronously rather than via the 2 s debounce, matching the mirror in
        /// RunCursorService.RenameCursor. A rename is a single deliberate act, not a stream of
        /// updates, and a kill inside that window loses the fire history permanently — the next
        /// launch's prune removes the old key, and the new one was never written.
        /// </summary>
        public void RenameStats(string oldName, string newName)
        {
            lock (_lock)
            {
                if (_stats.TryGetValue(oldName, out var s))
                {
                    _stats.Remove(oldName);
                    _stats[newName] = s;
                }
                if (_lastLoggedOutcome.TryGetValue(oldName, out var outcome))
                {
                    _lastLoggedOutcome.Remove(oldName);
                    _lastLoggedOutcome[newName] = outcome;
                }
                if (_everSeen.Remove(oldName)) _everSeen.Add(newName);
            }
            Flush();
            NotifyStateChanged();
        }

        /// <summary>
        /// Forget a profile's automation bookkeeping entirely — for when its trigger is deleted
        /// rather than renamed.
        ///
        /// Without this the stats outlived the automation: the sidecar on this machine still holds
        /// FireCount 12 for a profile whose Triggers went null three weeks ago. A NEW automation
        /// created in that profile then opened showing someone else's history, and — for an
        /// interval trigger — inherited a LastFiredAt long past due, which is a live anchor. The
        /// prune in Reload cannot reach this: it removes names that are GONE, and the profile is
        /// still very much there.
        ///
        /// Call only AFTER the delete has actually been written, so a save that throws does not
        /// take the history with it.
        /// </summary>
        public void ClearStats(string name)
        {
            bool removed;
            lock (_lock)
            {
                removed = _stats.Remove(name);
                _lastLoggedOutcome.Remove(name);
                // _everSeen is deliberately NOT cleared: the profile still exists, and this process
                // has still met it. Dropping it would make the next automation armed here look like
                // a cold start and fire its catch-up 15 s after the click.
            }
            if (!removed) return;
            Flush();
            NotifyStateChanged();
        }

        /// <summary>
        /// The stored history for one profile, whether or not it currently has a live watcher.
        ///
        /// GetStatus projects <see cref="_lastConfigs"/>, which comes from GetProfileTriggers and
        /// therefore drops DISABLED profiles — so disabling a profile made the panel show an
        /// automation with 240 fires as though it had never run once. The data was never lost,
        /// only the projection, and the fix belongs here rather than in _lastConfigs: that list
        /// also drives which watchers get armed.
        ///
        /// Returns null when nothing has ever been recorded for the name.
        /// </summary>
        public AutomationStatusEntry? GetStatsFor(string name)
        {
            lock (_lock)
            {
                if (!_stats.TryGetValue(name, out var s)) return null;
                return new AutomationStatusEntry
                {
                    Profile = name,
                    // Everything live stays false/null on purpose: for a profile with no watcher,
                    // zero IS the truth, and only the history carries over.
                    Running = false,
                    ConditionTrue = false,
                    NextDueAt = null,
                    LastFiredAt = s.LastFiredAt,
                    FireCount = s.FireCount,
                    SkippedBusy = s.SkippedBusy,
                    SkippedDirty = s.SkippedDirty,
                    SkippedModal = s.SkippedModal,
                    SkippedSuppressed = s.SkippedSuppressed,
                    LastResult = s.LastResult,
                };
            }
        }

        /// <summary>
        /// Zero the tallies for one profile, keeping its schedule position.
        ///
        /// The counters are lifetime totals, so an afternoon of testing leaves "12 busy" stuck to
        /// an automation that has run cleanly ever since — diluting the only signal those numbers
        /// carry, which is "how is this doing NOW".
        ///
        /// LastFiredAt is deliberately NOT cleared, and this is the whole design of the method:
        /// it is the interval loop's ANCHOR (see RunIntervalLoopAsync), not a display field.
        /// Nulling it would re-anchor the next tick to loop start, and on a profile the process
        /// has not seen before that is the 15-second catch-up the cold-start work just finished
        /// removing from every path a user can click. Same for LastScheduleOccurrenceTicks, which
        /// is the schedule's double-fire guard: clearing it lets today's occurrence run twice.
        ///
        /// A caller that genuinely wants the anchor gone wants ClearStats, which drops the whole
        /// record because the automation itself is gone.
        /// </summary>
        public void ResetCounters(string name)
        {
            lock (_lock)
            {
                if (!_stats.TryGetValue(name, out var s)) return;
                s.FireCount = 0;
                s.SkippedBusy = 0;
                s.SkippedDirty = 0;
                s.SkippedModal = 0;
                s.SkippedSuppressed = 0;
                s.LastResult = null;
                // Also the log-dedupe key: it only exists to stop a blocked watcher writing the
                // same line every few seconds, and after a reset the next outcome is worth a line
                // again whatever it is.
                _lastLoggedOutcome.Remove(name);
            }
            Flush();
            NotifyStateChanged();
        }

        /// Last "watcher stopped itself" reason announced per profile, so a Reload that restarts a
        /// still-broken watcher does not balloon again. Cleared once a watcher reaches its poll
        /// loop, so a problem that is fixed and then returns is announced afresh.
        private readonly Dictionary<string, string> _announcedStop = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// Tell the user, on the tray, that a watcher took itself out of service.
        ///
        /// The gap this fills: a watcher that returns early — unfillable condition, reference image
        /// gone, unparseable schedule time — leaves _runtimes, but the three surfaces that are
        /// ALWAYS visible keep saying armed: the tray tooltip's count, the sidebar dot, and the
        /// Settings dot. Only the Automation panel distinguishes armed-and-watching from
        /// armed-and-stopped, and that is the screen nobody leaves open. So the failure mode is an
        /// automation the user believes is guarding something, silently guarding nothing.
        ///
        /// Rate-limited by (profile, reason) rather than by time: the trigger is a state change,
        /// and Reload restarts loops often enough — every config edit, every arm toggle — that an
        /// unlimited version would balloon on each one.
        ///
        /// Reaching the tray from here follows the precedent RemapService set: TrayIconService is
        /// public static and this service, like that one, is alive long before the bridge exists.
        /// Never fatal — a notification that throws must not take the daemon with it.
        /// </summary>
        private void AnnounceWatcherStopped(string name, string reason)
        {
            lock (_lock)
            {
                if (_announcedStop.TryGetValue(name, out var last) && last == reason) return;
                _announcedStop[name] = reason;
            }
            // Marshalled to the UI thread, not called from the watcher's. ShowBalloon mutates the
            // single static NOTIFYICONDATA the tray also writes from there, and the field it sets
            // to raise the balloon is cleared again right after the Shell_NotifyIcon call. Two
            // threads interleaving that can leave the flag standing — and then every unrelated tray
            // refresh re-pops the same balloon for the rest of the session, which is the one
            // outcome here that does not heal itself. OnStateChanged already routes this way.
            dispatcherQueue?.TryEnqueue(() =>
            {
                try
                {
                    TrayIconService.ShowBalloon(
                        $"Automation stopped: {name}",
                        $"{reason} The automation is still armed, but it is not watching for anything.");
                }
                catch (Exception ex)
                {
                    DiagnosticLog.Warn($"Tray balloon for stopped watcher '{name}' failed: {ex.Message}");
                }
            });
        }

        /// <summary>Suppress clipboard-change fires for the next 2 s (capture-slot etc.).</summary>
        public void NotifyAppClipboardActivity()
            => Interlocked.Exchange(ref _clipboardSuppressUntilTicks, DateTime.UtcNow.AddSeconds(2).Ticks);

        public void StopAll()
        {
            lock (_lock)
            {
                foreach (var rt in _runtimes.Values) rt.Cts.Cancel();
                _runtimes.Clear();
            }
        }

        public List<AutomationStatusEntry> GetStatus()
        {
            lock (_lock)
            {
                var result = new List<AutomationStatusEntry>();
                foreach (var (name, config) in _lastConfigs)
                {
                    if (config == null) continue;
                    _runtimes.TryGetValue(name, out var rt);
                    _stats.TryGetValue(name, out var st);
                    result.Add(new AutomationStatusEntry
                    {
                        Profile = name,
                        Running = rt != null,
                        ConditionTrue = rt?.ConditionTrue ?? false,
                        NextDueAt = rt != null && rt.NextDueTicks > 0 ? new DateTime(rt.NextDueTicks) : null,
                        LastFiredAt = st?.LastFiredAt,
                        FireCount = st?.FireCount ?? 0,
                        SkippedBusy = st?.SkippedBusy ?? 0,
                        SkippedDirty = st?.SkippedDirty ?? 0,
                        SkippedModal = st?.SkippedModal ?? 0,
                        SkippedSuppressed = st?.SkippedSuppressed ?? 0,
                        LastResult = st?.LastResult,
                    });
                }
                return result;
            }
        }

        // ── Loop bodies ──

        private async Task RunLoopSafeAsync(string name, TriggerRuntime rt, TriggerStats stats, CancellationToken ct)
        {
            try
            {
                switch (rt.Config.Kind?.ToLowerInvariant())
                {
                    case "interval": await RunIntervalLoopAsync(name, rt, stats, ct); break;
                    case "schedule": await RunScheduleLoopAsync(name, rt, stats, ct); break;
                    case "condition":
                        if (string.Equals(rt.Config.ConditionType, "ClipboardChanged", StringComparison.OrdinalIgnoreCase))
                            await RunClipboardLoopAsync(name, rt, stats, ct);
                        else
                            await RunConditionLoopAsync(name, rt, stats, ct);
                        break;
                    default:
                        SetLastResult(stats, $"unknown trigger kind '{rt.Config.Kind}'");
                        break;
                }
            }
            catch (OperationCanceledException) { /* disarm */ }
            catch (Exception ex)
            {
                // A watcher loop dying must never take the app down — log + surface in status.
                DiagnosticLog.Error($"Automation watcher '{name}' crashed", ex);
                SetLastResult(stats, $"watcher crashed: {ex.Message}");
            }
            finally
            {
                // A loop that exits for any reason OTHER than disarm (bad config, missing
                // reference image, crash) must leave the registry — else the panel shows
                // Running forever and the diff-based Reload ("unchanged → keep") never
                // restarts it. With the entry gone, the next Reload starts a fresh loop.
                if (!ct.IsCancellationRequested)
                {
                    lock (_lock)
                    {
                        if (_runtimes.TryGetValue(name, out var current) && ReferenceEquals(current, rt))
                            _runtimes.Remove(name);
                    }
                    NotifyStateChanged();
                }
            }
        }

        private async Task RunIntervalLoopAsync(string name, TriggerRuntime rt, TriggerStats stats, CancellationToken ct)
        {
            int seconds = Math.Max(5, rt.Config.IntervalSeconds);
            var activeHours = ParseActiveHours(rt.Config.TimeOfDay);
            bool outsideHours = false;
            var period = TimeSpan.FromSeconds(seconds);

            // Anchor the FIRST tick to the last real fire, not to loop start. Anchoring to loop
            // start meant the countdown restarted on every app launch AND on every config edit or
            // arm toggle (Reload restarts a loop whenever the serialized config differs, and Armed
            // is part of that key) — so "every 12 hours" on a machine rebooted nightly never fired
            // once, and the row's "next" silently jumped forward each time with no explanation.
            // Stats are persisted now, so LastFiredAt survives the restart that used to erase it.
            // The catch-up is ONLY for a cold start. A loop restart is not rare: Reload restarts
            // one whenever the serialized config differs, and that key includes Armed — so an arm
            // toggle, a field edit or a master-switch cycle all rebuild the loop. Without this
            // gate, re-arming an automation whose period had elapsed would seize the mouse and
            // keyboard 15 s after the click, with the user still standing in the panel. Anchoring
            // to LastFiredAt is right; treating every restart as "the app was closed" is not.
            //
            // Decided in Reload, which is the only place that can tell a boot from a re-arm: this
            // loop starting is the SAME event in both cases, so asking here — as this used to, via
            // "is this the first loop for this name" — could not separate them. See _everSeen.
            bool coldStart = rt.ColdStart;

            DateTime? lastFired;
            lock (_lock) lastFired = stats.LastFiredAt;
            var next = lastFired is DateTime lf ? lf + period : DateTime.Now + period;
            if (next <= DateTime.Now)
            {
                if (coldStart)
                {
                    // Overdue while the app was closed. Fire — but after a short settle rather than
                    // the instant the loop starts: at launch the bridge may still be coming up
                    // (NotReady), and an autonomous replay landing on a user who just opened the
                    // app is the same ambush the schedule loop's staleness bound exists to prevent.
                    next = DateTime.Now.AddSeconds(15);
                    DiagnosticLog.Info($"Automation '{name}': interval tick was overdue at startup — firing in 15 s");
                }
                else
                {
                    // Re-armed or edited: start a fresh period, which is also what the editor's own
                    // hint promises ("the first fire happens one interval after arming").
                    next = DateTime.Now + period;
                }
            }

            while (!ct.IsCancellationRequested)
            {
                rt.NextDueTicks = next.Ticks;
                // Sleep in <= 60 s chunks so a clock change or a long suspend can't strand the loop
                // on a single huge Task.Delay (the schedule loop already does this).
                while (!ct.IsCancellationRequested)
                {
                    var remaining = next - DateTime.Now;
                    if (remaining <= TimeSpan.Zero) break;
                    await Task.Delay(remaining > TimeSpan.FromSeconds(60) ? TimeSpan.FromSeconds(60) : remaining, ct);
                }
                if (ct.IsCancellationRequested) break;

                // A busy tick used to be DROPPED outright ("the next tick catches up"), which is
                // only true when the interval is short. On a 30-minute interval that reasoning
                // costs the user half an hour because a replay happened to be running for two
                // seconds. Retry within a window bounded by the interval itself, so a retry can
                // never collide with the following tick.
                // Anchored at the LATER of the tick and now. Anchoring it at the tick alone meant
                // that after a suspend — where the sleep above breaks out deeply negative — the
                // request was born already expired: the pump sweeps expirations before it picks a
                // head, so it completed with the initial LastRefusal (SkippedBusy) without calling
                // FireProfile even once, on a completely idle engine, and then credited the
                // counter that is supposed to mean "the engine was busy".
                //
                // The invariant this window exists for is preserved. Let L be how late we woke.
                // With L < period/2 the window ends at next + L + min(s/2,180) < next + period,
                // the following tick. With L larger, the re-anchor below puts that tick at
                // now + period while the window ends at now + min(s/2,180) <= now + period/2. A
                // retry still cannot collide with the next tick in either case.
                // Active hours, when the user set some. The tick is SKIPPED, not deferred: an
                // interval means "this often while I am working", so a backlog released at 09:00
                // would be a burst of everything the night withheld. The re-anchor below keeps the
                // cadence on the clock either way.
                if (HoldForActiveHours(activeHours, stats, ref outsideHours, rt.Config.TimeOfDay ?? ""))
                {
                    next += period;
                    if (next <= DateTime.Now) next = DateTime.Now + period;
                    continue;
                }

                var graceEnd = Later(next, DateTime.Now) + TimeSpan.FromSeconds(Math.Min(seconds / 2.0, 180));
                var result = await RequestFireAsync(name, stats, ct, dueAt: next, expiresAt: graceEnd);
                // Anything but Fired/Failed/dirty means the queue held it to the deadline.
                // SkippedDirty is excluded because it comes back immediately and already set a
                // truthful result line — calling that "missed the grace window" would be a lie.
                if (result is not (TriggerFireResult.Fired or TriggerFireResult.Failed or TriggerFireResult.SkippedDirty))
                {
                    // Name the blocker instead of asserting contention. The condition loop
                    // got this in 55e1d20; these two loops kept saying "busy" for a modal or a
                    // still-booting app, both of which are not the engine being busy.
                    SetLastResult(stats, result switch
                    {
                        TriggerFireResult.SkippedModal =>
                            $"missed ({AutomationGuard.LastReason ?? "a dialog was open"} past the grace window)",
                        TriggerFireResult.NotReady => "missed (app was still starting past the grace window)",
                        _ => "missed (busy past the grace window)",
                    });
                    NotifyStateChanged();
                }

                // Anchor the NEXT tick to the tick we just serviced, not to "now" — otherwise a
                // fire that spent 40 s retrying would push every subsequent tick 40 s later, and
                // an "every 5 minutes" automation would drift off the clock over a day.
                next += period;
                if (next <= DateTime.Now) next = DateTime.Now + period;   // skipped ticks: don't burst-fire the backlog
            }
        }

        // How late a schedule occurrence may be before it is abandoned rather than fired. Sized to
        // comfortably cover the busy-retry grace window (3 min) plus a slow machine, while still
        // being unmistakably "we are past the moment you asked for".
        private static readonly TimeSpan ScheduleStaleAfter = TimeSpan.FromMinutes(10);

        private async Task RunScheduleLoopAsync(string name, TriggerRuntime rt, TriggerStats stats, CancellationToken ct)
        {
            if (!TimeSpan.TryParse(rt.Config.TimeOfDay, System.Globalization.CultureInfo.InvariantCulture, out var timeOfDay))
            {
                // The third way a watcher takes itself out of service, and the only one that used to
                // do it without even a log line.
                SetLastResult(stats, $"invalid schedule time '{rt.Config.TimeOfDay}'");
                DiagnosticLog.Warn($"Automation watcher '{name}': schedule time '{rt.Config.TimeOfDay}' is not a valid HH:mm");
                AnnounceWatcherStopped(name, $"Its schedule time '{rt.Config.TimeOfDay}' is not a valid time.");
                NotifyStateChanged();
                return;
            }
            // Past the only way this loop takes itself out of service, so it is genuinely watching.
            // The condition loop clears its announcement here too; leaving this one out made
            // _announcedStop's own remark ("cleared once a watcher reaches its poll loop") false for
            // half the watchers, and a schedule time broken, fixed, then broken again the same way
            // in one session announced only the first time.
            lock (_lock) _announcedStop.Remove(name);

            while (!ct.IsCancellationRequested)
            {
                var next = ComputeNextOccurrence(DateTime.Now, timeOfDay, rt.Config.DaysOfWeek);
                // Double-fire guard across loop restarts (global toggle off/on within the
                // fire minute): never re-fire the exact occurrence we already fired.
                long lastOcc;
                lock (_lock) lastOcc = stats.LastScheduleOccurrenceTicks;
                if (next.Ticks == lastOcc)
                    next = ComputeNextOccurrence(next.AddMinutes(1), timeOfDay, rt.Config.DaysOfWeek);
                rt.NextDueTicks = next.Ticks;

                // Sleep in <= 60 s chunks so a system clock change can't strand the loop.
                while (!ct.IsCancellationRequested)
                {
                    var remaining = next - DateTime.Now;
                    if (remaining <= TimeSpan.Zero) break;
                    await Task.Delay(remaining > TimeSpan.FromSeconds(60) ? TimeSpan.FromSeconds(60) : remaining, ct);
                }
                if (ct.IsCancellationRequested) break;

                lock (_lock) stats.LastScheduleOccurrenceTicks = next.Ticks;

                // Staleness bound. The sleep above breaks out as soon as `remaining <= 0`, which
                // across a suspend/hibernate is deeply negative: a 09:00 automation on a laptop
                // closed at 08:30 and opened at 18:00 fired the instant the machine woke — nine
                // hours late, injecting mouse and keyboard at a user who was looking at the
                // screen. A schedule names a MOMENT; once that moment is well past, running it is
                // no longer what the user asked for. (Distinct from the busy-retry grace below,
                // which bounds contention, not lateness.)
                var lateness = DateTime.Now - next;
                if (lateness > ScheduleStaleAfter)
                {
                    SetLastResult(stats, $"skipped — {(int)lateness.TotalMinutes} min late (machine asleep or clock changed)");
                    DiagnosticLog.Warn($"Automation '{name}': schedule occurrence {next:t} skipped, {(int)lateness.TotalMinutes} min stale");
                    NotifyStateChanged();
                    continue;
                }

                // A schedule that lands on a busy moment must NOT lose the whole day (the
                // interval loop's "next tick catches up" reasoning doesn't transfer — the
                // next tick is tomorrow). Retry retriable skips within a bounded grace
                // window; two same-time schedules then run back-to-back instead of one of
                // them deterministically never executing.
                // Queued on the OCCURRENCE time, so a schedule that landed on a busy minute keeps
                // its place ahead of interval ticks that became due while it waited — the
                // "deterministically never executes" case this grace window was written for.
                // Same anchoring fix as the interval loop, and here it cost a whole DAY rather than
                // a period. ScheduleStaleAfter deliberately lets an occurrence up to 10 min late
                // still run, and the comment on it says the 10 minutes were sized to "comfortably
                // cover the busy-retry grace window (3 min)". The code delivered the opposite: a
                // deadline of next + 3 min meant everything in the 3-to-10-minute band was born
                // expired and got ZERO attempts. The band is reachable by exactly the case the
                // staleness bound was written for — a laptop waking up — and the next chance was
                // tomorrow, reported as "busy".
                //
                // No extra clamp against ScheduleStaleAfter is needed: the gate above already
                // refused everything later than that, so this can never reach further than
                // 3 minutes past a lateness the loop has already accepted.
                var graceEnd = Later(next, DateTime.Now).AddMinutes(3);
                var result = await RequestFireAsync(name, stats, ct, dueAt: next, expiresAt: graceEnd);
                if (result is not (TriggerFireResult.Fired or TriggerFireResult.Failed or TriggerFireResult.SkippedDirty))
                {
                    // Name the blocker instead of asserting contention. The condition loop
                    // got this in 55e1d20; these two loops kept saying "busy" for a modal or a
                    // still-booting app, both of which are not the engine being busy.
                    SetLastResult(stats, result switch
                    {
                        TriggerFireResult.SkippedModal =>
                            $"missed ({AutomationGuard.LastReason ?? "a dialog was open"} past the grace window)",
                        TriggerFireResult.NotReady => "missed (app was still starting past the grace window)",
                        _ => "missed (busy past the grace window)",
                    });
                    NotifyStateChanged();
                }
            }
        }

        // Next local DateTime >= `after` matching HH:mm + the DaysOfWeek bitmask
        // (Sun = 1<<0, the If-Time convention; 0 = every day).
        internal static DateTime ComputeNextOccurrence(DateTime after, TimeSpan timeOfDay, int daysOfWeek)
        {
            for (int offset = 0; offset <= 7; offset++)
            {
                var candidate = after.Date.AddDays(offset) + timeOfDay;
                if (candidate <= after) continue;
                bool dayOk = daysOfWeek == 0 || (daysOfWeek & (1 << (int)candidate.DayOfWeek)) != 0;
                if (dayOk) return candidate;
            }
            // Unreachable (a 7-day scan always finds a slot), but never loop forever.
            return after.Date.AddDays(8) + timeOfDay;
        }

        private async Task RunConditionLoopAsync(string name, TriggerRuntime rt, TriggerStats stats, CancellationToken ct)
        {
            var cfg = rt.Config;
            bool levelMode = string.Equals(cfg.Retrigger, "level", StringComparison.OrdinalIgnoreCase);
            int cooldownSec = cfg.CooldownSeconds > 0 ? cfg.CooldownSeconds : 30;
            var activeHours = ParseActiveHours(cfg.TimeOfDay);
            bool outsideHours = false;
            var pendingTtl = TimeSpan.FromSeconds(Math.Max(cooldownSec, 30));
            int pollMs = PollCadenceMs(cfg);

            // Stop BEFORE spending a poll loop on something that provably cannot fire, and say so
            // in the same place a missing reference image is reported. Returning (rather than
            // spinning) also drops the runtime in the finally, so the panel stops claiming Running.
            var unfireable = DescribeUnfireable(cfg);
            if (unfireable != null)
            {
                SetLastResult(stats, $"{unfireable} — watcher stopped");
                DiagnosticLog.Warn($"Automation watcher '{name}': {unfireable}");
                AnnounceWatcherStopped(name, char.ToUpperInvariant(unfireable[0]) + unfireable.Substring(1) + ".");
                NotifyStateChanged();
                return;
            }

            // Everything below is resolved ONCE for the lifetime of the loop, because the loop owns
            // an immutable snapshot of the config (rt.Config = d.Config.Clone() — a later edit
            // restarts the loop instead of mutating it), so none of these can change between polls.
            // ProbeCondition used to redo all of it on every tick — at a cadence the user can push
            // down to 100 ms, and 250 ms by default on the pixel path.
            //
            // The loop owns the reference bitmap and its Mat: loaded after start, disposed in OUR
            // finally — Reload() only cancels the CTS and never touches them (a Dispose from
            // the UI thread would race MatchOnce's LockBits on this thread).
            System.Drawing.Bitmap? refImage = null;
            OpenCvSharp.Mat? templateMat = null;
            // Lowercased once instead of per tick, and it is what the switch in ProbeCondition reads.
            string? kind = cfg.ConditionType?.ToLowerInvariant();
            // WindowOpen: CompileTitleRegex emits IL (RegexOptions.Compiled) — its own doc asks
            // callers to cache the result when the target is reused across many calls.
            Models.WindowTarget? windowTarget = null;
            System.Text.RegularExpressions.Regex? titleRegex = null;
            // PixelColorMatch: a Trim + 3 Substring + 3 Convert.ToInt32 per tick otherwise.
            System.Drawing.Color? pixelColor = null;
            // ImageFound: optional ROI — constrain the scan to a sub-rect (cheaper + fewer false
            // positives for a background poll). Absolute coords; no offset translation.
            System.Drawing.Rectangle? searchRegion = null;
            // Alvo de ancoragem — distinto de windowTarget, que pertence à condição WindowOpen.
            Models.WindowTarget? anchorTarget = null;
            System.Text.RegularExpressions.Regex? anchorRegex = null;
            try
            {
                if (kind == "windowopen")
                {
                    (windowTarget, titleRegex) = ActionReplayer.BuildWindowTarget(
                        cfg.WindowProcessName, cfg.WindowTitle, cfg.WindowTitleMatchMode);
                }
                else if (kind == "pixelcolormatch")
                {
                    pixelColor = PixelColorService.ParseHex(cfg.PixelColor);
                }
                else if (kind == "imagefound")
                {
                    refImage = string.IsNullOrEmpty(cfg.ImagePath)
                        ? null
                        : ImageStorageService.LoadReferenceImage(name, cfg.ImagePath);
                    if (refImage == null)
                    {
                        SetLastResult(stats, "reference image missing — watcher stopped");
                        DiagnosticLog.Warn($"Automation watcher '{name}': reference image '{cfg.ImagePath}' missing");
                        AnnounceWatcherStopped(name, "Its reference image is missing.");
                        NotifyStateChanged();
                        return;
                    }
                    templateMat = ScreenCaptureService.BitmapToMat(refImage);
                    if (cfg.SearchRegionW is int sw && cfg.SearchRegionH is int sh && sw > 0 && sh > 0)
                        searchRegion = new System.Drawing.Rectangle(cfg.SearchRegionX ?? 0, cfg.SearchRegionY ?? 0, sw, sh);
                }

                // Coordenadas ancoradas na janela (opt-in) para as duas condições que TÊM
                // coordenada. Construído UMA vez, como o windowopen acima: o que muda a cada tick
                // é a posição da janela, não o alvo. Nada aqui para os outros quatro tipos —
                // WindowOpen/ProcessRunning/FileExists/ClipboardChanged não têm ponto para ancorar.
                //
                // FORA da cadeia if/else acima, e é a correção de um defeito que lançou: escrito
                // como cabeça da cadeia, este teste roubava o `else if (kind == "imagefound")` —
                // com a âncora ligada, o ramo que carrega a imagem de referência nunca rodava,
                // templateMat ficava null e ProbeCondition respondia false em TODO tick, para
                // sempre, com o painel verde dizendo Running. A auto-morte "reference image
                // missing" mora naquele mesmo ramo e também era pulada, e o deslocamento de ROI
                // escrito logo abaixo era código morto. A âncora é ORTOGONAL ao tipo: ela não
                // substitui a preparação de nenhum deles, soma-se a ela.
                if (cfg.UseRelativeCoordinates && (kind == "pixelcolormatch" || kind == "imagefound"))
                {
                    (anchorTarget, anchorRegex) = ActionReplayer.BuildWindowTarget(
                        cfg.WindowProcessName, cfg.WindowTitle, cfg.WindowTitleMatchMode);
                }

                // Only the FIRST probe may report an unusable search region — the same gate
                // WaitForImageAsync keeps for its own poll loop (ImageMatchingService.cs), and for
                // the same reason: at up to 10 polls a second an every-tick report is a log flood.
                //
                // The old justification, that "the verdict can't change between polls", is false.
                // The region is fixed, but usability is judged against VirtualScreen.Bounds, which
                // WM_DISPLAYCHANGE invalidates: unplug the monitor an ROI lives on and the region
                // becomes unusable, so the probe reads false with the report suppressed. It also
                // recovers on its own when the geometry comes back, which is why this stays a
                // first-tick gate rather than growing a per-poll report.
                bool reportRegion = true;

                // Seed the edge state with an INITIAL probe: a condition that is already true
                // when the loop starts is NOT an edge. Without this, every config edit (which
                // restarts the loop) — or arming while the condition holds — auto-fired within
                // one poll. Cooldown lives in TriggerStats so it also survives loop restarts.
                // Past every self-kill check, so this watcher is genuinely watching. Forget any
                // stop we announced for it: if the same problem comes back later it is news again.
                lock (_lock) _announcedStop.Remove(name);

                bool wasTrue = ProbeCondition(cfg, kind, windowTarget, titleRegex, pixelColor, templateMat, searchRegion, reportRegion, anchorTarget, anchorRegex);
                reportRegion = false;
                rt.ConditionTrue = wasTrue;
                if (wasTrue) NotifyStateChanged();
                // Consecutive false readings. A probe FAILURE is folded into false by every family
                // here — GetPixelAt returns null for a coordinate no longer on a visible monitor or
                // for fullscreen-exclusive denying GDI, Process.GetProcessesByName can throw, a
                // File.Exists on a flapping UNC path answers no — so one false reading is not
                // evidence the condition ended. Believing it dropped wasTrue and MANUFACTURED a
                // false-to-true edge when the reading came back, firing a macro at someone who had
                // just sat down. Requiring two costs one poll of latency when a condition really
                // does end, and covers the single-tick glitch, which is the shape these take.
                //
                // Deliberately not a tri-state through four services: null is not the common case
                // (a locked screen usually reads a VALID black, where false is correct), and the
                // naive "skip the tick when null" leaves a permanently mute watcher when a sensor
                // goes blind for good.
                int falseStreak = wasTrue ? 0 : 2;
                bool pending = false;
                var pendingSince = DateTime.MinValue;
                TriggerFireResult? lastRefusal = null;
                // Set when the active-hours window is what held a pending edge. Tracked apart from
                // lastRefusal because being outside the window is not a fire RESULT — the fire was
                // never offered — and without it the stale-edge line would blame the engine for
                // being busy, which is the exact mislabel the reason switch below exists to end.
                bool heldByHours = false;
                DateTime CooldownUntil() { lock (_lock) return new DateTime(stats.CooldownUntilTicks); }
                void StampCooldown() { lock (_lock) stats.CooldownUntilTicks = DateTime.Now.AddSeconds(cooldownSec).Ticks; }
                // A cooldown the user just LOWERED must not keep the watcher mute for the old one.
                ClampCooldownToCurrent(stats, cooldownSec);

                while (!ct.IsCancellationRequested)
                {
                    await Task.Delay(pollMs, ct);

                    bool raw = ProbeCondition(cfg, kind, windowTarget, titleRegex, pixelColor, templateMat, searchRegion, reportRegion, anchorTarget, anchorRegex);
                    // True is believed at once — a condition appearing is the event we exist for,
                    // and delaying it would cost reaction time on every fire. Only the DROP waits
                    // for a second opinion; see falseStreak.
                    bool isTrue;
                    if (raw) { falseStreak = 0; isTrue = true; }
                    else { falseStreak++; isTrue = falseStreak < 2 && rt.ConditionTrue; }
                    if (isTrue != rt.ConditionTrue)
                    {
                        rt.ConditionTrue = isTrue;
                        NotifyStateChanged();
                    }

                    // Evaluated once per tick, and deliberately NOT in place of the edge bookkeeping
                    // below: wasTrue has to keep tracking the condition while the window is shut, or
                    // a condition that stayed true all night would look like a fresh edge the moment
                    // the window opens — which is the ambush edge mode exists to prevent.
                    bool holding = HoldForActiveHours(activeHours, stats, ref outsideHours, cfg.TimeOfDay ?? "");

                    if (levelMode)
                    {
                        wasTrue = isTrue;
                        if (isTrue && !holding && DateTime.Now >= CooldownUntil())
                        {
                            // Bounded so the loop gets back to PROBING: in level mode the condition
                            // going false is meaningful, and a request parked at the head of the
                            // queue for minutes would hide that.
                            var r = await RequestFireAsync(name, stats, ct,
                                dueAt: DateTime.Now, expiresAt: DateTime.Now.AddSeconds(30));
                            if (r == TriggerFireResult.Fired)
                                StampCooldown();
                            else if (r == TriggerFireResult.Failed)
                                await Task.Delay(30000, ct);   // permanent failure — don't spam the disk logger
                            else if (r == TriggerFireResult.SkippedDirty)
                                // SkippedDirty is terminal, so it comes straight back — and in level
                                // mode a true condition then re-asks on EVERY poll for as long as
                                // the grid stays dirty: four dispatcher hops a second, an atomic
                                // sidecar write and a state push behind each debounce, and a counter
                                // climbing into six figures. This is the short backoff the fire
                                // queue's refactor dropped. Five seconds, not thirty: unsaved
                                // changes end with a Ctrl+S, and the first fire after it should not
                                // wait half a minute.
                                await Task.Delay(5000, ct);
                        }
                        continue;
                    }

                    // Edge mode: fire once per false→true transition.
                    if (isTrue && !wasTrue)
                    {
                        pending = true;
                        pendingSince = DateTime.Now;
                        // Both belong to THIS edge. Carrying either across would let a new edge
                        // inherit the last one's excuse — the window that held yesterday's, or a
                        // refusal from an attempt this edge never made.
                        heldByHours = false;
                        lastRefusal = null;
                    }
                    wasTrue = isTrue;

                    if (!pending) continue;
                    if (!isTrue) { pending = false; continue; }                 // cause vanished — drop the edge
                    if (DateTime.Now - pendingSince > pendingTtl)               // stale edge — don't ambush later
                    {
                        pending = false;
                        // Name the blocker that actually held it. "busy too long" was asserted for
                        // every non-terminal outcome, so a modal or a still-booting app — neither
                        // of which is contention — were both reported as the engine being busy,
                        // erasing the reason AutomationGuard went to the trouble of composing. This
                        // line is the durable record of why last night's fire did not happen.
                        SetLastResult(stats, heldByHours
                            ? $"fire skipped (outside active hours {cfg.TimeOfDay} — edge expired)"
                            : lastRefusal switch
                        {
                            // LastReason ALREADY reads "skipped (a dialog is open)" — it is composed
                            // for this exact use — so wrapping it produced "fire skipped (skipped
                            // (a dialog is open) — edge expired)". Only the fallback needs the word.
                            TriggerFireResult.SkippedModal =>
                                $"fire {AutomationGuard.LastReason ?? "skipped (a dialog was open)"} — edge expired",
                            TriggerFireResult.NotReady => "fire skipped (app was still starting — edge expired)",
                            TriggerFireResult.SkippedDirty => "fire skipped (unsaved changes — edge expired)",
                            _ => "fire skipped (busy too long — edge expired)",
                        });
                        NotifyStateChanged();
                        continue;
                    }
                    if (DateTime.Now < CooldownUntil()) continue;
                    // Placed AFTER the stale-edge branch above on purpose: an edge raised just
                    // before closing time still ages out on schedule instead of being frozen and
                    // released hours later, which is the same ambush by a slower route.
                    if (holding) { heldByHours = true; continue; }
                    // Reaching here proves the window opened, so whatever happens next is the real
                    // blocker. Without this the flag was sticky: an edge held overnight and then
                    // refused by a running replay still blamed the hours in the durable line.
                    heldByHours = false;

                    // Bounded per ATTEMPT, so the loop gets back to probing — the same reasoning
                    // the level branch above states, and it applies at least as strongly here.
                    // Handing the queue the whole TTL parked this loop on the await for the entire
                    // window, which made the two branches above unreachable for its duration: the
                    // "cause vanished" check could not run, and the closing comment's promise that
                    // "the loop re-probes" held only for the one refusal that is terminal. With a
                    // long cooldown the TTL is the cooldown — the editor allows a day — so the
                    // condition could appear, be blocked by a modal, disappear, and the macro would
                    // still fire when the modal closed, clicking at something no longer there.
                    //
                    // The total budget is unchanged: the stale-edge branch above still owns it, and
                    // clamping to it here keeps a slice from reaching past it.
                    var totalDeadline = pendingSince + pendingTtl;
                    var slice = DateTime.Now + EdgeAttemptWindow;
                    var result = await RequestFireAsync(name, stats, ct,
                        // dueAt is when the edge was observed, not now, so an old edge outranks a
                        // fresh one no matter how many slices it has been re-offered across.
                        dueAt: pendingSince,
                        expiresAt: slice < totalDeadline ? slice : totalDeadline);
                    if (result == TriggerFireResult.Fired)
                    {
                        pending = false;
                        StampCooldown();
                    }
                    else if (result == TriggerFireResult.Failed)
                    {
                        pending = false;
                    }
                    else
                    {
                        // Remembered for the stale-edge message above, which otherwise has nothing
                        // left to describe by the time it runs.
                        lastRefusal = result;
                    }
                    // The edge stays pending and the loop re-probes: the cause may have vanished,
                    // which the branches above must be allowed to notice — and now can.
                }
            }
            finally
            {
                // Mat before Bitmap: BitmapToMat copies the pixels, so the two are independent, but
                // releasing the native buffer first keeps the ownership order obvious.
                templateMat?.Dispose();
                refImage?.Dispose();
            }
        }

        /// The later of two moments. Exists so the two grace-window anchors read the same and stay
        /// that way — they are the same fix and drifted apart once already.
        private static DateTime Later(DateTime a, DateTime b) => a > b ? a : b;

        /// <summary>
        /// The hours an interval/condition/clipboard watcher is allowed to fire in, read from
        /// <c>TimeOfDay</c> as a RANGE — "09:00-18:00". Null when there is no window.
        ///
        /// Reusing TimeOfDay rather than adding a property is what keeps this off the DESTROY-ON-
        /// ROUND-TRIP class: ProfileTriggerConfig has no [JsonExtensionData], so a genuinely new
        /// field is dropped by an older build on any save, while a string it already knows survives
        /// untouched. It is still PINNED — an older build ignores the range and fires around the
        /// clock, which is behavioural divergence, and the matrix pins that too. See the
        /// "Automation active hours" entry in ProfileCompatibility.
        ///
        /// A RANGE is required, and that is the safety property, not a parsing detail. TimeOfDay is
        /// the schedule kind's fire time, so a profile that was once drafted as a schedule and then
        /// switched to condition keeps a bare "12:00" hanging off it — both of the automations on
        /// this machine do. Honouring a bare time here would have silenced them at 12:01 with
        /// nothing on screen to explain it. Only a value that could never be a schedule time counts.
        /// </summary>
        internal static (TimeSpan Start, TimeSpan End)? ParseActiveHours(string? timeOfDay)
        {
            if (string.IsNullOrWhiteSpace(timeOfDay)) return null;
            var s = timeOfDay.Trim();
            int dash = s.IndexOf('-');
            if (dash <= 0 || dash == s.Length - 1) return null;   // bare time, or malformed
            var inv = System.Globalization.CultureInfo.InvariantCulture;
            if (!TimeSpan.TryParse(s.Substring(0, dash).Trim(), inv, out var start)) return null;
            if (!TimeSpan.TryParse(s.Substring(dash + 1).Trim(), inv, out var end)) return null;
            if (start == end) return null;   // a zero-width window would mean "never" — treat as unset
            return (start, end);
        }

        /// <summary>
        /// Whether <paramref name="now"/> falls inside the window. Handles a window that WRAPS
        /// midnight ("22:00-06:00"), which is the overnight case a macro user actually wants; the
        /// end is exclusive so 09:00-18:00 stops at 17:59:59 rather than firing once at 18:00.
        /// </summary>
        private static bool InsideActiveHours((TimeSpan Start, TimeSpan End) w, DateTime now)
        {
            var t = now.TimeOfDay;
            return w.Start < w.End
                ? t >= w.Start && t < w.End
                : t >= w.Start || t < w.End;
        }

        /// <summary>
        /// True when a fire must be held because the watcher is outside its active hours.
        ///
        /// Reports on the TRANSITION only. A window changes state twice a day while the loops ask
        /// several times a SECOND, so writing the reason per tick would rewrite the sidecar and push
        /// the panel at the poll rate — the same shape as the level-mode re-request the audit found.
        /// Coming back inside deliberately does not overwrite LastResult: the last thing that
        /// actually happened ("fired", or why it did not) is worth more than "we are open again".
        /// </summary>
        private bool HoldForActiveHours((TimeSpan Start, TimeSpan End)? window, TriggerStats stats,
                                        ref bool wasOutside, string label)
        {
            if (window is not { } w) return false;
            bool outside = !InsideActiveHours(w, DateTime.Now);
            if (outside != wasOutside)
            {
                wasOutside = outside;
                if (outside) SetLastResult(stats, $"outside active hours ({label})");
                NotifyStateChanged();
            }
            return outside;
        }

        /// <summary>
        /// Trim a retained cooldown deadline to what the CURRENT setting could have produced.
        ///
        /// The deadline is stored as an absolute instant so it survives the loop restarts a config
        /// edit causes — that part is deliberate. What was missing is that lowering the cooldown
        /// could not take effect: dropping it from an hour to 30 s left the old deadline standing,
        /// so the watcher stayed mute for the remaining fifty-odd minutes, with the panel reporting
        /// the new number. Reopening the app "fixed" it by accident, since the field is not
        /// restored from the sidecar.
        ///
        /// Zero (never fired) passes through untouched, since Min(0, anything positive) is 0.
        /// </summary>
        private void ClampCooldownToCurrent(TriggerStats stats, int cooldownSec)
        {
            lock (_lock)
            {
                long ceiling = DateTime.Now.AddSeconds(cooldownSec).Ticks;
                if (stats.CooldownUntilTicks > ceiling) stats.CooldownUntilTicks = ceiling;
            }
        }

        /// How long a single edge-mode fire attempt may sit in the queue before the loop takes its
        /// turn back to probe again. Matches the bound the level branch already uses, and for the
        /// same reason: while this loop is awaiting, it cannot notice that the condition went away.
        private static readonly TimeSpan EdgeAttemptWindow = TimeSpan.FromSeconds(30);

        /// How long one clipboard copy stays actionable. It is the queue's grace window for this
        /// watcher, and also how long a copy the dirty gate refused is held for a retry — the same
        /// number on purpose, so no refusal path gets more patience than another.
        private static readonly TimeSpan ClipboardHoldWindow = TimeSpan.FromSeconds(10);

        private async Task RunClipboardLoopAsync(string name, TriggerRuntime rt, TriggerStats stats, CancellationToken ct)
        {
            var cfg = rt.Config;
            int cooldownSec = cfg.CooldownSeconds > 0 ? cfg.CooldownSeconds : 5;
            var activeHours = ParseActiveHours(cfg.TimeOfDay);
            bool outsideHours = false;
            int pollMs = PollCadenceMs(cfg);
            // Seeded, not read raw: zero means the clipboard was unreadable (no access to the
            // window station), not "sequence zero". Taking it at face value made the first REAL
            // reading afterwards look like a change and fabricate a fire.
            uint seed = NativeMethods.GetClipboardSequenceNumber();
            bool seeded = seed != 0;
            uint lastSeq = seed;

            // Shared with the condition loop rather than local to this one. The field's own comment
            // says why the cooldown lives in TriggerStats — a loop-local copy lets an edit right
            // after a fire re-fire immediately, voiding the cooldown the user set — and this loop
            // was the one place that did not honour it.
            DateTime CooldownUntil() { lock (_lock) return new DateTime(stats.CooldownUntilTicks); }
            void StampCooldown() { lock (_lock) stats.CooldownUntilTicks = DateTime.Now.AddSeconds(cooldownSec).Ticks; }
            ClampCooldownToCurrent(stats, cooldownSec);

            var lastReplayActiveAt = DateTime.MinValue;
            // A copy the DIRTY gate refused, kept for one hold window so the next ticks can ask
            // again. MinValue = nothing held. See the refusal branch at the bottom of the loop.
            var heldCopyAt = DateTime.MinValue;

            while (!ct.IsCancellationRequested)
            {
                await Task.Delay(pollMs, ct);

                uint seq = NativeMethods.GetClipboardSequenceNumber();
                // Zero is "unknown", never a real sequence number — hold the previous state.
                if (seq == 0) continue;
                // First readable value after an unreadable start is the BASELINE, not a change.
                if (!seeded) { seeded = true; lastSeq = seq; continue; }

                bool replayActive = IsReplayActive?.Invoke() ?? false;
                if (replayActive) lastReplayActiveAt = DateTime.Now;
                bool appTraffic = replayActive
                    || DateTime.Now - lastReplayActiveAt < TimeSpan.FromSeconds(2)
                    || DateTime.UtcNow.Ticks < Interlocked.Read(ref _clipboardSuppressUntilTicks);
                if (appTraffic)
                {
                    // Rebaseline: our own paste/restore traffic must stay invisible. But the filter
                    // is TEMPORAL, not attributional — a copy the USER makes in another app during
                    // a long macro is swallowed identically, and that IS a lost event worth
                    // reporting.
                    //
                    // Only the TAIL is worth counting. While a replay is actually running (or a
                    // capture-slot write is in its window) the app is the provable author of the
                    // traffic — SendText bumps the sequence twice per action, so counting there
                    // would report dozens of "skipped fires" per successful fire and bury the real
                    // ones. The residual window is the part where the app is already finished and
                    // a bump is most likely the user's own copy.
                    //
                    // It gets its OWN counter rather than SkippedBusy: these were never fire
                    // attempts, and folding them in would corrupt the number that means "the
                    // engine was busy".
                    bool attributable = replayActive
                        || DateTime.UtcNow.Ticks < Interlocked.Read(ref _clipboardSuppressUntilTicks);
                    if (seq != lastSeq && !attributable)
                    {
                        lock (_lock)
                        {
                            stats.SkippedSuppressed++;
                            stats.LastResult = "clipboard change ignored (just after a replay)";
                        }
                        MarkStatsDirty();
                        NotifyStateChanged();
                    }
                    // A held copy does not survive the clipboard moving on. The app's own paste and
                    // restore traffic replaces the content, so re-offering the held one afterwards
                    // would ask the pattern about text the user never copied.
                    if (seq != lastSeq) heldCopyAt = DateTime.MinValue;
                    lastSeq = seq;
                    continue;
                }

                bool isNewCopy = seq != lastSeq;
                if (isNewCopy) lastSeq = seq;

                // Nothing new on the clipboard. The one reason to carry on is a copy the dirty
                // gate refused and we are still holding.
                if (!isNewCopy && heldCopyAt == DateTime.MinValue) continue;
                if (isNewCopy)
                {
                    // A fresh copy supersedes a held one — acting on the older one now is exactly
                    // the stale ambush the hold window is bounded to prevent.
                    heldCopyAt = DateTime.MinValue;
                }
                else if (DateTime.Now - heldCopyAt > ClipboardHoldWindow - TimeSpan.FromMilliseconds(FireRetryCadenceMs))
                {
                    // Retire the hold one retry cadence EARLY. An attempt offered in the last
                    // fraction of the window is born expired: the pump sweeps expirations before it
                    // picks a head, so it comes back as SkippedBusy without FireProfile ever being
                    // called — a phantom refusal from a possibly idle engine, counted as
                    // contention. Deliberately not Later() here: extending the deadline instead
                    // would push the copy past the ten seconds the hold is bounded to.
                    heldCopyAt = DateTime.MinValue;
                    continue;
                }

                if (DateTime.Now < CooldownUntil()) { heldCopyAt = DateTime.MinValue; continue; }
                // Outside the active hours the copy is DROPPED, not held: a clipboard event is
                // already the shortest-lived of the three, and releasing this evening's copy
                // tomorrow morning is the staleness the hold window exists to bound.
                if (HoldForActiveHours(activeHours, stats, ref outsideHours, cfg.TimeOfDay ?? ""))
                { heldCopyAt = DateTime.MinValue; continue; }

                // Evaluated ONCE per copy, on the tick that saw it. A held copy has already passed
                // this — the sequence number has not moved, so the content cannot have either — and
                // re-reading it on every retry cost ~20 clipboard reads per hold AND could kill the
                // hold outright: a transient CLIPBRD_E_CANT_OPEN returns null, which this branch
                // cannot tell apart from "the text does not match".
                if (isNewCopy && !string.IsNullOrEmpty(cfg.ClipboardPattern))
                {
                    string? text = await ActionReplayer.ReadClipboardTextAsync(dispatcherQueue);
                    if (text == null || !text.Contains(cfg.ClipboardPattern, StringComparison.OrdinalIgnoreCase))
                    {
                        // The content cannot change while the sequence number does not, so a
                        // mismatch is final for this copy — do not re-read it every tick.
                        heldCopyAt = DateTime.MinValue;
                        continue;
                    }
                }

                // A clipboard change is an EVENT, so it can't PEND indefinitely — but dropping it
                // on the first busy tick was too harsh: the engine is often busy for a second or
                // two, and the copy the user just made is exactly what they wanted acted on.
                // Retry briefly, bounded so a stale copy can never ambush them later.
                var copiedAt = isNewCopy ? DateTime.Now : heldCopyAt;
                heldCopyAt = DateTime.MinValue;
                // countRefusal only on the tick that saw the copy: a hold re-offers the SAME
                // event up to twenty times, and the counters mean "how many times was a fire
                // refused", not "how many attempts did the retry make". The first refusal is
                // already recorded; the rest are the same occasion.
                var r = await RequestFireAsync(name, stats, ct,
                    dueAt: copiedAt, expiresAt: copiedAt + ClipboardHoldWindow, countRefusal: isNewCopy);
                if (r == TriggerFireResult.Fired)
                    StampCooldown();
                else if (r == TriggerFireResult.SkippedDirty)
                {
                    // Every other refusal already spent this window INSIDE the queue — the pump
                    // held the request and retried until expiresAt. SkippedDirty is the exception:
                    // it is terminal, so it comes back instantly, and the event was consumed on the
                    // way in (lastSeq moved), so nothing re-offers it. The user's copy was simply
                    // gone. Hold it here for the same window the others got, anchored to when they
                    // actually copied so the deadline cannot be extended by retrying.
                    heldCopyAt = copiedAt;
                }
            }
        }

        // Effective poll cadence: the user's PollIntervalMs when set, else the per-condition
        // default. Clamped to [100 ms, 10 min] — below 100 ms the probe cost dominates the
        // interval and the watcher just burns a core; above 10 minutes a "watcher" stops being
        // one and the user wants a schedule trigger instead.
        internal static int PollCadenceMs(ProfileTriggerConfig cfg)
        {
            if (cfg.PollIntervalMs > 0) return Math.Clamp(cfg.PollIntervalMs, 100, 600_000);
            return DefaultPollCadenceMs(cfg.ConditionType);
        }

        /// <summary>
        /// Deslocamento da janela ancora para ESTE tick. Sem ancora (o caso de sempre) devolve
        /// true com 0,0 — a coordenada segue absoluta e nada muda para quem nao optou.
        /// Com ancora e janela ausente devolve FALSE, e o chamador trata como condicao nao
        /// satisfeita: um vigia nao tem a quem reportar erro, e falhar em silencio e o unico
        /// desfecho que nao vira enxurrada de log a 4 Hz.
        ///
        /// Resolvido POR TICK de proposito. E o que o lado das acoes ja faz dentro do laco de
        /// espera (ExecuteWaitPixelColor), pela razao escrita la: resolver uma vez antes do laco
        /// faz uma janela que anda 10 px invalidar todo tick seguinte. Um vigia vive ordens de
        /// grandeza mais tempo que uma espera, entao o argumento so fica mais forte aqui.
        /// </summary>
        // Mesmo limiar que ActionReplayer usa para o mesmo teste (-31000): o rect de
        // estacionamento e (-32000,-32000), e a folga cobre variacao entre versoes do Windows.
        private const int MinimizedParkedLeft = -31000;

        // Alvos cuja ancora ja foi denunciada como ambigua. Chave por DESCRICAO, nao por handle:
        // o que interessa e a configuracao, e as janelas vao e vem. Nunca limpo — sao poucas
        // strings e o aviso deve sair uma vez por sessao, nao uma vez por janela reaberta.
        private static readonly HashSet<string> _ambiguousAnchorWarned = new(StringComparer.OrdinalIgnoreCase);

        private static string DescribeTarget(Models.WindowTarget t) =>
            !string.IsNullOrWhiteSpace(t.ProcessName) ? t.ProcessName! : (t.WindowTitle ?? "?");

        private static bool TryAnchorOffset(Models.WindowTarget? target,
                                            System.Text.RegularExpressions.Regex? titleRegex,
                                            out int dx, out int dy)
        {
            dx = 0;
            dy = 0;
            if (target == null) return true;
            // FindWindowStable, nao FindWindow: aquele para no PRIMEIRO casamento e EnumWindows anda
            // do topo da ordem Z para baixo, entao com duas janelas do mesmo processo a origem
            // trocava a cada clique do usuario entre elas — o ponto amostrado andava a distancia
            // entre as duas, a condicao ficava falsa em silencio, e voltava sozinha quando o foco
            // voltava. Uma ancora so por PROCESSO e legal e facil de criar (o dropdown de processos
            // preenche so esse campo), entao o caso nao e exotico. Aqui a pergunta nao e "existe
            // alguma?" e sim "ONDE ela esta", e essas duas perguntas nao aceitam o mesmo criterio.
            var hwnd = Helpers.WindowMatcher.FindWindowStable(target, titleRegex, out int matches);
            if (hwnd == IntPtr.Zero) return false;
            // Uma vez por vigia, nunca por tick: a 4 Hz isto viraria enxurrada de log, que e a
            // mesma razao pela qual a ausencia de janela falha calada.
            if (matches > 1 && _ambiguousAnchorWarned.Add(DescribeTarget(target)))
            {
                DiagnosticLog.Warn($"[Automation] A ancora casa com {matches} janelas de {DescribeTarget(target)}. "
                    + "A origem foi fixada numa delas; preencha o titulo da janela para escolher.");
            }
            if (!NativeMethods.GetWindowRect(hwnd, out var rect)) return false;
            // Rect de estacionamento de janela MINIMIZADA (-32000,-32000): passa por
            // IsWindowVisible e levaria a amostrar fora da tela. Mesmo teste que
            // TryResolveRelativeOffset faz do lado das acoes — que ate 17-09 NAO fazia: la o teste
            // existia mas so gateava um aviso, e o retorno usava o rect estacionado assim mesmo.
            if (rect.Left <= MinimizedParkedLeft || rect.Top <= MinimizedParkedLeft) return false;
            dx = rect.Left;
            dy = rect.Top;
            return true;
        }

        internal static int DefaultPollCadenceMs(string? conditionType) => conditionType?.ToLowerInvariant() switch
        {
            "pixelcolormatch" => 250,
            "clipboardchanged" => 500,
            _ => 1000,   // WindowOpen / ProcessRunning / FileExists / ImageFound
        };

        /// <summary>
        /// Why this condition can NEVER become true as configured, or null when it can.
        ///
        /// A blank required field is not an error anywhere downstream — WindowMatcher returns
        /// zero for a criteria-less target BY DESIGN, an empty process name returns false, an
        /// empty path returns false. So the watcher armed, reported Running, polled forever and
        /// never fired, with nothing on screen saying why. ImageFound was the only family that
        /// self-reported, which taught users that silence means healthy. The editor now blocks
        /// saving these, but configs written before that still exist on disk — this is what
        /// surfaces THOSE, and it is the backend's own answer rather than a mirror of the UI's.
        /// </summary>
        internal static string? DescribeUnfireable(ProfileTriggerConfig cfg)
        {
            var kind = cfg.ConditionType?.ToLowerInvariant();

            // A âncora de janela é opt-in e REUSA os campos do WindowOpen — que num gatilho de
            // pixel ou de imagem estão vazios, porque nada nunca pediu que fossem preenchidos.
            // Com os dois em branco WindowMatcher devolve zero POR DESENHO, TryAnchorOffset falha,
            // e a condição é falsa em todo tick para sempre. Era o único estado "nunca dispara"
            // que nenhum dos dois validadores conhecia: o vigia armava, dizia Running, e não dizia
            // mais nada. Fica ANTES do switch porque vale para os dois tipos que têm coordenada.
            if (cfg.UseRelativeCoordinates && (kind == "pixelcolormatch" || kind == "imagefound"))
            {
                if (string.IsNullOrWhiteSpace(cfg.WindowProcessName) && string.IsNullOrWhiteSpace(cfg.WindowTitle))
                    return "coordinates are anchored to a window, but no process name or window title is set — this can never match";
                // Mesma morte silenciosa do windowopen abaixo, pelo mesmo motivo: em modo regex um
                // padrão que não compila vira um Regex nulo, e um Regex nulo rejeita TODA janela.
                if (string.Equals(cfg.WindowTitleMatchMode, "regex", StringComparison.OrdinalIgnoreCase)
                    && !string.IsNullOrWhiteSpace(cfg.WindowTitle))
                {
                    var (_, anchorCompiled) = ActionReplayer.BuildWindowTarget(
                        cfg.WindowProcessName, cfg.WindowTitle, cfg.WindowTitleMatchMode);
                    if (anchorCompiled == null)
                        return "the anchor window-title regex does not compile — this can never match";
                }
            }

            switch (kind)
            {
                case "windowopen":
                    if (string.IsNullOrWhiteSpace(cfg.WindowProcessName) && string.IsNullOrWhiteSpace(cfg.WindowTitle))
                        return "no process name or window title set — this can never match";
                    // A title regex that does not compile is swallowed into a null Regex, and a null
                    // regex in regex mode rejects EVERY window — so a process name does not rescue
                    // it. The editor never validated this field, and its own placeholder teaches a
                    // syntax that is invalid halfway through typing it.
                    //
                    // Asked of the real .NET engine rather than mirrored: a JS RegExp check would
                    // reject .NET-valid patterns like (?>ab)+ and accept C:\Users\Admin, which .NET
                    // throws on.
                    if (string.Equals(cfg.WindowTitleMatchMode, "regex", StringComparison.OrdinalIgnoreCase)
                        && !string.IsNullOrWhiteSpace(cfg.WindowTitle))
                    {
                        var (_, compiled) = ActionReplayer.BuildWindowTarget(
                            cfg.WindowProcessName, cfg.WindowTitle, cfg.WindowTitleMatchMode);
                        if (compiled == null)
                            return "the window-title regex does not compile — this can never match";
                    }
                    return null;
                case "processrunning":
                    return string.IsNullOrWhiteSpace(cfg.WindowProcessName)
                        ? "no process name set — this can never match"
                        : null;
                case "fileexists":
                    return string.IsNullOrWhiteSpace(cfg.FilePath)
                        ? "no file path set — this can never match"
                        : null;
                case "pixelcolormatch":
                    // The editor's colour swatch accepts three-digit shorthand and renders #F00 as
                    // solid red, actively telling the user the value is good — while ParseHex takes
                    // six digits only and answers null, so the probe read false at 250 ms forever
                    // with nothing on screen saying why. Asking ParseHex itself is what keeps this
                    // honest for configs that never went through the editor at all: written by
                    // hand, imported, or armed straight from the profile list.
                    return PixelColorService.ParseHex(cfg.PixelColor) == null
                        ? $"the pixel colour '{cfg.PixelColor}' is not a 6-digit hex value — this can never match"
                        : null;
                case "imagefound":
                case "clipboardchanged":
                    return null;   // ImageFound reports its own missing reference below
                case null:
                case "":
                    return "no condition type set — this can never match";
                default:
                    // Unknown type: ProbeCondition's own switch falls through to false, so this
                    // watcher provably cannot fire — it armed, reported Running, polled at 1 Hz and
                    // said nothing. The same asymmetry existed one level up, where an unknown Kind
                    // IS reported (RunLoopSafeAsync). The case that will actually reach this is a
                    // downgrade: a profile carrying a condition family a newer build introduced.
                    return $"unknown condition type '{cfg.ConditionType}' — this version cannot watch for it";
            }
        }

        // Raw probes — reuse the app's static primitives; a probe error reads FALSE
        // (transition-only logging keeps DiagnosticLog off the per-poll path).
        /// <remarks>
        /// Everything after <paramref name="cfg"/> is precomputed ONCE by the caller's loop (see
        /// RunConditionLoopAsync) because none of it can change between polls, and rebuilding a
        /// compiled Regex / re-parsing a hex colour / re-converting the template bitmap /
        /// re-reading four ROI fields on every tick was pure waste on a path that runs 4-10x a
        /// second for as long as the watcher is armed. Nulls are fine: a probe only ever reads
        /// the ones its own condition type needs. <paramref name="reportRegion"/> is true only
        /// for the caller's seed probe — see the gate at the call site.
        /// </remarks>
        private bool ProbeCondition(
            ProfileTriggerConfig cfg,
            string? kind,
            Models.WindowTarget? windowTarget,
            System.Text.RegularExpressions.Regex? titleRegex,
            System.Drawing.Color? pixelColor,
            OpenCvSharp.Mat? templateMat,
            System.Drawing.Rectangle? searchRegion,
            bool reportRegion,
            // Ancora de janela (opt-in): construida UMA vez pelo laco chamador, como windowTarget.
            // Reconstruir aqui recompilaria o Regex do titulo a cada tick.
            Models.WindowTarget? anchorTarget,
            System.Text.RegularExpressions.Regex? anchorRegex)
        {
            try
            {
                switch (kind)
                {
                    case "windowopen":
                    {
                        if (windowTarget == null) return false;
                        if (cfg.WindowMatchForegroundOnly)
                            return Helpers.WindowMatcher.Matches(NativeMethods.GetForegroundWindow(), windowTarget, titleRegex);
                        return Helpers.WindowMatcher.FindWindow(windowTarget, titleRegex) != IntPtr.Zero;
                    }
                    case "processrunning":
                    {
                        var procName = cfg.WindowProcessName?.Trim();
                        if (string.IsNullOrEmpty(procName)) return false;
                        if (procName.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                            procName = procName[..^4];
                        System.Diagnostics.Process[] procs;
                        try { procs = System.Diagnostics.Process.GetProcessesByName(procName); }
                        catch { return false; }
                        try { return procs.Length > 0; }
                        finally { foreach (var p in procs) p.Dispose(); }
                    }
                    case "fileexists":
                        return !string.IsNullOrEmpty(cfg.FilePath)
                            && (System.IO.File.Exists(cfg.FilePath) || System.IO.Directory.Exists(cfg.FilePath));
                    case "pixelcolormatch":
                    {
                        if (pixelColor == null) return false;
                        // Janela ancora ausente => condicao FALSA, nunca erro. E o que
                        // ProbePixelColorMatch ja faz do lado das acoes, e e o que impede um vigia
                        // de virar fonte de aviso a cada 250 ms enquanto o app alvo esta fechado.
                        if (!TryAnchorOffset(anchorTarget, anchorRegex, out int adx, out int ady)) return false;
                        var sampled = PixelColorService.GetPixelAt(cfg.PixelX + adx, cfg.PixelY + ady);
                        return sampled != null
                            && PixelColorService.MatchesWithinTolerance(sampled.Value, pixelColor.Value, cfg.PixelTolerance);
                    }
                    case "imagefound":
                    {
                        if (templateMat == null) return false;
                        if (!TryAnchorOffset(anchorTarget, anchorRegex, out int idx, out int idy)) return false;
                        // A ROI e o unico dado com coordenada aqui; sem ROI a varredura e de tela
                        // cheia e nao ha o que ancorar. Deslocada por tick, nao na construcao:
                        // a janela pode andar entre um poll e o proximo.
                        var roi = searchRegion is System.Drawing.Rectangle r0
                            ? new System.Drawing.Rectangle(r0.X + idx, r0.Y + idy, r0.Width, r0.Height)
                            : searchRegion;
                        double confidence = Math.Min(0.99, cfg.ImageConfidence <= 0 ? 0.8 : cfg.ImageConfidence);
                        // Pre-converted template + pre-built ROI (see the loop): the Bitmap overload
                        // would redo the LockBits + BGRA→BGR conversion into a fresh native Mat on
                        // every poll.
                        return ImageMatchingService.MatchOnce(templateMat, roi, reportUnusableRegion: reportRegion)
                            .Score >= confidence;
                    }
                    default:
                        return false;
                }
            }
            catch
            {
                return false;
            }
        }

        // ── Fire queue ──
        //
        // Every watcher loop used to retry on its own: call, get SkippedBusy, sleep 5 s, call
        // again, until its grace window expired. Two problems that only show up with more than one
        // armed automation, which is the normal case here.
        //
        // ORDER. Two triggers due while a replay runs each poll independently, so when the engine
        // frees, whichever loop happens to wake first wins. Not first-due-first-served — arbitrary,
        // and it changes run to run. A schedule that lands on a busy minute could lose to an
        // interval tick that became due afterwards.
        //
        // LATENCY. The retry cadence was the wait: up to 5 s of dead time after the engine was
        // already free, on every fire that had to wait at all.
        //
        // One ordered waiting room fixes both. It deliberately introduces NO new policy: each
        // request carries the deadline its own loop already computed (the interval's half-period
        // grace, the schedule's 3 minutes, the edge's TTL, the clipboard's 10 s), so lifetimes are
        // exactly what they were. What changes is who goes first and how fast.
        //
        // A side effect worth knowing: the skip counters now count SKIPS, not retry attempts. One
        // missed interval tick used to bump SkippedBusy up to 36 times (3 min of grace at a 5 s
        // cadence, because the bookkeeping sat inside the polled call). It bumps once now.

        private sealed class FireRequest
        {
            public string Name = "";
            /// Ordering key: the moment this fire BECAME due, not when it was queued. A schedule
            /// that has been waiting keeps its place ahead of an interval tick due later.
            public DateTime DueAt;
            /// The caller's own grace deadline. Past it the request is abandoned, unchanged from
            /// the per-loop behaviour it replaces.
            public DateTime ExpiresAt;
            public long Seq;
            /// Why the last attempt was refused — reported back if the deadline wins.
            public TriggerFireResult LastRefusal = TriggerFireResult.SkippedBusy;
            public readonly TaskCompletionSource<TriggerFireResult> Tcs =
                new(TaskCreationOptions.RunContinuationsAsynchronously);
        }

        private readonly List<FireRequest> _fireQueue = new();
        private readonly object _queueLock = new();
        /// Wake signal, not a counter: capacity 1, released only when empty. The pump waits on it
        /// solely while the queue is empty, so a spurious wake costs one re-check.
        private readonly SemaphoreSlim _queueWake = new(0, 1);
        private long _fireSeq;
        private readonly CancellationTokenSource _pumpCts = new();

        /// How fast a refused request is re-attempted. The old per-loop cadence was 5 s and was
        /// pure latency; this is the queue's whole latency budget. An attempt is a dispatcher hop
        /// plus a handful of bool reads, so 400 ms is affordable even during a long replay.
        private const int FireRetryCadenceMs = 400;

        private void WakePump()
        {
            try { if (_queueWake.CurrentCount == 0) _queueWake.Release(); }
            catch (SemaphoreFullException) { /* another thread won the race — already awake */ }
        }

        /// <summary>
        /// The single fire pump. Only this task calls <see cref="FireProfile"/> from a watcher, so
        /// ordering is a property of the code rather than of who polls first.
        ///
        /// It attempts ONLY the head. Every refusal it can get is global — the engine is busy, a
        /// modal is up, the grid is dirty — so walking the rest of the queue would just multiply
        /// dispatcher hops to collect the same answer.
        /// </summary>
        private async Task RunFirePumpAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                FireRequest? head;
                List<FireRequest>? expired = null;
                lock (_queueLock)
                {
                    var now = DateTime.Now;
                    for (int i = _fireQueue.Count - 1; i >= 0; i--)
                    {
                        if (_fireQueue[i].ExpiresAt > now) continue;
                        (expired ??= new()).Add(_fireQueue[i]);
                        _fireQueue.RemoveAt(i);
                    }
                    head = null;
                    foreach (var r in _fireQueue)
                    {
                        if (head == null || r.DueAt < head.DueAt || (r.DueAt == head.DueAt && r.Seq < head.Seq))
                            head = r;
                    }
                }
                // Completed OUTSIDE the lock: the continuation is the waiting loop, which takes
                // _lock for its stats bookkeeping, and holding both is how a deadlock gets written.
                if (expired != null)
                    foreach (var r in expired) r.Tcs.TrySetResult(r.LastRefusal);

                if (head == null)
                {
                    try { await _queueWake.WaitAsync(ct); }
                    catch (OperationCanceledException) { break; }
                    continue;
                }

                var fire = FireProfile;
                TriggerFireResult result;
                if (fire == null)
                {
                    // Bridge not wired yet. Retriable, same as NotReady — never a failure, or an
                    // automation armed at boot would drop its first fire.
                    result = TriggerFireResult.NotReady;
                }
                else
                {
                    try { result = await fire(head.Name); }
                    catch (Exception ex)
                    {
                        DiagnosticLog.Error($"Automation fire '{head.Name}' failed", ex);
                        result = TriggerFireResult.Failed;
                    }
                }

                // SkippedDirty is terminal on purpose. Unsaved edits are not a moment of
                // contention like a running replay — they can sit for hours, and a request holding
                // the head of the queue that whole time would starve every other automation. The
                // watcher's next tick asks again — true for interval and for a condition, but NOT
                // for the two event-shaped watchers, which is why each grew its own hold: a
                // clipboard copy is consumed on the way in and nothing re-offers it (the loop keeps
                // it for one window now), and a schedule's next tick is tomorrow.
                bool terminal = result is TriggerFireResult.Fired
                                       or TriggerFireResult.Failed
                                       or TriggerFireResult.SkippedDirty;
                if (terminal)
                {
                    lock (_queueLock) _fireQueue.Remove(head);
                    head.Tcs.TrySetResult(result);
                    // No delay: on Fired the engine is now busy and the next attempt discovers
                    // that in one cheap hop; on the other two the answer was immediate anyway.
                    continue;
                }

                head.LastRefusal = result;
                try { await Task.Delay(FireRetryCadenceMs, ct); }
                catch (OperationCanceledException) { break; }
            }
        }

        // ── Fire plumbing ──

        /// <param name="dueAt">When this fire became due — the queue's ordering key.</param>
        /// <param name="expiresAt">
        /// The caller's grace deadline. Reaching it returns the last refusal reason, which is the
        /// caller's signal that it waited the window out rather than being refused once.
        /// </param>
        private async Task<TriggerFireResult> RequestFireAsync(
            string name, TriggerStats stats, CancellationToken ct, DateTime dueAt, DateTime expiresAt,
            bool countRefusal = true)
        {
            var req = new FireRequest { Name = name, DueAt = dueAt, ExpiresAt = expiresAt };
            lock (_queueLock)
            {
                req.Seq = ++_fireSeq;
                _fireQueue.Add(req);
            }
            WakePump();

            TriggerFireResult result;
            // Disarming (Reload cancels the loop's CTS) must pull the request out, or the pump
            // would keep attempting a fire for a watcher that no longer exists.
            using (ct.Register(() =>
            {
                lock (_queueLock) _fireQueue.Remove(req);
                req.Tcs.TrySetCanceled();
            }))
            {
                // OperationCanceledException on disarm — RunLoopSafeAsync catches it as a clean stop.
                result = await req.Tcs.Task.ConfigureAwait(false);
            }

            if (ct.IsCancellationRequested) return result;

            lock (_lock)
            {
                switch (result)
                {
                    case TriggerFireResult.Fired:
                        stats.LastFiredAt = DateTime.Now;
                        stats.FireCount++;
                        stats.LastResult = "fired";
                        break;
                    case TriggerFireResult.SkippedBusy:
                        if (countRefusal) stats.SkippedBusy++;
                        stats.LastResult = "skipped (busy)";
                        break;
                    case TriggerFireResult.SkippedDirty:
                        if (countRefusal) stats.SkippedDirty++;
                        stats.LastResult = "skipped (unsaved changes)";
                        break;
                    case TriggerFireResult.SkippedModal:
                        if (countRefusal) stats.SkippedModal++;
                        // Name WHAT blocked it. "skipped (dialog open)" on a screen that looks
                        // idle — because the blocker was a full-screen overlay or a picker behind
                        // the main window — reads as a bug in the automation engine, and steps 4-5
                        // deliberately made this case more common. Falls back to the old literal
                        // if the guard has no reason on record.
                        stats.LastResult = AutomationGuard.LastReason ?? "skipped (dialog open)";
                        break;
                    case TriggerFireResult.NotReady:
                        stats.LastResult = "waiting (app starting)";
                        break;
                    default:
                        stats.LastResult = "failed to start";
                        break;
                }
            }
            // Only "fired" used to be logged, so a skip left NO durable trace anywhere: the
            // counters live in the panel and (before persistence) died with the process, meaning
            // "did my automation run last night?" was unanswerable after a restart.
            //
            // Log the TRANSITION, not the state. A blocked watcher reaches this repeatedly for
            // exactly the outcomes worth logging, so logging per call would grow the file for as
            // long as the block lasts; one line when the outcome changes keeps the durable trace
            // and costs nothing while it persists.
            //
            // Two details in the original reasoning have since stopped being true, and neither
            // changes the conclusion. The per-loop retry cadences it listed (interval 5 s, schedule
            // 15 s, clipboard 2 s) were replaced by the fire queue in 2026-08-04, and the worst
            // case now is FASTER, not slower: a level-mode watcher over a dirty grid re-asks on
            // every poll. And DiagnosticLog stopped being "a synchronous append under a global
            // lock" when it became lock-free — but its queue is bounded and shared with the hooks
            // and WebView2, so flooding it still costs other subsystems their lines. Do not read
            // the second correction as "logging per tick is free now".
            string? logLine = null;
            lock (_lock)
            {
                var current = result == TriggerFireResult.Fired ? "fired" : stats.LastResult;
                if (!string.Equals(_lastLoggedOutcome.GetValueOrDefault(name), current, StringComparison.Ordinal))
                {
                    _lastLoggedOutcome[name] = current;
                    // NotReady is excluded even as a transition: it fires once per tick during boot
                    // and resolves itself the moment the bridge is up.
                    if (result != TriggerFireResult.NotReady)
                        logLine = result == TriggerFireResult.Fired
                            ? $"Automation: fired '{name}'"
                            : $"Automation: '{name}' {current}";
                }
            }
            if (logLine != null) DiagnosticLog.Info(logLine);
            MarkStatsDirty();
            NotifyStateChanged();
            return result;
        }

        private TriggerStats GetStatsLocked(string name)
        {
            if (!_stats.TryGetValue(name, out var s))
            {
                s = new TriggerStats();
                _stats[name] = s;
            }
            return s;
        }

        // ── Stats persistence ────────────────────────────────────────────────────────────────
        //
        // Fire counts, last-fired times and skip counters were in-memory only, so every launch
        // reset them to zero and "-". That made the ONE question a background daemon exists to
        // answer — "did this run while I was away?" — unanswerable, and it also erased the
        // interval loop's anchor, which is why a long interval could never come due (the loop
        // re-anchored to launch time on every start).
        //
        // Sidecar + debounced atomic write, following the run-cursors.json convention:
        // FileHelper.WriteAllTextAtomic yields UTF-8 with no BOM, matching the app's other JSON
        // writers. Debounced because a level-mode watcher can fire every few seconds.
        private const string StatsFileName = "automation-stats.json";
        private const int StatsSaveDebounceMs = 2000;
        private System.Threading.Timer? _statsTimer;

        private sealed class PersistedStats
        {
            public DateTime? LastFiredAt { get; set; }
            public int FireCount { get; set; }
            public int SkippedBusy { get; set; }
            public int SkippedDirty { get; set; }
            public int SkippedModal { get; set; }
            public int SkippedSuppressed { get; set; }
            public string? LastResult { get; set; }
            public long LastScheduleOccurrenceTicks { get; set; }
        }

        private static string StatsPath()
        {
            string dir = System.IO.Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "TrueReplayer");
            System.IO.Directory.CreateDirectory(dir);
            return System.IO.Path.Combine(dir, StatsFileName);
        }

        /// <summary>
        /// True once a load attempt has REACHED A VERDICT about the file — including the two
        /// verdicts that leave the map empty on purpose (no file yet, or a file holding null).
        /// False means we never found out what is on disk, and writing would be guessing.
        ///
        /// The mirror in RunCursorService has carried this guard from the start, with the reason
        /// on the tin: never write before a load, or the file gets clobbered with {}. Here the
        /// exposure is worse than it looks, because the map is not empty when the write happens:
        /// Reload calls GetStatsLocked for every armed trigger, seeding ZEROED entries. So a load
        /// that threw is followed by a perfectly plausible-looking save of counters that are all
        /// zero, and the fire history is gone mid-session — before any exit path runs.
        /// </summary>
        /// volatile because the writer is the startup thread and the readers are the debounce
        /// timer and the exit paths — the same discipline _globalEnabled uses.
        private volatile bool _statsLoaded;

        /// <summary>Restore persisted fire stats. Call once, before the first Reload.</summary>
        public void LoadStats()
        {
            try
            {
                var path = StatsPath();
                // Both early returns are verdicts, not failures — a first launch has no file, and
                // an empty map is a legitimate state. Marking them loaded is what keeps a brand
                // new install from being unable to persist anything for the rest of its life.
                if (!System.IO.File.Exists(path)) { _statsLoaded = true; return; }
                var map = JsonSerializer.Deserialize<Dictionary<string, PersistedStats>>(System.IO.File.ReadAllText(path));
                if (map == null) { _statsLoaded = true; return; }
                lock (_lock)
                {
                    foreach (var (name, p) in map)
                    {
                        _stats[name] = new TriggerStats
                        {
                            LastFiredAt = p.LastFiredAt,
                            FireCount = p.FireCount,
                            SkippedBusy = p.SkippedBusy,
                            SkippedDirty = p.SkippedDirty,
                            SkippedModal = p.SkippedModal,
                            SkippedSuppressed = p.SkippedSuppressed,
                            LastResult = p.LastResult,
                            LastScheduleOccurrenceTicks = p.LastScheduleOccurrenceTicks,
                            // CooldownUntilTicks is deliberately NOT restored: a cooldown is a
                            // rate limit on a running watcher, not history. Restoring one would
                            // silently mute a watcher for minutes after a restart.
                        };
                    }
                }
                _statsLoaded = true;
            }
            catch (Exception ex)
            {
                // Corrupt/unreadable stats must never stop the daemon — the session runs from zero.
                // _statsLoaded stays FALSE, which is the part that matters: "worst case we start at
                // zero" was only ever true of memory. On disk the worst case was destruction — the
                // next save wrote the zeroed map over the very history this failed to read, so one
                // transient read error (antivirus, OneDrive, a half-written file) permanently
                // erased every automation's record. Now the session simply does not persist.
                DiagnosticLog.Warn($"Automation stats load failed — running from zero, and NOT writing back ({ex.Message})");
            }
        }

        private void MarkStatsDirty()
        {
            lock (_lock)
            {
                if (_statsTimer != null) return;
                _statsTimer = new System.Threading.Timer(_ =>
                {
                    lock (_lock)
                    {
                        _statsTimer?.Dispose();
                        _statsTimer = null;
                    }
                    SaveStats();
                }, null, StatsSaveDebounceMs, System.Threading.Timeout.Infinite);
            }
        }

        /// <summary>Write pending stats immediately — call from the app's exit paths.</summary>
        public void Flush()
        {
            lock (_lock)
            {
                _statsTimer?.Dispose();
                _statsTimer = null;
            }
            SaveStats();
        }

        // Serializing AND writing inside _lock is deliberate — the same discipline
        // RunCursorService.SaveLocked documents. Flush() (exit paths) and the debounce timer
        // callback can both reach here, and Timer.Dispose does not wait for a callback already in
        // flight; with the write outside the lock, two WriteAllTextAtomic calls race on the same
        // target and the older snapshot can land last, losing the very fire the exit flush existed
        // to save. The payload is a handful of counters per automation, so holding the lock across
        // the write costs nothing measurable.
        private void SaveStats()
        {
            // The gate lives HERE and not in Flush(): every writer funnels through this method —
            // the exit paths, the debounce timer, the prune's write-through — and a guard on one
            // of them would simply let the others clobber the file instead.
            if (!_statsLoaded) return;
            try
            {
                lock (_lock)
                {
                    var snapshot = _stats.ToDictionary(
                        kv => kv.Key,
                        kv => new PersistedStats
                        {
                            LastFiredAt = kv.Value.LastFiredAt,
                            FireCount = kv.Value.FireCount,
                            SkippedBusy = kv.Value.SkippedBusy,
                            SkippedDirty = kv.Value.SkippedDirty,
                            SkippedModal = kv.Value.SkippedModal,
                            SkippedSuppressed = kv.Value.SkippedSuppressed,
                            LastResult = kv.Value.LastResult,
                            LastScheduleOccurrenceTicks = kv.Value.LastScheduleOccurrenceTicks,
                        },
                        StringComparer.OrdinalIgnoreCase);

                    var path = StatsPath();
                    // Empty snapshot is only a no-op when there is nothing on disk either. Once a
                    // file exists, "everything was pruned" is a real state that has to be written —
                    // bailing out would leave the deleted profiles' stats to be read back on the
                    // next launch, which is the exact staleness the prune exists to remove.
                    if (snapshot.Count == 0 && !System.IO.File.Exists(path)) return;
                    FileHelper.WriteAllTextAtomic(path, JsonSerializer.Serialize(snapshot));
                }
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Automation stats save failed ({ex.Message})");
            }
        }

        private void SetLastResult(TriggerStats stats, string message)
        {
            lock (_lock) stats.LastResult = message;
            // Persist these too, not just fire outcomes. The reasons that arrive through here are
            // the STOP reasons ("reference image missing", "can never match", "missed") — exactly
            // what a user needs to still be on screen after the restart that used to erase it.
            MarkStatsDirty();
        }

        // Trailing debounce (300 ms): a flapping condition probe (a pixel watcher on an
        // animated region flips up to 4×/s) must not drive a full automation:state push +
        // tray refresh per flip. Bursts collapse to one notification.
        private System.Threading.Timer? _notifyTimer;

        private void NotifyStateChanged()
        {
            lock (_lock)
            {
                if (_notifyTimer != null) return;
                _notifyTimer = new System.Threading.Timer(_ =>
                {
                    lock (_lock)
                    {
                        _notifyTimer?.Dispose();
                        _notifyTimer = null;
                    }
                    try { OnStateChanged?.Invoke(); }
                    catch { /* status push is best-effort */ }
                }, null, 300, System.Threading.Timeout.Infinite);
            }
        }

        private static string SerializeConfig(ProfileTriggerConfig config)
            => JsonSerializer.Serialize(config);
    }
}
