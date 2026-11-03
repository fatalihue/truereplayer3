using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using TrueReplayer.Interop;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Security.Cryptography;

namespace TrueReplayer.Services
{
    /// <summary>One recognised word. <see cref="Rect"/> is ABSOLUTE on the virtual screen.</summary>
    public sealed record OcrWord(string Text, Rectangle Rect);

    public sealed record OcrLine(string Text, IReadOnlyList<OcrWord> Words);

    /// <summary>
    /// What one read produced. <see cref="Text"/> is the lines joined with "\n". <see cref="Variant"/>
    /// names the preprocessing that produced it (for the Test read card and the log);
    /// <see cref="PreviewPng"/> is only filled when the caller asked for it.
    /// </summary>
    public sealed record OcrRead(string Text, IReadOnlyList<OcrLine> Lines, int ElapsedMs, string Variant, string Language)
    {
        public byte[]? PreviewPng { get; init; }
        public static OcrRead Empty(string variant, string language, int ms) => new("", Array.Empty<OcrLine>(), ms, variant, language);
    }

    /// <summary>
    /// <see cref="TextColor"/>: read only pixels near this colour (per-channel <see cref="ColorTolerance"/>);
    /// the lever for game HUDs drawn over a busy scene. <see cref="Number"/> turns on the short-token
    /// booster even when the plain variants did read something but no digit.
    /// </summary>
    public sealed record OcrOptions(bool Number = false, Color? TextColor = null, int ColorTolerance = OcrService.DefaultColorTolerance, bool WantPreview = false);

    /// <summary>No OCR language is installed (or the engine refused to start) — never a silent false.</summary>
    public sealed class OcrUnavailableException : Exception
    {
        public OcrUnavailableException(string message) : base(message) { }
    }

    /// <summary>
    /// The ONE OCR engine of the app (Windows.Media.Ocr: no payload, local, already in the TFM). Every
    /// consumer — Wait for Text, the Screen Text condition, Set Variable's Screen mode, the automation
    /// watcher, the Test read button and the Copy-screen-text hotkey — goes through here.
    ///
    /// Measured on this machine before it was written (synthetic images, 2026-10-11):
    ///   • ONE OcrEngine refuses a second concurrent RecognizeAsync ("Another RecognizeAsync operation is
    ///     already running", COMException) — hence the per-language pool; creating one costs ~0.1 ms.
    ///   • 2× bicubic is the sweet spot for UI text (13 px: 0 % raw → 81 %); a luminance stretch rescues
    ///     low contrast (24 % → 59 %); a colour key at the text colour rescues HUD text over a scene
    ///     (21 % → 68 % at 3×).
    ///   • Tokens of one or two glyphs ("7", "x3") come back EMPTY at any size; composing a known label
    ///     beside the crop ("Value: 7") makes the engine read them — the short-token booster below.
    ///   • A 1920×1080 read costs ~440 ms, a 300×60 one ~3 ms: regions matter.
    /// </summary>
    public static class OcrService
    {
        /// <summary>Per-channel distance for the text-colour key (±120 Euclidean measured ≈ ±70 per channel).</summary>
        public const int DefaultColorTolerance = 70;

        // Regions taller than this skip the short-token booster: a lone glyph in a big region is not the
        // case it exists for, and composing a label beside a whole window only adds noise.
        private const int BoosterMaxHeight = 80;

        // Drawn into the image for the engine to read beside the token, never shown: it is not text of
        // the interface and does not follow its language (the booster was measured with this label).
        private const string BoosterLabel = "Value:";

        /// <summary>The language a new install (and Reset) reads with — AppSettings.OcrLanguage's default.</summary>
        public const string DefaultLanguage = "pt-BR";

        /// <summary>
        /// The languages Settings always lists, installed or not: Português (the default) and English
        /// (what most game and app UIs are written in). Also the only packs <see cref="InstallLanguageAsync"/>
        /// adds — any other installed pack is listed as Windows reports it.
        /// </summary>
        public static readonly IReadOnlyList<(string Tag, string Name)> OfferedLanguages = new[]
        {
            ("pt-BR", "Português (Brasil)"),
            ("en-US", "English (United States)"),
        };

        /// <summary>Settings → App → Screen text. "" = Auto (the user's profile languages).</summary>
        public static string PreferredLanguage
        {
            get => _preferredLanguage;
            set
            {
                var v = value ?? "";
                if (v == _preferredLanguage) return;
                _preferredLanguage = v;
                InvalidateLanguage(); // re-resolve on next use; the pools stay keyed by tag
            }
        }
        private static string _preferredLanguage = DefaultLanguage;
        private static string? _resolvedTag;
        private static readonly object _resolveLock = new();
        private static readonly ConcurrentDictionary<string, ConcurrentBag<OcrEngine>> _pools = new(StringComparer.OrdinalIgnoreCase);

        /// <summary>
        /// The error of every read with no OCR language, in the interface's language: where to install
        /// one, in this app's Settings and in Windows' (i18n/*/engine-ocr.ts).
        /// </summary>
        public static string NoLanguageMessage => S.OcrNoLanguage;

        /// <summary>
        /// Drops the resolved tag so the next read asks Windows again. The resolution is cached for the
        /// watcher's sake (it reads every tick), which also means a pack added while the app runs was
        /// never picked up: the Settings tab calls this whenever it lists the languages, and so does a
        /// finished install.
        /// </summary>
        public static void InvalidateLanguage()
        {
            lock (_resolveLock) _resolvedTag = null;
        }

        /// <summary>
        /// Installed recognizer languages, tag + NATIVE name ("English (United States)", "Deutsch
        /// (Deutschland)"). Not DisplayName: that one is in the Windows UI language, so on a pt-BR
        /// Windows an installed en-US pack read "Inglês" while the same language offered but not
        /// installed read "English" — one language, two names, depending on the pack. Empty when none.
        /// </summary>
        public static IReadOnlyList<(string Tag, string Name)> AvailableLanguages()
        {
            try
            {
                return OcrEngine.AvailableRecognizerLanguages
                    .Select(l => (l.LanguageTag, l.NativeName))
                    .ToList();
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"[OCR] could not list recognizer languages: {ex.Message}");
                return Array.Empty<(string, string)>();
            }
        }

        /// <summary>The tag Auto resolves to on this machine (null = no OCR language at all).</summary>
        public static string? AutoLanguageTag()
        {
            try
            {
                var e = OcrEngine.TryCreateFromUserProfileLanguages();
                if (e != null) return e.RecognizerLanguage.LanguageTag;
                return OcrEngine.AvailableRecognizerLanguages.FirstOrDefault()?.LanguageTag;
            }
            catch { return null; }
        }

        /// <summary>
        /// The tag a read uses right now: the chosen pack when it is installed, else Auto (null = no
        /// OCR language at all). Never cached and never throws — the Settings note reads it, so the
        /// panel says exactly what a read will do, from the same rule <see cref="ResolveTag"/> applies.
        /// </summary>
        public static string? EffectiveLanguageTag() => Resolve(_preferredLanguage, log: false);

        private static string? Resolve(string preferred, bool log)
        {
            if (!string.IsNullOrWhiteSpace(preferred))
            {
                try
                {
                    if (OcrEngine.IsLanguageSupported(new Windows.Globalization.Language(preferred)))
                        return preferred;
                    if (log) DiagnosticLog.Warn($"[OCR] language '{preferred}' is not installed — using Auto");
                }
                catch { /* malformed tag → Auto */ }
            }
            return AutoLanguageTag();
        }

        private static string ResolveTag()
        {
            lock (_resolveLock)
            {
                if (_resolvedTag != null) return _resolvedTag;
                var tag = Resolve(_preferredLanguage, log: true);
                if (tag == null) throw new OcrUnavailableException(NoLanguageMessage);
                _resolvedTag = tag;
                return tag;
            }
        }

        /// <summary>What an install ended with. <see cref="RestartApp"/>: Windows says it is installed
        /// but this process's engine does not list it yet. <see cref="Error"/> is shown as is.</summary>
        public sealed record InstallResult(bool Ok, bool Canceled = false, bool RestartApp = false, bool RestartWindows = false, string? Error = null);

        /// <summary>
        /// Adds the Windows OCR pack for <paramref name="tag"/>, one of <see cref="OfferedLanguages"/>:
        /// the optional capability Language.OCR~~~tag~0.0.1.0, through DISM. Only the OCR pack — the
        /// language does not join the user's language list, so no keyboard layout appears. DISM needs
        /// admin, so it runs elevated: Windows asks (UAC) unless TrueReplayer already is. The pack comes
        /// from Windows Update; a PC with no route to it (offline, a WSUS policy without Features on
        /// Demand) fails with DISM's own code, which the message carries.
        /// </summary>
        public static Task<InstallResult> InstallLanguageAsync(string tag) => Task.Run(async () =>
        {
            var offered = OfferedLanguages.FirstOrDefault(l => string.Equals(l.Tag, tag, StringComparison.OrdinalIgnoreCase));
            // The errors below follow a colon on the page ("Couldn't install …: {error}"), in the
            // interface's language (i18n/*/engine-ocr.ts, install).
            if (offered.Tag == null) return new InstallResult(false, Error: S.OcrInstallNotOffered(tag: tag, app: AppIdentity.DisplayName));
            string capability = $"Language.OCR~~~{offered.Tag}~0.0.1.0";
            var psi = new ProcessStartInfo
            {
                FileName = Path.Combine(Environment.SystemDirectory, "dism.exe"),
                Arguments = $"/Online /Add-Capability /CapabilityName:{capability} /NoRestart /Quiet",
                // ShellExecute is what carries the runas verb; it also blocks this thread while the
                // UAC prompt is up, which is why the whole install runs on the pool.
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            DiagnosticLog.Info($"[OCR] installing {capability}");
            int code;
            try
            {
                using var p = Process.Start(psi);
                if (p == null) return new InstallResult(false, Error: S.OcrInstallDismNotStarted);
                // An elevated DISM cannot be killed from here; on a timeout it is only no longer waited on.
                using var cts = new CancellationTokenSource(TimeSpan.FromMinutes(20));
                await p.WaitForExitAsync(cts.Token);
                code = p.ExitCode;
            }
            catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223) // ERROR_CANCELLED: UAC declined
            {
                DiagnosticLog.Info("[OCR] install canceled at the permission prompt");
                return new InstallResult(false, Canceled: true);
            }
            catch (OperationCanceledException)
            {
                DiagnosticLog.Warn($"[OCR] {capability}: DISM still running after 20 minutes — no longer waiting");
                return new InstallResult(false, Error: S.OcrInstallStillInstalling);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Error($"[OCR] {capability}: DISM could not start", ex);
                return new InstallResult(false, Error: S.Reason(ex));
            }

            const int RebootRequired = 3010; // ERROR_SUCCESS_REBOOT_REQUIRED
            if (code != 0 && code != RebootRequired)
            {
                DiagnosticLog.Warn($"[OCR] {capability}: DISM exit 0x{(uint)code:X8}");
                return new InstallResult(false, Error: S.OcrInstallFailed(code: ((uint)code).ToString("X8", System.Globalization.CultureInfo.InvariantCulture)));
            }
            InvalidateLanguage();
            bool listed = false;
            try { listed = OcrEngine.IsLanguageSupported(new Windows.Globalization.Language(offered.Tag)); } catch { }
            DiagnosticLog.Info($"[OCR] {capability} installed (exit {code}); engine lists it: {listed}");
            return new InstallResult(true, RestartApp: !listed, RestartWindows: code == RebootRequired);
        });

        private static OcrEngine Rent(out string tag)
        {
            tag = ResolveTag();
            var bag = _pools.GetOrAdd(tag, _ => new ConcurrentBag<OcrEngine>());
            if (bag.TryTake(out var engine)) return engine;
            engine = OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language(tag));
            if (engine == null) throw new OcrUnavailableException(NoLanguageMessage);
            return engine;
        }

        private static void Return(string tag, OcrEngine engine) =>
            _pools.GetOrAdd(tag, _ => new ConcurrentBag<OcrEngine>()).Add(engine);

        /// <summary>
        /// Captures <paramref name="regionAbs"/> (null = the whole virtual screen) and reads it.
        /// <paramref name="accept"/> stops the variant ladder at the first read it likes (a condition
        /// passes the matcher; a read passes "got something"). Throws <see cref="OcrUnavailableException"/>.
        /// </summary>
        public static async Task<OcrRead> ReadAsync(Rectangle? regionAbs, OcrOptions options, Func<OcrRead, bool>? accept, CancellationToken ct)
        {
            Rectangle r;
            if (regionAbs is Rectangle given && given.Width > 0 && given.Height > 0)
            {
                // Clip to the desktop: CopyFromScreen of an off-desktop strip returns black, which reads
                // as "nothing" and would hide a real region mistake. An empty intersection is no read.
                var (vx, vy, vw, vh) = NativeMethods.VirtualScreen.Bounds;
                r = Rectangle.Intersect(given, new Rectangle(vx, vy, vw, vh));
                if (r.Width <= 0 || r.Height <= 0)
                    return OcrRead.Empty(S.OcrVariantOffScreen, "", 0);
            }
            else
            {
                var (vx, vy, vw, vh) = NativeMethods.VirtualScreen.Bounds;
                r = new Rectangle(vx, vy, vw, vh);
            }
            using var bmp = ScreenCaptureService.CaptureRegion(r.X, r.Y, r.Width, r.Height);
            return await ReadBitmapAsync(bmp, new Point(r.X, r.Y), options, accept, ct);
        }

        /// <summary>
        /// Reads an already-captured bitmap whose top-left sits at <paramref name="originAbs"/> on the
        /// virtual screen (the frozen crop of an insert, or a fresh capture). Word rects come back absolute.
        /// </summary>
        public static async Task<OcrRead> ReadBitmapAsync(Bitmap source, Point originAbs, OcrOptions options, Func<OcrRead, bool>? accept, CancellationToken ct)
        {
            var sw = Stopwatch.StartNew();
            var engine = Rent(out var tag);
            try
            {
                // The names are what the Test read card shows beside the time, in the interface's
                // language (i18n/*/engine-ocr.ts, variant); the booster's is a whole name of its own.
                var variants = new List<(string name, int scale, bool stretch, bool key)>();
                string boosterName;
                if (options.TextColor is Color)
                {
                    variants.Add((S.OcrVariantTripleKey, 3, false, true));
                    variants.Add((S.OcrVariantDoubleKey, 2, false, true));
                    boosterName = S.OcrVariantTripleKeyLabel;
                }
                else
                {
                    variants.Add((S.OcrVariantDouble, 2, false, false));
                    variants.Add((S.OcrVariantDoubleStretch, 2, true, false));
                    boosterName = S.OcrVariantDoubleLabel;
                }

                // With no caller predicate, a read is good when it read something — and in Number mode
                // when that something holds a digit. Without the second half a ladder that read "HP"
                // and dropped the lone "7" stopped right there and never reached the booster that
                // exists for exactly that (Test read with no operand, a Changes wait on a number).
                Func<OcrRead, bool> isGood = accept ?? (r => r.Text.Length > 0 && (!options.Number || r.Text.Any(char.IsDigit)));
                OcrRead? best = null;
                Bitmap? bestImage = null;
                try
                {
                    foreach (var v in variants)
                    {
                        ct.ThrowIfCancellationRequested();
                        double scale = FitScale(source.Width, source.Height, v.scale);
                        var prepared = Prepare(source, scale, v.stretch, v.key ? options.TextColor : null, options.ColorTolerance);
                        OcrRead read;
                        bool good;
                        // The prepared image is owned here until it is kept or finished; a throw from the
                        // engine or from the predicate (a regex timeout, a non-number operand) must not
                        // leave a 2-3x bitmap to the finalizer on every watcher tick.
                        try
                        {
                            read = await RecognizeAsync(engine, prepared, scale, 0, originAbs, v.name, tag);
                            good = isGood(read);
                        }
                        catch { prepared.Dispose(); throw; }
                        if (good)
                        {
                            bestImage?.Dispose();
                            return Finish(read with { ElapsedMs = (int)sw.ElapsedMilliseconds }, prepared, options);
                        }
                        if (best == null || read.Text.Length > best.Text.Length)
                        {
                            bestImage?.Dispose();
                            best = read; bestImage = prepared;
                        }
                        else prepared.Dispose();
                    }

                    // Short-token booster: the engine drops lone one/two-glyph tokens. Only for small
                    // regions, and only when the ladder found nothing (Text) or no digit (Number).
                    bool wantBooster = source.Height <= BoosterMaxHeight
                        && (best == null || best.Text.Length == 0 || (options.Number && !best.Text.Any(char.IsDigit)));
                    if (wantBooster)
                    {
                        ct.ThrowIfCancellationRequested();
                        var v = variants[0];
                        double scale = FitScale(source.Width + source.Height * 4, source.Height, v.scale);
                        using var keyed = Prepare(source, 1, v.stretch, v.key ? options.TextColor : null, options.ColorTolerance);
                        var (composed, labelWidth) = ComposeWithLabel(keyed);
                        using (composed)
                        {
                            var scaled = Prepare(composed, scale, false, null, 0);
                            OcrRead read;
                            bool good;
                            try
                            {
                                read = await RecognizeAsync(engine, scaled, scale, labelWidth, originAbs, boosterName, tag);
                                good = isGood(read);
                            }
                            catch { scaled.Dispose(); throw; }
                            if (good || read.Text.Length > (best?.Text.Length ?? 0))
                            {
                                bestImage?.Dispose();
                                best = read; bestImage = scaled;
                                if (good) { bestImage = null; return Finish(read with { ElapsedMs = (int)sw.ElapsedMilliseconds }, scaled, options); }
                            }
                            else scaled.Dispose();
                        }
                    }

                    var final = (best ?? OcrRead.Empty(variants[0].name, tag, 0)) with { ElapsedMs = (int)sw.ElapsedMilliseconds };
                    if (bestImage != null)
                    {
                        var withPreview = Finish(final, bestImage, options);
                        bestImage = null;
                        return withPreview;
                    }
                    return final;
                }
                finally
                {
                    bestImage?.Dispose();
                }
            }
            finally
            {
                Return(tag, engine);
            }
        }

        // Attaches the preview (when asked) and disposes the prepared image.
        private static OcrRead Finish(OcrRead read, Bitmap prepared, OcrOptions options)
        {
            try
            {
                if (!options.WantPreview) return read;
                return read with { PreviewPng = EncodePreview(prepared) };
            }
            finally { prepared.Dispose(); }
        }

        // Whole numbers while the image fits (2×, then 1×); below 1× only when even the source is over
        // the engine's limit — a whole-screen read on a virtual desktop wider than ~10000 px (three 4K
        // monitors), which RecognizeAsync would otherwise reject.
        private static double FitScale(int w, int h, int wanted)
        {
            int max = 10000;
            try { max = (int)OcrEngine.MaxImageDimension; } catch { }
            int s = wanted;
            while (s > 1 && ((long)w * s > max || (long)h * s > max)) s--;
            if (w <= max && h <= max) return s;
            return Math.Min((double)max / w, (double)max / h) * 0.999;
        }

        private static async Task<OcrRead> RecognizeAsync(OcrEngine engine, Bitmap image, double scale, int labelWidthSrc, Point originAbs, string variant, string tag)
        {
            using var soft = ToSoftwareBitmap(image);
            var result = await engine.RecognizeAsync(soft);
            var lines = new List<OcrLine>();
            double labelEdge = labelWidthSrc * scale;
            foreach (var line in result.Lines)
            {
                var words = new List<OcrWord>();
                foreach (var w in line.Words)
                {
                    var b = w.BoundingRect;
                    // With the booster the composed label sits left of the crop: its words end before
                    // the crop starts, so they are dropped here and every kept rect shifts back.
                    if (labelWidthSrc > 0 && b.X + b.Width / 2 < labelEdge) continue;
                    int x = (int)Math.Round(b.X / scale) - labelWidthSrc + originAbs.X;
                    int y = (int)Math.Round(b.Y / scale) + originAbs.Y;
                    int ww = Math.Max(1, (int)Math.Round(b.Width / scale));
                    int hh = Math.Max(1, (int)Math.Round(b.Height / scale));
                    words.Add(new OcrWord(w.Text, new Rectangle(x, y, ww, hh)));
                }
                if (words.Count > 0)
                    lines.Add(new OcrLine(string.Join(" ", words.Select(x => x.Text)), words));
            }
            var text = string.Join("\n", lines.Select(l => l.Text));
            return new OcrRead(text, lines, 0, variant, tag);
        }

        /// <summary>
        /// Scales (bicubic), optionally stretches luminance, optionally keys on a colour. The result is
        /// always a fresh Format32bppArgb bitmap the caller owns.
        /// </summary>
        private static Bitmap Prepare(Bitmap src, double scale, bool stretch, Color? key, int tolerance)
        {
            var dst = new Bitmap(Math.Max(1, (int)(src.Width * scale)), Math.Max(1, (int)(src.Height * scale)), PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(dst))
            {
                g.InterpolationMode = scale == 1 ? InterpolationMode.NearestNeighbor : InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.DrawImage(src, new Rectangle(0, 0, dst.Width, dst.Height));
            }
            if (!stretch && key is null) return dst;

            var data = dst.LockBits(new Rectangle(0, 0, dst.Width, dst.Height), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
            try
            {
                var buf = new byte[data.Stride * dst.Height];
                Marshal.Copy(data.Scan0, buf, 0, buf.Length);
                if (key is Color c)
                {
                    int tol = Math.Clamp(tolerance, 0, 255);
                    for (int i = 0; i < buf.Length; i += 4)
                    {
                        bool hit = Math.Abs(buf[i] - c.B) <= tol && Math.Abs(buf[i + 1] - c.G) <= tol && Math.Abs(buf[i + 2] - c.R) <= tol;
                        byte v = hit ? (byte)0 : (byte)255;
                        buf[i] = buf[i + 1] = buf[i + 2] = v;
                        buf[i + 3] = 255;
                    }
                }
                else
                {
                    byte lo = 255, hi = 0;
                    for (int i = 0; i < buf.Length; i += 4)
                    {
                        byte l = Lum(buf, i);
                        if (l < lo) lo = l;
                        if (l > hi) hi = l;
                    }
                    double k = hi > lo ? 255.0 / (hi - lo) : 1;
                    for (int i = 0; i < buf.Length; i += 4)
                    {
                        byte v = (byte)Math.Clamp((Lum(buf, i) - lo) * k, 0, 255);
                        buf[i] = buf[i + 1] = buf[i + 2] = v;
                        buf[i + 3] = 255;
                    }
                }
                Marshal.Copy(buf, 0, data.Scan0, buf.Length);
            }
            finally { dst.UnlockBits(data); }
            return dst;
        }

        private static byte Lum(byte[] buf, int i) => (byte)((buf[i] * 29 + buf[i + 1] * 150 + buf[i + 2] * 77) >> 8);

        /// <summary>
        /// Draws the known label to the left of the crop, sized to the crop's height and in the colour
        /// that contrasts with the crop's own background (read from its corner). Returns the composite
        /// and the label's width in source pixels.
        /// </summary>
        private static (Bitmap composed, int labelWidth) ComposeWithLabel(Bitmap crop)
        {
            var bg = crop.GetPixel(0, 0);
            bool darkBg = (bg.R * 77 + bg.G * 150 + bg.B * 29) >> 8 < 128;
            var fg = darkBg ? Color.White : Color.Black;
            float px = Math.Max(8f, crop.Height * 0.6f);
            using var font = new Font("Segoe UI", px, GraphicsUnit.Pixel);
            int labelW;
            using (var tmp = new Bitmap(1, 1))
            using (var tg = Graphics.FromImage(tmp))
                labelW = (int)Math.Ceiling(tg.MeasureString(BoosterLabel + " ", font).Width) + 4;
            var composed = new Bitmap(labelW + crop.Width, crop.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(composed))
            {
                g.Clear(bg);
                g.TextRenderingHint = TextRenderingHint.AntiAliasGridFit;
                using var brush = new SolidBrush(fg);
                var size = g.MeasureString(BoosterLabel, font);
                g.DrawString(BoosterLabel, font, brush, 2, Math.Max(0, (crop.Height - size.Height) / 2));
                g.DrawImageUnscaled(crop, labelW, 0);
            }
            return (composed, labelW);
        }

        private static SoftwareBitmap ToSoftwareBitmap(Bitmap bmp)
        {
            var data = bmp.LockBits(new Rectangle(0, 0, bmp.Width, bmp.Height), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
            try
            {
                var bytes = new byte[data.Stride * bmp.Height];
                Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);
                var buffer = CryptographicBuffer.CreateFromByteArray(bytes);
                return SoftwareBitmap.CreateCopyFromBuffer(buffer, BitmapPixelFormat.Bgra8, bmp.Width, bmp.Height, BitmapAlphaMode.Premultiplied);
            }
            finally { bmp.UnlockBits(data); }
        }

        /// <summary>PNG of what the engine saw, capped at 600×200 so a Test-read card never ships a screenshot.</summary>
        private static byte[] EncodePreview(Bitmap prepared)
        {
            double k = Math.Min(1.0, Math.Min(600.0 / prepared.Width, 200.0 / prepared.Height));
            int w = Math.Max(1, (int)(prepared.Width * k)), h = Math.Max(1, (int)(prepared.Height * k));
            using var small = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(small))
            {
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.DrawImage(prepared, new Rectangle(0, 0, w, h));
            }
            using var ms = new MemoryStream();
            small.Save(ms, ImageFormat.Png);
            return ms.ToArray();
        }
    }
}
