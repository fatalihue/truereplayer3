using System;
using System.Runtime.InteropServices;

namespace TrueReplayer.Interop
{
    internal static class NativeMethods
    {
        public const uint INPUT_MOUSE = 0;
        public const uint INPUT_KEYBOARD = 1;

        public const uint MOUSEEVENTF_MOVE = 0x0001;
        public const uint MOUSEEVENTF_ABSOLUTE = 0x8000;
        public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
        public const uint MOUSEEVENTF_WHEEL = 0x0800;
        // Side buttons through SendInput: the X flags plus WHICH button in mouseData. Used by the
        // remap layer's mouse-side targets only — the replayer never simulates side buttons.
        public const uint MOUSEEVENTF_XDOWN = 0x0080;
        public const uint MOUSEEVENTF_XUP = 0x0100;
        public const uint XBUTTON1 = 0x0001;
        public const uint XBUTTON2 = 0x0002;
        public const uint MOUSEEVENTF_VIRTUALDESK = 0x4000;

        public const uint KEYEVENTF_EXTENDEDKEY = 0x0001;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public const uint KEYEVENTF_SCANCODE = 0x0008;
        // KEYEVENTF_UNICODE: wScan carries a UTF-16 CODE UNIT and wVk MUST be 0. The system
        // synthesizes a VK_PACKET (0xE7) keystroke that the target's TranslateMessage turns into
        // WM_CHAR. Per the KEYBDINPUT contract it combines ONLY with KEYEVENTF_KEYUP — never with
        // KEYEVENTF_SCANCODE, which every other injection site in this app sets. Do not copy
        // SimulateKeyPress's flag expression here; write the flags fresh.
        // Used ONLY as the per-character fallback in TypeTextViaSendInput, for characters the
        // target's layout cannot produce at all (emoji, →, é on a US layout).
        public const uint KEYEVENTF_UNICODE = 0x0004;

        public const int WH_MOUSE_LL = 14;
        public const int WH_KEYBOARD_LL = 13;

        // Only the mouse hook's early-out uses this: it is the one message WH_MOUSE_LL delivers
        // that no branch in MouseHookCallbackCore handles, and it arrives at the mouse's polling
        // rate (125-1000 Hz), so naming it lets that path bail before doing any work.
        public const int WM_MOUSEMOVE = 0x0200;

        public const int WM_LBUTTONDOWN = 0x0201;
        public const int WM_LBUTTONUP = 0x0202;
        public const int WM_RBUTTONDOWN = 0x0204;
        public const int WM_RBUTTONUP = 0x0205;
        public const int WM_MBUTTONDOWN = 0x0207;
        public const int WM_MBUTTONUP = 0x0208;
        public const int WM_MOUSEWHEEL = 0x020A;
        // X-buttons (mouse side buttons). HIWORD(mouseData) tells which one: 1 = XButton1
        // (back), 2 = XButton2 (forward). Used only as profile-hotkey triggers — the
        // recorder/replayer deliberately do not know about them.
        public const int WM_XBUTTONDOWN = 0x020B;
        public const int WM_XBUTTONUP = 0x020C;

        public const int WM_KEYDOWN = 0x0100;
        public const int WM_KEYUP = 0x0101;

        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT
        {
            public uint type;
            public InputUnion U;
        }

        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion
        {
            [FieldOffset(0)] public MOUSEINPUT mi;
            [FieldOffset(0)] public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT
        {
            public int dx;
            public int dy;
            public uint mouseData;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct POINT
        {
            public int x;
            public int y;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct MSLLHOOKSTRUCT
        {
            public POINT pt;
            public uint mouseData;
            public uint flags;
            public uint time;
            public IntPtr dwExtraInfo;
        }

        public delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);
        public delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        // ── Known folders ──
        // SHGetKnownFolderPath is the only correct way to resolve Downloads:
        // Environment.SpecialFolder has no entry for it, and %USERPROFILE%\Downloads
        // guesses wrong when the folder is redirected.
        private static readonly Guid FOLDERID_Downloads = new("374DE290-123F-4565-9164-39C4925E467B");

        [DllImport("shell32.dll")]
        private static extern int SHGetKnownFolderPath([MarshalAs(UnmanagedType.LPStruct)] Guid rfid, uint dwFlags, IntPtr hToken, out IntPtr ppszPath);

        /// <summary>Resolved Downloads folder, or null when the shell can't say (never throws).</summary>
        public static string? TryGetDownloadsFolder()
        {
            var pszPath = IntPtr.Zero;
            try
            {
                // Free unconditionally: the docs require CoTaskMemFree on the out pointer
                // whether or not the call succeeded. FreeCoTaskMem(Zero) is a safe no-op.
                if (SHGetKnownFolderPath(FOLDERID_Downloads, 0, IntPtr.Zero, out pszPath) == 0)
                    return Marshal.PtrToStringUni(pszPath);
            }
            catch { }
            finally
            {
                Marshal.FreeCoTaskMem(pszPath);
            }
            return null;
        }

        // SetLastError=true so a failed hook install (returns IntPtr.Zero) surfaces a meaningful
        // Marshal.GetLastWin32Error() in InputHookManager.Start()'s diagnostic logging.
        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll")]
        public static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        public static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll")]
        public static extern IntPtr GetModuleHandle(string lpModuleName);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

        // Single-event overload: INPUT is blittable, so `ref` marshals as a direct pointer
        // and the caller skips the one-element array allocation. Every injection site in the
        // app sends exactly one event, and the clicker loop does it twice per tick — at 100/s
        // that is 200 arrays a second that never needed to exist.
        [DllImport("user32.dll", SetLastError = true)]
        public static extern uint SendInput(uint nInputs, ref INPUT pInputs, int cbSize);

        // Cached INPUT size. Marshal.SizeOf is reflection-backed and was being recomputed on
        // every single injected event (three separate sites did it per call).
        public static readonly int InputSize = Marshal.SizeOf<INPUT>();

        // System timer resolution. Task.Delay quantises to the current timer period — ~15.6 ms
        // by default — so a clicker configured for 10 ms cannot be honoured without asking for
        // 1 ms first. Always pair Begin with End: the setting is process-wide and persists
        // until released, and holding 1 ms costs battery on idle machines.
        [DllImport("winmm.dll", EntryPoint = "timeBeginPeriod")]
        public static extern uint TimeBeginPeriod(uint uMilliseconds);

        [DllImport("winmm.dll", EntryPoint = "timeEndPeriod")]
        public static extern uint TimeEndPeriod(uint uMilliseconds);

        [DllImport("user32.dll")]
        public static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        public static extern uint MapVirtualKey(uint uCode, uint uMapType);

        [DllImport("user32.dll")]
        public static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        public static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll")]
        public static extern int GetSystemMetrics(int nIndex);

        /// <summary>GetSystemMetrics for a given DPI — the icon sizes of a window on a scaled display.</summary>
        [DllImport("user32.dll")]
        public static extern int GetSystemMetricsForDpi(int nIndex, uint dpi);

        // Icon metrics: the window's big icon (taskbar, Alt+Tab) and the small one (title bar, tray).
        public const int SM_CXICON = 11, SM_CYICON = 12, SM_CXSMICON = 49, SM_CYSMICON = 50;

        // System double-click time (ms) — the same threshold the OS uses to pair two
        // clicks into a double-click. Used by the recorder's DoubleClick merge so
        // recording agrees with what the target app itself perceived.
        [DllImport("user32.dll")]
        public static extern uint GetDoubleClickTime();

        [DllImport("user32.dll")]
        public static extern IntPtr GetForegroundWindow();

        // Monotonic per-session clipboard revision counter — bumps on every clipboard write
        // without opening the clipboard (cheap enough to poll). Returns 0 when the calling
        // thread's desktop has no clipboard access (locked workstation / secure desktop) —
        // callers must treat 0 as "unknown", NOT as a change.
        [DllImport("user32.dll")]
        public static extern uint GetClipboardSequenceNumber();

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder lpString, int nMaxCount);

        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern IntPtr OpenProcess(uint dwDesiredAccess, bool bInheritHandle, uint dwProcessId);

        [DllImport("psapi.dll", CharSet = CharSet.Unicode)]
        public static extern uint GetProcessImageFileName(IntPtr hProcess, System.Text.StringBuilder lpImageFileName, uint nSize);

        [DllImport("kernel32.dll")]
        public static extern bool CloseHandle(IntPtr hObject);

        public const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

        // Token plumbing for ProcessIntegrity — "is the window under the Clicker's cursor
        // elevated while we are not?". TOKEN_QUERY on a limited process handle is all that
        // TokenElevation needs.
        public const uint TOKEN_QUERY = 0x0008;
        public const int TokenElevation = 20;

        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

        // TokenElevation writes a TOKEN_ELEVATION — a single DWORD (TokenIsElevated).
        [DllImport("advapi32.dll", SetLastError = true)]
        public static extern bool GetTokenInformation(IntPtr tokenHandle, int tokenInformationClass, out uint tokenInformation, uint tokenInformationLength, out uint returnLength);

        [DllImport("user32.dll")]
        public static extern IntPtr WindowFromPoint(POINT point);

        [DllImport("user32.dll")]
        public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

        [StructLayout(LayoutKind.Sequential)]
        public struct RECT
        {
            public int Left, Top, Right, Bottom;
        }

        // Reports the window's RESTORED placement (rcNormalPosition) even while it is
        // minimised — GetWindowRect would answer with the off-screen (-32000,-32000) parking
        // rect instead, which loses the monitor the window actually lives on.
        [DllImport("user32.dll")]
        public static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

        [StructLayout(LayoutKind.Sequential)]
        public struct WINDOWPLACEMENT
        {
            public int length;
            public int flags;
            public int showCmd;
            public POINT ptMinPosition;
            public POINT ptMaxPosition;
            public RECT rcNormalPosition;
        }

        [DllImport("user32.dll")]
        public static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

        public const uint GA_ROOT = 2;

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);

        public const uint MB_ICONERROR = 0x00000010;

        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool IsIconic(IntPtr hWnd); // true if minimized

        // ── Out-of-window run-status notifications (UI Wave 3) ──
        // FlashWindowEx pulses the taskbar button; MessageBeep plays the system
        // sound scheme's chime (no bundled audio asset, respects user's scheme
        // incl. "No Sounds"). Both are fired only when the TrueReplayer window
        // is NOT foreground — the game usually is.
        [StructLayout(LayoutKind.Sequential)]
        public struct FLASHWINFO
        {
            public uint cbSize;
            public IntPtr hwnd;
            public uint dwFlags;
            public uint uCount;
            public uint dwTimeout;
        }

        public const uint FLASHW_TRAY = 0x00000002;      // flash the taskbar button
        public const uint FLASHW_TIMERNOFG = 0x0000000C; // flash until the window comes to the foreground

        [DllImport("user32.dll")]
        public static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

        public const uint MB_OK_BEEP = 0x00000000;        // MB_OK — "done" chime
        public const uint MB_ICONERROR_BEEP = 0x00000010; // MB_ICONERROR — "failed" chime
        // MB_ICONASTERISK — the system "Asterisk"/info sound. Audibly distinct from MB_OK,
        // which is the point: the run-end chime already plays after EVERY row, so the
        // list-finished cue has to differ by TIMBRE to be recognisable without looking.
        public const uint MB_ICONASTERISK_BEEP = 0x00000040;

        [DllImport("user32.dll")]
        public static extern bool MessageBeep(uint uType);

        [DllImport("user32.dll")]
        public static extern uint GetDpiForWindow(IntPtr hWnd);

        /// <summary>GetDpiForWindow with the 0-means-96 fallback every caller needs.</summary>
        public static uint GetDpiForWindowSafe(IntPtr hWnd)
        {
            uint dpi = GetDpiForWindow(hWnd);
            return dpi == 0 ? 96u : dpi;
        }

        [DllImport("user32.dll")]
        public static extern bool IsZoomed(IntPtr hWnd); // true if maximized

        [DllImport("user32.dll")]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        public const uint SWP_NOSIZE = 0x0001;
        public const uint SWP_NOMOVE = 0x0002;
        public const uint SWP_NOZORDER = 0x0004;
        // Posts the request to the window's own thread instead of waiting for it to process
        // WM_WINDOWPOSCHANGING/CHANGED — a busy or frozen target cannot block the caller.
        public const uint SWP_ASYNCWINDOWPOS = 0x4000;

        [DllImport("user32.dll")]
        public static extern IntPtr GetKeyboardLayout(uint idThread);

        [DllImport("user32.dll")]
        public static extern int ToUnicodeEx(
            uint wVirtKey, uint wScanCode, byte[] lpKeyState,
            [Out, MarshalAs(UnmanagedType.LPWStr)] System.Text.StringBuilder pwszBuff,
            int cchBuff, uint wFlags, IntPtr dwhkl);

        // CharSet.Unicode is LOAD-BEARING, not tidiness: the default (Ansi) binds VkKeyScanExA, and
        // the marshaller then best-fits the char into the process ANSI codepage on the way in. A
        // character outside that codepage arrives as '?' and the API faithfully answers about '?' —
        // measured 2026-09-01, U+2192 returned 0x01BF (Shift+VK_OEM_2 = '?') through the ANSI entry
        // point and 0xFFFF through the wide one. Callers that treat -1 as the only "not on this
        // layout" signal would silently type the substitute. See TryResolveTypedKey, whose
        // round-trip check exists to catch exactly that class and stays even with this fixed.
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        public static extern short VkKeyScanEx(char ch, IntPtr dwhkl);

        [DllImport("user32.dll")]
        public static extern uint MapVirtualKeyEx(uint uCode, uint uMapType, IntPtr dwhkl);

        // GetDC(NULL) returns a DC for the entire virtual screen (all monitors), letting
        // GetPixel sample any visible pixel without per-monitor handling. ReleaseDC must
        // be called on the same hWnd that was passed to GetDC, even when that hWnd is NULL.
        // GetPixel returns a COLORREF (0x00BBGGRR) or CLR_INVALID (0xFFFFFFFF) when the
        // coordinates fall outside the DC. Used by PixelColorService for WaitPixelColor.
        [DllImport("user32.dll")]
        public static extern IntPtr GetDC(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

        [DllImport("gdi32.dll")]
        public static extern uint GetPixel(IntPtr hdc, int nXPos, int nYPos);

        // Window management
        public const int SW_MINIMIZE = 6;
        public const int SW_RESTORE = 9;
        public const int SW_MAXIMIZE = 3; // == SW_SHOWMAXIMIZED
        public const int SW_SHOW = 5;     // show in current size/state (un-hides without un-maximizing)

        // WM_CLOSE requests a graceful window close (the app can prompt to save) — used by the
        // ActivateWindow "Close" verb. PostMessage (not SendMessage) so a hung target can't block us.
        public const int WM_CLOSE = 0x0010;

        [DllImport("user32.dll")]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        // ShowWindow for a window of ANOTHER thread without waiting for that thread to process it.
        [DllImport("user32.dll")]
        public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);

        [DllImport("user32.dll")]
        public static extern bool PostMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll")]
        public static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        public static extern bool BringWindowToTop(IntPtr hWnd);

        // True when the window's thread hasn't pumped its message queue for ~5s (frozen app).
        // Heuristic — a genuine hang guard, not a general "ready" signal for a slow-but-pumping loader.
        [DllImport("user32.dll")]
        public static extern bool IsHungAppWindow(IntPtr hWnd);

        // Two overloads: GET writes the value through a ref; SET passes the new value IN the
        // pvParam slot itself (SPI_SETFOREGROUNDLOCKTIMEOUT is a "value-in-pointer" action).
        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, ref uint pvParam, uint fWinIni);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);

        public const uint SPI_GETFOREGROUNDLOCKTIMEOUT = 0x2000;
        public const uint SPI_SETFOREGROUNDLOCKTIMEOUT = 0x2001;
        public const uint SPIF_SENDCHANGE = 0x0002;

        // Which desktop has the input. The lock screen, the UAC prompt and Ctrl+Alt+Del run on the
        // secure desktop ("Winlogon"), which a user process cannot open — and there the low-level
        // hooks see nothing and SendInput delivers nothing. See InputHookManager's watchdog.
        public const uint DESKTOP_READOBJECTS = 0x0001;
        public const int UOI_NAME = 2;

        [DllImport("user32.dll", SetLastError = true)]
        public static extern IntPtr OpenInputDesktop(uint dwFlags, bool fInherit, uint dwDesiredAccess);

        [DllImport("user32.dll", SetLastError = true)]
        public static extern bool CloseDesktop(IntPtr hDesktop);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool GetUserObjectInformation(IntPtr hObj, int nIndex, System.Text.StringBuilder? pvInfo, uint nLength, out uint lpnLengthNeeded);

        // When this session last received input, from ANY device, physical or injected, in
        // GetTickCount (32-bit) time. Tells the hook watchdog whether there was input its hooks
        // should have seen.
        [StructLayout(LayoutKind.Sequential)]
        public struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        [DllImport("user32.dll")]
        public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        // Session change notifications (lock/unlock, console or remote reconnect), delivered to the
        // main window as WM_WTSSESSION_CHANGE with the event in wParam.
        public const int WM_WTSSESSION_CHANGE = 0x02B1;
        public const int WTS_CONSOLE_CONNECT = 0x1;
        public const int WTS_REMOTE_CONNECT = 0x3;
        public const int WTS_SESSION_UNLOCK = 0x8;
        public const uint NOTIFY_FOR_THIS_SESSION = 0;

        [DllImport("wtsapi32.dll", SetLastError = true)]
        public static extern bool WTSRegisterSessionNotification(IntPtr hWnd, uint dwFlags);

        [DllImport("wtsapi32.dll", SetLastError = true)]
        public static extern bool WTSUnRegisterSessionNotification(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern uint RegisterWindowMessage(string lpString);

        [DllImport("user32.dll")]
        public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);

        [DllImport("kernel32.dll")]
        public static extern uint GetCurrentThreadId();

        public static IntPtr SetMouseHook(LowLevelMouseProc proc)
        {
            using var curProcess = System.Diagnostics.Process.GetCurrentProcess();
            using var curModule = curProcess.MainModule!;
            return SetWindowsHookEx(WH_MOUSE_LL, proc, GetModuleHandle(curModule.ModuleName!), 0);
        }

        public static IntPtr SetKeyboardHook(LowLevelKeyboardProc proc)
        {
            using var curProcess = System.Diagnostics.Process.GetCurrentProcess();
            using var curModule = curProcess.MainModule!;
            return SetWindowsHookEx(WH_KEYBOARD_LL, proc, GetModuleHandle(curModule.ModuleName!), 0);
        }

        /// <summary>
        /// Virtual-screen bounds (SM_X/YVIRTUALSCREEN + SM_CX/CYVIRTUALSCREEN) cached
        /// to avoid 4 P/Invoke calls per mouse action / clicker iteration. The values
        /// only change on monitor add/remove or DPI change — both rare events; users
        /// who hit one can restart the replay to pick up the new bounds. Worth the
        /// micro-saving in the cursor-clicker hot loop where SimulateMouse fires at
        /// 10+ Hz and previously did 4 GetSystemMetrics calls per click.
        /// </summary>
        public static class VirtualScreen
        {
            // Guards the cache fields below. Bounds is read from the replay/clicker thread
            // while Invalidate() runs on the UI thread's WndProc (WM_DISPLAYCHANGE), so the
            // lock prevents a torn-tuple read (mixed old/new bounds) and double-initialization.
            // It does not change the values returned for a given display configuration.
            private static readonly object _gate = new object();
            private static int _x, _y, _w, _h;
            private static bool _cached;

            public static (int X, int Y, int W, int H) Bounds
            {
                get
                {
                    lock (_gate)
                    {
                        if (!_cached)
                        {
                            _x = GetSystemMetrics(76); // SM_XVIRTUALSCREEN
                            _y = GetSystemMetrics(77); // SM_YVIRTUALSCREEN
                            _w = GetSystemMetrics(78); // SM_CXVIRTUALSCREEN
                            _h = GetSystemMetrics(79); // SM_CYVIRTUALSCREEN
                            _cached = true;
                        }
                        return (_x, _y, _w, _h);
                    }
                }
            }

            /// <summary>
            /// Drops the cache so the next read re-queries Windows. Wired to the
            /// WM_DISPLAYCHANGE message in WindowShellServices' WndProc, so it fires
            /// automatically on a monitor reconfiguration or DPI change.
            /// </summary>
            public static void Invalidate()
            {
                lock (_gate)
                {
                    _cached = false;
                }
            }
        }
    }
}