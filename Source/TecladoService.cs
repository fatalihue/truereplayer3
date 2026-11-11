using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Teclado: TrueReplayerMK as a mode of TrueReplayer 3 (branch "teclado"; plan
    /// .claude/planos/teclado-no-tr3-2026-11-10.md). A keyboard per game: a game is matched by its
    /// .exe in the foreground, and each physical key (by <c>KeyboardEvent.code</c>, see
    /// <see cref="TecladoKeys"/>) can take a function on the base layer and on a hold layer that
    /// inherits from the base. Config lives in its own sidecar, Documents\TrueReplayer3\teclado.json,
    /// with RemapService's protections: a copy of the last good read (teclado.bak.json), and a
    /// quarantine that never writes over a file it could not read — edits go to
    /// teclado.pending.json until the user says to replace it.
    ///
    /// Phase 1 keeps the config, checks it and hands it to the page; the foreground event comes in
    /// phase 2 and the hook in phase 3.
    /// </summary>
    public static class TecladoService
    {
        /// <summary>A key's function. Absent from the layer's map = the default (the key does what it always does).</summary>
        public sealed class KeyFunction
        {
            /// <summary>key | mouse | macro | text | off | layer (see <see cref="Kinds"/>).</summary>
            public string Kind { get; set; } = "off";
            /// <summary>key: the key or combo that goes out, in KeyUtils names ("Space", "Ctrl+Shift+1").</summary>
            public string? Combo { get; set; }
            /// <summary>mouse: one of the Key Remaps' mouse targets (LeftClick … ScrollDown).</summary>
            public string? Mouse { get; set; }
            /// <summary>macro: the library macro's name.</summary>
            public string? Macro { get; set; }
            /// <summary>macro: once | times | hold | toggle.</summary>
            public string? Mode { get; set; }
            public int? Times { get; set; }
            /// <summary>macro: ms between repetitions (times, hold, toggle).</summary>
            public int? Interval { get; set; }
            /// <summary>macro: the game also gets the key itself.</summary>
            public bool? KeepOriginal { get; set; }
            /// <summary>text: what is typed, and whether Enter follows.</summary>
            public string? Text { get; set; }
            public bool? Enter { get; set; }
        }

        public sealed class Game
        {
            public string Id { get; set; } = "";
            public string Name { get; set; } = "";
            /// <summary>The executables that bring it in: a launcher and the game, or two editions.</summary>
            public List<string> Exes { get; set; } = new();
            public bool On { get; set; } = true;
            public Dictionary<string, KeyFunction> Base { get; set; } = new();
            public Dictionary<string, KeyFunction> Layer { get; set; } = new();
        }

        public sealed class Config
        {
            public int Version { get; set; } = SchemaVersion;
            /// <summary>The mode's master switch (the status bar's "Teclado").</summary>
            public bool Enabled { get; set; } = true;
            /// <summary>The drawing's physical layout chosen by hand (abnt2, ansi, iso), or null to follow Windows' (phase 5).</summary>
            public string? Layout { get; set; }
            public List<Game> Games { get; set; } = new();
        }

        public static readonly IReadOnlyCollection<string> Layouts = new[] { "abnt2", "ansi", "iso" };

        /// <summary>
        /// The drawing's physical family from Windows' keyboard layout (the UI thread's, the one the user
        /// types with): ABNT2 for Brazilian Portuguese, ANSI for US English and the East Asian layouts,
        /// ISO for the rest. A guess about the hardware, which the page lets the user correct.
        /// </summary>
        public static string DetectLayout()
        {
            int lang = (int)((long)Interop.NativeMethods.GetKeyboardLayout(0) & 0xFFFF);
            int primary = lang & 0x3FF;
            if (lang == 0x0416) return "abnt2";
            // English (US), Chinese, Japanese, Korean.
            if (lang == 0x0409 || primary == 0x04 || primary == 0x11 || primary == 0x12) return "ansi";
            return "iso";
        }

        public const int SchemaVersion = 1;
        public const int MaxGames = 64;
        public const int MaxExes = 8;
        public const int MaxNameLength = 60;
        public const int MaxTextLength = 500;
        public const int MaxComboLength = 40;
        public const int MaxTimes = 999;
        public const int MaxIntervalMs = 60_000;

        public static readonly IReadOnlyCollection<string> Kinds = new[] { "key", "mouse", "macro", "text", "off", "layer" };
        public static readonly IReadOnlyCollection<string> Modes = new[] { "once", "times", "hold", "toggle" };
        // The same names RemapService resolves as mouse targets.
        public static readonly IReadOnlyCollection<string> MouseTargets = new[] { "LeftClick", "RightClick", "MiddleClick", "XButton1", "XButton2", "ScrollUp", "ScrollDown" };

        private const string FileName = "teclado.json";
        private const string BackupFileName = "teclado.bak.json";
        public const string PendingFileName = "teclado.pending.json";

        private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };
        private static readonly JsonSerializerOptions WriteOptions = new()
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        private static readonly object _lock = new();

        public static Config Current { get; private set; } = new();

        /// <summary>
        /// teclado.json is there and could not be read or parsed (RemapService.LoadFailed, for the same
        /// reasons: a sync agent, an antivirus, a hand edit). Not set for a file that is simply absent.
        /// While it is set, <see cref="Save"/> never touches teclado.json.
        /// </summary>
        public static bool LoadFailed { get; private set; }

        /// <summary><see cref="Current"/> came from teclado.bak.json because teclado.json was unreadable.</summary>
        public static bool LoadedFromBackup { get; private set; }

        /// <summary>What went wrong, in the exception's own words, for the page's notice.</summary>
        public static string? LoadFailureDetail { get; private set; }

        /// <summary>Raised after every Load and Save: the bridge pushes teclado:state on it.</summary>
        public static event Action? Changed;

        private const int ReadRetryAttempts = 3;
        private const int ReadRetryDelayMs = 40;

        private static string GetPath()
        {
            string dir = AppIdentity.DocumentsRoot;
            Directory.CreateDirectory(dir);
            return Path.Combine(dir, FileName);
        }

        private static string SiblingPath(string fileName) => Path.Combine(Path.GetDirectoryName(GetPath())!, fileName);

        public static void Load()
        {
            // Phase 4: a macro saved by the app (the editor, autosave, an import) is compiled again for
            // the keys that run it. Not every save reloads the library list, so the list alone is late.
            if (!_listening)
            {
                _listening = true;
                SettingsManager.ProfileWritten += (_, _) => MacroWritten();
            }
            lock (_lock)
            {
                var path = GetPath();
                LoadFailed = false;
                LoadedFromBackup = false;
                LoadFailureDetail = null;

                if (!File.Exists(path))
                {
                    // A new install, or nobody added a game yet: an empty config, and Save is free to create the file.
                    Current = new Config();
                    Raise();
                    return;
                }

                if (TryReadText(path, out var json, out var error))
                {
                    var parsed = TryParse(json, out var parseError);
                    if (parsed != null)
                    {
                        Current = Normalize(parsed);
                        WriteBackupIfChanged(json);
                        Raise();
                        return;
                    }
                    error = parseError;
                }

                LoadFailed = true;
                LoadFailureDetail = error?.Message;
                DiagnosticLog.Error(
                    $"teclado.json could not be read — it will NOT be overwritten; edits this session go to {PendingFileName}",
                    error ?? new IOException("unknown read failure"));
                if (TryLoadBackup(out var backup))
                {
                    Current = backup;
                    LoadedFromBackup = true;
                }
                else
                {
                    Current = new Config();
                }
                Raise();
            }
        }

        /// <param name="overwriteUnreadableFile">Only a deliberate user choice may pass true (the page's "Replace the file").</param>
        public static void Save(Config incoming, bool overwriteUnreadableFile = false)
        {
            lock (_lock)
            {
                // The edit takes effect in this session either way, as in RemapService.
                Current = Normalize(incoming);
                try
                {
                    var json = JsonSerializer.Serialize(Current, WriteOptions);
                    if (LoadFailed && !overwriteUnreadableFile)
                    {
                        // Quarantine: writing back what we hold would delete everything the unreadable file still has.
                        if (Current.Games.Count > 0)
                        {
                            FileHelper.WriteAllTextAtomic(SiblingPath(PendingFileName), json);
                            DiagnosticLog.Warn($"Teclado: teclado.json is unreadable, so the change was written to {PendingFileName} instead.");
                        }
                        else
                        {
                            DiagnosticLog.Warn("Teclado: change NOT written — teclado.json is unreadable and the list is empty. Live for this session only.");
                        }
                    }
                    else
                    {
                        FileHelper.WriteAllTextAtomic(GetPath(), json);
                        WriteBackupIfChanged(json);
                        if (LoadFailed)
                        {
                            LoadFailed = false;
                            LoadedFromBackup = false;
                            LoadFailureDetail = null;
                            DiagnosticLog.Info("teclado.json overwritten on explicit request — load-failure quarantine cleared.");
                        }
                    }
                }
                catch (Exception ex)
                {
                    DiagnosticLog.Error("teclado.json save failed", ex);
                }
                Raise();
            }
        }

        public static void SetEnabled(bool enabled)
        {
            Config next;
            lock (_lock) next = new Config { Enabled = enabled, Layout = Current.Layout, Games = Current.Games };
            Save(next);
        }

        /// <summary>The config as the page receives it (camelCase, nulls left out), with the quarantine's state.</summary>
        public static object StatePayload()
        {
            lock (_lock)
            {
                // Phase 4: what each macro a key points to is to the executor, so the panel can say why
                // one does not run from its key. Only the macros the config names, as the last compile saw them.
                var macros = new Dictionary<string, object>(StringComparer.Ordinal);
                foreach (var (name, r) in InputHookManager.TecladoMacroReports)
                    macros[name] = new { found = r.Found, empty = r.Empty, unsupported = r.Unsupported };
                return new
                {
                    config = JsonSerializer.SerializeToElement(Current, WriteOptions),
                    loadFailed = LoadFailed,
                    loadedFromBackup = LoadedFromBackup,
                    loadFailureDetail = LoadFailureDetail,
                    pendingFile = PendingFileName,
                    macros,
                    detectedLayout = DetectLayout(),
                };
            }
        }

        /// <summary>Raised after the library changed and the keys' macros were compiled again (the page's state is stale).</summary>
        public static event Action? MacrosChanged;

        private static bool _listening;

        /// <summary>A macro file was written by the app: when a key runs a macro, compile again (only a changed file is read).</summary>
        private static void MacroWritten()
        {
            lock (_lock)
            {
                bool anyMacro = Current.Games.Any(g => g.Base.Values.Any(f => f.Kind == "macro") || g.Layer.Values.Any(f => f.Kind == "macro"));
                if (!anyMacro) return;
                try { InputHookManager.PublishTeclado(Current); }
                catch (Exception ex) { DiagnosticLog.Error("Teclado: compiling the macros failed", ex); return; }
            }
            try { MacrosChanged?.Invoke(); }
            catch (Exception ex) { DiagnosticLog.Warn($"Teclado: a MacrosChanged handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        /// <summary>
        /// The macro library changed (ProfileController, after every list load: a save, an import, the
        /// disk watcher). The keys' macros are compiled again — a file read only when it changed.
        /// </summary>
        public static void LibraryChanged(IReadOnlyDictionary<string, TecladoMacros.LibraryEntry> library)
        {
            TecladoMacros.SetLibrary(library);
            lock (_lock)
            {
                try { InputHookManager.PublishTeclado(Current); }
                catch (Exception ex) { DiagnosticLog.Error("Teclado: compiling the macros failed", ex); }
            }
            try { MacrosChanged?.Invoke(); }
            catch (Exception ex) { DiagnosticLog.Warn($"Teclado: a MacrosChanged handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        /// <summary>A macro renamed in the library: every key that points to it follows. True when the config changed (and was saved).</summary>
        public static bool RenameMacro(string oldName, string newName)
        {
            if (string.IsNullOrEmpty(oldName) || string.IsNullOrEmpty(newName) || oldName == newName) return false;
            Config next;
            lock (_lock)
            {
                bool changed = false;
                foreach (var game in Current.Games)
                {
                    foreach (var layer in new[] { game.Base, game.Layer })
                    {
                        foreach (var fn in layer.Values)
                        {
                            if (fn.Kind != "macro" || !string.Equals(fn.Macro, oldName, StringComparison.Ordinal)) continue;
                            fn.Macro = newName;
                            changed = true;
                        }
                    }
                }
                if (!changed) return false;
                next = Current;
            }
            Save(next);
            return true;
        }

        /// <summary>A config the page sent, read with the same names the file uses.</summary>
        public static Config? FromJson(JsonElement element)
        {
            try { return element.Deserialize<Config>(ReadOptions); }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Teclado: config from the page could not be read: {ex.GetType().Name}: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// The config as the engine keeps it: known keys and functions only, sizes inside their bounds,
        /// one layer key per game, unique ids. Nothing is invented: a function that does not hold
        /// together is dropped, which leaves the key at its default.
        /// </summary>
        public static Config Normalize(Config? raw)
        {
            var layout = raw?.Layout?.Trim().ToLowerInvariant();
            var config = new Config
            {
                Version = SchemaVersion,
                Enabled = raw?.Enabled ?? true,
                Layout = layout != null && Layouts.Contains(layout) ? layout : null,
            };
            if (raw?.Games == null) return config;
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var g in raw.Games)
            {
                if (g == null || config.Games.Count >= MaxGames) continue;
                var exes = (g.Exes ?? new List<string>())
                    .Select(e => Path.GetFileName((e ?? "").Trim()))
                    .Where(e => e.Length > 0)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Take(MaxExes)
                    .ToList();
                var name = (g.Name ?? "").Trim();
                if (name.Length == 0) name = exes.Count > 0 ? Path.GetFileNameWithoutExtension(exes[0]) : "";
                if (name.Length == 0) continue;
                if (name.Length > MaxNameLength) name = name[..MaxNameLength];
                var id = (g.Id ?? "").Trim();
                if (id.Length == 0 || id.Length > 64 || ids.Contains(id)) id = "g-" + Guid.NewGuid().ToString("N")[..10];
                ids.Add(id);

                var baseKeys = NormalizeLayer(g.Base, isBase: true);
                // One layer key per game: the first one the file names wins.
                string? layerKey = null;
                foreach (var code in baseKeys.Keys.ToList())
                {
                    if (baseKeys[code].Kind != "layer") continue;
                    if (layerKey == null) layerKey = code; else baseKeys.Remove(code);
                }
                var layerKeys = NormalizeLayer(g.Layer, isBase: false);
                if (layerKey != null) layerKeys.Remove(layerKey);

                config.Games.Add(new Game { Id = id, Name = name, Exes = exes, On = g.On, Base = baseKeys, Layer = layerKeys });
            }
            return config;
        }

        private static Dictionary<string, KeyFunction> NormalizeLayer(Dictionary<string, KeyFunction>? raw, bool isBase)
        {
            var result = new Dictionary<string, KeyFunction>(StringComparer.Ordinal);
            if (raw == null) return result;
            foreach (var (code, fn) in raw)
            {
                if (code == null || fn == null || !TecladoKeys.IsKnown(code)) continue;
                var clean = NormalizeFunction(fn, code, isBase);
                if (clean != null) result[code] = clean;
            }
            return result;
        }

        private static KeyFunction? NormalizeFunction(KeyFunction fn, string code, bool isBase)
        {
            var kind = (fn.Kind ?? "").Trim().ToLowerInvariant();
            bool wheel = code.StartsWith("Wheel", StringComparison.Ordinal);
            switch (kind)
            {
                case "key":
                {
                    var combo = (fn.Combo ?? "").Trim();
                    if (combo.Length > MaxComboLength) return null;
                    // An empty combo is a key still to be pressed in the panel: kept, without effect until it has one.
                    return new KeyFunction { Kind = kind, Combo = combo };
                }
                case "mouse":
                {
                    var target = MouseTargets.FirstOrDefault(m => string.Equals(m, fn.Mouse?.Trim(), StringComparison.OrdinalIgnoreCase));
                    return target == null ? null : new KeyFunction { Kind = kind, Mouse = target };
                }
                case "macro":
                {
                    var mode = Modes.Contains(fn.Mode ?? "") ? fn.Mode! : "once";
                    // The wheel only takes functions of a single touch: a notch has no "while held".
                    if (wheel && (mode == "hold" || mode == "toggle")) mode = "once";
                    var macro = (fn.Macro ?? "").Trim();
                    return new KeyFunction
                    {
                        Kind = kind,
                        Macro = macro.Length == 0 ? null : macro,
                        Mode = mode,
                        Times = mode == "times" ? Math.Clamp(fn.Times ?? 3, 2, MaxTimes) : null,
                        Interval = mode == "once" ? null : Math.Clamp(fn.Interval ?? 100, 0, MaxIntervalMs),
                        KeepOriginal = fn.KeepOriginal == true ? true : null,
                    };
                }
                case "text":
                {
                    var text = fn.Text ?? "";
                    if (text.Length > MaxTextLength) text = text[..MaxTextLength];
                    return new KeyFunction { Kind = kind, Text = text, Enter = fn.Enter == true ? true : null };
                }
                case "off":
                    return new KeyFunction { Kind = kind };
                case "layer":
                    // Only on the base, and never on the wheel: holding is what a layer key does.
                    return isBase && !wheel ? new KeyFunction { Kind = kind } : null;
                default:
                    return null;
            }
        }

        private static void Raise()
        {
            // The hook's tables, compiled here (off the hook thread) and swapped whole.
            try { InputHookManager.PublishTeclado(Current); }
            catch (Exception ex) { DiagnosticLog.Error("Teclado: compiling the tables failed", ex); }
            try { Changed?.Invoke(); }
            catch (Exception ex) { DiagnosticLog.Warn($"Teclado: a Changed handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        private static bool TryReadText(string path, out string text, out Exception? error, int attempts = ReadRetryAttempts)
        {
            text = "";
            error = null;
            for (int attempt = 0; attempt < attempts; attempt++)
            {
                try
                {
                    using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
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

        private static Config? TryParse(string json, out Exception? error)
        {
            error = null;
            try { return JsonSerializer.Deserialize<Config>(json, ReadOptions) ?? new Config(); }
            catch (Exception ex) { error = ex; return null; }
        }

        private static bool TryLoadBackup(out Config config)
        {
            config = new Config();
            try
            {
                var backupPath = SiblingPath(BackupFileName);
                if (!File.Exists(backupPath) || !TryReadText(backupPath, out var text, out _)) return false;
                var parsed = TryParse(text, out _);
                if (parsed == null) return false;
                config = Normalize(parsed);
                DiagnosticLog.Info($"Teclado recovered from {BackupFileName}: {config.Games.Count} games.");
                return true;
            }
            catch { return false; }
        }

        // Compares first: the folder is often cloud-synced, and rewriting the same bytes is an upload for nothing.
        private static void WriteBackupIfChanged(string json)
        {
            try
            {
                var backupPath = SiblingPath(BackupFileName);
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
                DiagnosticLog.Warn($"teclado backup write failed: {ex.GetType().Name}: {ex.Message}");
            }
        }
    }
}
