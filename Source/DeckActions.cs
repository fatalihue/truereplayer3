using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.UI.Dispatching;
using TrueReplayer.Helpers;

namespace TrueReplayer.Services
{
    /// <summary>
    /// What the Deck's buttons do outside the engine (branch deck; plan .claude/planos/deck-2026-11-19.md,
    /// Fase 3): keys, a text typed or pasted, a program, file, folder or address opened. One worker thread does
    /// them one after the other, in the order the buttons were pressed — two quick presses never interleave —
    /// and never on the hook's thread nor the Deck's. Everything goes to the window in front: a deck never
    /// takes the focus. The macros and the TR3 commands run in MainWindow, through the engine's own paths.
    /// </summary>
    internal static class DeckActions
    {
        private static readonly BlockingCollection<System.Action> _work = new();
        private static readonly object _lock = new();
        private static Thread? _worker;
        // "Stop all" ends a text still being typed.
        private static CancellationTokenSource _typing = new();
        // One paste at a time: a second one would take the first one's text for the user's clipboard.
        private static readonly SemaphoreSlim _pasting = new(1, 1);

        // Test houses only (deck-acoes-real.mjs, with TRUEREPLAYER3_TEST_DECK=1, the Deck's test switch): Open always
        // goes through the shell's own ShellExecute, the path an elevated app takes, so the probe can see it work.
        private static readonly bool TestShellOpen = Environment.GetEnvironmentVariable("TRUEREPLAYER3_TEST_DECK") == "1";

        private static void Queue(System.Action job)
        {
            lock (_lock)
            {
                if (_worker == null)
                {
                    _worker = new Thread(() =>
                    {
                        foreach (var next in _work.GetConsumingEnumerable())
                        {
                            try { next(); }
                            catch (Exception ex) { DiagnosticLog.Warn($"Deck: a button's work failed: {ex.GetType().Name}: {ex.Message}"); }
                        }
                    }) { IsBackground = true, Name = "Deck work" };
                    // The shell's COM objects (a shortcut's target, the desktop's ShellExecute) want a single-threaded apartment.
                    _worker.SetApartmentState(ApartmentState.STA);
                    _worker.Start();
                }
            }
            _work.Add(job);
        }

        /// <summary>"Stop all": a text still being typed stops.</summary>
        public static void StopTyping()
        {
            var old = Interlocked.Exchange(ref _typing, new CancellationTokenSource());
            old.Cancel();
        }

        // ── Keys ──

        /// <summary>The button's combo, pressed and let go in the window in front.</summary>
        public static void Keys(string deckId, int slot, DeckService.Tile tile)
        {
            string? combo = tile.Action.Combo;
            if (string.IsNullOrEmpty(combo)) return;
            Queue(() =>
            {
                if (!InputHookManager.TryDeckCombo(combo, out var strokes))
                {
                    DeckHost.Fail(deckId, slot, tile, S.DeckTipKeysInvalid(combo: combo));
                    return;
                }
                InputHookManager.DeckSendCombo(strokes);
                DiagnosticLog.Info($"Deck: sent {combo}");
            });
        }

        // ── Text ──

        /// <summary>The button's text, typed in the window in front one character at a time.</summary>
        public static void TypeText(string text)
        {
            if (string.IsNullOrEmpty(text)) return;
            var token = _typing.Token;
            Queue(() =>
            {
                InputHookManager.DeckType(text, token);
                DiagnosticLog.Info($"Deck: typed {text.Length} character(s){(token.IsCancellationRequested ? " (stopped)" : "")}");
            });
        }

        /// <summary>
        /// The button's text, pasted in the window in front the way Send Text pastes: the text on the clipboard, Ctrl+V,
        /// a moment for the target to read it (ActionReplayer.PasteSettleMs), and the user's clipboard back. Called on
        /// the UI thread, the clipboard's; notifyClipboard keeps the clipboard automations from firing on it.
        /// </summary>
        public static async void Paste(string text, DispatcherQueue ui, System.Action notifyClipboard)
        {
            if (string.IsNullOrEmpty(text)) return;
            await _pasting.WaitAsync();
            try
            {
                notifyClipboard();
                var original = await ActionReplayer.ReadClipboardSnapshotAsync(ui, includeHtml: false);
                var nonText = original.Text == null ? await ActionReplayer.ReadClipboardNonTextAsync(ui) : null;
                var package = new Windows.ApplicationModel.DataTransfer.DataPackage();
                // CF_UNICODETEXT is CRLF: a Win32 edit box breaks no line on a lone LF.
                package.SetText(text.Replace("\r\n", "\n").Replace("\n", "\r\n"));
                Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(package);
                await Task.Delay(50);
                await Task.Run(InputHookManager.DeckSendPaste);
                await Task.Delay(ActionReplayer.PasteSettleMs);
                notifyClipboard();
                ActionReplayer.RestoreClipboard(ui, original, nonText);
                DiagnosticLog.Info($"Deck: pasted {text.Length} character(s)");
            }
            catch (Exception ex)
            {
                // async void: nothing may escape.
                DiagnosticLog.Error("Deck: pasting failed", ex);
            }
            finally { _pasting.Release(); }
        }

        // ── Open ──

        /// <summary>
        /// Opens a program, file, folder or address, as Win+R would. With "bring to the front", a program already open
        /// comes to the front instead of opening again. When the app runs elevated, the desktop's shell opens it, so what
        /// it opens does not run elevated too.
        /// </summary>
        public static void Open(string deckId, int slot, DeckService.Tile tile)
        {
            var a = tile.Action;
            if (string.IsNullOrWhiteSpace(a.Target)) return;
            string target = Environment.ExpandEnvironmentVariables(a.Target.Trim().Trim('"'));
            string? args = string.IsNullOrWhiteSpace(a.Args) ? null : a.Args;
            bool front = a.Focus == true;
            Queue(() =>
            {
                if (front && TryFront(target))
                {
                    DiagnosticLog.Info($"Deck: brought {Path.GetFileName(target)} to the front");
                    return;
                }
                if (!TryLaunch(target, args, out string error))
                {
                    DeckHost.Fail(deckId, slot, tile, S.DeckTipOpenFailed(reason: error));
                    return;
                }
                DiagnosticLog.Info($"Deck: opened {target}");
            });
        }

        /// <summary>A program's window already open, brought to the front. False when the target is not a program or none is open.</summary>
        private static bool TryFront(string target)
        {
            string? exe = ExeOf(target);
            if (exe == null) return false;
            var hwnd = ActionReplayer.FindWindowExcludingSelf(new Models.WindowTarget { ProcessName = exe }, null);
            if (hwnd == IntPtr.Zero) return false;
            return WindowActivation.ActivateAsync(hwnd).GetAwaiter().GetResult();
        }

        /// <summary>The .exe a target runs (through a shortcut too), or null for an address, a document or a folder.</summary>
        private static string? ExeOf(string target)
        {
            if (Uri.TryCreate(target, UriKind.Absolute, out var uri) && !uri.IsFile) return null;
            string path = target.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase) ? ShortcutTarget(target) ?? "" : target;
            return path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? Path.GetFileName(path) : null;
        }

        private static bool TryLaunch(string target, string? args, out string error)
        {
            error = "";
            try
            {
                // The shell reports nothing back: a path that is not there is said here, before it is asked.
                if (Path.IsPathRooted(target) && !File.Exists(target) && !Directory.Exists(target))
                    throw new FileNotFoundException(null, target);
                if ((ProcessIntegrity.SelfElevated || TestShellOpen) && ShellExecuteFromDesktop(target, args)) return true;
                var psi = new ProcessStartInfo { FileName = target, Arguments = args ?? "", UseShellExecute = true };
                Process.Start(psi)?.Dispose();
                return true;
            }
            catch (Exception ex)
            {
                error = S.Reason(ex);
                return false;
            }
        }

        /// <summary>
        /// ShellExecute by the desktop's own shell (Explorer's IShellDispatch2), so the program runs at Explorer's
        /// level, not at this elevated app's: the desktop's folder view, found through IShellWindows, hands out its
        /// Application object. False when any step is missing (no Explorer, another shell): the caller opens it itself.
        /// </summary>
        private static bool ShellExecuteFromDesktop(string file, string? args)
        {
            object? windows = null, desktop = null, browser = null, view = null, folderView = null, shell = null;
            try
            {
                var type = Type.GetTypeFromCLSID(CLSID_ShellWindows, throwOnError: true)!;
                windows = Activator.CreateInstance(type)!;
                object location = 0; // CSIDL_DESKTOP
                object root = null!;
                desktop = ((IShellWindows)windows).FindWindowSW(ref location, ref root, SWC_DESKTOP, out _, SWFO_NEEDDISPATCH);
                if (desktop == null) return false;
                var sid = SID_STopLevelBrowser;
                var iid = typeof(IShellBrowser).GUID;
                browser = ((IOleServiceProvider)desktop).QueryService(ref sid, ref iid);
                ((IShellBrowser)browser).QueryActiveShellView(out var shellView);
                view = shellView;
                var dispatch = IID_IDispatch;
                folderView = shellView.GetItemObject(SVGIO_BACKGROUND, ref dispatch);
                shell = folderView.GetType().InvokeMember("Application", BindingFlags.GetProperty, null, folderView, null);
                if (shell == null) return false;
                string dir = Path.IsPathRooted(file) && File.Exists(file) ? Path.GetDirectoryName(file) ?? "" : "";
                shell.GetType().InvokeMember("ShellExecute", BindingFlags.InvokeMethod, null, shell, new object[] { file, args ?? "", dir, "open", 1 });
                return true;
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Deck: the desktop's shell could not open it ({ex.GetType().Name}: {ex.Message}); the app opens it itself");
                return false;
            }
            finally
            {
                foreach (var o in new[] { shell, folderView, view, browser, desktop, windows })
                    if (o != null && Marshal.IsComObject(o)) { try { Marshal.FinalReleaseComObject(o); } catch { } }
            }
        }

        /// <summary>Where a shortcut (.lnk) points, or null.</summary>
        private static string? ShortcutTarget(string lnk)
        {
            object? link = null;
            try
            {
                link = Activator.CreateInstance(Type.GetTypeFromCLSID(CLSID_ShellLink, throwOnError: true)!)!;
                ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Load(lnk, 0);
                var path = new StringBuilder(1024);
                ((IShellLinkW)link).GetPath(path, path.Capacity, IntPtr.Zero, 0);
                return path.Length > 0 ? path.ToString() : null;
            }
            catch { return null; }
            finally { if (link != null) { try { Marshal.FinalReleaseComObject(link); } catch { } } }
        }

        // ── The shell's COM, as much of it as the two paths above use ──

        private static readonly Guid CLSID_ShellWindows = new("9BA05972-F6A8-11CF-A442-00A0C90A8F39");
        private static readonly Guid CLSID_ShellLink = new("00021401-0000-0000-C000-000000000046");
        private static readonly Guid SID_STopLevelBrowser = new("4C96BE40-915C-11CF-99D3-00AA004AE837");
        private static readonly Guid IID_IDispatch = new("00020400-0000-0000-C000-000000000046");
        private const int SWC_DESKTOP = 8, SWFO_NEEDDISPATCH = 1;
        private const uint SVGIO_BACKGROUND = 0;

        [ComImport, Guid("85CB6900-4D95-11CF-960C-0080C7F4EE85"), InterfaceType(ComInterfaceType.InterfaceIsDual)]
        private interface IShellWindows
        {
            int Count { get; }
            [return: MarshalAs(UnmanagedType.IDispatch)] object Item([MarshalAs(UnmanagedType.Struct)] object index);
            [return: MarshalAs(UnmanagedType.IUnknown)] object _NewEnum();
            void Register([MarshalAs(UnmanagedType.IDispatch)] object pid, int hwnd, int swClass, out int cookie);
            void RegisterPending(int threadId, [MarshalAs(UnmanagedType.Struct)] ref object location, [MarshalAs(UnmanagedType.Struct)] ref object root, int swClass, out int cookie);
            void Revoke(int cookie);
            void OnNavigate(int cookie, [MarshalAs(UnmanagedType.Struct)] ref object location);
            void OnActivated(int cookie, [MarshalAs(UnmanagedType.VariantBool)] bool active);
            [return: MarshalAs(UnmanagedType.IDispatch)]
            object FindWindowSW([MarshalAs(UnmanagedType.Struct)] ref object location, [MarshalAs(UnmanagedType.Struct)] ref object root, int swClass, out int hwnd, int options);
            void OnCreated(int cookie, [MarshalAs(UnmanagedType.IUnknown)] object punk);
            void ProcessAttachDetach([MarshalAs(UnmanagedType.VariantBool)] bool attach);
        }

        [ComImport, Guid("6D5140C1-7436-11CE-8034-00AA006009FA"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IOleServiceProvider
        {
            [return: MarshalAs(UnmanagedType.IUnknown)]
            object QueryService(ref Guid service, ref Guid riid);
        }

        [ComImport, Guid("000214E2-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellBrowser
        {
            void GetWindow(out IntPtr hwnd);
            void ContextSensitiveHelp(int enterMode);
            void InsertMenusSB(IntPtr menuShared, IntPtr menuWidths);
            void SetMenuSB(IntPtr menuShared, IntPtr oleMenu, IntPtr activeObject);
            void RemoveMenusSB(IntPtr menuShared);
            void SetStatusTextSB(IntPtr text);
            void EnableModelessSB(int enable);
            void TranslateAcceleratorSB(IntPtr msg, ushort id);
            void BrowseObject(IntPtr pidl, uint flags);
            void GetViewStateStream(uint mode, out IntPtr stream);
            void GetControlWindow(uint id, out IntPtr hwnd);
            void SendControlMsg(uint id, uint msg, IntPtr wParam, IntPtr lParam, out IntPtr result);
            void QueryActiveShellView(out IShellView view);
            void OnViewWindowActive(IShellView view);
            void SetToolbarItems(IntPtr buttons, uint count, uint flags);
        }

        [ComImport, Guid("000214E3-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellView
        {
            void GetWindow(out IntPtr hwnd);
            void ContextSensitiveHelp(int enterMode);
            [PreserveSig] int TranslateAccelerator(IntPtr msg);
            void EnableModeless(int enable);
            void UIActivate(uint state);
            void Refresh();
            void CreateViewWindow(IntPtr previous, IntPtr settings, IntPtr browser, IntPtr rect, out IntPtr hwnd);
            void DestroyViewWindow();
            void GetCurrentInfo(IntPtr settings);
            void AddPropertySheetPages(uint reserved, IntPtr addPage, IntPtr lParam);
            void SaveViewState();
            void SelectItem(IntPtr pidl, uint flags);
            [return: MarshalAs(UnmanagedType.Interface)]
            object GetItemObject(uint item, ref Guid riid);
        }

        [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int cch, IntPtr findData, uint flags);
        }
    }
}
