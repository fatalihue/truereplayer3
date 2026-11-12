using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Threading;
using TrueReplayer.Interop;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Teclado, phase 4: the executor of the macros on game keys (plan decision 2). It is not the
    /// engine: it never touches ActionReplayer, IsReplaying or the macro open in the grid, and it runs
    /// several macros at once — in a game, macro keys are pressed almost together.
    ///
    /// One thread of its own interleaves every run by time: each run is a position in its macro's
    /// operations and a deadline, and the thread sleeps until the nearest deadline or a command. The
    /// hook only queues commands (press, release, stop all) and signals; nothing here runs on the hook
    /// thread, and the hook never waits for this one.
    ///
    /// Keys and buttons are counted: a key the runs hold goes down at the first holder and up at the
    /// last, so one macro letting go of Shift never releases it under another that still holds it. A
    /// run that ends, or is stopped, lets go of what it holds; "stop all" (the game left the front, the
    /// Teclado was turned off, the hook stopped, the session came back) stops every run.
    /// </summary>
    internal static class TecladoRunner
    {
        /// <summary>A key's macro and how it runs: compiled with the tables, immutable.</summary>
        internal sealed class Binding
        {
            public required TecladoMacro Macro { get; init; }
            /// <summary>once | times | hold | toggle (TecladoService.Modes).</summary>
            public required string Mode { get; init; }
            public int Times { get; init; } = 1;
            public int IntervalMs { get; init; }
        }

        private enum CommandKind : byte { Press, Release, StopAll, Mouse }

        /// <param name="Done">Set once a StopAll has let go of everything (the app closing waits on it).</param>
        /// <param name="Flags">Mouse: the MOUSEEVENTF flags, the mouseData and the dwExtraInfo mark it goes out with.</param>
        private readonly record struct Command(CommandKind Kind, int Key, Binding? Binding, ManualResetEventSlim? Done = null,
            uint Flags = 0, uint Data = 0, IntPtr Mark = default);

        private sealed class Run
        {
            public required int Key;
            public required Binding Binding;
            public int Index;
            /// <summary>Iterations still to start after this one; int.MaxValue for hold and toggle.</summary>
            public int Remaining;
            public long Due;
            public bool Done;
            /// <summary>What this run holds, in the order it went down.</summary>
            public readonly List<InputHookManager.TecladoStroke> Keys = new();
            /// <summary>
            /// The modifiers a combination of this run pressed while the run already held them (a KeyDown
            /// row's): the combination's own release leaves them to that row, as the engine does.
            /// </summary>
            public readonly List<ushort> ComboHeld = new();
            public readonly bool[] Buttons = new bool[3];
            /// <summary>A walk in progress (Game Mode): from where, by how much, in how many steps, at which.</summary>
            public int WalkX, WalkY, WalkDx, WalkDy, WalkSteps, WalkStep;
        }

        private static readonly ConcurrentQueue<Command> _commands = new();
        private static readonly AutoResetEvent _wake = new(false);
        private static readonly object _startLock = new();
        private static Thread? _thread;
        private static volatile bool _busy;

        // ── Runner-thread state: nobody else touches it ──
        private static readonly List<Run> _runs = new();
        private static readonly int[] _keyHolders = new int[256];
        // The stroke that took each key down, so "stop all" lets go of exactly that.
        private static readonly InputHookManager.TecladoStroke[] _keyStrokes = new InputHookManager.TecladoStroke[256];
        private static readonly int[] _buttonHolders = new int[3];
        private static bool _fineTimer;

        private static readonly uint[] ButtonDownFlags = { NativeMethods.MOUSEEVENTF_LEFTDOWN, NativeMethods.MOUSEEVENTF_RIGHTDOWN, NativeMethods.MOUSEEVENTF_MIDDLEDOWN };
        private static readonly uint[] ButtonUpFlags = { NativeMethods.MOUSEEVENTF_LEFTUP, NativeMethods.MOUSEEVENTF_RIGHTUP, NativeMethods.MOUSEEVENTF_MIDDLEUP };

        /// <summary>Whether a run is going (the page and the tests read it; it may lag a command by a tick).</summary>
        internal static bool Busy => _busy;

        /// <summary>Starts the thread, off the hook thread (the tables' compile calls it when a key has a macro).</summary>
        internal static void EnsureStarted()
        {
            if (_thread != null) return;
            lock (_startLock)
            {
                if (_thread != null) return;
                var t = new Thread(Loop) { IsBackground = true, Name = "Teclado macros", Priority = ThreadPriority.AboveNormal };
                t.Start();
                _thread = t;
            }
        }

        // ── Commands (any thread; the hook's only cost is a queue and a signal) ──

        internal static void Press(int key, Binding binding) => Post(new Command(CommandKind.Press, key, binding));

        internal static void Release(int key) => Post(new Command(CommandKind.Release, key, null));

        internal static void StopAll()
        {
            if (_thread == null) return;
            Post(new Command(CommandKind.StopAll, 0, null));
        }

        /// <summary>
        /// Stops every run and waits, at most <paramref name="timeoutMs"/>, for what they hold to go up:
        /// the app is closing (Environment.Exit right after), and a release still in the queue would race
        /// the end of the process and leave a key down in the game.
        /// </summary>
        internal static void StopAllAndWait(int timeoutMs)
        {
            if (_thread == null) return;
            using var done = new ManualResetEventSlim(false);
            Post(new Command(CommandKind.StopAll, 0, null, done));
            done.Wait(timeoutMs);
        }

        /// <summary>Whether a run holds the key (any thread; the hook reads it before a slot lets go of the same key).</summary>
        internal static bool HoldsKey(int vk) => Volatile.Read(ref _keyHolders[vk & 0xFF]) > 0;

        /// <summary>Whether a run holds the button (0 left, 1 right, 2 middle).</summary>
        internal static bool HoldsButton(int button) => Volatile.Read(ref _buttonHolders[button]) > 0;

        // Whether a slot of the hook holds the key or the button: then it is the slot's to let go.
        private static bool SlotHoldsKey(int vk) => Volatile.Read(ref InputHookManager.TecladoSlotKeys[vk & 0xFF]) > 0;
        private static bool SlotHoldsButton(int button) => Volatile.Read(ref InputHookManager.TecladoSlotButtons[button]) > 0;

        private static void Post(Command command)
        {
            EnsureStarted();
            _commands.Enqueue(command);
            _wake.Set();
        }

        /// <summary>
        /// A click, a button's release or a turn of the wheel a key's function sends (hook thread; no
        /// allocation), sent from this thread in the order it came, with the macros' starts and stops: a
        /// kept original still goes before its macro, and one SendInput per call (a game that counts
        /// messages, not deltas, gets as many as there were). Not from the hook thread: a mouse SendInput
        /// made there, after the mouse callback returned, waited ~300 ms for that very hook
        /// (LowLevelHooksTimeout), with all the system's mouse input behind it — a wheel 5 of 5, a click now
        /// and then (measured on 12-11-2026, teclado-roda-raw-real.mjs; the keyboard went through, the Key
        /// Remaps' measure says, remap-lateral-espera-real.mjs). The Key Remaps send theirs the same way, from
        /// their own thread (InputHookManager.RemapMouseLoop).
        /// </summary>
        internal static void Mouse(uint flags, uint data, IntPtr mark) => Post(new Command(CommandKind.Mouse, 0, null, null, flags, data, mark));

        /// <summary>
        /// Takes back, from the programs that read the mouse through Raw Input, a turn of the wheel the hook
        /// swallowed (see InputHookManager.TecladoWheelCancelMark).
        /// </summary>
        internal static void TakeBackWheel(int delta) => Mouse(NativeMethods.MOUSEEVENTF_WHEEL, unchecked((uint)-delta), InputHookManager.TecladoWheelCancelMark);

        // ── The thread ──

        private static void Loop()
        {
            while (true)
            {
                try
                {
                    while (_commands.TryDequeue(out var c)) Apply(c);

                    long now = Stopwatch.GetTimestamp();
                    long next = long.MaxValue;
                    for (int i = 0; i < _runs.Count; i++)
                    {
                        var run = _runs[i];
                        Advance(run, now);
                        if (run.Done)
                        {
                            Finish(run);
                            _runs.RemoveAt(i--);
                            continue;
                        }
                        if (run.Due < next) next = run.Due;
                    }
                    _busy = _runs.Count > 0;

                    // 1 ms timer resolution only while a run is going (process-wide; always paired).
                    if (_busy && !_fineTimer) { NativeMethods.TimeBeginPeriod(1); _fineTimer = true; }
                    else if (!_busy && _fineTimer) { NativeMethods.TimeEndPeriod(1); _fineTimer = false; }

                    if (next == long.MaxValue) { _wake.WaitOne(); continue; }
                    long wait = next - Stopwatch.GetTimestamp();
                    if (wait <= 0) continue;
                    int ms = (int)(wait * 1000 / Stopwatch.Frequency);
                    if (ms >= 1) _wake.WaitOne(ms);
                    else Thread.Yield();
                }
                catch (Exception ex)
                {
                    // The thread must survive a bad run: drop everything rather than die holding keys.
                    DiagnosticLog.Error("Teclado: the macro executor failed; every run was stopped", ex);
                    try { StopEverything(); } catch { }
                }
            }
        }

        private static void Apply(Command c)
        {
            switch (c.Kind)
            {
                case CommandKind.Mouse:
                    SendMouse(0, 0, c.Data, c.Flags, c.Mark);
                    return;
                case CommandKind.StopAll:
                    StopEverything();
                    c.Done?.Set();
                    return;
                case CommandKind.Release:
                {
                    var run = Find(c.Key);
                    if (run != null && run.Binding.Mode == "hold") Stop(run);
                    return;
                }
                case CommandKind.Press:
                {
                    var b = c.Binding!;
                    var run = Find(c.Key);
                    if (run != null)
                    {
                        // Toggle: the second press stops it. Once, times and hold: a run already going is
                        // not restarted ("apertar de novo enquanto roda não reinicia").
                        if (b.Mode == "toggle") Stop(run);
                        return;
                    }
                    if (b.Macro.Ops.Length == 0) return;
                    _runs.Add(new Run
                    {
                        Key = c.Key,
                        Binding = b,
                        Remaining = b.Mode switch { "times" => Math.Max(1, b.Times) - 1, "hold" or "toggle" => int.MaxValue, _ => 0 },
                        // The macro starts at the press: its first step's own Delay is the only wait.
                        Due = Stopwatch.GetTimestamp() + Ticks(b.Macro.Ops[0].DelayMs),
                    });
                    _busy = true;
                    return;
                }
            }
        }

        private static Run? Find(int key)
        {
            foreach (var r in _runs) if (r.Key == key && !r.Done) return r;
            return null;
        }

        private static void Stop(Run run)
        {
            if (run.Done) return;
            run.Done = true;
            Finish(run);
            _runs.Remove(run);
        }

        private static void StopEverything()
        {
            foreach (var r in _runs) { r.Done = true; Finish(r); }
            _runs.Clear();
            // Nothing a run held can be left: whatever the counts still say goes up — unless a slot of
            // the hook holds it too (a key held as Shift while a macro also pressed Shift): then it is the
            // slot's to let go.
            for (int vk = 0; vk < _keyHolders.Length; vk++)
            {
                if (_keyHolders[vk] == 0) continue;
                Volatile.Write(ref _keyHolders[vk], 0);
                if (!SlotHoldsKey(vk)) InputHookManager.TecladoSend(_keyStrokes[vk], down: false);
            }
            for (int b = 0; b < _buttonHolders.Length; b++)
            {
                if (_buttonHolders[b] == 0) continue;
                Volatile.Write(ref _buttonHolders[b], 0);
                if (!SlotHoldsButton(b)) SendButton(ButtonUpFlags[b], 0, 0, positioned: false);
            }
            _busy = false;
        }

        /// <summary>Lets go of what a run holds (it ended, or it was stopped).</summary>
        private static void Finish(Run run)
        {
            for (int i = run.Keys.Count - 1; i >= 0; i--) ReleaseKey(run.Keys[i]);
            run.Keys.Clear();
            run.ComboHeld.Clear();
            for (int b = 0; b < run.Buttons.Length; b++)
            {
                if (!run.Buttons[b]) continue;
                run.Buttons[b] = false;
                ReleaseButton(b, 0, 0, positioned: false);
            }
        }

        /// <summary>Runs every operation that is due, on the deadlines the engine keeps: a step's wait counts from the previous deadline, and a run behind schedule resyncs instead of bursting.</summary>
        private static void Advance(Run run, long now)
        {
            var ops = run.Binding.Macro.Ops;
            int budget = 4096;
            while (!run.Done && run.Due <= now && budget-- > 0)
            {
                if (run.WalkSteps > 0)
                {
                    WalkStep(run);
                    if (run.WalkSteps > 0) { run.Due += Ticks(ActionReplayer.MoveStepDelayMs); continue; }
                    NextOp(run, ops, now);
                    continue;
                }

                var op = ops[run.Index];
                bool walking = Execute(run, op);
                if (walking) { run.Due += Ticks(ActionReplayer.MoveStepDelayMs); continue; }
                NextOp(run, ops, now);
            }
        }

        private static void NextOp(Run run, TecladoOp[] ops, long now)
        {
            run.Index++;
            if (run.Index >= ops.Length)
            {
                if (run.Remaining <= 0) { run.Done = true; return; }
                if (run.Remaining != int.MaxValue) run.Remaining--;
                run.Index = 0;
                // At least 1 ms between iterations: a macro of zero waits with a zero interval must not flood the input.
                run.Due += Ticks(Math.Max(1, run.Binding.IntervalMs));
            }
            run.Due += Ticks(ops[run.Index].DelayMs);
            if (run.Due < now) run.Due = now;
        }

        /// <summary>Sends one operation. True when it began a walk that the next ticks carry on.</summary>
        private static bool Execute(Run run, TecladoOp op)
        {
            switch (op.Kind)
            {
                case TecladoOpKind.KeyDown:
                {
                    var s = op.Stroke;
                    if (Holds(run, s.Vk))
                    {
                        // The macro pressed again a key it holds: a repeat, as the engine would send. A
                        // combination's modifier pressed so is the KeyDown row's, and stays down after it.
                        if (op.Combo) run.ComboHeld.Add(s.Vk);
                        InputHookManager.TecladoSend(s, down: true);
                        break;
                    }
                    run.Keys.Add(s);
                    int i = s.Vk & 0xFF;
                    Volatile.Write(ref _keyHolders[i], _keyHolders[i] + 1);
                    if (_keyHolders[i] == 1)
                    {
                        _keyStrokes[i] = s;
                        InputHookManager.TecladoSend(s, down: true);
                    }
                    break;
                }
                case TecladoOpKind.KeyUp:
                {
                    var s = op.Stroke;
                    // "KeyDown Ctrl, Ctrl+C, click, KeyUp Ctrl": the combination leaves the row's Ctrl down,
                    // so the click is a Ctrl+click (ActionExecution's heldByMacro).
                    if (op.Combo && run.ComboHeld.Remove(s.Vk)) break;
                    int at = IndexOfKey(run, s.Vk);
                    if (at >= 0)
                    {
                        run.Keys.RemoveAt(at);
                        ReleaseKey(s);
                    }
                    // An up the macro never pressed goes out as the engine sends it, unless another run, or
                    // a slot of the hook, holds the key.
                    else if (_keyHolders[s.Vk & 0xFF] == 0 && !SlotHoldsKey(s.Vk)) InputHookManager.TecladoSend(s, down: false);
                    break;
                }
                case TecladoOpKind.ButtonDown:
                case TecladoOpKind.ButtonUp:
                {
                    bool down = op.Kind == TecladoOpKind.ButtonDown;
                    int b = op.Button;
                    int x = op.X, y = op.Y;
                    bool positioned = !op.AtCursor && ToScreen(run, ref x, ref y);
                    if (!op.AtCursor && !positioned) break; // no window to be relative to: no click
                    if (down)
                    {
                        if (run.Buttons[b]) { SendButton(ButtonDownFlags[b], x, y, positioned); break; }
                        run.Buttons[b] = true;
                        Volatile.Write(ref _buttonHolders[b], _buttonHolders[b] + 1);
                        if (_buttonHolders[b] == 1) SendButton(ButtonDownFlags[b], x, y, positioned);
                    }
                    else if (run.Buttons[b])
                    {
                        run.Buttons[b] = false;
                        ReleaseButton(b, x, y, positioned);
                    }
                    else if (_buttonHolders[b] == 0 && !SlotHoldsButton(b)) SendButton(ButtonUpFlags[b], x, y, positioned);
                    break;
                }
                case TecladoOpKind.Wheel:
                    SendWheel(op.Data);
                    break;
                case TecladoOpKind.Char:
                    InputHookManager.TecladoSendChar((char)op.Data, down: true);
                    InputHookManager.TecladoSendChar((char)op.Data, down: false);
                    break;
                case TecladoOpKind.MoveTo:
                {
                    int x = op.X, y = op.Y;
                    if (!ToScreen(run, ref x, ref y)) break;
                    return BeginMove(run, x, y);
                }
            }
            return false;
        }

        private static bool Holds(Run run, ushort vk) => IndexOfKey(run, vk) >= 0;

        private static int IndexOfKey(Run run, ushort vk)
        {
            for (int i = 0; i < run.Keys.Count; i++) if (run.Keys[i].Vk == vk) return i;
            return -1;
        }

        // The last run to hold a key or a button lets go of it — unless a slot of the hook holds it too.
        private static void ReleaseKey(InputHookManager.TecladoStroke s)
        {
            int i = s.Vk & 0xFF;
            if (_keyHolders[i] == 0) return;
            Volatile.Write(ref _keyHolders[i], _keyHolders[i] - 1);
            if (_keyHolders[i] == 0 && !SlotHoldsKey(i)) InputHookManager.TecladoSend(s, down: false);
        }

        private static void ReleaseButton(int b, int x, int y, bool positioned)
        {
            if (_buttonHolders[b] == 0) return;
            Volatile.Write(ref _buttonHolders[b], _buttonHolders[b] - 1);
            if (_buttonHolders[b] == 0 && !SlotHoldsButton(b)) SendButton(ButtonUpFlags[b], x, y, positioned);
        }

        // ── The mouse, as SimulateMouse and MoveCursorTo do it ──

        /// <summary>The point on the screen: window-relative coordinates count from the window in front (the game).</summary>
        private static bool ToScreen(Run run, ref int x, ref int y)
        {
            if (!run.Binding.Macro.Relative) return true;
            var hwnd = NativeMethods.GetForegroundWindow();
            if (hwnd == IntPtr.Zero || !NativeMethods.GetWindowRect(hwnd, out var rect)) return false;
            // A minimised window is parked at -32000 and has no origin (TryResolveRelativeOffset).
            if (rect.Left <= -32000 || rect.Top <= -32000) return false;
            x += rect.Left;
            y += rect.Top;
            return true;
        }

        /// <summary>A jump, or the first step of a walk (Game Mode). True while a walk has steps left.</summary>
        private static bool BeginMove(Run run, int x, int y)
        {
            var (vx, vy, vw, vh) = NativeMethods.VirtualScreen.Bounds;
            x = Math.Clamp(x, vx, vx + Math.Max(1, vw) - 1);
            y = Math.Clamp(y, vy, vy + Math.Max(1, vh) - 1);
            var macro = run.Binding.Macro;
            bool smooth = macro.GameMode ?? ActionReplayer.SmoothMovement;
            int stepPx = ActionReplayer.MoveStepPx;
            if (!smooth || stepPx <= 0 || !NativeMethods.GetCursorPos(out var start))
            {
                MoveAbs(x, y);
                return false;
            }
            if (start.x == x && start.y == y) return false;

            int originX = start.x, originY = start.y;
            bool fast = macro.FastApproach ?? ActionReplayer.FastApproach;
            int settle = ActionReplayer.SettleDistancePx;
            if (fast && settle > 0)
            {
                double fdx = x - originX, fdy = y - originY;
                double full = Math.Sqrt(fdx * fdx + fdy * fdy);
                if (full > settle)
                {
                    originX = x - (int)Math.Round(fdx / full * settle);
                    originY = y - (int)Math.Round(fdy / full * settle);
                    NativeMethods.SetCursorPos(originX, originY); // the raw-input-silent teleport
                }
            }
            int dx = x - originX, dy = y - originY;
            double dist = Math.Sqrt((double)dx * dx + (double)dy * dy);
            run.WalkX = originX;
            run.WalkY = originY;
            run.WalkDx = dx;
            run.WalkDy = dy;
            run.WalkSteps = Math.Max(1, (int)Math.Ceiling(dist / stepPx));
            run.WalkStep = 0;
            WalkStep(run);
            return run.WalkSteps > 0;
        }

        private static void WalkStep(Run run)
        {
            run.WalkStep++;
            double t = (double)run.WalkStep / run.WalkSteps;
            MoveAbs(run.WalkX + (int)Math.Round(run.WalkDx * t), run.WalkY + (int)Math.Round(run.WalkDy * t));
            if (run.WalkStep >= run.WalkSteps) run.WalkSteps = 0;
        }

        private const uint PositionFlags = NativeMethods.MOUSEEVENTF_MOVE | NativeMethods.MOUSEEVENTF_ABSOLUTE | NativeMethods.MOUSEEVENTF_VIRTUALDESK;

        private static (int nx, int ny) Normalise(int x, int y)
        {
            var (vx, vy, vw, vh) = NativeMethods.VirtualScreen.Bounds;
            return ((int)(((double)(x - vx) * 65535) / Math.Max(1, vw - 1)), (int)(((double)(y - vy) * 65535) / Math.Max(1, vh - 1)));
        }

        /// <summary>The engine's dual write: SetCursorPos for GetCursorPos readers, one move input for Raw Input readers.</summary>
        private static void MoveAbs(int x, int y)
        {
            NativeMethods.SetCursorPos(x, y);
            var (nx, ny) = Normalise(x, y);
            SendMouse(nx, ny, 0, PositionFlags);
        }

        private static void SendButton(uint flags, int x, int y, bool positioned)
        {
            if (positioned)
            {
                var (nx, ny) = Normalise(x, y);
                SendMouse(nx, ny, 0, flags | PositionFlags);
            }
            else SendMouse(0, 0, 0, flags);
        }

        private static void SendWheel(int delta) => SendMouse(0, 0, unchecked((uint)delta), NativeMethods.MOUSEEVENTF_WHEEL);

        private static void SendMouse(int dx, int dy, uint data, uint flags, IntPtr mark = default)
        {
            var input = new NativeMethods.INPUT
            {
                type = NativeMethods.INPUT_MOUSE,
                U = new NativeMethods.InputUnion
                {
                    mi = new NativeMethods.MOUSEINPUT { dx = dx, dy = dy, mouseData = data, dwFlags = flags, dwExtraInfo = mark == IntPtr.Zero ? InputHookManager.TecladoMark : mark },
                },
            };
            NativeMethods.SendInput(1, ref input, NativeMethods.InputSize);
        }

        private static long Ticks(int ms) => ms <= 0 ? 0 : ms * Stopwatch.Frequency / 1000;
    }
}
