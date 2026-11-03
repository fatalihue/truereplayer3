using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Linq;
// ExternalException — the base GDI+ failure type Bitmap can surface for a damaged image.
using System.Runtime.InteropServices;

namespace TrueReplayer.Services
{
    public static class ImageStorageService
    {
        // Reference images live under Documents\TrueReplayer3\Images (AppIdentity.ImagesDir),
        // beside the macros that reference them. Not in %LocalAppData%\TrueReplayer3: an
        // uninstall deletes that folder whole, and a reinstall would find the macros in Documents
        // with every Wait Image broken. Not in Roaming either: large binary crops bloat the
        // roaming profile and slow domain logins.
        //
        // TrueReplayer 2 still moves images it once kept in Roaming; that migration is not
        // here: the Roaming folder it reads belongs to TrueReplayer 2, and this app never
        // writes there.
        private static string GetBaseDirectory() => AppIdentity.ImagesDir;

        public static string GetImageDirectory(string profileName)
        {
            return Path.Combine(GetBaseDirectory(), SanitizeFolderName(profileName));
        }

        /// <summary>
        /// Saves a reference image for a profile and returns the filename.
        /// </summary>
        public static string SaveReferenceImage(Bitmap image, string profileName)
        {
            string dir = GetImageDirectory(profileName);
            Directory.CreateDirectory(dir);

            string filename = $"wait-{Guid.NewGuid():N}.png";
            string fullPath = Path.Combine(dir, filename);

            // Write to a temp file and rename, instead of encoding straight into the final path.
            // Bitmap.Save streams the PNG out incrementally, so a process death partway through —
            // a Velopack update restarting the app, a crash, a full disk — used to leave a
            // TRUNCATED file sitting at the exact name an action already references. That file then
            // exists (File.Exists is true, so no caller treats it as missing) but cannot be decoded,
            // which is how LoadReferenceImage came to throw where its callers expected null. The
            // rename is the same temp+rename pattern FileHelper already gives profile writes; reuse
            // its retry so an antivirus scan of the freshly-written temp doesn't fail the save.
            //
            // The temp deliberately ends in ".png" so CleanupOrphanImages' startup sweep reaps any
            // leftover as an unreferenced image, and deliberately does NOT use the "wait-" prefix so
            // a half-written file can never be mistaken for a live reference by a human reading the
            // folder.
            string tempPath = Path.Combine(dir, $"partial-{Guid.NewGuid():N}.png");
            try
            {
                image.Save(tempPath, ImageFormat.Png);
                FileHelper.MoveAtomic(tempPath, fullPath);
            }
            catch
            {
                try { File.Delete(tempPath); } catch { }
                throw;
            }
            return filename;
        }

        /// <summary>
        /// A picture file the user chose as a reference image (Choose file…), saved as the profile's
        /// PNG like a capture: a JPEG, a BMP or a GIF comes out PNG, at its own size. Throws
        /// InvalidDataException, with a reason a person can read, for a file that is too big or is
        /// not a picture; anything else (an unreadable file, a failed save) throws as it is.
        /// </summary>
        public static string SaveReferenceImageFromFile(string path, string profileName)
        {
            long length = new FileInfo(path).Length;
            // The reasons below are the engine's own sentences, in the interface's language: the bridge
            // shows ex.Message (through S.Reason, which passes these through).
            if (length > MaxReferenceImageBytes)
                throw new InvalidDataException(S.ProfilesImageTooBig(max: S.Num(MaxReferenceImageBytes / (1024 * 1024)), size: S.Num(length / (1024 * 1024))));
            Bitmap picture;
            try
            {
                // Decoded from a copy in memory into a detached bitmap, as LoadReferenceImage does:
                // the file is not held open, and the bitmap outlives the stream.
                using var stream = new MemoryStream(File.ReadAllBytes(path));
                using var loaded = new Bitmap(stream);
                picture = new Bitmap(loaded);
            }
            catch (Exception ex) when (ex is ArgumentException || ex is OutOfMemoryException || ex is ExternalException)
            {
                throw new InvalidDataException(S.ProfilesImageNotPicture, ex);
            }
            using (picture) return SaveReferenceImage(picture, profileName);
        }

        /// <summary>
        /// The full path of a profile's reference image when it is on disk (Save image…), or null.
        /// </summary>
        public static string? GetReferenceImageFile(string profileName, string imagePath)
            => TryResolveImageFile(profileName, imagePath, out string fullPath) && File.Exists(fullPath) ? fullPath : null;

        /// <summary>
        /// Loads a reference image from the profile's image directory.
        /// </summary>
        public static Bitmap? LoadReferenceImage(string profileName, string imagePath)
        {
            if (!TryResolveImageFile(profileName, imagePath, out string fullPath)) return null;
            if (!File.Exists(fullPath)) return null;

            // Every caller — WaitImage and If-ImageFound in ActionExecution, the image-condition
            // watcher in TriggerService, the crop/test handlers in WebViewBridge — reads null as
            // "no usable reference image" and has a policy for it (WaitImage's is the OnTimeout
            // policy its comment already promises to apply to a PNG that is "missing/unreadable").
            // The method is even declared Bitmap?. But an undecodable file used to come out as a
            // THROW, not a null: GDI+ answers a truncated or non-PNG stream with ArgumentException,
            // and — a long-standing quirk, not a real allocation failure — with OutOfMemoryException
            // for image data it cannot parse. Neither ever reached the null branch, so the
            // "unreadable" half of that promise did not exist; the exception escaped into the replay
            // loop instead. Fail the way the callers were written for, and log so the file can be
            // found and re-captured.
            //
            // The read itself (File.ReadAllBytes) is included: a locked or vanished file is the same
            // "no usable image" answer, and racing File.Exists above cannot rule it out.
            try
            {
                // Load into a detached bitmap: System.Drawing.Bitmap keeps a reference to its
                // backing stream for its lifetime, so copy into an independent Bitmap before the
                // MemoryStream is disposed — otherwise later pixel access / Save throws GDI+ errors.
                using var stream = new MemoryStream(File.ReadAllBytes(fullPath));
                using var loaded = new Bitmap(stream);
                return new Bitmap(loaded);
            }
            catch (Exception ex) when (ex is ArgumentException
                                    || ex is OutOfMemoryException
                                    || ex is IOException
                                    || ex is UnauthorizedAccessException
                                    || ex is ExternalException)
            {
                try { DiagnosticLog.Info($"[Images] Reference image '{fullPath}' could not be decoded ({ex.GetType().Name}: {ex.Message}) — treated as missing. Truncated by an interrupted save, or not a PNG; re-capture it."); } catch { }
                return null;
            }
        }

        /// <summary>
        /// Reads a reference image as base64 (for embedding in export).
        /// </summary>
        public static string? ReadAsBase64(string profileName, string imagePath)
        {
            if (!TryResolveImageFile(profileName, imagePath, out string fullPath)) return null;
            if (!File.Exists(fullPath)) return null;

            return Convert.ToBase64String(File.ReadAllBytes(fullPath));
        }

        // PNG 8-byte signature. Imported reference images must be real PNGs within sane size
        // bounds — rejects an empty/oversized blob or a non-image payload smuggled in a hostile
        // .trprofile before it ever lands on disk.
        private static readonly byte[] PngSignature = { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A };
        // Covers a full-screen / multi-monitor PNG (the 50 MB base64 envelope cap decodes to ~37 MB);
        // rejects only genuinely absurd/oversized blobs. The same bound for a picture file chosen as
        // a reference image.
        private const long MaxReferenceImageBytes = 40 * 1024 * 1024;
        private static bool IsValidPng(byte[] bytes)
        {
            if (bytes.Length < 8 || bytes.Length > MaxReferenceImageBytes) return false;
            for (int i = 0; i < PngSignature.Length; i++)
                if (bytes[i] != PngSignature[i]) return false;
            return true;
        }

        /// <summary>
        /// True when a reference image already exists on disk for the profile. Used by import to
        /// avoid falsely flagging a WaitImage / If-ImageFound row as broken when an Overwrite
        /// re-import omits an image the receiver already has.
        /// </summary>
        public static bool ReferenceImageExists(string profileName, string untrustedName)
            => TryResolveImageFile(profileName, untrustedName, out var fullPath) && File.Exists(fullPath);

        /// <summary>
        /// Saves a base64-encoded image with a specific filename (for import with original name).
        /// </summary>
        /// Returns true if the image was written; false if the filename was rejected
        /// (traversal/invalid) or the base64 payload was malformed. The import counts the
        /// false returns to warn the user about reference images that didn't restore,
        /// instead of the action silently pointing at a missing PNG.
        public static bool SaveFromBase64(string base64Data, string profileName, string filename)
        {
            // filename originates from an imported .trprofile (untrusted). Resolve it to a
            // sanitized path inside the profile's image dir, rejecting traversal/invalid names.
            // The same Path.GetFileName reduction runs on the read side (LoadReferenceImage et
            // al.), so a name like "..\\x.png" maps to "x.png" consistently and the action's
            // ImagePath still resolves after import.
            if (!TryResolveImageFile(profileName, filename, out string fullPath)) return false;

            // The payload must BE a PNG (IsValidPng below) but the NAME was unconstrained, so an
            // envelope could ask for "payload.dll" and get a file whose bytes start with \x89PNG
            // written into the profile's image folder. Nothing loads that folder and the content is
            // still a PNG, so this is not code execution — the real cost is that it becomes
            // permanent litter: CleanupOrphanImages only enumerates "*.png", so the startup sweep
            // never reaps it, and even deleting the profile leaves it behind unless the whole
            // directory goes. Every reference image this app writes is a .png; requiring the
            // extension costs nothing and keeps the folder to one file type.
            if (!fullPath.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            {
                try { DiagnosticLog.Info($"[Images] Rejected '{filename}': reference images must be .png."); } catch { }
                return false;
            }

            Directory.CreateDirectory(GetImageDirectory(profileName));
            // base64Data is untrusted import data and this runs once per image inside
            // ConfirmImportAsync's loop. Swallow a malformed payload (log + skip this one
            // image) so one bad entry doesn't abort the rest of the import — but report it
            // via the return value so the import can surface a warning.
            try
            {
                var bytes = Convert.FromBase64String(base64Data);
                if (!IsValidPng(bytes)) { try { DiagnosticLog.Info($"[Images] Rejected '{filename}': not a valid PNG or out of size bounds."); } catch { } return false; }
                File.WriteAllBytes(fullPath, bytes);
                return true;
            }
            catch (Exception ex)
            {
                try { DiagnosticLog.Info($"[Images] Skipped '{filename}' with invalid base64 data: {ex.Message}"); } catch { }
                return false;
            }
        }

        /// <summary>
        /// Copies a reference image from one profile to another (or within the same profile)
        /// under a new GUID filename. Returns the new filename, or null if the source doesn't exist.
        /// </summary>
        public static string? CloneReferenceImage(string srcProfile, string srcImagePath, string dstProfile)
        {
            if (!TryResolveImageFile(srcProfile, srcImagePath, out string srcFullPath)) return null;
            if (!File.Exists(srcFullPath)) return null;

            string dstDir = GetImageDirectory(dstProfile);
            Directory.CreateDirectory(dstDir);

            string newFilename = $"wait-{Guid.NewGuid():N}.png";
            string dstFullPath = Path.Combine(dstDir, newFilename);
            try
            {
                File.Copy(srcFullPath, dstFullPath, overwrite: false);
                return newFilename;
            }
            catch
            {
                return null;
            }
        }

        /// <summary>
        /// Carries a profile's image directory over to its new name. Returns false when some
        /// file had to stay behind under the old name (each one is logged); CleanupOrphanImages
        /// re-homes those at the next start instead of deleting them, so false means "not yet",
        /// not "lost".
        ///
        /// This used to give up in three cases, all silently, and the startup sweep then read the
        /// old folder as a deleted profile's and erased every PNG in it:
        ///   • a case-only rename ("farm" → "Farm"), which NTFS calls the same folder — the
        ///     folder simply kept the old spelling;
        ///   • a new-name folder that already existed (a leftover of a deleted profile, or an
        ///     import that created it);
        ///   • a Directory.Move that threw (a file held open by the indexer, antivirus or an
        ///     Explorer preview).
        /// </summary>
        public static bool RenameProfileDirectory(string oldProfileName, string newProfileName)
        {
            string oldDir = GetImageDirectory(oldProfileName);
            string newDir = GetImageDirectory(newProfileName);

            if (string.Equals(oldDir, newDir, StringComparison.Ordinal)) return true;
            if (!Directory.Exists(oldDir)) return true;

            // Same folder to NTFS, so nothing is at stake but the spelling: every lookup (and
            // CleanupOrphanImages' own matching) ignores case. Re-spelled for tidiness; a failure
            // here costs nothing.
            if (string.Equals(oldDir, newDir, StringComparison.OrdinalIgnoreCase))
            {
                try { Directory.Move(oldDir, newDir); }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    try { DiagnosticLog.Info($"[Images] Case-only re-spelling of '{oldDir}' failed ({ex.Message}); the folder keeps its old spelling, which every lookup ignores."); } catch { }
                }
                return true;
            }

            if (!Directory.Exists(newDir))
            {
                try { Directory.Move(oldDir, newDir); return true; }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    try { DiagnosticLog.Info($"[Images] Moving '{oldDir}' to '{newDir}' failed ({ex.Message}); carrying the files one by one."); } catch { }
                }
            }

            // The folder could not move whole (the new one exists, or the move threw): carry file
            // by file. Move only, never copy — a rename is atomic, so a file is either complete
            // under the new name or still complete under the old one, never half-written.
            int left = 0;
            try
            {
                Directory.CreateDirectory(newDir);
                foreach (var file in Directory.EnumerateFiles(oldDir))
                {
                    string dest = Path.Combine(newDir, Path.GetFileName(file));
                    try
                    {
                        // Already there under the new name (GUID file names: the same image). Never
                        // overwritten; the stale copy is the startup sweep's to reap.
                        if (File.Exists(dest)) continue;
                        File.Move(file, dest);
                    }
                    catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                    {
                        left++;
                        try { DiagnosticLog.Info($"[Images] Could not carry '{file}' to '{newDir}': {ex.Message}. Re-homed at the next start."); } catch { }
                    }
                }
                if (left == 0)
                    try { Directory.Delete(oldDir); } catch { /* a stale duplicate, or held open — the sweep reaps it */ }
            }
            catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
            {
                try { DiagnosticLog.Info($"[Images] Carrying images from '{oldDir}' to '{newDir}' failed: {ex.Message}. Re-homed at the next start."); } catch { }
                return false;
            }
            return left == 0;
        }

        /// <summary>
        /// Deletes a profile's entire image directory. Best-effort.
        /// </summary>
        public static void DeleteProfileDirectory(string profileName)
        {
            string dir = GetImageDirectory(profileName);
            try { if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true); }
            catch { /* best effort */ }
        }

        /// <summary>
        /// Sweep at app startup: deletes PNGs in each profile's image directory that aren't
        /// referenced by any action across all profiles. Runs before any user-driven undo can
        /// happen so we never delete a file the in-memory undo stack still expects.
        /// referencedByProfile maps profileName → set of ImagePath filenames that should be kept.
        /// Profiles without an entry have all their PNGs deleted (and the dir if it ends up empty),
        /// except a PNG another profile references and lacks, which is moved to that profile.
        ///
        /// No-ops when no profile loaded: an empty map means the Profiles folder is missing (moved
        /// or renamed — the load just recreated it empty), empty, or every file in it failed to
        /// read, and sweeping against that erases every reference PNG the user has. Same posture
        /// as RunCursorService.PruneMissingProfiles. Orphans wait for a start with a profile in it.
        /// </summary>
        public static int CleanupOrphanImages(IReadOnlyDictionary<string, HashSet<string>> referencedByProfile, IReadOnlySet<string>? keepEntirelyFolders = null)
        {
            int deleted = 0;
            string baseDir = GetBaseDirectory();
            if (!Directory.Exists(baseDir)) return 0;
            if (referencedByProfile == null || referencedByProfile.Count == 0)
            {
                try { DiagnosticLog.Info("[Images] Orphan sweep skipped: no profile loaded, so every image stays."); } catch { }
                return 0;
            }

            // Re-keyed case-INSENSITIVELY whatever comparer the caller built with, because the
            // folder names below come from the disk and NTFS ignores case. An ordinal map missed
            // "farm" on disk against "Farm" in the profile list — a case-only rename, which keeps
            // the folder's spelling — and the whole folder was swept as a deleted profile's.
            var byFolder = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
            // Reference image → the folder(s) whose profile uses it. File names are GUIDs
            // ("wait-<guid>.png"), so a name found in a folder other than its owner's is that
            // owner's image, left behind under an old folder name.
            var ownersOf = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var kv in referencedByProfile)
            {
                if (!byFolder.TryGetValue(kv.Key, out var set))
                    byFolder[kv.Key] = set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                set.UnionWith(kv.Value);
                foreach (var image in kv.Value)
                {
                    if (!ownersOf.TryGetValue(image, out var owners)) ownersOf[image] = owners = new List<string>();
                    owners.Add(kv.Key);
                }
            }

            int rehomed = 0;
            foreach (var profileDir in Directory.EnumerateDirectories(baseDir))
            {
                string profileFolder = Path.GetFileName(profileDir);
                // profileFolder is sanitized; map back is not exact, but referencedByProfile keys
                // are sanitized via the same SanitizeFolderName used to write, so equivalent lookup.
                // A profile that FAILED to load (corrupt/half-written JSON) is recorded in
                // _loadFailures but has NO entry in referencedByProfile — without this skip its
                // entire image folder would be treated as orphaned and deleted, losing the user's
                // reference PNGs on a recoverable error. Keep such folders untouched.
                if (keepEntirelyFolders?.Contains(profileFolder) == true) continue;
                byFolder.TryGetValue(profileFolder, out var referenced);
                referenced ??= new HashSet<string>(StringComparer.OrdinalIgnoreCase);

                try
                {
                    foreach (var file in Directory.EnumerateFiles(profileDir, "*.png"))
                    {
                        string name = Path.GetFileName(file);
                        if (referenced.Contains(name)) continue;

                        // Before deleting, give it back to a profile that references it and lacks
                        // it: a rename whose folder could not be carried (RenameProfileDirectory),
                        // or a profile renamed in Explorer while the app was closed — nothing sees
                        // that one happen, so its images sat under the old name and this sweep
                        // used to erase them. A re-home that fails leaves the file where it is.
                        if (TryRehome(baseDir, file, name, profileFolder, ownersOf, out bool keep))
                        {
                            rehomed++;
                            continue;
                        }
                        if (keep) continue;

                        try { File.Delete(file); deleted++; }
                        catch { /* best effort */ }
                    }
                    // Remove empty profile directories left behind by deleted profiles whose
                    // referencedByProfile entry was missing entirely.
                    if (!byFolder.ContainsKey(profileFolder)
                        && !Directory.EnumerateFileSystemEntries(profileDir).Any())
                    {
                        try { Directory.Delete(profileDir); }
                        catch { /* best effort */ }
                    }
                }
                catch { /* best effort */ }
            }
            if (rehomed > 0)
                try { DiagnosticLog.Info($"[Images] Re-homed {rehomed} reference image(s) left under an old profile folder name."); } catch { }
            // The sweep deletes for good, and a startup that ate the user's images left no trace.
            if (deleted > 0)
                try { DiagnosticLog.Info($"[Images] Orphan sweep deleted {deleted} unreferenced image(s)."); } catch { }
            return deleted;
        }

        // Moves an image referenced by another profile into that profile's folder when the folder
        // lacks it. True when moved. `keep` is true when the file must stay put: an owner lacks it
        // but the move failed — deleting would destroy the only copy.
        private static bool TryRehome(string baseDir, string file, string name, string currentFolder,
            Dictionary<string, List<string>> ownersOf, out bool keep)
        {
            keep = false;
            if (!ownersOf.TryGetValue(name, out var owners)) return false;
            foreach (var owner in owners)
            {
                if (string.Equals(owner, currentFolder, StringComparison.OrdinalIgnoreCase)) continue;
                string ownerDir = Path.Combine(baseDir, owner);
                string dest = Path.Combine(ownerDir, name);
                if (File.Exists(dest)) continue;
                try
                {
                    Directory.CreateDirectory(ownerDir);
                    File.Move(file, dest);
                    try { DiagnosticLog.Info($"[Images] Re-homed '{name}' from '{currentFolder}' to '{owner}'."); } catch { }
                    return true;
                }
                catch (Exception ex) when (ex is IOException || ex is UnauthorizedAccessException)
                {
                    keep = true;
                    try { DiagnosticLog.Info($"[Images] Could not re-home '{name}' from '{currentFolder}' to '{owner}': {ex.Message}. Left in place."); } catch { }
                    return false;
                }
            }
            return false;
        }

        /// <summary>
        /// Returns the sanitized folder name actually used on disk for a profile. Useful when
        /// building the referenced-image map for CleanupOrphanImages so the keys line up with
        /// the directory names returned by enumeration.
        /// </summary>
        public static string GetSanitizedProfileFolder(string profileName) => SanitizeFolderName(profileName);

        /// <summary>
        /// Resolves an untrusted image file name to a full path guaranteed to live directly
        /// inside the profile's image directory. Strips directory components (defeats "..\\"
        /// and absolute-path traversal) and rejects names with invalid characters. Returns
        /// false (empty path) when the name can't be safely resolved.
        /// </summary>
        private static bool TryResolveImageFile(string profileName, string untrustedName, out string fullPath)
        {
            fullPath = string.Empty;
            if (string.IsNullOrEmpty(untrustedName)) return false;

            // Reduce to a bare file name: "..\\..\\evil.png" -> "evil.png", "C:\\x\\y.png" -> "y.png".
            string safeName = Path.GetFileName(untrustedName);
            if (string.IsNullOrEmpty(safeName)) return false;
            if (safeName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0) return false;

            string dir = GetImageDirectory(profileName);
            string candidate = Path.Combine(dir, safeName);

            // Defense in depth: confirm the resolved path stays under the image directory.
            string canonicalDir = Path.GetFullPath(dir);
            if (!canonicalDir.EndsWith(Path.DirectorySeparatorChar))
                canonicalDir += Path.DirectorySeparatorChar;
            if (!Path.GetFullPath(candidate).StartsWith(canonicalDir, StringComparison.OrdinalIgnoreCase))
                return false;

            fullPath = candidate;
            return true;
        }

        // Path.GetInvalidFileNameChars() allocates a FRESH char[] on every call (it hands out a copy
        // so callers cannot mutate the framework's own array), and SanitizeFolderName runs twice per
        // TryResolveImageFile. One copy, taken once.
        private static readonly char[] InvalidFileNameChars = Path.GetInvalidFileNameChars();

        private static string SanitizeFolderName(string name)
        {
            // The overwhelmingly common case is a name with no invalid char at all, and IndexOfAny
            // answers that in one pass instead of 41 string.Replace calls (each of which allocates
            // whether or not it replaced anything).
            if (name.IndexOfAny(InvalidFileNameChars) >= 0)
            {
                foreach (char c in InvalidFileNameChars)
                    name = name.Replace(c, '_');
            }

            // '.' and ' ' are NOT in Path.GetInvalidFileNameChars(), so "." and ".." come through
            // the loop completely untouched — and this is the ONLY guard the folder name ever gets.
            // TryResolveImageFile's containment check protects the FILE name; every caller of
            // GetImageDirectory (SaveReferenceImage, CloneReferenceImage, RenameProfileDirectory,
            // DeleteProfileDirectory, GetSanitizedProfileFolder) feeds the folder straight into
            // Path.Combine with no check of its own. Verified against the real APIs:
            //   Combine(...\Images, "..")  -> Documents\TrueReplayer3
            //   Combine(...\Images, ".")   -> Documents\TrueReplayer3\Images
            //   Combine(...\Images, "")    -> Documents\TrueReplayer3\Images
            //   Combine(...\Images, "   ") -> Documents\TrueReplayer3\Images\  (spaces stripped)
            // so DeleteProfileDirectory("..") is Directory.Delete(recursive: true) on the user's
            // whole data root — the macros themselves, Images, settings, remaps, run cursors,
            // automation stats, Backups — and "." / "" / "   " wipe the whole Images tree.
            //
            // ProfileNameValidator.IsSafe rejects "." and "..", so this is NOT reachable from an
            // imported .trprofile (import also always writes entry.Name + ".json"). But the
            // validator does not OWN this path, and its own comment claims coverage it cannot give:
            // a file literally named "...json" dropped into the Profiles directory by a zip
            // extraction, a cloud-sync artefact or a manual copy is perfectly legal on NTFS (no
            // trailing dot, no invalid char), matches LoadProfileListAsync's "*.json" enumeration,
            // and Path.GetFileNameWithoutExtension splits at the LAST dot — yielding "..". The
            // "..json" and ".json" variants yield "." and "" the same way. Those names reach the
            // sidebar without ever passing through the validator, and deleting the phantom profile
            // is what pulls the trigger. Neutralize at the folder boundary, where it belongs.
            //
            // Only names with NO substantive content are rewritten — everything that keeps at least
            // one non-dot, non-space character is returned byte-identical. That is deliberate: the
            // on-disk folder key must stay exactly what previous versions wrote, or
            // CleanupOrphanImages stops matching existing folders and deletes every reference PNG
            // the user has. (The degenerate names do collide with each other — "" and "." both map
            // to "_" — which is fine: none of them should exist, and sharing one junk folder is not
            // in the same universe as erasing the macros.)
            if (name.TrimEnd('.', ' ').Length == 0)
                name = name.Length == 0 ? "_" : name.Replace('.', '_').Replace(' ', '_');

            return name;
        }
    }
}
