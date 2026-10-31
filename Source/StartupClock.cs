using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The opening's own clock (D7): milliseconds since the process started, marked at each stage of
    /// the native part of the opening and written to the log in one line once the page has loaded —
    /// "[Startup] main 41 · ui 98 · …". Marks taken before the log exists (Program.Main) wait here.
    /// </summary>
    internal static class StartupClock
    {
        private static readonly DateTime ProcessStart = ReadProcessStart();
        private static readonly List<string> Marks = new();
        private static bool _written;

        /// <summary>Milliseconds since the process started.</summary>
        public static double Ms => (DateTime.Now - ProcessStart).TotalMilliseconds;

        public static void Mark(string stage)
        {
            lock (Marks)
                if (!_written) Marks.Add($"{stage} {Ms:F0}");
        }

        /// <summary>Writes the marks once, with a last one; later calls do nothing.</summary>
        public static void Write(string lastStage)
        {
            string line;
            lock (Marks)
            {
                if (_written) return;
                Marks.Add($"{lastStage} {Ms:F0}");
                _written = true;
                line = string.Join(" · ", Marks);
            }
            DiagnosticLog.Info($"[Startup] {line} (ms since the process started)");
        }

        private static DateTime ReadProcessStart()
        {
            try { return Process.GetCurrentProcess().StartTime; }
            catch { return DateTime.Now; }
        }
    }
}
