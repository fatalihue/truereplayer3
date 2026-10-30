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
        /// <summary>The Velopack package id and the name of every folder and system name.</summary>
        public const string Id = "TrueReplayer3";

        /// <summary>The name on screen: window, tray, dialogs, shortcuts, the exe's description.</summary>
        public const string DisplayName = "TrueReplayer 3";

        /// <summary>The exe's name without extension (AssemblyName), shared with TrueReplayer 2.</summary>
        public const string ProcessName = "TrueReplayer";

        public const string InstanceMutexName = Id + "_SingleInstance_Mutex";

        /// <summary>The value under HKCU\…\CurrentVersion\Run.</summary>
        public const string RunValueName = Id;

        /// <summary>The AppUserModelID notifications will be registered under (Fase 4).</summary>
        public const string Aumid = "fatalihue." + Id;

        /// <summary>The window's icon, and the tray's icons for its three states, next to the exe.</summary>
        public const string IconFile = Id + ".ico";
        public const string IconFileRed = Id + "Red.ico";
        public const string IconFilePurple = Id + "Purple.ico";

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
        /// %LOCALAPPDATA%\TrueReplayer3: Velopack's install root, and the app's own machine-local
        /// storage beside it — WebView2, Logs and Debug. An uninstall deletes it whole: nothing the
        /// user would miss lives here.
        /// </summary>
        public static string LocalRoot => _localRoot.Value;

        /// <summary>
        /// The local Velopack feed the previews are packed into (decision 2). A sibling of
        /// <see cref="LocalRoot"/>, not inside it: an uninstall may remove that whole folder.
        /// </summary>
        public static string UpdateFeedDir => LocalRoot + "-feed";

        /// <summary>
        /// TrueReplayer 2. Only the coexistence guard (its mutex and its exe) and the import (its
        /// data) look at it, and nothing here ever writes there.
        /// </summary>
        internal static class Tr2
        {
            private const string Id = "TrueReplayer";

            public const string DisplayName = "TrueReplayer 2";

            public const string InstanceMutexName = Id + "_SingleInstance_Mutex";

            private static readonly Lazy<string> _documentsRoot = new(() => Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), Id));
            private static readonly Lazy<string> _localRoot = new(() => Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), Id));

            public static string DocumentsRoot => _documentsRoot.Value;

            public static string ProfilesDir => Path.Combine(DocumentsRoot, "Profiles");

            public static string LocalRoot => _localRoot.Value;

            /// <summary>Where Velopack keeps the installed TrueReplayer 2's exe.</summary>
            public static string InstalledExe => Path.Combine(LocalRoot, "current", ProcessName + ".exe");
        }
    }
}
