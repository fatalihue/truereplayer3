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
    /// an app; a game that is off is still reported, so the status bar can say it is off. With two games
    /// on the same .exe, the one turned on wins (two setups of one game, switched by "Use").
    ///
    /// Phase 7, "Lock to this game": a locked game counts as in front whatever window is, except the
    /// app's own (where its keys are edited). The lock lasts until it is lifted or the app closes: never
    /// saved, since a lock forgotten across a restart would leave keys changed in every program.
    /// </summary>
    public static class TecladoFront
    {
        /// <summary>
        /// The process in front, the game it is (null when it is none), the layer key held (phase 3), and
        /// the game locked (phase 7; it is the game in front unless the app's own window is).
        /// </summary>
        public sealed record State(string? Process, string? GameId, string? GameName, bool GameOn, bool Layer, string? LockedId = null);

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
        // The game locked by the user, and whether one of the app's own windows is in front.
        private static string? _locked;
        private static bool _selfInFront;
        private static readonly uint _selfPid = (uint)Environment.ProcessId;
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

        /// <summary>Locks a game (its keys with any window in front but the app's), or lifts the lock with null.</summary>
        public static void Lock(string? gameId) => InputHookManager.QueueOnHookThread(() =>
        {
            _locked = string.IsNullOrEmpty(gameId) ? null : gameId;
            Match();
        });

        /// <summary>The locked game's name, or null (the tray panel shows it, with the way to lift it).</summary>
        public static string? LockedName
        {
            get
            {
                var id = _state.LockedId;
                return id == null ? null : TecladoService.Current.Games.FirstOrDefault(g => g.Id == id)?.Name;
            }
        }

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
            uint pid = 0;
            if (hwnd != IntPtr.Zero) NativeMethods.GetWindowThreadProcessId(hwnd, out pid);
            _selfInFront = pid != 0 && pid == _selfPid;
            _process = hwnd == IntPtr.Zero ? null : ProcessOf(hwnd);
            Match();
        }

        private static void Match()
        {
            var games = TecladoService.Current.Games;
            TecladoService.Game? game = null;
            if (_locked != null)
            {
                game = games.FirstOrDefault(g => g.Id == _locked);
                // A game removed takes its lock with it; the app's own windows keep their keys.
                if (game == null) _locked = null;
                else if (_selfInFront) game = null;
            }
            if (_locked == null)
            {
                var key = RemapService.NormalizeProcess(_process);
                if (key != null)
                {
                    foreach (var g in games)
                    {
                        if (!g.Exes.Any(e => RemapService.NormalizeProcess(e) == key)) continue;
                        game ??= g;
                        if (g.On) { game = g; break; }
                    }
                }
            }
            // The hook first: another game (or none) lets go of what the old one held, its layer too.
            InputHookManager.SetTecladoFront(game?.Id);
            Publish(new State(_process, game?.Id, game?.Name, game?.On ?? false, _layer, _locked));
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
