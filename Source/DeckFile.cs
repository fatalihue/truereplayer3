using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.Json;

namespace TrueReplayer.Services
{
    /// <summary>
    /// The .trdeck file (branch deck; plan .claude/planos/deck-2026-11-19.md, Fase 7): a zip with deck.json — a
    /// deck.json of its own, with only the decks it carries (never the Deck's own settings: the captures, the
    /// press while a macro runs, the hotkey of every deck are this PC's) — and images/, the pictures its buttons
    /// show (Deck\images). The macros its buttons run do not go: a button names its macro, and finds it in the
    /// library it lands in, or shows it missing.
    ///
    /// Reading is defensive: a file of at most 16 MB, 300 entries, deck.json of 4 MB, pictures of 2 MB each, read
    /// into memory by name — no path of the archive is ever written to disk. deck.json goes through
    /// DeckService.Normalize, and a picture is kept only when it decodes as one (DeckImages fits it again). Fase 8: a
    /// picture is a PNG (what an export writes) of at most 4096 px a side, told by its header before any decoding,
    /// and the pictures read add up to 32 MB at most.
    /// </summary>
    internal static class DeckFile
    {
        public const string Extension = ".trdeck";
        private const string JsonEntry = "deck.json", ImagesFolder = "images/";
        private const long MaxFileBytes = 16L * 1024 * 1024, MaxJsonBytes = 4L * 1024 * 1024, MaxImageBytes = 2L * 1024 * 1024;
        private const int MaxEntries = 300;
        private const long MaxImagesTotalBytes = 32L * 1024 * 1024;
        private const int MaxImageSide = 4096;

        /// <summary>What a file holds once read: its decks, normalized, and the pictures they name, by name.</summary>
        public sealed record Parsed(string FileName, List<DeckService.Deck> Decks, Dictionary<string, byte[]> Images);

        /// <summary>A file name for a deck: its name without what a file name cannot hold.</summary>
        public static string FileNameFor(string deckName) => DeckService.MacroSafe(deckName) + Extension;

        /// <summary>
        /// The deck and its pictures into a .trdeck at <paramref name="path"/> (written beside it first, then moved
        /// over it). The pictures it names that are not in Deck\images any more are counted, and the buttons keep
        /// naming them (the importer drops what does not come).
        /// </summary>
        public static (int Images, int Missing) Write(string path, DeckService.Deck deck)
        {
            var copy = DeckService.CloneDeck(deck);
            var config = new DeckService.Config { Decks = { copy } };
            var names = DeckService.ImagesOf(copy).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            string temp = path + ".tmp-" + Guid.NewGuid().ToString("N")[..6];
            int images = 0, missing = 0;
            try
            {
                using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write))
                using (var zip = new ZipArchive(stream, ZipArchiveMode.Create))
                {
                    var json = zip.CreateEntry(JsonEntry, CompressionLevel.Optimal);
                    using (var w = new StreamWriter(json.Open(), new UTF8Encoding(false)))
                        w.Write(DeckService.ToJson(config));
                    foreach (var name in names)
                    {
                        var file = Path.Combine(DeckImages.DirPath, name);
                        if (!IsPlainName(name) || !File.Exists(file)) { missing++; continue; }
                        // A PNG is compressed already: stored as it is.
                        zip.CreateEntryFromFile(file, ImagesFolder + name, CompressionLevel.NoCompression);
                        images++;
                    }
                }
                File.Move(temp, path, overwrite: true);
            }
            finally
            {
                try { if (File.Exists(temp)) File.Delete(temp); } catch { /* the move took it, or nothing to clean */ }
            }
            return (images, missing);
        }

        /// <summary>
        /// A .trdeck read: its decks (normalized; none when it holds none) and the pictures they name. Null, with
        /// the reason in <paramref name="error"/>, when the file is not a deck of TR3 or cannot be read.
        /// </summary>
        public static Parsed? Read(string path, out string? error)
        {
            error = null;
            try
            {
                var info = new FileInfo(path);
                if (!info.Exists || info.Length == 0 || info.Length > MaxFileBytes) { error = S.DeckFileNotDeck; return null; }
                using var zip = ZipFile.OpenRead(path);
                if (zip.Entries.Count > MaxEntries) { error = S.DeckFileNotDeck; return null; }
                var jsonEntry = zip.Entries.FirstOrDefault(e => string.Equals(e.FullName, JsonEntry, StringComparison.OrdinalIgnoreCase));
                if (jsonEntry == null || jsonEntry.Length > MaxJsonBytes) { error = S.DeckFileNotDeck; return null; }
                DeckService.Config? raw;
                using (var reader = new StreamReader(jsonEntry.Open(), Encoding.UTF8))
                {
                    string text = ReadCapped(reader, MaxJsonBytes);
                    raw = DeckService.FromJsonText(text);
                }
                // "decks": null reads as a list that is not there (Fase 8: it gave a NullReferenceException's text).
                if (raw?.Decks == null || raw.Decks.Count == 0) { error = S.DeckFileNotDeck; return null; }
                var decks = DeckService.Normalize(raw).Decks;
                if (decks.Count == 0) { error = S.DeckFileNotDeck; return null; }

                var wanted = new HashSet<string>(decks.SelectMany(DeckService.ImagesOf), StringComparer.OrdinalIgnoreCase);
                var images = new Dictionary<string, byte[]>(StringComparer.OrdinalIgnoreCase);
                long total = 0;
                foreach (var entry in zip.Entries)
                {
                    if (!entry.FullName.StartsWith(ImagesFolder, StringComparison.OrdinalIgnoreCase)) continue;
                    string name = entry.FullName[ImagesFolder.Length..];
                    if (!IsPlainName(name) || !wanted.Contains(name) || images.ContainsKey(name) || entry.Length <= 0 || entry.Length > MaxImageBytes) continue;
                    if (total + entry.Length > MaxImagesTotalBytes) break;
                    // One picture that lies about its size, or is not a fair PNG, is left out; the deck still comes.
                    try
                    {
                        using var s = entry.Open();
                        using var ms = new MemoryStream();
                        CopyCapped(s, ms, MaxImageBytes);
                        var bytes = ms.ToArray();
                        if (!IsFairPng(bytes)) continue;
                        images[name] = bytes;
                        total += bytes.Length;
                    }
                    catch (InvalidDataException) { }
                }
                return new Parsed(Path.GetFileName(path), decks, images);
            }
            catch (InvalidDataException)
            {
                error = S.DeckFileNotDeck;
                return null;
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Deck: '{path}' could not be read: {ex.GetType().Name}: {ex.Message}");
                error = S.DeckFileUnreadable(S.Reason(ex));
                return null;
            }
        }

        /// <summary>A picture of the file kept in Deck\images under a name of its own (fitted again), or null when it is not a picture.</summary>
        public static string? KeepImage(byte[] bytes)
        {
            if (!IsFairPng(bytes)) return null;
            try
            {
                using var ms = new MemoryStream(bytes);
                using var image = Image.FromStream(ms, useEmbeddedColorManagement: false, validateImageData: true);
                return DeckImages.Save(image);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Deck: a picture of an imported deck was left out: {ex.GetType().Name}: {ex.Message}");
                return null;
            }
        }

        /// <summary>A PNG of at most 4096 px a side, by its signature and its IHDR — nothing decoded (Fase 8).</summary>
        internal static bool IsFairPng(byte[] b)
        {
            if (b.Length < 24) return false;
            ReadOnlySpan<byte> signature = stackalloc byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
            if (!b.AsSpan(0, 8).SequenceEqual(signature) || b[12] != (byte)'I' || b[13] != (byte)'H' || b[14] != (byte)'D' || b[15] != (byte)'R') return false;
            int w = BinaryPrimitives.ReadInt32BigEndian(b.AsSpan(16, 4));
            int h = BinaryPrimitives.ReadInt32BigEndian(b.AsSpan(20, 4));
            return w is > 0 and <= MaxImageSide && h is > 0 and <= MaxImageSide;
        }

        // A picture's name as DeckImages writes it: a file name, no folder, nothing that climbs out.
        private static bool IsPlainName(string name) =>
            name.Length is > 0 and <= 128 && name.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 && name != "." && name != "..";

        // The archive says how long an entry is, and a crafted one can lie: the reading stops at the cap either way.
        private static string ReadCapped(StreamReader reader, long max)
        {
            var sb = new StringBuilder();
            var buffer = new char[8192];
            int n;
            while ((n = reader.Read(buffer, 0, buffer.Length)) > 0)
            {
                sb.Append(buffer, 0, n);
                if (sb.Length > max) throw new InvalidDataException("deck.json is too long");
            }
            return sb.ToString();
        }

        private static void CopyCapped(Stream from, Stream to, long max)
        {
            var buffer = new byte[81920];
            long total = 0;
            int n;
            while ((n = from.Read(buffer, 0, buffer.Length)) > 0)
            {
                total += n;
                if (total > max) throw new InvalidDataException("a picture is too large");
                to.Write(buffer, 0, n);
            }
        }
    }
}
