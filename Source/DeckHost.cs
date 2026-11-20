using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The Deck's thread (branch deck; plan .claude/planos/deck-2026-11-19.md, Fase 2): a long-lived STA
    /// thread with its own message loop — off the UI thread, whose WebView2 and XAML bursts and modal loops
    /// would freeze the decks, and alive with the WebView closed. It owns a hidden window (the decks' owner,
    /// which keeps them out of every "find the app's window" — TrueReplayer 2's knock, CoexistenceGuard —
    /// and is the mailbox other threads post to), one DeckWindow per fixed deck, the monitors as last read,
    /// and the app in front (for "only with these apps").
    /// </summary>
    public static class DeckHost
    {
        internal readonly struct MonitorInfo
        {
            public readonly IntPtr Handle;
            public readonly DeckNative.RECT Bounds, Work;
            public readonly float Scale;
            public readonly string? DevicePath;
            public readonly bool Primary;
            public MonitorInfo(IntPtr handle, DeckNative.RECT bounds, DeckNative.RECT work, float scale, string? devicePath, bool primary)
            { Handle = handle; Bounds = bounds; Work = work; Scale = scale; DevicePath = devicePath; Primary = primary; }
        }

        private const string OwnerClass = AppIdentity.Id + "DeckOwner";
        private const uint WM_RUN = DeckNative.WM_APP + 1;

        private static Thread? _thread;
        private static IntPtr _owner;
        private static volatile bool _ready;
        private static readonly ConcurrentQueue<System.Action> _queue = new();
        private static readonly Dictionary<string, DeckWindow> _windows = new(StringComparer.Ordinal);
        private static readonly Dictionary<IntPtr, DeckWindow> _byHwnd = new();
        private static readonly DeckNative.WndProc _proc = Proc;
        private static DeckNative.WinEventProc? _fgProc;
        private static IntPtr _fgHook;
        private static List<MonitorInfo> _monitors = new();
        private static string? _frontProcess;
        private static bool _allHidden;
        private static readonly HashSet<string> _hidden = new(StringComparer.Ordinal);
        private static volatile DeckTheme _theme = DeckTheme.Default;
        private static readonly uint _selfPid = (uint)Environment.ProcessId;
        // WDA_EXCLUDEFROMCAPTURE exists from Windows 10 2004; before it the flag reads as WDA_MONITOR, a black
        // box that would blind Wait Image under the deck (Fase 0, probe C) — so nothing is set there.
        private static readonly bool _excludeSupported = Environment.OSVersion.Version.Build >= 19041;

        /// <summary>The theme the decks paint with now.</summary>
        internal static DeckTheme Theme => _theme;

        /// <summary>A button was clicked (deck id, page index, slot). Raised on the Deck thread; the actions come in Fase 3.</summary>
        public static event System.Action<string, int, int>? TileClicked;

        /// <summary>Starts the thread with the theme saved at the last run (the page's comes later, through SetTheme).</summary>
        public static void Start(IReadOnlyDictionary<string, string>? savedTheme, bool animations)
        {
            if (_thread != null) return;
            _theme = new DeckTheme(savedTheme, animations);
            using var started = new ManualResetEventSlim();
            _thread = new Thread(() => Run(started)) { IsBackground = true, Name = "Deck", Priority = ThreadPriority.AboveNormal };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
            // The windows come up on their own: the app does not wait for them past a moment.
            started.Wait(2000);
        }

        /// <summary>Closes the decks and ends the thread (the app's exit).</summary>
        public static void Stop()
        {
            if (_thread == null) return;
            Post(() => DeckNative.PostQuitMessage(0));
            _thread.Join(1000);
            _thread = null;
        }

        /// <summary>The page's theme (theme:colors): the decks paint again with it.</summary>
        public static void SetTheme(IReadOnlyDictionary<string, string> hex, bool animations)
        {
            _theme = new DeckTheme(hex, animations);
            Post(() => { foreach (var w in _windows.Values) w.Replace(); });
        }

        /// <summary>A deck's own show/hide hotkey: for this session.</summary>
        public static void Toggle(string id) => Post(() =>
        {
            if (!_hidden.Remove(id)) _hidden.Add(id);
            RefreshVisibility();
        });

        /// <summary>The "show/hide every deck" hotkey: for this session.</summary>
        public static void ToggleAll() => Post(() =>
        {
            _allHidden = !_allHidden;
            RefreshVisibility();
        });

        private static void Post(System.Action action)
        {
            _queue.Enqueue(action);
            if (_ready) DeckNative.PostMessageW(_owner, WM_RUN, IntPtr.Zero, IntPtr.Zero);
        }

        // ── The thread ──

        private static void Run(ManualResetEventSlim started)
        {
            try
            {
                Register(OwnerClass);
                Register(DeckWindow.ClassName);
                _owner = DeckNative.CreateWindowExW(DeckNative.WS_EX_TOOLWINDOW, OwnerClass, AppIdentity.DisplayName + " · Deck", DeckNative.WS_POPUP,
                    0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, DeckNative.GetModuleHandleW(null), IntPtr.Zero);
                if (_owner == IntPtr.Zero) throw new InvalidOperationException($"CreateWindowEx(owner): {Marshal.GetLastWin32Error()}");
                _fgProc = OnForeground;
                _fgHook = DeckNative.SetWinEventHook(DeckNative.EVENT_SYSTEM_FOREGROUND, DeckNative.EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _fgProc, 0, 0, DeckNative.WINEVENT_OUTOFCONTEXT);
                ReadMonitors();
                ReadForeground(DeckNative.GetForegroundWindow());
                DeckService.Changed += OnConfigChanged;
                DeckService.MacrosChanged += OnConfigChanged;
                _ready = true;
                SyncNow();
                if (!_excludeSupported) DiagnosticLog.Warn($"Deck: Windows build {Environment.OSVersion.Version.Build} has no WDA_EXCLUDEFROMCAPTURE; the decks show in screen captures");
                started.Set();
                Drain();
                while (DeckNative.GetMessageW(out var msg, IntPtr.Zero, 0, 0) > 0)
                {
                    DeckNative.TranslateMessage(ref msg);
                    DeckNative.DispatchMessageW(ref msg);
                }
            }
            catch (Exception ex)
            {
                DiagnosticLog.Error("Deck: the decks' thread stopped", ex);
            }
            finally
            {
                _ready = false;
                started.Set();
                DeckService.Changed -= OnConfigChanged;
                DeckService.MacrosChanged -= OnConfigChanged;
                if (_fgHook != IntPtr.Zero) DeckNative.UnhookWinEvent(_fgHook);
                foreach (var w in _windows.Values) { try { w.Dispose(); } catch { } }
                _windows.Clear();
                _byHwnd.Clear();
                if (_owner != IntPtr.Zero) DeckNative.DestroyWindow(_owner);
                _owner = IntPtr.Zero;
            }
        }

        private static void Register(string cls)
        {
            var wc = new DeckNative.WNDCLASSEXW
            {
                cbSize = (uint)Marshal.SizeOf<DeckNative.WNDCLASSEXW>(),
                lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_proc),
                hInstance = DeckNative.GetModuleHandleW(null),
                hCursor = DeckNative.LoadCursorW(IntPtr.Zero, (IntPtr)32512),
                lpszClassName = cls,
            };
            if (DeckNative.RegisterClassExW(ref wc) == 0)
            {
                int err = Marshal.GetLastWin32Error();
                if (err != 1410) throw new InvalidOperationException($"RegisterClassEx({cls}): {err}"); // 1410: already registered
            }
        }

        private static IntPtr Proc(IntPtr h, uint m, IntPtr w, IntPtr l)
        {
            try
            {
                if (h == _owner)
                {
                    switch (m)
                    {
                        case WM_RUN: Drain(); return IntPtr.Zero;
                        case DeckNative.WM_DISPLAYCHANGE:
                            ReplaceAll();
                            return IntPtr.Zero;
                        case DeckNative.WM_SETTINGCHANGE:
                            if ((uint)(long)w == DeckNative.SPI_SETWORKAREA) ReplaceAll();
                            break;
                    }
                }
                else if (_byHwnd.TryGetValue(h, out var deck))
                {
                    if (m == DeckNative.WM_DPICHANGED) ReadMonitors();
                    return deck.Proc(m, w, l);
                }
            }
            catch (Exception ex)
            {
                // A managed exception must not cross back into user32.
                DiagnosticLog.Warn($"Deck: a window message 0x{m:X} failed: {ex.GetType().Name}: {ex.Message}");
            }
            return DeckNative.DefWindowProcW(h, m, w, l);
        }

        private static void Drain()
        {
            while (_queue.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception ex) { DiagnosticLog.Warn($"Deck: a posted step failed: {ex.GetType().Name}: {ex.Message}"); }
            }
        }

        private static void OnConfigChanged() => Post(SyncNow);

        /// <summary>The windows follow deck.json: one per fixed deck, drawn again, shown or hidden.</summary>
        private static void SyncNow()
        {
            var config = DeckService.Current;
            bool exclude = !config.ShowInCaptures && _excludeSupported;
            var keep = new HashSet<string>(StringComparer.Ordinal);
            // With the Deck turned off, no window at all: nothing of Direct2D is loaded for decks nobody sees.
            foreach (var deck in config.Enabled ? config.Decks : new List<DeckService.Deck>())
            {
                // A summoned deck has no window at rest; it comes with the hotkey (Fase 4).
                if (deck.Mode != "fixed") continue;
                keep.Add(deck.Id);
                if (!_windows.TryGetValue(deck.Id, out var window))
                {
                    window = new DeckWindow(deck, _owner);
                    _windows[deck.Id] = window;
                    _byHwnd[window.Hwnd] = window;
                }
                window.Update(deck, exclude);
            }
            foreach (var id in _windows.Keys.Where(k => !keep.Contains(k)).ToList())
            {
                var window = _windows[id];
                _byHwnd.Remove(window.Hwnd);
                window.Dispose();
                _windows.Remove(id);
                _hidden.Remove(id);
            }
            RefreshVisibility();
        }

        private static void RefreshVisibility()
        {
            var config = DeckService.Current;
            foreach (var deck in config.Decks)
            {
                if (!_windows.TryGetValue(deck.Id, out var window)) continue;
                bool show = config.Enabled && deck.On && !_allHidden && !_hidden.Contains(deck.Id) && AppsLetShow(deck);
                bool was = window.Shown;
                window.SetShown(show);
                if (show && !was)
                {
                    var r = window.ScreenRect;
                    DiagnosticLog.Info($"Deck: '{deck.Name}' shown at ({r.Left},{r.Top}) {r.Width}×{r.Height}");
                }
            }
        }

        private static bool AppsLetShow(DeckService.Deck deck)
        {
            if (deck.ShowWhen.Kind != "apps") return true;
            return _frontProcess != null && deck.ShowWhen.Apps.Any(a => RemapService.NormalizeProcess(a) == _frontProcess);
        }

        private static void ReplaceAll()
        {
            ReadMonitors();
            foreach (var w in _windows.Values) w.Replace();
        }

        // ── The app in front ──

        private static void OnForeground(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            try
            {
                if (ReadForeground(hwnd)) RefreshVisibility();
                foreach (var w in _windows.Values) w.KeepOnTop();
            }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: reading the window in front failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        /// <summary>The process in front, for "only with these apps". The app's own windows change nothing. True when it changed.</summary>
        private static bool ReadForeground(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            DeckNative.GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0 || pid == _selfPid) return false;
            var name = RemapService.NormalizeProcess(ProcessName(pid));
            if (name == _frontProcess) return false;
            _frontProcess = name;
            return true;
        }

        private static string? ProcessName(uint pid)
        {
            var h = DeckNative.OpenProcess(DeckNative.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (h == IntPtr.Zero) return null;
            try
            {
                var buffer = new char[1024];
                uint size = (uint)buffer.Length;
                return DeckNative.QueryFullProcessImageNameW(h, 0, buffer, ref size) ? Path.GetFileName(new string(buffer, 0, (int)size)) : null;
            }
            finally { DeckNative.CloseHandle(h); }
        }

        // ── Monitors ──

        private static void ReadMonitors()
        {
            var list = new List<MonitorInfo>();
            DeckNative.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr h, IntPtr dc, ref DeckNative.RECT r, IntPtr data) =>
            {
                var mi = new DeckNative.MONITORINFOEXW { cbSize = (uint)Marshal.SizeOf<DeckNative.MONITORINFOEXW>(), szDevice = "" };
                if (DeckNative.GetMonitorInfoW(h, ref mi))
                {
                    float scale = DeckNative.GetDpiForMonitor(h, 0, out uint dpi, out _) == 0 && dpi > 0 ? dpi / 96f : 1f;
                    list.Add(new MonitorInfo(h, mi.rcMonitor, mi.rcWork, scale, DevicePathOf(mi.szDevice), (mi.dwFlags & DeckNative.MONITORINFOF_PRIMARY) != 0));
                }
                return true;
            }, IntPtr.Zero);
            if (list.Count > 0) _monitors = list;
        }

        /// <summary>
        /// The monitor's device path ("\\?\DISPLAY#GSM5B7F#…"), which stays the same across reboots and
        /// across the order Windows numbers the displays in — unlike "\\.\DISPLAY2". The display name when the
        /// path cannot be read.
        /// </summary>
        private static string? DevicePathOf(string displayName)
        {
            var dd = new DeckNative.DISPLAY_DEVICEW { cb = (uint)Marshal.SizeOf<DeckNative.DISPLAY_DEVICEW>(), DeviceName = "", DeviceString = "", DeviceID = "", DeviceKey = "" };
            return DeckNative.EnumDisplayDevicesW(displayName, 0, ref dd, DeckNative.EDD_GET_DEVICE_INTERFACE_NAME) && !string.IsNullOrEmpty(dd.DeviceID)
                ? dd.DeviceID
                : displayName;
        }

        private static MonitorInfo Primary()
        {
            if (_monitors.Count == 0) ReadMonitors();
            var primary = _monitors.FirstOrDefault(m => m.Primary);
            return primary.Handle != IntPtr.Zero ? primary : _monitors.FirstOrDefault();
        }

        /// <summary>The deck's monitor by its device path; the primary one when it is not connected (the saved place is kept).</summary>
        internal static MonitorInfo MonitorFor(string? devicePath)
        {
            if (_monitors.Count == 0) ReadMonitors();
            if (devicePath != null)
                foreach (var m in _monitors)
                    if (string.Equals(m.DevicePath, devicePath, StringComparison.OrdinalIgnoreCase)) return m;
            return Primary();
        }

        internal static MonitorInfo MonitorAt(int x, int y)
        {
            var h = DeckNative.MonitorFromPoint(new DeckNative.POINT(x, y), DeckNative.MONITOR_DEFAULTTONEAREST);
            foreach (var m in _monitors) if (m.Handle == h) return m;
            ReadMonitors();
            foreach (var m in _monitors) if (m.Handle == h) return m;
            return Primary();
        }

        /// <summary>
        /// The edge a deck at this anchor may slide past: only one the work area reaches (no taskbar on it) and
        /// with no monitor beyond (the deck would slide onto it). Left and right first, for the corners.
        /// </summary>
        internal static string? EdgeFor(string anchor, MonitorInfo m)
        {
            bool Free(string edge)
            {
                var b = m.Bounds;
                var w = m.Work;
                (bool reaches, DeckNative.POINT outside) = edge switch
                {
                    "left" => (w.Left == b.Left, new DeckNative.POINT(b.Left - 2, (b.Top + b.Bottom) / 2)),
                    "right" => (w.Right == b.Right, new DeckNative.POINT(b.Right + 1, (b.Top + b.Bottom) / 2)),
                    "top" => (w.Top == b.Top, new DeckNative.POINT((b.Left + b.Right) / 2, b.Top - 2)),
                    _ => (w.Bottom == b.Bottom, new DeckNative.POINT((b.Left + b.Right) / 2, b.Bottom + 1)),
                };
                return reaches && DeckNative.MonitorFromPoint(outside, DeckNative.MONITOR_DEFAULTTONULL) == IntPtr.Zero;
            }
            var order = new List<string>();
            if (anchor.Contains("left")) order.Add("left");
            if (anchor.Contains("right")) order.Add("right");
            if (anchor.StartsWith("top")) order.Add("top");
            if (anchor.StartsWith("bottom")) order.Add("bottom");
            return order.FirstOrDefault(Free);
        }

        /// <summary>The other decks on screen, for the magnet.</summary>
        internal static IEnumerable<DeckNative.RECT> OtherRects(string id) =>
            _windows.Where(kv => kv.Key != id && kv.Value.Shown).Select(kv => kv.Value.ScreenRect).ToList();

        // ── From the windows ──

        /// <summary>A deck moved on screen: its new place goes to deck.json (and to the page, when it is watching).</summary>
        internal static void SavePlace(string id, DeckService.Place place)
        {
            DiagnosticLog.Info($"Deck: moved to {place.Anchor} {place.Dx:0.#},{place.Dy:0.#} on {place.Monitor}");
            DeckService.SetPlace(id, place);
        }

        internal static void TileClick(string id, int page, int slot)
        {
            DiagnosticLog.Info($"Deck: click on '{id}' page {page} slot {slot}");
            try { TileClicked?.Invoke(id, page, slot); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: a TileClicked handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }
    }
}
