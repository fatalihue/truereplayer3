using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using TrueReplayer.Helpers;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The interface's choices that are the user's own — the theme and the presets made in the Theme
    /// Editor, the Send Text snippets and its open sections, the tips' language, the Live Variables
    /// switch and the first-use tips still to come — kept in Documents\TrueReplayer3\interface.json,
    /// beside the macros. Kept in WebView2's storage alone (under %LOCALAPPDATA%), they were the one
    /// part of the user's things that a copy of the data folder left behind.
    ///
    /// The page still reads them from localStorage, as it always has: the boot mirror in index.html
    /// paints the saved theme from there before React loads. DocumentScript runs before the page's
    /// first line. Once per run it fills those keys from the file, and from then on it forwards every
    /// write of them here (interface:set). Nothing in the page has to know about the file.
    /// </summary>
    public static class InterfaceStore
    {
        /// <summary>
        /// The keys that live in the file. The import from TrueReplayer 2 carries the same ones
        /// (Tr2Import). Widths and folded panels stay in WebView2: they belong to this PC.
        /// </summary>
        public static readonly string[] Keys =
        {
            "truereplay-theme", "truereplay-custom-presets", "trueplayer_snippets", "tr-language",
            "tr-sendtext-more", "tr-livevars", "tr-tips",
        };

        public static string FilePath => Path.Combine(AppIdentity.DocumentsRoot, "interface.json");

        // How this run began, decided by Load. FromFile: the file is the truth. Fresh: a new data
        // folder, so the interface starts from its defaults and the first-use tips. Seed: a data folder
        // from a version that kept all this in WebView2 only, so the page sends what it has. Unread: a
        // file that exists but could not be read, so the page keeps what it has and nothing is written.
        private enum Start { FromFile, Fresh, Seed, Unread }

        private const int SaveDebounceMs = 500;
        private static readonly HashSet<string> KeySet = new(Keys, StringComparer.Ordinal);
        private static readonly JsonSerializerOptions WriteOptions = new()
        {
            WriteIndented = true,
            // The snippets are the user's text: readable in the file, accents and all.
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        };
        private static readonly object _lock = new();
        private static readonly Dictionary<string, string> _values = new(StringComparer.Ordinal);
        private static Start _start = Start.Seed;
        private static bool _dirty;
        private static Timer? _saveTimer;

        /// <summary>
        /// Reads the file. Called in Main, after an import from TrueReplayer 2 is put in place and
        /// before anything creates the Profiles folder. Without a file, a data folder with no Profiles
        /// folder is a new one; a data folder that has one comes from a version that kept all this
        /// in WebView2 only. Never throws.
        /// </summary>
        public static void Load()
        {
            lock (_lock)
            {
                try
                {
                    if (!File.Exists(FilePath))
                    {
                        _start = Directory.Exists(AppIdentity.ProfilesDir) ? Start.Seed : Start.Fresh;
                        return;
                    }
                    // Unreadable is not absent (RunCursorService learned it the hard way): a file a
                    // scanner or OneDrive holds at boot must not be overwritten, and the page must not
                    // drop the user's theme because of it.
                    if (!FileHelper.TryReadAllTextShared(FilePath, out var json, out var readError))
                    {
                        _start = Start.Unread;
                        DiagnosticLog.Error("interface.json could not be read — the interface keeps what WebView2 has, and the file is not written before it can be read",
                            readError ?? new IOException("unknown read failure"));
                        return;
                    }
                    _start = TryApplyFileLocked(json) ? Start.FromFile : Start.Seed;
                    // The tips' language of the builds before D30 ("en") is now the interface's
                    // (en-US); written back at once, so the file says what the app reads.
                    if (_start == Start.FromFile && NormalizeLanguageLocked()) SaveLocked();
                }
                catch (Exception ex)
                {
                    _start = Start.Unread;
                    DiagnosticLog.Error("interface.json could not be loaded", ex);
                }
            }
        }

        /// <summary>
        /// The script that runs before the page's first line, on every load. Once per run it fills the
        /// keys from the file, or empties them for a new data folder; a Reload UI keeps whatever the
        /// page wrote since. When the file has to be seeded, it sends what the page has once the bridge
        /// is there. It then forwards every write of the keys to interface:set.
        /// </summary>
        public static string DocumentScript()
        {
            lock (_lock)
            {
                string mode = _start switch { Start.FromFile => "file", Start.Fresh => "fresh", Start.Seed => "seed", _ => "keep" };
                return "(() => {"
                    // The engine looks for it after the first load (MainWindow.EnsureInterfaceScriptRanAsync).
                    + "window.__trInterface = true;"
                    + "const keys = " + JsonSerializer.Serialize(Keys) + ", file = " + JsonSerializer.Serialize(_values) + ", mode = " + JsonSerializer.Serialize(mode) + ";"
                    + "const post = (payload) => { try { window.chrome.webview.postMessage({ type: 'interface:set', payload }); } catch {} };"
                    + "try {"
                    + "if (!sessionStorage.getItem('tr-interface')) {"
                    + "sessionStorage.setItem('tr-interface', '1');"
                    + "if (mode === 'file' || mode === 'fresh') { for (const k of keys) { if (mode === 'file' && k in file) localStorage.setItem(k, file[k]); else localStorage.removeItem(k); } }"
                    + "else if (mode === 'seed') {"
                    + "const seed = () => { const values = {}; for (const k of keys) { const v = localStorage.getItem(k); if (v !== null) values[k] = v; } post({ values, seed: true }); };"
                    + "if (window.chrome && window.chrome.webview) seed(); else addEventListener('DOMContentLoaded', seed, { once: true });"
                    + "} }"
                    + "} catch {}"
                    + "const S = Storage.prototype, set = S.setItem, remove = S.removeItem;"
                    + "S.setItem = function (k, v) { set.call(this, k, v); if (this === localStorage && keys.includes(k)) post({ values: { [k]: String(v) } }); };"
                    + "S.removeItem = function (k) { remove.call(this, k); if (this === localStorage && keys.includes(k)) post({ values: { [k]: null } }); };"
                    + "})();";
            }
        }

        /// <summary>
        /// interface:set — the page wrote some of the keys (a null removes one). With seed, the values
        /// are all the page has, the first time a data folder has no file: they replace what is held
        /// and are written at once. Until that seed comes, writes are held but not written, so a file
        /// with only part of the user's choices never exists.
        /// </summary>
        public static void Set(JsonElement payload)
        {
            if (payload.ValueKind != JsonValueKind.Object
                || !payload.TryGetProperty("values", out var values) || values.ValueKind != JsonValueKind.Object) return;
            bool seed = payload.TryGetProperty("seed", out var s) && s.ValueKind == JsonValueKind.True;
            lock (_lock)
            {
                if (_start == Start.Unread && !TryLateLoadLocked()) return;
                if (seed) _values.Clear();
                foreach (var p in values.EnumerateObject())
                {
                    if (!KeySet.Contains(p.Name)) continue;
                    if (p.Value.ValueKind == JsonValueKind.String) _values[p.Name] = p.Value.GetString()!;
                    else if (p.Value.ValueKind == JsonValueKind.Null) _values.Remove(p.Name);
                }
                NormalizeLanguageLocked();
                if (_start == Start.Seed && !seed) return;
                // From here on the file is the truth, for a page that loads again in this run too.
                _start = Start.FromFile;
                _dirty = true;
                if (seed) { SaveLocked(); return; }
                _saveTimer ??= new Timer(_ => Flush(), null, Timeout.Infinite, Timeout.Infinite);
                _saveTimer.Change(SaveDebounceMs, Timeout.Infinite);
            }
        }

        /// <summary>The value of one key as held now, or null.</summary>
        public static string? Get(string key)
        {
            lock (_lock) return _values.TryGetValue(key, out var v) ? v : null;
        }

        /// <summary>
        /// One key set by the engine itself — the interface's language, which the page asks for with
        /// ui:language (D30). Kept and written like the page's own writes; null removes the key.
        /// </summary>
        public static void SetValue(string key, string? value)
        {
            if (!KeySet.Contains(key)) return;
            lock (_lock)
            {
                if (_start == Start.Unread && !TryLateLoadLocked()) return;
                if (value == null) _values.Remove(key); else _values[key] = value;
                // A data folder still waiting for the page's seed keeps it until the seed comes.
                if (_start == Start.Seed) return;
                _start = Start.FromFile;
                _dirty = true;
                _saveTimer ??= new Timer(_ => Flush(), null, Timeout.Infinite, Timeout.Infinite);
                _saveTimer.Change(SaveDebounceMs, Timeout.Infinite);
            }
        }

        /// <summary>
        /// The interface's language straight from the file, before Load: Main reads it ahead of the
        /// one-at-a-time guard, whose dialog speaks it. An import the previous run staged is put in place
        /// after the guard, and Load reads the language again then. Null when there is none to read.
        /// </summary>
        public static string? PeekLanguage()
        {
            try
            {
                if (!File.Exists(FilePath) || !FileHelper.TryReadAllTextShared(FilePath, out var json, out _)) return null;
                var parsed = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
                return parsed != null && parsed.TryGetValue(S.LanguageKey, out var v) ? v : null;
            }
            catch { return null; }
        }

        /// <summary>
        /// The file an import from TrueReplayer 2 stages (Tr2Import): what this app holds, with the
        /// values that came from TrueReplayer 2 over it.
        /// </summary>
        public static string Merged(IReadOnlyDictionary<string, string> incoming)
        {
            lock (_lock)
            {
                var merged = new Dictionary<string, string>(_values, StringComparer.Ordinal);
                foreach (var kv in incoming)
                    if (KeySet.Contains(kv.Key)) merged[kv.Key] = kv.Value;
                return JsonSerializer.Serialize(merged, WriteOptions);
            }
        }

        /// <summary>Writes any pending change now. Call on every exit path.</summary>
        public static void Flush()
        {
            lock (_lock) { if (_dirty) SaveLocked(); }
        }

        // Caller holds _lock. The interface's language as the app keeps it (S.Normalize): "en" becomes
        // "en-US", and a value it does not know goes, which is Windows's. True when it changed.
        private static bool NormalizeLanguageLocked()
        {
            if (!_values.TryGetValue(S.LanguageKey, out var stored)) return false;
            var normal = S.Normalize(stored);
            if (normal == stored) return false;
            if (normal == null) _values.Remove(S.LanguageKey); else _values[S.LanguageKey] = normal;
            _dirty = true;
            return true;
        }

        // Caller holds _lock. True when the text was a usable file.
        private static bool TryApplyFileLocked(string json)
        {
            try
            {
                var parsed = JsonSerializer.Deserialize<Dictionary<string, string>>(json);
                _values.Clear();
                foreach (var kv in parsed ?? new())
                    if (KeySet.Contains(kv.Key) && kv.Value != null) _values[kv.Key] = kv.Value;
                return true;
            }
            catch (JsonException ex)
            {
                // Written atomically, so this is a hand edit gone wrong. The page's copy is complete
                // (it is written through on every change), so it seeds a new file.
                DiagnosticLog.Warn($"interface.json is not valid JSON ({ex.Message}) — written again from the interface's own copy");
                return false;
            }
        }

        // Caller holds _lock. A boot read that failed, tried again before the first write. A file that
        // is gone by now is not written from this run's few writes: they are held, and the next start
        // seeds it from the page.
        private static bool TryLateLoadLocked()
        {
            if (!File.Exists(FilePath)) { _start = Start.Seed; return true; }
            if (!FileHelper.TryReadAllTextShared(FilePath, out var json, out _)) return false;
            TryApplyFileLocked(json);
            _start = Start.FromFile;
            return true;
        }

        // Caller holds _lock.
        private static void SaveLocked()
        {
            try
            {
                Directory.CreateDirectory(AppIdentity.DocumentsRoot);
                FileHelper.WriteAllTextAtomic(FilePath, JsonSerializer.Serialize(_values, WriteOptions));
                // Cleared only on success, so the next Flush tries a failed write again.
                _dirty = false;
            }
            catch (Exception ex)
            {
                DiagnosticLog.Error("interface.json save failed — the interface keeps the change, and the file gets it on the next write", ex);
            }
        }
    }
}
