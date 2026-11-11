using System;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using TrueReplayer.Interop;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Teclado, phase 2: which game is in front. Windows says when the foreground window changes
    /// (SetWinEventHook, EVENT_SYSTEM_FOREGROUND, out of context), so nothing is polled. The event hook
    /// lives on InputHookManager's thread, whose message loop delivers its callbacks between the key
    /// events: the game the key hook reads (phase 3) never changes in the middle of a key's callback.
    /// The process name is cached by pid, and a Store app's frame (ApplicationFrameHost) is looked
    /// through to the app inside it. A game is matched by its .exe name, the way RemapService compares
    /// an app; a game that is off is still reported, so the status bar can say it is off.
    /// </summary>
    public static class TecladoFront
    {
        /// <summary>The process in front, the game it is (null when it is none), and the layer key held (phase 3).</summary>
        public sealed record State(string? Process, string? GameId, string? GameName, bool GameOn, bool Layer);

        private static volatile State _state = new(null, null, null, false, false);

        /// <summary>The latest state. Written on the hook thread only; any thread may read it.</summary>
        public static State Current => _state;

        /// <summary>Raised on the hook thread when the process in front or its game changes. Must not block.</summary>
        public static event Action<State>? Changed;

        private const uint EVENT_SYSTEM_FOREGROUND = 0x0003;
        private const uint WINEVENT_OUTOFCONTEXT = 0x0000;

        private delegate void WinEventProc(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time);
        private delegate bool EnumWindowsProc(IntPtr hwnd, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWinEventHook(uint eventMin, uint eventMax, IntPtr hmodWinEventProc, WinEventProc proc, uint idProcess, uint idThread, uint flags);

        [DllImport("user32.dll")]
        private static extern bool UnhookWinEvent(IntPtr hook);

        [DllImport("user32.dll")]
        private static extern bool EnumChildWindows(IntPtr parent, EnumWindowsProc proc, IntPtr lParam);

        // ── The hook thread's own state: no lock, nobody else touches it ──

        // Held here, or the GC would collect the delegate Windows still calls.
        private static WinEventProc? _proc;
        private static IntPtr _hook;
        private static string? _process;
        private static bool _layer;
        private static uint _cachedPid;
        private static string? _cachedName;
        private static readonly StringBuilder _path = new(1024);

        /// <summary>Starts listening, on the hook thread. Called once the input hooks are up.</summary>
        public static void Start() => InputHookManager.QueueOnHookThread(() =>
        {
            if (_hook != IntPtr.Zero) return;
            _proc = OnEvent;
            _hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, IntPtr.Zero, _proc, 0, 0, WINEVENT_OUTOFCONTEXT);
            if (_hook == IntPtr.Zero) DiagnosticLog.Warn($"Teclado: SetWinEventHook failed (error {Marshal.GetLastWin32Error()}); the game in front will not follow the windows.");
            Read(NativeMethods.GetForegroundWindow());
        });

        /// <summary>Stops listening (the app is closing).</summary>
        public static void Stop() => InputHookManager.QueueOnHookThread(() =>
        {
            if (_hook == IntPtr.Zero) return;
            UnhookWinEvent(_hook);
            _hook = IntPtr.Zero;
        });

        /// <summary>The Teclado's config changed (a game added, an .exe, a game turned off): match again.</summary>
        public static void ConfigChanged() => InputHookManager.QueueOnHookThread(Match);

        /// <summary>The layer key went down or up (the hook, on this thread).</summary>
        internal static void SetLayer(bool held)
        {
            if (_layer == held) return;
            _layer = held;
            Publish(_state with { Layer = held });
        }

        private static void OnEvent(IntPtr hook, uint ev, IntPtr hwnd, int idObject, int idChild, uint thread, uint time)
        {
            if (ev != EVENT_SYSTEM_FOREGROUND) return;
            try { Read(hwnd); }
            catch (Exception ex) { DiagnosticLog.Warn($"Teclado: reading the window in front failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        private static void Read(IntPtr hwnd)
        {
            _process = hwnd == IntPtr.Zero ? null : ProcessOf(hwnd);
            Match();
        }

        private static void Match()
        {
            var key = RemapService.NormalizeProcess(_process);
            TecladoService.Game? game = null;
            if (key != null)
            {
                foreach (var g in TecladoService.Current.Games)
                {
                    if (g.Exes.Any(e => RemapService.NormalizeProcess(e) == key)) { game = g; break; }
                }
            }
            // The hook first: another game (or none) lets go of what the old one held, its layer too.
            InputHookManager.SetTecladoFront(game?.Id);
            Publish(new State(_process, game?.Id, game?.Name, game?.On ?? false, _layer));
        }

        private static void Publish(State next)
        {
            if (next == _state) return;
            _state = next;
            try { Changed?.Invoke(next); }
            catch (Exception ex) { DiagnosticLog.Warn($"Teclado: a foreground handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        private static string? ProcessOf(IntPtr hwnd)
        {
            NativeMethods.GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == 0) return null;
            var name = NameOf(pid);
            // A Store app's top window is a frame owned by ApplicationFrameHost.exe; the app is the
            // child window that belongs to another process.
            if (string.Equals(name, "ApplicationFrameHost.exe", StringComparison.OrdinalIgnoreCase))
            {
                uint inner = 0;
                EnumChildWindows(hwnd, (child, _) =>
                {
                    NativeMethods.GetWindowThreadProcessId(child, out uint p);
                    if (p == 0 || p == pid) return true;
                    inner = p;
                    return false;
                }, IntPtr.Zero);
                if (inner != 0) name = NameOf(inner);
            }
            return name;
        }

        // One process at a time is cached: the one in front. Asked again only when it changes.
        private static string? NameOf(uint pid)
        {
            if (pid == _cachedPid) return _cachedName;
            string? name = null;
            var handle = NativeMethods.OpenProcess(NativeMethods.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (handle != IntPtr.Zero)
            {
                try
                {
                    _path.Clear();
                    if (NativeMethods.GetProcessImageFileName(handle, _path, (uint)_path.Capacity) > 0)
                        name = Path.GetFileName(_path.ToString());
                }
                finally { NativeMethods.CloseHandle(handle); }
            }
            _cachedPid = pid;
            _cachedName = name;
            return name;
        }
    }
}
