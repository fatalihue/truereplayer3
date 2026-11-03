using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading;
using TrueReplayer.Helpers;
using TrueReplayer.Interop;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Always-on 1:1 key remap layer (the AutoHotkey classic: CapsLock→Esc, mouse
    /// side-button→key, disable a key). Config lives in its own sidecar
    /// Documents\TrueReplayer\remaps.json (the AppSettings POCO's full-rebuild save
    /// pattern doesn't fit lists; profile-order.json precedent) and is loaded in the
    /// MainWindow ctor BEFORE the input hooks start — the layer must work even if
    /// WebView2 never comes up (tray-daemon usage). The UI only edits + republishes.
    /// The hook-facing artifact is a volatile snapshot dictionary registered into
    /// InputHookManager (ProfileHotkeys pattern).
    /// </summary>
    public static class RemapService
    {
        public class RemapEntry
        {
            public string From { get; set; } = "";
            // Empty string = disable the key (swallow with no replacement). A key name, or one of
            // the mouse-side names (LeftClick, RightClick, MiddleClick, XButton1, XButton2,
            // ScrollUp, ScrollDown) — see MouseTargets.
            public string To { get; set; } = "";
            public bool Enabled { get; set; } = true;
            // Per-app scope: the process the rule is limited to ("chrome.exe" or "chrome"; case
            // and the extension do not matter). Empty = any app. Absent in files written before
            // 2026-09-05, which System.Text.Json reads as the default — a global rule, exactly
            // what those entries were. An older app reading a scoped file ignores the field and
            // applies the rule everywhere; the file stays loadable both ways.
            public string Process { get; set; } = "";
        }

        public class RemapConfig
        {
            public bool Enabled { get; set; } = true;
            public List<RemapEntry> Remaps { get; set; } = new();
        }

        public const int MaxRemaps = 32;
        private const string FileName = "remaps.json";

        // One instance each: JsonSerializerOptions is the type-metadata cache, so a fresh one per
        // call rebuilds the RemapConfig graph. Frozen on first use, so sharing is safe.
        private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };
        private static readonly JsonSerializerOptions WriteOptions = new() { WriteIndented = true };

        // Last content of remaps.json that PARSED. Written by Load (the text just proved itself)
        // and refreshed after a successful Save; never touched while the load latch is on, because
        // then it is the only surviving copy of the user's list.
        private const string BackupFileName = "remaps.bak.json";

        // Where an edit goes while the latch is on. Nothing reads it back automatically: the app
        // cannot know whether remaps.json became readable again with NEWER content than this, so
        // merging is the user's call. Both the balloon and the log name the path — and so does the
        // Settings panel's quarantine notice, which is why the name is public.
        public const string PendingFileName = "remaps.pending.json";

        private static readonly object _lock = new();

        public static RemapConfig Current { get; private set; } = new();

        /// <summary>
        /// TRUE only for "remaps.json is there and we could not turn it into a config" — a sharing
        /// violation (this sidecar lives under Documents, which is usually cloud-synced), an
        /// antivirus lock, a write cut short, hand-edited JSON. It is NOT set when the file is
        /// simply absent: that is a legitimately empty config, the state every fresh install is in.
        ///
        /// Collapsing those two into one empty <see cref="Current"/> is what made a transient read
        /// failure permanent. Up to 32 remaps rendered as an empty panel, indistinguishable from
        /// having none — and the first thing anyone tries, flipping "Enable Key Remaps" off and on
        /// to see if that wakes it up, called Save with that empty list and wrote it over the file.
        /// One locked read, and the list was gone for good. While this is set Save will not touch
        /// remaps.json at all (see Save), so the data outlives whatever was holding the file.
        /// </summary>
        public static bool LoadFailed { get; private set; }

        /// <summary>
        /// Why <see cref="LoadFailed"/> is set, in one line, for the Key Remaps page (under its
        /// quarantine notice): the engine's sentence and the error's own words. Said when it is read,
        /// so it follows the interface's language; the log writes the exception itself.
        /// </summary>
        public static string? LoadFailureDetail => LoadFailed ? FailureDetail(_loadError, _loadErrorIsParse) : null;

        // What LoadFailureDetail says, kept as the failure rather than as words.
        private static Exception? _loadError;
        private static bool _loadErrorIsParse;

        /// <summary>
        /// True when <see cref="Current"/> came from <see cref="BackupFileName"/> because
        /// remaps.json was unreadable. The layer works and the panel is populated, but what is
        /// shown is the last known-good copy, which may be older than the file on disk.
        /// </summary>
        public static bool LoadedFromBackup { get; private set; }

        // Read attempts for a file that exists but will not open. The holders we lose to here —
        // OneDrive/Dropbox uploading it, Defender scanning it moments after a write — keep it for
        // tens of milliseconds, not seconds, so three quick tries clear nearly all of them.
        // Deliberately much shorter than FileHelper's write-side ladder (~3.8s): this runs in the
        // MainWindow ctor, before the hooks exist, and a frozen startup is its own bug.
        private const int ReadRetryAttempts = 3;
        private const int ReadRetryDelayMs = 40;

        private static string GetPath()
        {
            string dir = AppIdentity.DocumentsRoot;
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, FileName);
        }

        private static string SiblingPath(string fileName) =>
            Path.Combine(Path.GetDirectoryName(GetPath())!, fileName);

        public static void Load()
        {
            lock (_lock)
            {
                var path = GetPath();

                // No FileHelper.CleanupOrphanTemps sweep here, deliberately. It matches on SHAPE —
                // 8 lowercase-alnum chars, '.', 3 more — which is safe in Profiles\, a directory
                // only the app writes to with long names. This one is Documents\TrueReplayer: the
                // user opens it, and an ordinary file of theirs like mymacros.txt fits that shape
                // exactly. A data-loss fix must not plant a delete-by-pattern in a user folder.
                // WriteAllTextAtomic only strands a temp when both its retried Move AND its
                // cleanup Delete fail, and every other sidecar here already lives with that.

                // A retry is a fresh verdict: a file that reads fine now is no longer quarantined.
                LoadFailed = false;
                _loadError = null;
                _loadErrorIsParse = false;
                LoadedFromBackup = false;

                if (!File.Exists(path))
                {
                    // ABSENT. Nothing to protect and nothing to warn about — this is what a new
                    // install looks like, and Save stays free to create the file.
                    Current = new RemapConfig();
                    Publish();
                    return;
                }

                // PRESENT. From here on, every failure path must leave the file alone.
                bool parseFailed = false;
                if (TryReadText(path, out var json, out var readError))
                {
                    var parsed = TryParse(json, out var parseError);
                    if (parsed != null)
                    {
                        Current = parsed;
                        // Snapshot the text we just proved parseable, so the next start has
                        // something to fall back on if the file is unreadable by then.
                        WriteBackupIfChanged(json);
                        Publish();
                        return;
                    }
                    readError = parseError;
                    parseFailed = true;
                }

                LoadFailed = true;
                _loadError = readError;
                _loadErrorIsParse = parseFailed;
                DiagnosticLog.Error(
                    $"remaps.json could not be read — it will NOT be overwritten; edits this session go to {PendingFileName}",
                    readError ?? new IOException("unknown read failure"));

                if (TryLoadBackup(out var backup))
                {
                    Current = backup;
                    LoadedFromBackup = true;
                    int count = backup.Remaps.Count;
                    Announce(S.RemapsUnreadableTitle, S.RemapsUnreadableBackup(n: S.Num(count), pending: PendingFileName, count: count));
                }
                else
                {
                    Current = new RemapConfig();
                    Announce(S.RemapsUnreadableTitle, S.RemapsUnreadableNoBackup);
                }
                Publish();
            }
        }

        /// <param name="overwriteUnreadableFile">
        /// The explicit "yes, replace whatever is in that file" the quarantine below waits for.
        /// Only a deliberate user choice may pass true — every ordinary save leaves it false.
        /// </param>
        public static void Save(RemapConfig config, bool overwriteUnreadableFile = false)
        {
            lock (_lock)
            {
                if (config.Remaps.Count > MaxRemaps)
                    config.Remaps = config.Remaps.GetRange(0, MaxRemaps);

                // The edit takes effect in this session either way. The layer is live state, and
                // refusing to apply it would stack a second, invisible failure on the first.
                Current = config;
                try
                {
                    var json = JsonSerializer.Serialize(config, WriteOptions);

                    if (LoadFailed && !overwriteUnreadableFile)
                    {
                        // QUARANTINE. We hold a config we could not read off disk, so writing it
                        // back is not a save, it is a delete of everything the file still holds.
                        if (config.Remaps.Count == 0)
                        {
                            // Nothing worth preserving, and a pending file containing an empty
                            // list is a trap: it invites the user to copy it over a remaps.json
                            // that may be perfectly intact by then. Write nothing.
                            DiagnosticLog.Warn(
                                "Key remaps: change NOT written — remaps.json is unreadable and the in-memory list is empty. Live for this session only.");
                            Announce(S.RemapsNotSavedTitle, S.RemapsNotSavedEmpty);
                        }
                        else
                        {
                            FileHelper.WriteAllTextAtomic(SiblingPath(PendingFileName), json);
                            DiagnosticLog.Warn(
                                $"Key remaps: remaps.json is unreadable, so the change was written to {PendingFileName} instead. remaps.json is untouched.");
                            Announce(S.RemapsNotSavedTitle, S.RemapsNotSavedPending(PendingFileName));
                        }
                        // Note the backup is NOT refreshed here: while the main file is unreadable
                        // it is the last known-good copy, and this content never came off disk.
                    }
                    else
                    {
                        FileHelper.WriteAllTextAtomic(GetPath(), json);
                        WriteBackupIfChanged(json);
                        if (LoadFailed)
                        {
                            // The user chose to replace the unreadable file and we did: the file on
                            // disk is ours again, so the quarantine has nothing left to protect.
                            LoadFailed = false;
                            _loadError = null;
                            _loadErrorIsParse = false;
                            LoadedFromBackup = false;
                            DiagnosticLog.Info("remaps.json overwritten on explicit request — load-failure quarantine cleared.");
                        }
                    }
                }
                catch (Exception ex)
                {
                    DiagnosticLog.Error("remaps.json save failed", ex);
                }
                Publish();
            }
        }

        /// <summary>
        /// Opens with FileShare.ReadWrite where File.ReadAllText asks for FileShare.Read only:
        /// a sync agent or scanner that has the file open for WRITING fails the stricter mode,
        /// and this is a file no other part of the process writes concurrently.
        /// </summary>
        private static bool TryReadText(string path, out string text, out Exception? error,
            int attempts = ReadRetryAttempts)
        {
            text = "";
            error = null;
            for (int attempt = 0; attempt < attempts; attempt++)
            {
                try
                {
                    using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
                        FileShare.ReadWrite | FileShare.Delete);
                    using var reader = new StreamReader(stream, detectEncodingFromByteOrderMarks: true);
                    text = reader.ReadToEnd();
                    return true;
                }
                catch (Exception ex)
                {
                    error = ex;
                    if (attempt < attempts - 1) Thread.Sleep(ReadRetryDelayMs);
                }
            }
            return false;
        }

        // Malformed content is not retried — it will be just as malformed 40ms later. Kept apart
        // from TryReadText so the two failures stay distinguishable in the log.
        private static RemapConfig? TryParse(string json, out Exception? error)
        {
            error = null;
            try
            {
                return JsonSerializer.Deserialize<RemapConfig>(json, ReadOptions) ?? new RemapConfig();
            }
            catch (Exception ex)
            {
                error = ex;
                return null;
            }
        }

        private static bool TryLoadBackup(out RemapConfig config)
        {
            config = new RemapConfig();
            try
            {
                var backupPath = SiblingPath(BackupFileName);
                if (!File.Exists(backupPath)) return false;
                if (!TryReadText(backupPath, out var text, out _)) return false;
                var parsed = TryParse(text, out _);
                if (parsed == null) return false;
                config = parsed;
                DiagnosticLog.Info($"Key remaps recovered from {BackupFileName}: {parsed.Remaps.Count} entries.");
                return true;
            }
            catch
            {
                return false;
            }
        }

        // Compares before writing: Load calls this on every app start, and this directory is
        // typically cloud-synced — rewriting identical bytes is a sync upload for nothing.
        // A backup that cannot be written is never a reason to fail the thing it backs up.
        private static void WriteBackupIfChanged(string json)
        {
            try
            {
                var backupPath = SiblingPath(BackupFileName);
                // One attempt only: this read decides "skip a redundant write", nothing more, and
                // Save runs it on the UI thread. If the backup is momentarily locked we just
                // rewrite it — and if THAT fails, the catch below turns it into a log line.
                if (File.Exists(backupPath)
                    && TryReadText(backupPath, out var existing, out _, attempts: 1)
                    && string.Equals(existing, json, StringComparison.Ordinal))
                {
                    return;
                }
                FileHelper.WriteAllTextAtomic(backupPath, json);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"remaps backup write failed: {ex.GetType().Name}: {ex.Message}");
            }
        }

        // The engine's sentence for the failure and, after it, the error's own words: the engine's
        // phrase for the common ones (in use, access denied — S.Reason), the .NET text otherwise. A
        // parse error is .NET's JSON message, which says the line and the column.
        private static string FailureDetail(Exception? ex, bool isParse) =>
            ex == null ? S.RemapsDetailUnknown
            : isParse ? S.RemapsDetailParse(ex.Message)
            : S.RemapsDetailRead(S.Reason(ex));

        // A Windows notification is the only user-facing surface this service can reach on its own: Load
        // runs in the window ctor, long before WebView2 (and in tray-daemon usage the panel may
        // never open at all). Never let a notification failure break a load or a save.
        private static void Announce(string title, string text)
        {
            try { WindowsNotices.Show(title, text, null, (S.RemapsOpen, "remaps-open")); }
            catch (Exception ex) { DiagnosticLog.Warn($"remap notification failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        public static void SetEnabled(bool enabled)
        {
            RemapConfig updated;
            lock (_lock)
            {
                updated = new RemapConfig { Enabled = enabled, Remaps = Current.Remaps };
            }
            Save(updated);
        }

        /// <summary>
        /// Compiles the config into the hook's snapshot — fromVk → the rules for that key, each a
        /// target plus an optional per-app scope: enabled entries only, self-remaps rejected, the
        /// same FROM in the same scope first-wins, unresolvable names skipped. TO of "" is the
        /// Disable target (swallow-only); the mouse-side names resolve to Mouse/Wheel targets.
        /// </summary>
        // Mouse-side targets, by the names the UI stores. Injected through SendInput's MOUSE path,
        // never as a keyboard vk — a keyboard injection of VK_XBUTTON1 is a no-op, which is why
        // these were refused as targets until 2026-09-05. Sources stay keys and side buttons.
        private static readonly Dictionary<string, RemapTarget> MouseTargets = new(StringComparer.OrdinalIgnoreCase)
        {
            ["LeftClick"] = RemapTarget.ForMouse(NativeMethods.MOUSEEVENTF_LEFTDOWN, NativeMethods.MOUSEEVENTF_LEFTUP),
            ["RightClick"] = RemapTarget.ForMouse(NativeMethods.MOUSEEVENTF_RIGHTDOWN, NativeMethods.MOUSEEVENTF_RIGHTUP),
            ["MiddleClick"] = RemapTarget.ForMouse(NativeMethods.MOUSEEVENTF_MIDDLEDOWN, NativeMethods.MOUSEEVENTF_MIDDLEUP),
            ["XButton1"] = RemapTarget.ForMouse(NativeMethods.MOUSEEVENTF_XDOWN, NativeMethods.MOUSEEVENTF_XUP, NativeMethods.XBUTTON1),
            ["XButton2"] = RemapTarget.ForMouse(NativeMethods.MOUSEEVENTF_XDOWN, NativeMethods.MOUSEEVENTF_XUP, NativeMethods.XBUTTON2),
            ["ScrollUp"] = RemapTarget.ForWheel(120),
            ["ScrollDown"] = RemapTarget.ForWheel(-120),
        };

        /// <summary>
        /// The per-app scope as the hook compares it: lower-case, trimmed, without ".exe". Null
        /// for "any app". One normalisation, shared by the compile step and by the duplicate
        /// check in the bridge, so "Chrome.EXE" and "chrome" are one scope everywhere.
        /// </summary>
        public static string? NormalizeProcess(string? raw)
        {
            if (string.IsNullOrWhiteSpace(raw)) return null;
            var p = raw.Trim().ToLowerInvariant();
            if (p.EndsWith(".exe", StringComparison.Ordinal)) p = p[..^4];
            return p.Length == 0 ? null : p;
        }

        private static bool TryResolveTarget(string? to, out RemapTarget target)
        {
            target = RemapTarget.Disable;
            if (string.IsNullOrWhiteSpace(to)) return true;   // "" = disable the key
            var name = to.Trim();
            if (MouseTargets.TryGetValue(name, out target)) return true;
            if (!KeyUtils.TryResolveVirtualKeyCode(name, out var vk)) return false;
            // A mouse-button vk reached by another spelling ("VK_5") is still not a key to inject.
            if (vk == 0x01 || vk == 0x02 || vk == 0x04 || vk == 0x05 || vk == 0x06) return false;
            target = RemapTarget.ForKey(vk);
            return true;
        }

        // Generic modifier names (what hotkey capture emits for either physical side) fan out
        // to BOTH side vks on the FROM side — capturing RIGHT Alt shows "Alt" in the chip, and
        // remapping only the left one would silently target the wrong physical key.
        private static readonly Dictionary<string, ushort[]> ModifierSidePairs = new(StringComparer.OrdinalIgnoreCase)
        {
            ["Ctrl"] = new ushort[] { 0xA2, 0xA3 },
            ["Alt"] = new ushort[] { 0xA4, 0xA5 },
            ["Shift"] = new ushort[] { 0xA0, 0xA1 },
            ["Win"] = new ushort[] { 0x5B, 0x5C },
        };

        private static readonly ushort[] LeftAltOnly = { 0xA4 };

        /// <summary>
        /// The fan-out above, minus the one side that is not a modifier at all.
        ///
        /// On a layout with AltGr — ABNT2, the European layouts, US-International — 0xA5
        /// (VK_RMENU) is NOT "the other Alt". It is the key that reaches an entire third
        /// character layer: on ABNT2 that is @ \ [ ] { } and the superscripts, characters the
        /// user has no other way to type. Fanning "Alt" out to it does not remap a modifier,
        /// it deletes a layer of the keyboard, and it does something worse on the way: because
        /// win32k synthesises a left Ctrl in front of every AltGr press (see IsAltGrPhantomCtrl
        /// in InputHookManager), the phantom is delivered to the app while the RAlt is swallowed
        /// and replaced — so the app receives Ctrl+TO. With the very ordinary remap Alt to W,
        /// every attempt to type an @ closed the browser tab.
        ///
        /// So on those layouts "Alt" means the LEFT Alt and nothing else. The fan-out's own
        /// justification — hotkey capture emits the side-less name "Alt" for either physical
        /// key, so honouring only one side would silently target the wrong one — still holds
        /// everywhere it is true, which is every layout WITHOUT AltGr; there the pair stands.
        /// A user who really does want the AltGr key itself remapped can still say so with the
        /// explicit name "RightAlt", which resolves straight to 0xA5 through KeyUtils and
        /// bypasses this fan-out entirely. That is the deliberate, named, opt-in version of
        /// what used to happen to everyone on the owner's keyboard by default — and the hook
        /// neutralises the phantom Ctrl for it, so even chosen deliberately it behaves.
        /// </summary>
        private static ushort[] SideVksFor(string name, ushort[] pair)
        {
            if (!name.Equals("Alt", StringComparison.OrdinalIgnoreCase)) return pair;
            return KeyUtils.LayoutHasAltGr() ? LeftAltOnly : pair;
        }

        // Layout the current snapshot was compiled against. Every from/to that is a single
        // character outside the static name map resolves through the layout, so a snapshot is
        // only valid for the layout that produced it — see RepublishForLayoutChange.
        private static IntPtr _publishedLayout = IntPtr.Zero;

        /// <summary>
        /// Recompiles the hook snapshot against whatever layout is active NOW, and does nothing
        /// if that is the layout it was already compiled against.
        ///
        /// Publish() only ever ran from Load() and Save(), so the compiled vks were frozen at
        /// whatever the layout happened to be at startup. Switch layout with Alt+Shift and every
        /// remap whose from/to is a single character — ç [ ; - ' / , the whole ABNT2 OEM row —
        /// keeps pointing at the vk that character had on the OLD layout, which on the new one
        /// is a different physical key or none at all.
        ///
        /// The event that says the layout changed is WM_INPUTLANGCHANGE, which arrives at the
        /// window, not here. This is the half that belongs to the service: the window's handler
        /// is one call to this method. Cheap and idempotent by design so that handler needs no
        /// filtering of its own — no disk I/O, and an unchanged layout returns immediately.
        /// KeyUtils.ActiveLayout is the UI thread's layout whichever thread asks (KeyUtils.BindUiThread).
        /// </summary>
        public static void RepublishForLayoutChange()
        {
            lock (_lock)
            {
                if (KeyUtils.ActiveLayout == _publishedLayout) return;
                Publish();
            }
        }

        private static void Publish()
        {
            var rules = new Dictionary<int, List<RemapRule>>();
            int active = 0;
            bool narrowedAltFanOut = false;
            _publishedLayout = KeyUtils.ActiveLayout;
            if (Current.Enabled)
            {
                foreach (var entry in Current.Remaps)
                {
                    if (!entry.Enabled) continue;
                    if (string.IsNullOrWhiteSpace(entry.From)) continue;
                    if (string.Equals(entry.From, entry.To, StringComparison.OrdinalIgnoreCase)) continue;
                    if (!TryResolveTarget(entry.To, out var target)) continue;
                    string? process = NormalizeProcess(entry.Process);

                    ushort[] fromVks;
                    var fromName = entry.From.Trim();
                    if (ModifierSidePairs.TryGetValue(fromName, out var pair))
                    {
                        fromVks = SideVksFor(fromName, pair);
                        if (fromVks.Length < pair.Length) narrowedAltFanOut = true;
                    }
                    else if (KeyUtils.TryResolveVirtualKeyCode(entry.From, out var fromVk))
                    {
                        fromVks = new[] { fromVk };
                    }
                    else
                    {
                        continue;
                    }

                    bool added = false;
                    foreach (var fv in fromVks)
                    {
                        if (!rules.TryGetValue(fv, out var list)) rules[fv] = list = new List<RemapRule>();
                        // The same FROM in the same scope twice — first wins, as it always did. A
                        // different scope is a different rule: "F in the game" and "F everywhere
                        // else" both stand, and the hook picks the scoped one when its app is in front.
                        if (list.Exists(r => string.Equals(r.Process, process, StringComparison.Ordinal))) continue;
                        list.Add(new RemapRule(process, target));
                        added = true;
                    }
                    if (added) active++;
                }
            }
            var map = new Dictionary<int, RemapRule[]>(rules.Count);
            foreach (var kv in rules) map[kv.Key] = kv.Value.ToArray();
            InputHookManager.RegisterRemaps(map);
            // The suffix is what makes "0 active" readable after the fact: an empty layer because
            // the user has no remaps and an empty layer because the file would not open used to
            // write the identical log line.
            string state = !LoadFailed ? ""
                : LoadedFromBackup ? " — from BACKUP, remaps.json unreadable"
                : " — remaps.json UNREADABLE, list not recovered";
            // Named in the log because it is the one case where the compiled snapshot is
            // deliberately narrower than the config reads, and "my Alt remap only works on the
            // left Alt" is otherwise indistinguishable from a bug.
            string altGr = narrowedAltFanOut
                ? " — AltGr layout: 'Alt' compiled to LEFT Alt only (right Alt is AltGr here; use \"RightAlt\" to remap it deliberately)"
                : "";
            DiagnosticLog.Info($"Key remaps published: {active} active (config {Current.Remaps.Count}, enabled={Current.Enabled}){state}{altGr}");
        }
    }
}
