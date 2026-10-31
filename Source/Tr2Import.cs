using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Microsoft.Web.WebView2.Core;

namespace TrueReplayer.Services
{
    /// <summary>
    /// "Import from TrueReplayer 2" (plan .claude/planos/truereplayer3-paralelo-2026-10-30.md,
    /// decision 4): a copy of TrueReplayer 2's data, which this app only ever reads.
    ///
    /// Two steps, because almost everything it replaces is loaded the moment the app starts — the
    /// settings, the remaps, the hotkeys, the macro library and its watcher:
    ///  1. <see cref="StageAsync"/>, in the running app: copies TrueReplayer 2's files into staging
    ///     folders inside this app's own roots, reads TrueReplayer 2's theme and snippets, writes a
    ///     marker, and the app restarts.
    ///  2. <see cref="FinishPending"/>, early in the next start, before anything loads: moves what
    ///     this app had to Documents\TrueReplayer3\Backups and the staged copy into place.
    /// The theme and snippets live in TrueReplayer 2's WebView2 storage (LevelDB): a hidden WebView2
    /// opens a COPY of that folder and Chromium reads its own format — nothing opens TrueReplayer 2's
    /// folder, and no hand-written LevelDB reader is needed. The page gets them before its first script
    /// runs (<see cref="WebStorageScript"/>).
    /// Automations and Run on startup arrive switched off: automations firing by themselves right after
    /// an import would act on the screen, and two apps starting with Windows would race at login.
    /// </summary>
    internal static class Tr2Import
    {
        [Flags]
        public enum Parts { None = 0, Macros = 1, Settings = 2, Remaps = 4, Appearance = 8, All = 15 }

        /// <summary>What the page needs to show before an import, and what an import brought.</summary>
        public sealed record Summary(
            bool Tr2Found, int Macros, int Folders, int Images, bool Settings, int Remaps,
            bool Appearance, bool Tr2Running, bool Tr3HasData);

        // Files of Documents\TrueReplayer that travel with the macros (the Data Loop's places in each
        // table, the automations' history and cooldowns) or on their own.
        private const string SettingsFile = "appsettings.json";
        private const string RemapsFile = "remaps.json";
        private static readonly string[] MacroSidecars = { "run-cursors.json", "automation-stats.json" };

        private static string Tr2Profiles => AppIdentity.Tr2.ProfilesDir;
        private static string Tr2Images => Path.Combine(AppIdentity.Tr2.LocalRoot, "Images");
        private static string Tr2LocalStorage => Path.Combine(AppIdentity.Tr2.LocalRoot, "WebView2", "EBWebView", "Default", "Local Storage");

        // The page reads camelCase, and the summary goes to it from the state file as it was written.
        private static readonly JsonSerializerOptions CamelCase = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        private static string PendingFile => Path.Combine(AppIdentity.LocalRoot, "import-pending.json");
        private static string StateFile => Path.Combine(AppIdentity.LocalRoot, "import-state.json");

        // ── Looking ──────────────────────────────────────────────────────────────────────────────

        public static Summary Scan()
        {
            int macros = 0, folders = 0, images = 0, remaps = 0;
            bool settings = false;
            try
            {
                if (Directory.Exists(Tr2Profiles))
                {
                    macros = Directory.EnumerateFiles(Tr2Profiles, "*.json").Count(IsMacroFile);
                    var order = ReadJsonShared(Path.Combine(Tr2Profiles, "profile-order.json"));
                    folders = (order?["folders"] as JsonArray)?.Count ?? 0;
                }
                if (Directory.Exists(Tr2Images))
                    images = Directory.EnumerateFiles(Tr2Images, "*.png", SearchOption.AllDirectories).Count();
                settings = File.Exists(Path.Combine(AppIdentity.Tr2.DocumentsRoot, SettingsFile));
                var remapsJson = ReadJsonShared(Path.Combine(AppIdentity.Tr2.DocumentsRoot, RemapsFile));
                remaps = (remapsJson?["Remaps"] as JsonArray)?.Count ?? 0;
            }
            catch (Exception ex) { DiagnosticLog.Warn($"[Import] scan of {AppIdentity.Tr2.DisplayName} failed: {ex.Message}"); }

            bool appearance = Directory.Exists(Tr2LocalStorage);
            bool found = macros > 0 || settings || remaps > 0 || appearance;
            return new Summary(found, macros, folders, images, settings, remaps, appearance,
                CoexistenceGuard.Tr2Running() && !CoexistenceGuard.Bypassed, Tr3HasData());
        }

        private static bool IsMacroFile(string path) =>
            !string.Equals(Path.GetFileName(path), "profile-order.json", StringComparison.OrdinalIgnoreCase);

        private static bool Tr3HasData() =>
            File.Exists(Path.Combine(AppIdentity.DocumentsRoot, SettingsFile))
            && Directory.Exists(AppIdentity.ProfilesDir)
            && Directory.EnumerateFiles(AppIdentity.ProfilesDir, "*.json").Any(IsMacroFile);

        // ── Step 1: staging, in the running app ──────────────────────────────────────────────────

        /// <summary>
        /// Copies the chosen parts into staging folders and leaves the marker for the next start.
        /// Null on success (the caller restarts the app); otherwise what to tell the user.
        /// </summary>
        public static async Task<string?> StageAsync(Parts parts, IntPtr parentWindow)
        {
            if (!CoexistenceGuard.Bypassed && CoexistenceGuard.Tr2Running())
                return $"Close {AppIdentity.Tr2.DisplayName} first: its files must not change while they are copied.";
            if (parts == Parts.None) return "Choose something to import.";

            string stamp = DateTime.Now.ToString("yyyy-MM-dd HHmmss");
            string docsStage = Path.Combine(AppIdentity.DocumentsRoot, ".import-" + stamp.Replace(' ', '-'));
            string localStage = Path.Combine(AppIdentity.LocalRoot, ".import-" + stamp.Replace(' ', '-'));
            try
            {
                Directory.CreateDirectory(docsStage);
                Directory.CreateDirectory(localStage);
                var summary = Scan();

                if (parts.HasFlag(Parts.Macros))
                {
                    if (Directory.Exists(Tr2Profiles)) CopyTree(Tr2Profiles, Path.Combine(docsStage, "Profiles"));
                    // TrueReplayer 2 keeps them in Local; here they go beside the macros (AppIdentity.ImagesDir).
                    if (Directory.Exists(Tr2Images)) CopyTree(Tr2Images, Path.Combine(docsStage, "Images"));
                    foreach (var name in MacroSidecars) CopyIfExists(Path.Combine(AppIdentity.Tr2.DocumentsRoot, name), Path.Combine(docsStage, name));
                }
                if (parts.HasFlag(Parts.Settings))
                {
                    var settings = ReadJsonShared(Path.Combine(AppIdentity.Tr2.DocumentsRoot, SettingsFile));
                    if (settings is JsonObject o)
                    {
                        o["RunOnStartup"] = false;
                        o["AutomationEnabled"] = false;
                        File.WriteAllText(Path.Combine(docsStage, SettingsFile), o.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));
                    }
                }
                if (parts.HasFlag(Parts.Remaps))
                    CopyIfExists(Path.Combine(AppIdentity.Tr2.DocumentsRoot, RemapsFile), Path.Combine(docsStage, RemapsFile));
                if (parts.HasFlag(Parts.Appearance))
                {
                    // The theme, the presets and the snippets go into interface.json (InterfaceStore),
                    // beside the macros: the one this app has goes to Backups with the rest.
                    var values = await ReadTr2WebStorageAsync(localStage, parentWindow);
                    if (values != null && values.Count > 0)
                        File.WriteAllText(Path.Combine(docsStage, Path.GetFileName(InterfaceStore.FilePath)), InterfaceStore.Merged(values));
                }

                var pending = new JsonObject
                {
                    ["stamp"] = stamp,
                    ["docsStage"] = docsStage,
                    ["localStage"] = localStage,
                    ["parts"] = (int)parts,
                    ["summary"] = JsonSerializer.SerializeToNode(summary, CamelCase),
                };
                File.WriteAllText(PendingFile, pending.ToJsonString());
                DiagnosticLog.Info($"[Import] staged {parts} from {AppIdentity.Tr2.DisplayName} ({summary.Macros} macros, {summary.Images} images); restarting to finish");
                return null;
            }
            catch (Exception ex)
            {
                DiagnosticLog.Error("[Import] staging failed", ex);
                TryDelete(docsStage);
                TryDelete(localStage);
                return $"The import failed and nothing was changed: {ex.Message}";
            }
        }

        private static void CopyTree(string src, string dst, Func<string, bool>? skip = null)
        {
            Directory.CreateDirectory(dst);
            foreach (var file in Directory.EnumerateFiles(src))
                if (skip?.Invoke(Path.GetFileName(file)) != true)
                    CopyIfExists(file, Path.Combine(dst, Path.GetFileName(file)));
            foreach (var dir in Directory.EnumerateDirectories(src))
                CopyTree(dir, Path.Combine(dst, Path.GetFileName(dir)), skip);
        }

        // Read with sharing open and nothing else: TrueReplayer 2's files are never written, moved or
        // locked, and their write times are carried over so the copy is the same file.
        private static void CopyIfExists(string src, string dst)
        {
            if (!File.Exists(src)) return;
            using (var input = new FileStream(src, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var output = new FileStream(dst, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                input.CopyTo(output);
            File.SetLastWriteTimeUtc(dst, File.GetLastWriteTimeUtc(src));
        }

        private static JsonNode? ReadJsonShared(string path)
        {
            if (!File.Exists(path)) return null;
            try
            {
                using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                return JsonNode.Parse(stream, documentOptions: new JsonDocumentOptions { AllowTrailingCommas = true, CommentHandling = JsonCommentHandling.Skip });
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"[Import] could not read {path}: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// TrueReplayer 2's localStorage, read by Chromium from a copy of its Local Storage folder in a
        /// hidden WebView2 of its own: same origin (https://app.local), so the same keys come back.
        /// </summary>
        private static async Task<Dictionary<string, string>?> ReadTr2WebStorageAsync(string localStage, IntPtr parentWindow)
        {
            if (!Directory.Exists(Tr2LocalStorage)) return null;
            string userData = Path.Combine(localStage, "wv2");
            // LevelDB's LOCK file is held by a WebView2 process of TrueReplayer 2 still on its way out,
            // and Chromium makes its own: it stays behind.
            CopyTree(Tr2LocalStorage, Path.Combine(userData, "EBWebView", "Default", "Local Storage"),
                name => string.Equals(name, "LOCK", StringComparison.OrdinalIgnoreCase));
            string pageDir = Path.Combine(localStage, "page");
            Directory.CreateDirectory(pageDir);
            File.WriteAllText(Path.Combine(pageDir, "read.html"), "<!doctype html><title>import</title>");

            CoreWebView2Controller? controller = null;
            try
            {
                var env = await CoreWebView2Environment.CreateWithOptionsAsync(null, userData, new CoreWebView2EnvironmentOptions());
                controller = await env.CreateCoreWebView2ControllerAsync(
                    CoreWebView2ControllerWindowReference.CreateFromWindowHandle((ulong)parentWindow.ToInt64()));
                controller.IsVisible = false;
                var core = controller.CoreWebView2;
                core.SetVirtualHostNameToFolderMapping("app.local", pageDir, CoreWebView2HostResourceAccessKind.Deny);
                var loaded = new TaskCompletionSource<bool>();
                core.NavigationCompleted += (_, e) => loaded.TrySetResult(e.IsSuccess);
                core.Navigate("https://app.local/read.html");
                if (await Task.WhenAny(loaded.Task, Task.Delay(15000)) != loaded.Task || !loaded.Task.Result)
                {
                    DiagnosticLog.Warn($"[Import] the page that reads {AppIdentity.Tr2.DisplayName}'s storage did not load");
                    return null;
                }
                // ExecuteScriptAsync answers JSON: here a JSON string that holds the JSON object.
                string raw = await core.ExecuteScriptAsync(
                    "JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))");
                var all = JsonSerializer.Deserialize<Dictionary<string, string>>(JsonSerializer.Deserialize<string>(raw) ?? "{}") ?? new();
                return all.Where(kv => InterfaceStore.Keys.Contains(kv.Key)).ToDictionary(kv => kv.Key, kv => kv.Value);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"[Import] reading {AppIdentity.Tr2.DisplayName}'s theme and snippets failed: {ex.Message}");
                return null;
            }
            finally
            {
                controller?.Close();
            }
        }

        // ── Step 2: finishing, early in the next start ───────────────────────────────────────────

        /// <summary>
        /// Moves a staged import into place, what this app had into Backups first. Runs in Main before
        /// the settings, the remaps or the library are read. Idempotent: no marker, nothing to do.
        /// </summary>
        public static void FinishPending()
        {
            if (!File.Exists(PendingFile)) return;
            JsonNode? pending;
            try { pending = JsonNode.Parse(File.ReadAllText(PendingFile)); }
            catch (Exception ex) { DiagnosticLog.Warn($"[Import] unreadable marker, dropped: {ex.Message}"); TryDeleteFile(PendingFile); return; }
            string stamp = pending?["stamp"]?.GetValue<string>() ?? DateTime.Now.ToString("yyyy-MM-dd HHmmss");
            string docsStage = pending?["docsStage"]?.GetValue<string>() ?? "";
            string localStage = pending?["localStage"]?.GetValue<string>() ?? "";
            string backup = Path.Combine(AppIdentity.DocumentsRoot, "Backups", "Before import " + stamp);
            try
            {
                if (Directory.Exists(docsStage))
                {
                    foreach (var dir in Directory.GetDirectories(docsStage))
                        Swap(dir, Path.Combine(AppIdentity.DocumentsRoot, Path.GetFileName(dir)), Path.Combine(backup, Path.GetFileName(dir)));
                    foreach (var file in Directory.GetFiles(docsStage))
                        Swap(file, Path.Combine(AppIdentity.DocumentsRoot, Path.GetFileName(file)), Path.Combine(backup, Path.GetFileName(file)));
                }
                WriteState(s =>
                {
                    s["lastImport"] = stamp;
                    s["backup"] = Directory.Exists(backup) ? backup : null;
                    s["summary"] = pending?["summary"]?.DeepClone();
                    s["announce"] = true;
                });
                DiagnosticLog.Info($"[Import] finished; what was here before is in {(Directory.Exists(backup) ? backup : "(nothing to keep)")}");
            }
            catch (Exception ex)
            {
                DiagnosticLog.Error("[Import] finishing failed; the staged copy is left where it was", ex);
            }
            finally
            {
                TryDeleteFile(PendingFile);
                TryDelete(docsStage);
                TryDelete(localStage);
            }
        }

        private static void Swap(string staged, string target, string backupPath)
        {
            bool isDir = Directory.Exists(staged);
            bool exists = isDir ? Directory.Exists(target) : File.Exists(target);
            if (exists)
            {
                Directory.CreateDirectory(Path.GetDirectoryName(backupPath)!);
                if (isDir) Directory.Move(target, backupPath); else File.Move(target, backupPath);
            }
            if (isDir) Directory.Move(staged, target); else File.Move(staged, target);
        }


        /// <summary>The summary of an import that finished on this start, once: for the page's notice.</summary>
        public static JsonNode? TakeAnnouncement()
        {
            var state = ReadState();
            if (state?["announce"]?.GetValue<bool>() != true) return null;
            WriteState(s => s["announce"] = false);
            return state["summary"]?.DeepClone();
        }

        private static JsonObject? ReadState()
        {
            try { return File.Exists(StateFile) ? JsonNode.Parse(File.ReadAllText(StateFile)) as JsonObject : null; }
            catch { return null; }
        }

        private static void WriteState(Action<JsonObject> change)
        {
            try
            {
                var state = ReadState() ?? new JsonObject();
                change(state);
                Directory.CreateDirectory(AppIdentity.LocalRoot);
                File.WriteAllText(StateFile, state.ToJsonString());
            }
            catch (Exception ex) { DiagnosticLog.Warn($"[Import] could not save the import state: {ex.Message}"); }
        }

        // Only ever called on folders this class created inside this app's own roots.
        private static void TryDelete(string dir)
        {
            try { if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir) && IsOwnStage(dir)) Directory.Delete(dir, recursive: true); }
            catch (Exception ex) { DiagnosticLog.Warn($"[Import] could not remove {dir}: {ex.Message}"); }
        }

        private static bool IsOwnStage(string dir)
        {
            string name = Path.GetFileName(dir.TrimEnd(Path.DirectorySeparatorChar));
            string parent = Path.GetDirectoryName(dir.TrimEnd(Path.DirectorySeparatorChar)) ?? "";
            return name.StartsWith(".import-", StringComparison.Ordinal)
                && (string.Equals(parent, AppIdentity.DocumentsRoot, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(parent, AppIdentity.LocalRoot, StringComparison.OrdinalIgnoreCase));
        }

        private static void TryDeleteFile(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch { }
        }
    }
}
