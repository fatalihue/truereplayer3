using System;
using System.IO;

namespace TrueReplayer
{
    /// <summary>
    /// Who this app is, in one place. TrueReplayer 3 is installed and runs beside TrueReplayer 2,
    /// so every name the two could share — the folders, the single-instance mutex, the Run value,
    /// the update feed, the name on screen — comes from here (plan
    /// .claude/planos/truereplayer3-paralelo-2026-10-30.md, decision 3). tools/identidade-gate.mjs
    /// fails the build when "TrueReplayer" builds a path or a visible name anywhere else: one path
    /// that slipped through would write into TrueReplayer 2's data.
    ///
    /// The exe keeps its name, TrueReplayer.exe. That is deliberate: TrueReplayer 2.50, launched
    /// while this app runs, finds the running instance by that process name and knocks on its
    /// window (Program.SignalRunningInstance there), which is how this app learns about it.
    /// </summary>
    internal static class AppIdentity
    {
        /// <summary>
        /// The name of every folder and system name of this app: Documents, the machine-local data,
        /// the mutex, the Run value. Also the Velopack pack of the old test install
        /// (<see cref="PackId"/>), which the previews updated until the local feed ended (plan
        /// encerramento-tr2-2026-11-03.md, T8).
        /// </summary>
        public const string Id = "TrueReplayer3";

        /// <summary>
        /// The pack TrueReplayer 3 ships as when it replaces TrueReplayer 2 (plan
        /// encerramento-tr2-2026-11-03.md, decision 11): every installed TrueReplayer 2 updates to it,
        /// so it lives in TrueReplayer 2's old install folder.
        /// </summary>
        public const string PublicPackId = "TrueReplayer";

        /// <summary>
        /// The public pack's feed: the newest release of TrueReplayer-releases, the one every installed
        /// TrueReplayer 2 reads (plan encerramento-tr2-2026-11-03.md, section 3.3).
        /// </summary>
        public const string PublicFeedUrl = "https://github.com/fatalihue/TrueReplayer-releases/releases/latest/download";

        // Set by the test scripts: the pack a copy outside any install behaves as (the public one,
        // "TrueReplayer", in a test house). Honoured only outside an install.
        private const string TestPackVariable = "TRUEREPLAYER3_TEST_PACKID";

        private static readonly Lazy<(string? Pack, string? Root)> _velopack = new(ReadVelopack);

        // What Velopack knows about this process: the pack it was installed as and the install folder,
        // both null for a copy run from anywhere else. VelopackApp.Run, the first thing Main does, sets
        // the process-wide locator.
        private static (string? Pack, string? Root) ReadVelopack()
        {
            try
            {
                var locator = Velopack.Locators.VelopackLocator.IsCurrentSet
                    ? Velopack.Locators.VelopackLocator.Current
                    : Velopack.Locators.VelopackLocator.CreateDefaultForPlatform(null);
                if (locator.CurrentlyInstalledVersion == null || string.IsNullOrEmpty(locator.AppId) || string.IsNullOrEmpty(locator.RootAppDir))
                    return (null, null);
                return (locator.AppId, Path.GetFullPath(locator.RootAppDir).TrimEnd(Path.DirectorySeparatorChar));
            }
            catch { return (null, null); }
        }

        /// <summary>True when Velopack installed this copy (the test pack or the public one).</summary>
        public static bool VelopackInstalled => _velopack.Value.Pack != null;

        /// <summary>
        /// The Velopack pack: the one this copy was installed as — <see cref="Id"/> for the owner's
        /// test install, <see cref="PublicPackId"/> from 3.0.0 on. Outside an install, the test
        /// variable's, else <see cref="Id"/>.
        /// </summary>
        public static string PackId => _velopack.Value.Pack
            ?? (Environment.GetEnvironmentVariable(TestPackVariable) is { Length: > 0 } test ? test : Id);

        /// <summary>The public pack (from 3.0.0, living in TrueReplayer 2's old install folder).</summary>
        public static bool IsPublicPack => string.Equals(PackId, PublicPackId, StringComparison.OrdinalIgnoreCase);

        /// <summary>
        /// The install folder: Velopack's, or for a copy outside one, where the pack would be installed.
        /// For the test pack it is <see cref="LocalRoot"/>; for the public one, %LOCALAPPDATA%\TrueReplayer.
        /// "Installed" (the Run value, the extension's host, the AUMID) means the exe is inside it.
        /// </summary>
        public static string InstallRoot => _velopack.Value.Root ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), PackId);

        /// <summary>The name on screen: window, tray, dialogs, shortcuts, the exe's description.</summary>
        public const string DisplayName = "TrueReplayer 3";

        /// <summary>The exe's name without extension (AssemblyName), shared with TrueReplayer 2.</summary>
        public const string ProcessName = "TrueReplayer";

        public const string InstanceMutexName = Id + "_SingleInstance_Mutex";

        /// <summary>The value under HKCU\…\CurrentVersion\Run.</summary>
        public const string RunValueName = Id;

        /// <summary>
        /// The AppUserModelID of the installed app: the one Velopack gives the Start-menu and desktop
        /// shortcuts it makes ("velopack." + the pack id). The installed process claims it (Program), so
        /// its taskbar button is the pinned shortcut's however it was started, and its Windows
        /// notifications (WindowsNotices) carry the shortcut's name and icon. The plan's
        /// "fatalihue.TrueReplayer3" would have split the two. It follows the pack: velopack.TrueReplayer3
        /// for the test install, velopack.TrueReplayer for the public one.
        /// </summary>
        public static string Aumid => "velopack." + PackId;

        /// <summary>
        /// The window's icon — the tray's Ready too — and the tray's icons for its other states
        /// (TrayIconService.TrayState), next to the exe. tools/icones-3.ps1 and tools/icones-estado.ps1
        /// make them.
        /// </summary>
        public const string IconFile = Id + ".ico";
        public const string IconFilePurple = Id + "Purple.ico";
        public const string IconFileRecording = Id + "Recording.ico";
        public const string IconFileReplaying = Id + "Replaying.ico";
        public const string IconFileOff = Id + "Off.ico";
        public const string IconFileAlert = Id + "Alert.ico";

        // Environment.GetFolderPath is a shell lookup, and neither folder can move while the
        // process is alive.
        private static readonly Lazy<string> _documentsRoot = new(() => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), Id));
        private static readonly Lazy<string> _localRoot = new(() => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Id));

        /// <summary>Documents\TrueReplayer3: the user's data — settings, remaps and the sidecars.</summary>
        public static string DocumentsRoot => _documentsRoot.Value;

        /// <summary>Documents\TrueReplayer3\Profiles: the macros.</summary>
        public static string ProfilesDir => Path.Combine(DocumentsRoot, "Profiles");

        /// <summary>
        /// Documents\TrueReplayer3\Images: the macros' reference images, beside the macros that need
        /// them. Not in <see cref="LocalRoot"/>: uninstalling deletes that folder whole (seen on
        /// preview.2), and a reinstall would bring the macros back without their images.
        /// </summary>
        public static string ImagesDir => Path.Combine(DocumentsRoot, "Images");

        /// <summary>
        /// %LOCALAPPDATA%\TrueReplayer3: the app's own machine-local storage — WebView2, Logs and
        /// Debug — whichever pack it was installed as. It is also the test pack's install folder, which
        /// an uninstall deletes whole: nothing the user would miss lives here. The public pack is
        /// installed elsewhere (<see cref="InstallRoot"/>).
        /// </summary>
        public static string LocalRoot => _localRoot.Value;

        /// <summary>
        /// TrueReplayer 2. Only the coexistence guard (its mutex and its exe) and the import (its
        /// data) look at it, and nothing here ever writes there.
        /// </summary>
        internal static class Tr2
        {
            private const string Id = "TrueReplayer";

            public const string DisplayName = "TrueReplayer 2";

            public const string InstanceMutexName = Id + "_SingleInstance_Mutex";

            /// <summary>
            /// TrueReplayer 2's value under HKCU\…\CurrentVersion\Run. The public pack takes it over
            /// when it points into its install folder (TrayIconService.AdoptTr2RunValue).
            /// </summary>
            public const string RunValueName = Id;

            private static readonly Lazy<string> _documentsRoot = new(() => Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), Id));
            private static readonly Lazy<string> _localRoot = new(() => Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Id));

            public static string DocumentsRoot => _documentsRoot.Value;

            public static string ProfilesDir => Path.Combine(DocumentsRoot, "Profiles");

            /// <summary>
            /// %LOCALAPPDATA%\TrueReplayer: where TrueReplayer 2 was installed up to 2.50.1, with its
            /// images and WebView2. From 3.0.0 on it is the public pack's install folder.
            /// </summary>
            public static string LocalRoot => _localRoot.Value;

            /// <summary>
            /// %LOCALAPPDATA%\TrueReplayer2: TrueReplayer 2.50.2, the final build, installed as its own
            /// app (pack TrueReplayer2, plan encerramento-tr2-2026-11-03.md, section 1.3), with its
            /// WebView2 and Logs.
            /// </summary>
            public static string FinalLocalRoot => _localRoot.Value + "2";

            /// <summary>Documents\TrueReplayer\Images: the 2.50.2's reference images, beside its macros.</summary>
            public static string FinalImagesDir => Path.Combine(DocumentsRoot, "Images");

            /// <summary>
            /// The exe of TrueReplayer 2.50.2, the TrueReplayer 2 that "Switch" opens. Not the old
            /// install folder's: from 3.0.0 on that is this app.
            /// </summary>
            public static string InstalledExe => Path.Combine(FinalLocalRoot, "current", ProcessName + ".exe");
        }
    }
}
