using System;
using System.Collections.Generic;
using System.IO;
using System.Numerics;
using System.Text;
using Vortice;
using Vortice.DCommon;
using Vortice.Direct2D1;
using Vortice.DirectWrite;
using Vortice.DXGI;
using Vortice.Mathematics;
using D2FeatureLevel = Vortice.Direct2D1.FeatureLevel;
using D2FactoryType = Vortice.Direct2D1.FactoryType;
using DPixelFormat = Vortice.DCommon.PixelFormat;
using DWFactoryType = Vortice.DirectWrite.FactoryType;
using DWFontStyle = Vortice.DirectWrite.FontStyle;
using RF = System.Drawing.RectangleF;
using VRect = Vortice.Mathematics.Rect;
using VSize = Vortice.Mathematics.Size;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The tokens the Deck's windows paint with: the page's theme flattened to opaque #rrggbb
    /// (themes.ts nativeDialogColors + nativeDeckColors, through theme:colors), and whether the user's
    /// Motion setting lets things animate. Saved in appsettings.json (DeckTheme) so the decks paint the
    /// right colours at the next launch, before any page exists; Lavender Coal (the default theme) until a
    /// theme has been seen once.
    /// </summary>
    internal sealed class DeckTheme
    {
        public static readonly IReadOnlyDictionary<string, string> DefaultHex = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["bgSurface"] = "#1c1c1c", ["bgCard"] = "#1f1f1f",
            ["borderDefault"] = "#2d2d2e", ["borderSubtle"] = "#29292a", ["borderStrong"] = "#38383a",
            ["textPrimary"] = "#c8c8d4", ["accentSolid"] = "#4392d3",
            ["replayFg"] = "#6bcb77", ["recordingFg"] = "#ff6b6b",
        };

        public readonly Color4 Surface, Card, BorderDefault, BorderSubtle, BorderStrong, Text, Accent, ReplayFg, RecordingFg;
        /// <summary>The "on" face: 12 % of the accent over the panel (not over the face: the label keeps 4.5:1, Fase 0).</summary>
        public readonly Color4 OnFace, OnBorder;
        public readonly bool Animations;
        public readonly IReadOnlyDictionary<string, string> Hex;

        public DeckTheme(IReadOnlyDictionary<string, string>? hex, bool animations)
        {
            var map = new Dictionary<string, string>(DefaultHex, StringComparer.Ordinal);
            if (hex != null)
                foreach (var (k, v) in hex)
                    if (DefaultHex.ContainsKey(k) && Parse(v) is { }) map[k] = v.ToLowerInvariant();
            Hex = map;
            Animations = animations;
            Surface = Parse(map["bgSurface"])!.Value; Card = Parse(map["bgCard"])!.Value;
            BorderDefault = Parse(map["borderDefault"])!.Value; BorderSubtle = Parse(map["borderSubtle"])!.Value;
            BorderStrong = Parse(map["borderStrong"])!.Value; Text = Parse(map["textPrimary"])!.Value;
            Accent = Parse(map["accentSolid"])!.Value; ReplayFg = Parse(map["replayFg"])!.Value; RecordingFg = Parse(map["recordingFg"])!.Value;
            OnFace = Mix(Accent, Surface, 0.12f);
            OnBorder = Mix(Accent, OnFace, 0.40f);
        }

        public static DeckTheme Default { get; } = new(null, true);

        public static Color4? Parse(string? hex)
        {
            if (hex == null || hex.Length != 7 || hex[0] != '#') return null;
            try
            {
                int n = Convert.ToInt32(hex.Substring(1), 16);
                return new Color4(((n >> 16) & 255) / 255f, ((n >> 8) & 255) / 255f, (n & 255) / 255f, 1f);
            }
            catch { return null; }
        }

        // "a" over "b", by a's weight: the page's color-mix(in srgb, a N%, b).
        private static Color4 Mix(Color4 a, Color4 b, float w) =>
            new(a.R * w + b.R * (1 - w), a.G * w + b.G * (1 - w), a.B * w + b.B * (1 - w), 1f);
    }

    /// <summary>
    /// What a deck's window draws with: a premultiplied 32-bit DIB that UpdateLayeredWindow takes, a
    /// Direct2D DC render target bound to it (software, grayscale antialiasing — the Fase 0 probe), and
    /// the brushes, text formats, SVG documents and pictures it keeps between frames. One per window, all
    /// on the Deck's thread; the factories are shared.
    /// </summary>
    internal sealed class DeckPainter : IDisposable
    {
        private static ID2D1Factory1? _factory;
        private static IDWriteFactory? _dwrite;

        public static ID2D1Factory1 Factory => _factory ??= D2D1.D2D1CreateFactory<ID2D1Factory1>(D2FactoryType.SingleThreaded, DebugLevel.None);
        public static IDWriteFactory DWrite => _dwrite ??= Vortice.DirectWrite.DWrite.DWriteCreateFactory<IDWriteFactory>(DWFactoryType.Shared);

        private IntPtr _dc, _bmp, _oldBmp;
        public int Width { get; private set; }
        public int Height { get; private set; }
        private float _scale = 1f;
        private ID2D1DCRenderTarget? _rt;
        private ID2D1DeviceContext5? _dc5;
        private readonly Dictionary<uint, ID2D1SolidColorBrush> _brushes = new();
        private readonly Dictionary<string, ID2D1SvgDocument?> _svgs = new(StringComparer.Ordinal);
        private readonly Dictionary<string, (ID2D1Bitmap? Bitmap, DateTime Stamp)> _images = new(StringComparer.OrdinalIgnoreCase);
        private readonly Dictionary<(string Family, float Size, bool Center, bool Trim), IDWriteTextFormat> _formats = new();
        private readonly List<IDWriteInlineObject> _signs = new();

        public ID2D1RenderTarget Target => _rt!;

        /// <summary>The DIB and the render target for a size in pixels and a monitor scale; nothing is redone when both stay.</summary>
        public void Ensure(int width, int height, float scale)
        {
            width = Math.Max(1, width);
            height = Math.Max(1, height);
            if (_rt != null && width == Width && height == Height && Math.Abs(scale - _scale) < 0.001f) return;
            if (_rt == null || Math.Abs(scale - _scale) >= 0.001f)
            {
                DropTarget();
                _scale = scale;
                _rt = Factory.CreateDCRenderTarget(new RenderTargetProperties(RenderTargetType.Software,
                    new DPixelFormat(Vortice.DXGI.Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Premultiplied), 96f * scale, 96f * scale,
                    RenderTargetUsage.None, D2FeatureLevel.Default));
                _rt.TextAntialiasMode = Vortice.Direct2D1.TextAntialiasMode.Grayscale;
                _dc5 = _rt.QueryInterfaceOrNull<ID2D1DeviceContext5>();
            }
            if (width != Width || height != Height || _dc == IntPtr.Zero)
            {
                DropDib();
                var bi = new DeckNative.BITMAPINFOHEADER { biSize = (uint)System.Runtime.InteropServices.Marshal.SizeOf<DeckNative.BITMAPINFOHEADER>(), biWidth = width, biHeight = -height, biPlanes = 1, biBitCount = 32 };
                _dc = DeckNative.CreateCompatibleDC(IntPtr.Zero);
                _bmp = DeckNative.CreateDIBSection(IntPtr.Zero, ref bi, 0, out _, IntPtr.Zero, 0);
                _oldBmp = DeckNative.SelectObject(_dc, _bmp);
                Width = width;
                Height = height;
            }
        }

        /// <summary>Starts a frame: the whole bitmap cleared to transparent, drawing in DIP.</summary>
        public void Begin()
        {
            _rt!.BindDC(_dc, new RawRect(0, 0, Width, Height));
            _rt.BeginDraw();
            _rt.Clear(new Color4(0, 0, 0, 0));
            _rt.Transform = Matrix3x2.Identity;
        }

        /// <summary>Ends a frame; false when Direct2D asks for the target again (it is rebuilt on the next frame).</summary>
        public bool End()
        {
            var hr = _rt!.EndDraw();
            if (hr.Success) return true;
            DiagnosticLog.Warn($"Deck: EndDraw 0x{hr.Code:X8}; the target is rebuilt");
            DropTarget();
            return false;
        }

        /// <summary>The bitmap to the window at a place, with an opacity on top of its own alpha.</summary>
        public bool Present(IntPtr hwnd, int x, int y, byte alpha)
        {
            var screen = DeckNative.GetDC(IntPtr.Zero);
            try
            {
                var pos = new DeckNative.POINT(x, y);
                var size = new DeckNative.SIZE(Width, Height);
                var src = new DeckNative.POINT(0, 0);
                var blend = new DeckNative.BLENDFUNCTION { BlendOp = 0, SourceConstantAlpha = alpha, AlphaFormat = 1 };
                return DeckNative.UpdateLayeredWindow(hwnd, screen, ref pos, ref size, _dc, ref src, 0, ref blend, DeckNative.ULW_ALPHA);
            }
            finally { DeckNative.ReleaseDC(IntPtr.Zero, screen); }
        }

        /// <summary>Only the opacity, and the place: nothing is drawn again (a fade, a slide).</summary>
        public static bool Move(IntPtr hwnd, int x, int y, byte alpha)
        {
            var pos = new DeckNative.POINT(x, y);
            var blend = new DeckNative.BLENDFUNCTION { BlendOp = 0, SourceConstantAlpha = alpha, AlphaFormat = 1 };
            return DeckNative.UpdateLayeredWindow(hwnd, IntPtr.Zero, ref pos, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, ref blend, DeckNative.ULW_ALPHA);
        }

        // ── Primitives, in DIP ──

        public ID2D1SolidColorBrush Brush(Color4 c)
        {
            uint key = (uint)(Math.Clamp(c.A, 0, 1) * 255) << 24 | (uint)(Math.Clamp(c.R, 0, 1) * 255) << 16 | (uint)(Math.Clamp(c.G, 0, 1) * 255) << 8 | (uint)(Math.Clamp(c.B, 0, 1) * 255);
            if (!_brushes.TryGetValue(key, out var b)) _brushes[key] = b = _rt!.CreateSolidColorBrush(c);
            return b;
        }

        public void FillRound(float x, float y, float w, float h, float r, Color4 c) =>
            _rt!.FillRoundedRectangle(new RoundedRectangle(new RF(x, y, w, h), r, r), Brush(c));

        /// <summary>A border of width w drawn inside the box (the CSS border-box way).</summary>
        public void StrokeRound(float x, float y, float w, float h, float r, Color4 c, float width = 1f)
        {
            float half = width / 2f;
            _rt!.DrawRoundedRectangle(new RoundedRectangle(new RF(x + half, y + half, w - width, h - width), Math.Max(0, r - half), Math.Max(0, r - half)), Brush(c), width);
        }

        public void Circle(float cx, float cy, float r, Color4 c) => _rt!.FillEllipse(new Ellipse(new Vector2(cx, cy), r, r), Brush(c));

        public IDWriteTextFormat Format(string family, float size, bool center, bool trim)
        {
            var key = (family, size, center, trim);
            if (_formats.TryGetValue(key, out var f)) return f;
            f = DWrite.CreateTextFormat(family, null, FontWeight.Normal, DWFontStyle.Normal, FontStretch.Normal, size, "pt-br");
            f.TextAlignment = center ? TextAlignment.Center : TextAlignment.Leading;
            f.ParagraphAlignment = ParagraphAlignment.Center;
            f.WordWrapping = WordWrapping.NoWrap;
            if (trim)
            {
                var sign = DWrite.CreateEllipsisTrimmingSign(f);
                _signs.Add(sign);
                f.SetTrimming(new Trimming { Granularity = TrimmingGranularity.Character }, sign);
            }
            _formats[key] = f;
            return f;
        }

        public void Text(string text, IDWriteTextFormat format, float x, float y, float w, float h, Color4 c) =>
            _rt!.DrawText(text, format, new VRect(x, y, w, h), Brush(c), DrawTextOptions.Clip | DrawTextOptions.EnableColorFont);

        /// <summary>How wide a text is in a format, in DIP.</summary>
        public static float Measure(string text, IDWriteTextFormat format)
        {
            using var layout = DWrite.CreateTextLayout(text, format, 4000f, 200f);
            return layout.Metrics.WidthIncludingTrailingWhitespace;
        }

        /// <summary>A lucide SVG (stroke="currentColor") in a box, in an ink: "#rrggbb", or "rgba(0, 0, 0, 0.72)" for the dark ink on a light swatch.</summary>
        public bool Svg(string markup, string ink, float x, float y, float size)
        {
            if (_dc5 == null) return false;
            string key = ink + "|" + markup;
            if (!_svgs.TryGetValue(key, out var doc))
            {
                doc = null;
                string colored = ink.StartsWith("rgba", StringComparison.Ordinal)
                    ? markup.Replace("stroke=\"currentColor\"", "stroke=\"#000000\" stroke-opacity=\"0.72\"")
                    : markup.Replace("currentColor", ink);
                var bytes = Encoding.UTF8.GetBytes(colored);
                var ptr = DeckNative.SHCreateMemStream(bytes, (uint)bytes.Length);
                if (ptr != IntPtr.Zero)
                {
                    try
                    {
                        using var stream = new SharpGen.Runtime.Win32.ComStream(ptr);
                        doc = _dc5.CreateSvgDocument(stream, new VSize(24, 24));
                    }
                    catch (Exception ex) { DiagnosticLog.Warn($"Deck: an icon's SVG could not be read: {ex.GetType().Name}: {ex.Message}"); }
                }
                _svgs[key] = doc;
            }
            if (doc == null) return false;
            var before = _dc5.Transform;
            _dc5.Transform = Matrix3x2.CreateScale(size / 24f) * Matrix3x2.CreateTranslation(x, y) * before;
            _dc5.DrawSvgDocument(doc);
            _dc5.Transform = before;
            return true;
        }

        /// <summary>A picture file fitted in a box (a capture, a chosen image). False when it cannot be read.</summary>
        public bool Image(string path, float x, float y, float w, float h)
        {
            DateTime stamp;
            try { stamp = File.GetLastWriteTimeUtc(path); }
            catch { return false; }
            if (!_images.TryGetValue(path, out var entry) || entry.Stamp != stamp)
            {
                entry.Bitmap?.Dispose();
                entry = (LoadBitmap(path), stamp);
                _images[path] = entry;
            }
            var bmp = entry.Bitmap;
            if (bmp == null) return false;
            var size = bmp.Size;
            float k = Math.Min(w / size.Width, h / size.Height);
            float dw = size.Width * k, dh = size.Height * k;
            float dx = x + (w - dw) / 2f, dy = y + (h - dh) / 2f;
            _rt!.DrawBitmap(bmp, new RawRectF(dx, dy, dx + dw, dy + dh), 1f, BitmapInterpolationMode.Linear, null);
            return true;
        }

        private ID2D1Bitmap? LoadBitmap(string path)
        {
            try
            {
                using var source = new System.Drawing.Bitmap(path);
                var rect = new System.Drawing.Rectangle(0, 0, source.Width, source.Height);
                var data = source.LockBits(rect, System.Drawing.Imaging.ImageLockMode.ReadOnly, System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
                try
                {
                    return _rt!.CreateBitmap(new SizeI(source.Width, source.Height), data.Scan0, (uint)data.Stride,
                        new BitmapProperties(new DPixelFormat(Vortice.DXGI.Format.B8G8R8A8_UNorm, Vortice.DCommon.AlphaMode.Premultiplied)));
                }
                finally { source.UnlockBits(data); }
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Deck: the picture {Path.GetFileName(path)} could not be read: {ex.GetType().Name}: {ex.Message}");
                return null;
            }
        }

        private void DropTarget()
        {
            foreach (var b in _brushes.Values) b.Dispose();
            _brushes.Clear();
            foreach (var d in _svgs.Values) d?.Dispose();
            _svgs.Clear();
            foreach (var (b, _) in _images.Values) b?.Dispose();
            _images.Clear();
            _dc5?.Dispose();
            _dc5 = null;
            _rt?.Dispose();
            _rt = null;
        }

        private void DropDib()
        {
            if (_dc == IntPtr.Zero) return;
            DeckNative.SelectObject(_dc, _oldBmp);
            DeckNative.DeleteObject(_bmp);
            DeckNative.DeleteDC(_dc);
            _dc = _bmp = _oldBmp = IntPtr.Zero;
            Width = Height = 0;
        }

        public void Dispose()
        {
            DropTarget();
            foreach (var f in _formats.Values) f.Dispose();
            _formats.Clear();
            foreach (var s in _signs) s.Dispose();
            _signs.Clear();
            DropDib();
        }
    }
}
