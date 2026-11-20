using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Deck (branch deck; plan .claude/planos/deck-2026-11-19.md, Fase 6): the pictures the buttons show, kept in
    /// Documents\TrueReplayer3\Deck\images — a program's icon (from its .exe or its shortcut, at 256 px when it has
    /// one), a picture file, a piece of the screen. Each is a PNG of at most 128 px on its longer side, under a name
    /// of its own (a new one each time, so nothing cached shows an old picture). deck.json keeps the name
    /// (Icon.Kind "image"); the window draws the file, and the page shows it through https://deck.local/.
    /// </summary>
    internal static class DeckImages
    {
        public const int Side = 128;

        /// <summary>Where the pictures are kept, whether or not the folder exists yet (the page's deck.local maps it).</summary>
        public static string DirPath => Path.Combine(AppIdentity.DocumentsRoot, "Deck", "images");

        /// <summary>The folder, made when first asked for.</summary>
        public static string Dir
        {
            get
            {
                var dir = DirPath;
                Directory.CreateDirectory(dir);
                return dir;
            }
        }

        /// <summary>A picture kept for a button, fitted in 128 px: its file name in <see cref="Dir"/>.</summary>
        public static string Save(Image source)
        {
            float k = Math.Min(1f, Side / (float)Math.Max(1, Math.Max(source.Width, source.Height)));
            int w = Math.Max(1, (int)Math.Round(source.Width * k)), h = Math.Max(1, (int)Math.Round(source.Height * k));
            using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.Clear(Color.Transparent);
                g.DrawImage(source, 0, 0, w, h);
            }
            string name = $"img-{DateTime.Now:yyyyMMdd-HHmmss}-{Guid.NewGuid().ToString("N")[..6]}.png";
            bmp.Save(Path.Combine(Dir, name), ImageFormat.Png);
            return name;
        }

        /// <summary>A picture file (png, jpg, bmp, gif): kept fitted in 128 px. Null when it cannot be read.</summary>
        public static string? FromPicture(string path)
        {
            try
            {
                // Read through a stream: Image.FromFile keeps the file locked while the image lives.
                using var stream = File.OpenRead(path);
                using var image = Image.FromStream(stream);
                return Save(image);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Deck: the picture {Path.GetFileName(path)} could not be read: {ex.GetType().Name}: {ex.Message}");
                return null;
            }
        }

        /// <summary>
        /// The icon of a program, a shortcut or any file, as Explorer shows it — at 256 px when the icon has that size
        /// (a modern program's), scaled from the largest it has otherwise. A shortcut gives its own icon when it has one,
        /// else its target's. Null when there is none to read.
        /// </summary>
        public static string? FromProgram(string path)
        {
            IntPtr large = IntPtr.Zero;
            try
            {
                var (iconFile, index) = IconLocation(path);
                if (iconFile != null && DeckNative.SHDefExtractIconW(iconFile, index, 0, out large, out var small, (16u << 16) | 256u) == 0 && small != IntPtr.Zero)
                    DeckNative.DestroyIcon(small);
                if (large == IntPtr.Zero)
                {
                    // The shell's own large icon (32 px): a file whose icon has no place of its own (a folder, a URL).
                    var info = new DeckNative.SHFILEINFOW { szDisplayName = "", szTypeName = "" };
                    DeckNative.SHGetFileInfoW(path, 0, ref info, (uint)Marshal.SizeOf<DeckNative.SHFILEINFOW>(), DeckNative.SHGFI_ICON | DeckNative.SHGFI_LARGEICON);
                    large = info.hIcon;
                }
                if (large == IntPtr.Zero) return null;
                using var icon = Icon.FromHandle(large);
                using var bmp = icon.ToBitmap();
                return Save(bmp);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Deck: the icon of {Path.GetFileName(path)} could not be read: {ex.GetType().Name}: {ex.Message}");
                return null;
            }
            finally
            {
                if (large != IntPtr.Zero) DeckNative.DestroyIcon(large);
            }
        }

        /// <summary>Where a file's icon is: a shortcut's own (or its target's), a program's own, any other file's as Explorer has it.</summary>
        private static (string? File, int Index) IconLocation(string path)
        {
            string target = path;
            if (path.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase))
            {
                var (linked, iconPath, iconIndex) = ReadShortcut(path);
                if (!string.IsNullOrWhiteSpace(iconPath)) return (Environment.ExpandEnvironmentVariables(iconPath), iconIndex);
                if (!string.IsNullOrWhiteSpace(linked)) target = linked;
            }
            if (target.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || target.EndsWith(".ico", StringComparison.OrdinalIgnoreCase) || target.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
                return (target, 0);
            var info = new DeckNative.SHFILEINFOW { szDisplayName = "", szTypeName = "" };
            if (DeckNative.SHGetFileInfoW(target, 0, ref info, (uint)Marshal.SizeOf<DeckNative.SHFILEINFOW>(), DeckNative.SHGFI_ICONLOCATION) != IntPtr.Zero
                && !string.IsNullOrWhiteSpace(info.szDisplayName))
                return (Environment.ExpandEnvironmentVariables(info.szDisplayName), info.iIcon);
            return (null, 0);
        }

        /// <summary>A shortcut's target, and its own icon (empty when it uses the target's).</summary>
        public static (string? Target, string? IconPath, int IconIndex) ReadShortcut(string lnk)
        {
            object? link = null;
            try
            {
                link = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046"), throwOnError: true)!)!;
                ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Load(lnk, 0);
                var shell = (IShellLinkW)link;
                var target = new StringBuilder(1024);
                shell.GetPath(target, target.Capacity, IntPtr.Zero, 0);
                var icon = new StringBuilder(1024);
                shell.GetIconLocation(icon, icon.Capacity, out int index);
                return (target.Length > 0 ? target.ToString() : null, icon.Length > 0 ? icon.ToString() : null, index);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Deck: the shortcut {Path.GetFileName(lnk)} could not be read: {ex.GetType().Name}: {ex.Message}");
                return (null, null, 0);
            }
            finally
            {
                if (link != null) { try { Marshal.FinalReleaseComObject(link); } catch { } }
            }
        }

        // IShellLinkW, in its order, as far as GetIconLocation.
        [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellLinkW
        {
            void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int cch, IntPtr findData, uint flags);
            void GetIDList(out IntPtr pidl);
            void SetIDList(IntPtr pidl);
            void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int cch);
            void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int cch);
            void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
            void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int cch);
            void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
            void GetHotkey(out short hotkey);
            void SetHotkey(short hotkey);
            void GetShowCmd(out int showCmd);
            void SetShowCmd(int showCmd);
            void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder iconPath, int cch, out int index);
        }
    }
}
