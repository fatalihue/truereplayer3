using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using System.Collections.ObjectModel;
using TrueReplayer.Models;
using TrueReplayer.Services;
using WinForms = System.Windows.Forms;

namespace TrueReplayer.Controllers
{
    // Conflict resolution decided up-front in the React Import Preview dialog. The legacy
    // "OverwriteAll" / "SkipAll" values were removed when the per-profile inline picker
    // replaced the old C# bulk dialog — bulk behaviour is now a frontend convenience that
    // just stamps the chosen value into every conflicting row's resolution.
    public enum ImportConflictResult { Overwrite, Rename, Skip }

    // Outcome of the import-preview prep step. Distinguishes the one legitimate silent case
    // (Cancelled = user closed the picker) from every real failure the old code collapsed into
    // the same silent no-op, so the bridge can surface an actionable message instead of nothing.
    public enum ImportPrepareStatus { Ok, Cancelled, TooLarge, ReadError, ParseError, NoProfiles }
    public readonly record struct ImportPrepareResult(
        ImportPrepareStatus Status, ProfileExportEnvelope? Envelope, string? FilePath, string? Detail);

    // Why ParseImportEnvelope returned null — lets the caller tell a corrupt/unreadable file
    // (ParseError) from a structurally valid export that simply carries no profiles (NoProfiles),
    // which deserve different messages.
    public enum ImportParseError { None, Malformed, NoProfiles }

    public class ProfileController : IDisposable
    {
        /// <summary>
        /// The description cap, enforced wherever a description ENTERS the app. Mirrored by
        /// MAX_DESCRIPTION in the Info dialog and by the cut in HandleProfileSetMetadata; a
        /// .trprofile carried the only path that skipped it.
        /// </summary>
        internal const int MaxDescriptionLength = 500;

        private readonly MainWindow window;
        private FileSystemWatcher? profileWatcher;
        private CancellationTokenSource? debounceCts;
        // Watcher events fire on threadpool threads and can overlap; this guards the
        // cancel/dispose/reassign of debounceCts so two callbacks can't race into
        // cancelling or disposing the same (already-disposed) CTS.
        private readonly object _debounceLock = new();
        private bool _disposed;
        private DateTime suppressWatcherUntil = DateTime.MinValue;
        // The profile folder as the suppressing refresh found it (see RefreshProfileListAsync). The
        // window swallows only the ECHO of the app's own writes: a reload inside it is skipped when
        // the folder still matches this, and runs when anything changed after it.
        private string? _suppressedFolderState;

        public ObservableCollection<ProfileEntry> ProfileEntries { get; } = new();

        /// <summary>
        /// Optional callback fired when an operation surfaces a user-facing notice (the
        /// ConditionalBlockValidator auto-repair on profile load, the picker that cannot open, the
        /// organisation file that cannot be read or written…), with (message, type): the message
        /// already in the interface's language, and its type — "success", "info" or "error", the
        /// page's toast types — because the page can only guess the colour from English words. The bridge wires
        /// this to SendMessage("alert:show", { message, type }) through its held notices. Wrapped in
        /// null-check so headless test contexts don't have to provide one.
        /// </summary>
        public Action<string, string>? OnAlert { get; set; }

        /// <summary>
        /// Raised on the UI thread after the folder watcher re-read the list for a change made
        /// OUTSIDE the app. Every in-app mutator pushes the list to the frontend itself; this is
        /// the only reload nobody pushed, so the sidebar kept a deleted profile and missed a new
        /// one until something unrelated refreshed it. The bridge wires it to PushProfilesUpdate.
        /// </summary>
        public Action? OnListChangedExternally { get; set; }

        /// <summary>
        /// Raised on the UI thread when a profile .json is renamed to another .json outside the app,
        /// with (old name, new name, new path) — BEFORE the debounced list reload. Images, automation
        /// history and data cursors are keyed by the name and only the app's own rename moved them.
        /// </summary>
        public Action<string, string, string>? OnProfileRenamedExternally { get; set; }

        private Dictionary<string, WindowTarget> _cachedWindowTargets = new();
        // Profile name → file, republished WHOLE at every list swap. LoadProfileByNameAsync is also
        // the replay engine's RunProfile lookup, which runs on the replay's pool thread; reading
        // ProfileEntries there — cleared and refilled in place on the UI thread — could find the
        // list empty (the sub-profile "not found") or throw "Collection was modified", and either
        // one silently skipped a healthy sub-profile. A reference swap is atomic: the old list or
        // the new one, never a half-built one.
        private volatile IReadOnlyDictionary<string, string> _profilePathsByName = new Dictionary<string, string>(StringComparer.Ordinal);
        // The same freeze for the folder half of GetFolderInheritedContext, the engine's other
        // RunProfile lookup. See PublishFolderContexts.
        private volatile IReadOnlyDictionary<string, FolderInheritedContext> _folderContexts = new Dictionary<string, FolderInheritedContext>(StringComparer.Ordinal);
        // Built during LoadProfileListAsync — maps sanitized profile folder name → set of
        // ImagePath filenames referenced by WaitImage actions. Used by ImageStorageService
        // .CleanupOrphanImages at startup to delete unreferenced PNGs.
        private Dictionary<string, HashSet<string>> _referencedImagesByProfile = new();
        private string? _activeProfileName;
        // Reference PNGs are stored per profile, and while none is loaded they go to a literal
        // "default" folder: WebViewBridge.StorageProfileName is that mapping ("No Profile" →
        // "default"), and because every capture AND every read in that state resolves against the
        // same key, a No-Profile session works perfectly even though no profile on disk claims
        // those images. Duplicated here because that helper is private to the bridge; the two
        // spellings of "default" must stay in step.
        private const string NoProfileImageFolder = "default";
        private ProfileOrderData _profileOrder = new();

        /// <summary>The pinned macros, in their order: the tray panel lists them first.</summary>
        public IReadOnlyList<string> PinnedNames => _profileOrder.Pinned;
        private readonly SemaphoreSlim _profileOrderLock = new(1, 1);

        private static readonly JsonSerializerOptions OrderJsonOptions = new()
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            TypeInfoResolver = new DefaultJsonTypeInfoResolver()
        };

        private string ProfileOrderPath => Path.Combine(AppIdentity.ProfilesDir, "profile-order.json");

        // Theme colors for native dialogs (sent from React frontend)
        private SolidColorBrush? _dialogBackground;
        private SolidColorBrush? _dialogForeground;

        public ProfileController(MainWindow window)
        {
            this.window = window;
            SetupProfileWatcher();
        }

        // Native ContentDialogs only theme their background + primary foreground today, so only
        // bgCard/bgSurface and textPrimary are read here. textSecondary, accentSolid and borderSubtle
        // are accepted but intentionally unused: the signature mirrors the full theme payload sent by
        // WebViewBridge.HandleThemeColors (which forwards all six fields) so the call site stays a
        // straight pass-through and a future dialog can start consuming them without a contract change.
        public void SetDialogThemeColors(string bgSurface, string bgCard, string textPrimary, string textSecondary, string? accentSolid, string? borderSubtle)
        {
            // Background and text as a PAIR, or neither. Parsed independently, a theme whose
            // background failed and whose text did not left the WinUI default background under the
            // theme's text — a dark theme's light text on a light default, or the reverse. The
            // default pair is always readable; half of a theme is not.
            if (DialogColorPair(bgSurface, bgCard, textPrimary) is { } pair)
            {
                _dialogBackground = new SolidColorBrush(ColorHelper.FromArgb(pair.Background.A, pair.Background.R, pair.Background.G, pair.Background.B));
                _dialogForeground = new SolidColorBrush(ColorHelper.FromArgb(pair.Foreground.A, pair.Foreground.R, pair.Foreground.G, pair.Foreground.B));
            }
            else
            {
                _dialogBackground = null;
                _dialogForeground = null;
            }
        }

        /// <summary>The dialog's background (card, else surface) and text, or null unless BOTH read.</summary>
        internal static ((byte A, byte R, byte G, byte B) Background, (byte A, byte R, byte G, byte B) Foreground)? DialogColorPair(
            string? bgSurface, string? bgCard, string? textPrimary)
        {
            var background = ParseCssHex(bgCard) ?? ParseCssHex(bgSurface);
            var foreground = ParseCssHex(textPrimary);
            return background is { } bg && foreground is { } fg ? (bg, fg) : null;
        }

        // CSS hex, the only dialect the frontend writes: #RGB, #RRGGBB or #RRGGBBAA with the alpha
        // LAST. It was read as XAML's #AARRGGBB, which turned an opaque "#343746ff" into a 20%-alpha
        // blue. The frontend now sends opaque #rrggbb (nativeDialogColors); the other lengths are
        // read correctly anyway rather than trusted not to arrive.
        internal static (byte A, byte R, byte G, byte B)? ParseCssHex(string? hex)
        {
            if (string.IsNullOrEmpty(hex) || hex[0] != '#') return null;
            var digits = hex[1..];
            if (digits.Length == 3) digits = string.Concat(digits.Select(ch => new string(ch, 2)));
            if ((digits.Length != 6 && digits.Length != 8) || !digits.All(Uri.IsHexDigit)) return null;
            byte r = Convert.ToByte(digits[..2], 16), g = Convert.ToByte(digits[2..4], 16), b = Convert.ToByte(digits[4..6], 16);
            byte a = digits.Length == 8 ? Convert.ToByte(digits[6..8], 16) : (byte)255;
            return (a, r, g, b);
        }

        public void ApplyDialogTheme(ContentDialog dialog, TextBlock? messageBlock = null)
        {
            if (_dialogBackground != null) dialog.Background = _dialogBackground;
            if (_dialogForeground != null) dialog.Foreground = _dialogForeground;
            if (messageBlock != null && _dialogForeground != null) messageBlock.Foreground = _dialogForeground;
        }

        /// <summary>
        /// Run a WinForms file dialog on a dedicated STA thread so the UI thread stays responsive.
        ///
        /// The dialog is NOT modal — it has no owner and lives on a detached thread — so the app
        /// keeps running for as long as the user browses, which is precisely the window an
        /// automation fire lands in. Every picker therefore holds an InteractionScope for its whole
        /// life, and it is EXCLUSIVE: a second unowned picker stacked over the first is not merely
        /// redundant, it is two dialogs writing to one flow with no way for the user to tell which
        /// one their Enter answered.
        ///
        /// The TTL is generous on purpose. A picker legitimately stays open while someone walks a
        /// network share; the sweep here is a leak backstop, not a policy.
        /// </summary>
        private async Task<string?> ShowFileDialogAsync(WinForms.FileDialog dialog, string what)
        {
            // Reclaiming, not just claiming: the exclusive slot is shared with the nine capture
            // overlays, and one of those that cannot close used to take save / load / import /
            // export down with it — silently, since a refusal returned null and null is what a
            // cancel returns. Asking the holder to close first turns that into a brief pause; a
            // holder that still will not answer is now SAID OUT LOUD instead of looking like the
            // user's own Escape key.
            var interaction = await Services.InteractionScope.EnterExclusiveAsync($"file picker: {what}", TimeSpan.FromMinutes(20));
            if (interaction == null)
            {
                OnAlert?.Invoke(S.ProfilesAlertsPickerBusy(holder: Services.InteractionScope.Describe(Services.InteractionScope.ExclusiveOwner)), "info");
                // Disposing here is not tidiness — the dialog's usual disposal lives in the
                // thread's finally, and that thread is never going to start. Skipping it leaks the
                // native dialog's resources on every refusal.
                dialog.Dispose();
                return null;
            }

            var tcs = new TaskCompletionSource<string?>();
            // A dialog that THROWS (a broken shell extension, an unusable InitialDirectory, a COM
            // failure) still resolves to null — every caller already handles null — but it used to
            // be indistinguishable from the user pressing Cancel: nothing logged, nothing shown, the
            // picker just never appeared. Written before SetResult, which publishes it.
            Exception? failure = null;
            var thread = new Thread(() =>
            {
                try
                {
                    tcs.SetResult(dialog.ShowDialog() == WinForms.DialogResult.OK ? dialog.FileName : null);
                }
                catch (Exception ex)
                {
                    failure = ex;
                    tcs.SetResult(null);
                }
                finally
                {
                    dialog.Dispose();
                    // Released on the STA thread, where the dialog actually ended — not by the
                    // awaiting caller, which may already have been abandoned.
                    interaction.Dispose();
                }
            });
            thread.SetApartmentState(ApartmentState.STA);
            thread.IsBackground = true;
            thread.Start();
            var picked = await tcs.Task;
            if (failure != null)
            {
                DiagnosticLog.Error($"File dialog ({what}) failed", failure);
                OnAlert?.Invoke(S.ProfilesAlertsPickerFailed(reason: S.Reason(failure)), "error");
            }
            return picked;
        }

        /// <summary>
        /// Opens an executable/document picker for the ActivateWindow "Launch" field, so the user
        /// gets a full, resolvable path instead of a bare exe name that ShellExecute can't find
        /// (the "voicemeeterpro.exe — file not found" footgun). Returns null on cancel.
        /// </summary>
        public Task<string?> PickExecutableFileAsync()
            => ShowFileDialogAsync(new WinForms.OpenFileDialog
            {
                Title = S.ProfilesPickerProgram,
                Filter = $"{S.ProfilesFilterPrograms} (*.exe;*.bat;*.cmd;*.com;*.lnk)|*.exe;*.bat;*.cmd;*.com;*.lnk|{S.ProfilesFilterAllFiles} (*.*)|*.*",
                CheckFileExists = true,
            }, "launch target");

        /// <summary>
        /// Choose file… for a reference image: a picture to look for on the screen. Null on Cancel.
        /// </summary>
        public Task<string?> PickImageFileAsync()
            => ShowFileDialogAsync(new WinForms.OpenFileDialog
            {
                Title = S.ProfilesPickerImage,
                Filter = $"{S.ProfilesFilterPictures} (*.png;*.jpg;*.jpeg;*.bmp;*.gif)|*.png;*.jpg;*.jpeg;*.bmp;*.gif|{S.ProfilesFilterAllFiles} (*.*)|*.*",
                CheckFileExists = true,
            }, "reference image");

        /// <summary>
        /// Save image…: where a reference image's PNG goes. Null on Cancel.
        /// </summary>
        public Task<string?> PickImageSavePathAsync(string suggestedName)
            => ShowFileDialogAsync(new WinForms.SaveFileDialog
            {
                Title = S.ProfilesPickerSaveImage,
                Filter = $"{S.ProfilesFilterPng} (*.png)|*.png",
                FileName = suggestedName,
                DefaultExt = "png",
            }, "save image");

        /// <summary>
        /// The system's Save dialog for a file the interface built (a theme, the remaps, the
        /// snippets), then the text written where the user chose. Returns the path, or null on
        /// Cancel; a write that fails throws to the caller, which says so.
        /// </summary>
        public async Task<string?> SaveTextFileAsync(string suggestedName, string text, string title)
        {
            var path = await ShowFileDialogAsync(new WinForms.SaveFileDialog
            {
                Title = title,
                Filter = $"{S.ProfilesFilterJson} (*.json)|*.json",
                FileName = suggestedName,
                DefaultExt = "json"
            }, "save file");
            if (path == null) return null;
            await File.WriteAllTextAsync(path, text, new System.Text.UTF8Encoding(false));
            return path;
        }

        #region Profile CRUD Operations

        public async Task<bool> SaveProfileAsync()
        {
            string profileDir = AppIdentity.ProfilesDir;

            Directory.CreateDirectory(profileDir);

            // SNAPSHOT BEFORE THE PICKER, not after.
            //
            // The file dialog is not modal — ShowFileDialogAsync runs ShowDialog() on a detached
            // STA thread with no owner — so the app keeps living while it is open, for as long as
            // the user takes to pick a folder and type a name. The automation daemon fires in that
            // window, and a fire swaps UserProfile.Current and calls ApplyProfile, which clears and
            // refills window.Actions. Building the profile AFTER the await therefore read whatever
            // the daemon had just installed: the file came out with ANOTHER profile's actions,
            // hotkey, window target and loop settings, under the name the user typed.
            //
            // Actions is COPIED rather than assigned. window.Actions is the live ObservableCollection
            // the bridge mutates — CreateProfileFromState (WebViewBridge) already copies for exactly
            // this reason, and assigning it here meant even a snapshot taken at the right moment
            // could still be rewritten underneath us before SettingsManager serialised it.
            var profile = new UserProfile
            {
                Actions = new System.Collections.ObjectModel.ObservableCollection<Models.ActionItem>(window.Actions),
                BatchDelay = UserProfile.Current.BatchDelay,
                LastProfileDirectory = string.Empty, // filled in below, once a path exists
                CustomHotkey = UserProfile.Current.CustomHotkey,
                CustomHotstring = UserProfile.Current.CustomHotstring,
                TargetWindow = UserProfile.Current.TargetWindow,
                UseRelativeCoordinates = UserProfile.Current.UseRelativeCoordinates,
                WindowWidth = UserProfile.Current.WindowWidth,
                WindowHeight = UserProfile.Current.WindowHeight,
                WindowX = UserProfile.Current.WindowX,
                WindowY = UserProfile.Current.WindowY,
                RestorePosition = UserProfile.Current.RestorePosition,
                RestoreSize = UserProfile.Current.RestoreSize,
                BringToFocus = UserProfile.Current.BringToFocus,
                TriggerMode = UserProfile.Current.TriggerMode,
                IsDisabled = UserProfile.Current.IsDisabled,
                // Per-profile loop — mirror CreateProfileFromState; without these four a
                // Save-As-New silently resets the copy to 1×.
                EnableLoop = UserProfile.Current.EnableLoop,
                LoopCount = UserProfile.Current.LoopCount,
                LoopIntervalEnabled = UserProfile.Current.LoopIntervalEnabled,
                LoopInterval = UserProfile.Current.LoopInterval,
                // Per-profile Game Mode — same reason as the loop four.
                GameMode = UserProfile.Current.GameMode,
                RestoreCursor = UserProfile.Current.RestoreCursor,
                DelayVariation = UserProfile.Current.DelayVariation,
                FastApproach = UserProfile.Current.FastApproach,
                // Data-loop table — mirror CreateProfileFromState so a "Save As New" /
                // first-save doesn't silently drop the table.
                Data = UserProfile.Current.Data,
                // Automation trigger travels too, but Armed is machine-LOCAL intent:
                // a Save-As-New copy must not silently start self-firing next to the
                // original (both would fire the same schedule).
                Triggers = DisarmedTriggerClone(UserProfile.Current.Triggers),
            };

            // The image folder key belongs to the same snapshot, for the same reason. Reference
            // PNGs are stored per profile, so carrying them into the file the user is about to
            // name (below) requires knowing which folder the ones on screen RIGHT NOW came from —
            // and an automation fire during the picker changes that: MainWindow's fire path calls
            // UpdateProfileColors, which is exactly what _activeProfileName tracks. Read after the
            // await it would name whatever the daemon just activated, and the save would copy THAT
            // profile's images into the user's new file.
            //
            // No active profile means the app is in "No Profile" (UpdateProfileColors(null)), whose
            // captures live in NoProfileImageFolder.
            string sourceImageKey = string.IsNullOrEmpty(_activeProfileName) ? NoProfileImageFolder : _activeProfileName!;

            var fileName = await ShowFileDialogAsync(new WinForms.SaveFileDialog
            {
                Filter = $"{S.ProfilesFilterJson} (*.json)|*.json",
                FileName = S.ProfilesNamesSaveAs,
                InitialDirectory = profileDir
            }, "save macro");

            if (fileName != null)
            {
                // The one field that genuinely cannot be known before the picker returns.
                profile.LastProfileDirectory = Path.GetDirectoryName(fileName)!;

                // The images have to travel with the profile, BEFORE the JSON is written — see
                // TryCarryReferenceImages for what writing the paths verbatim used to cost. The
                // destination folder key is the file's bare name, the same derivation
                // LoadProfileListAsync uses to key the reference map it hands the orphan sweep.
                string newProfileName = Path.GetFileNameWithoutExtension(fileName);
                if (!TryCarryReferenceImages(profile, sourceImageKey, newProfileName, out int droppedImages, out string? failedImage))
                {
                    // Deliberately no write. The user keeps a profile whose images are all still
                    // in their original folder and a grid that still has every action in it, which
                    // is a far better place to be than holding a file that looks saved and has
                    // half its references pointing at PNGs that do not exist. Returning false also
                    // keeps HasUnsavedChanges set at every call site, so the close guard will ask
                    // again instead of letting the work go.
                    WinForms.MessageBox.Show(
                        S.ProfilesSaveAsImageFailed(image: failedImage ?? "", name: newProfileName),
                        S.ProfilesSaveAsErrorTitle, WinForms.MessageBoxButtons.OK, WinForms.MessageBoxIcon.Error);
                    return false;
                }

                try
                {
                    await SettingsManager.SaveProfileAsync(fileName, profile);
                    await RefreshProfileListAsync(true);
                    // Source PNGs that were already gone are not a save failure — the file is on
                    // disk and correct — but the new profile has rows that will never match, and
                    // the user is the only one who can recapture them. Say so instead of letting
                    // them find out at the next replay.
                    if (droppedImages > 0)
                        OnAlert?.Invoke(S.ProfilesAlertsSavedImagesMissing(n: S.Num(droppedImages), name: newProfileName, count: droppedImages), "info");
                    return true;
                }
                catch (Exception ex)
                {
                    WinForms.MessageBox.Show(S.ProfilesSaveAsFailed(reason: S.Reason(ex)), S.ProfilesSaveAsErrorTitle, WinForms.MessageBoxButtons.OK, WinForms.MessageBoxIcon.Error);
                }
            }
            return false;
        }

        // WHY THE SAVE HAS TO CARRY THE IMAGES
        //
        // Reference images — WaitImage, IF-ImageFound, and the automation image watcher — are the
        // only asset a profile keeps outside its JSON, and they are stored PER PROFILE, keyed by
        // the profile name (NoProfileImageFolder while none is loaded). Writing the new file with
        // the ImagePath values verbatim, which is what this path did, produced a profile whose
        // every image row pointed into somebody else's folder. It failed in two different ways:
        //
        //   Save-As-New from a loaded profile: the PNGs stay in the ORIGINAL profile's folder,
        //   where that profile still references them, so nothing is deleted — but the new profile
        //   only ever reads its own folder, so every image row is dead from birth.
        //
        //   First save out of "No Profile": the PNGs sit in Images\default and NOTHING references
        //   that folder. CleanupOrphanImages builds its keep-set from the real Profiles\*.json
        //   names, so "default" has no entry: at the next app start every PNG in it is deleted and
        //   the folder removed. The user saved, was told nothing, and lost the images on launch.
        //
        // The four sibling copy paths in WebViewBridge (paste, duplicate row, duplicate profile ×2)
        // have always cloned. This one simply never did.
        //
        // COPY, NOT MOVE. Moving out of Images\default would be tidier — the copies left behind are
        // swept at the next start anyway — but saving does not change what the app is looking at:
        // CurrentProfileName stays "No Profile" (nothing on the save path reassigns it) and the LIVE
        // ActionItems keep their original filenames, so the session keeps resolving against
        // "default". A move would blank every thumbnail and break every WaitImage in the session the
        // user is still working in, and would break a second Save-As under a different name. The
        // same argument is stronger for Save-As-New, where a move would gut the ORIGINAL profile.
        // Worst case of a copy is a duplicate PNG the orphan sweep collects; worst case of a move is
        // destroying the images of a profile the user never asked to touch.
        //
        // ABORT, DON'T HALF-SAVE. When a copy that should have worked fails, the caller writes
        // nothing: the user is left exactly where they were, free to retry. Writing anyway would
        // recreate the defect this whole fix closes — a profile the user believes is saved, holding
        // a mix of live and dangling references, whose dangling half disappears at the next start.
        // A source PNG that is ALREADY gone is the one case that does not abort: there is nothing to
        // carry and nothing to lose, so the row is saved without its reference (empty thumbnail +
        // "recapture" hint, matching HandleActionsPaste) and the user is told afterwards.
        /// <summary>
        /// Copies every reference PNG the snapshot points at into <paramref name="dstKey"/>'s image
        /// folder and repoints the snapshot at the copies. <paramref name="dropped"/> counts
        /// references whose source PNG was already missing. Returns false — with the offending name
        /// in <paramref name="failedImage"/> — when a PNG that exists could not be copied, in which
        /// case the caller must not write the profile.
        /// </summary>
        private static bool TryCarryReferenceImages(UserProfile profile, string srcKey, string dstKey, out int dropped, out string? failedImage)
        {
            dropped = 0;
            failedImage = null;

            // Same folder on both ends: a No-Profile session saved under the name "default", or a
            // Save-As-New that overwrites the very profile that is loaded. The PNGs are already
            // exactly where the file being written will look for them, so cloning would do nothing
            // but orphan the originals. Compared sanitized, because that is the name the directory
            // actually has on disk.
            if (string.Equals(ImageStorageService.GetSanitizedProfileFolder(srcKey),
                              ImageStorageService.GetSanitizedProfileFolder(dstKey),
                              StringComparison.OrdinalIgnoreCase))
                return true;

            int carried = 0;

            for (int i = 0; i < profile.Actions.Count; i++)
            {
                var action = profile.Actions[i];
                if (string.IsNullOrEmpty(action.ImagePath)) continue;
                // Same predicate as the paste / duplicate / import sites: a condition OPENER
                // (If or While) with ConditionType "ImageFound" shares WaitImage's per-profile
                // PNG storage — ActionItem.CarriesConditionProbe is the one source of that rule.
                bool refsImage = action.ActionType == "WaitImage"
                    || (action.CarriesConditionProbe && string.Equals(action.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase));
                if (!refsImage) continue;

                if (!TryCarryOneImage(srcKey, dstKey, action.ImagePath!, out string? carriedName))
                {
                    failedImage = action.ImagePath;
                    return false;
                }

                // The snapshot's collection is a SHALLOW copy of window.Actions — the items in it
                // are the very objects the grid is bound to. Repointing ImagePath in place would
                // rewrite the LIVE row to a filename that exists only in the new profile's folder,
                // and the session (still resolving under the old key) would lose the image it is
                // showing. Swap in a detached Clone and leave the live row alone; RowNumber is
                // [JsonIgnore] and UI-only, which is why Clone deliberately omits it.
                var detached = action.Clone();
                detached.ImagePath = carriedName;
                profile.Actions[i] = detached;

                if (carriedName == null) dropped++; else carried++;
            }

            // The automation image-watcher PNG lives OUTSIDE Actions and rides along in the
            // snapshot, so it needs the same treatment — HandleProfileDuplicate clones it
            // separately for exactly this reason. DisarmedTriggerClone already handed us a detached
            // config, so this one can be repointed in place.
            if (profile.Triggers != null
                && string.Equals(profile.Triggers.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrEmpty(profile.Triggers.ImagePath))
            {
                if (!TryCarryOneImage(srcKey, dstKey, profile.Triggers.ImagePath!, out string? carriedName))
                {
                    failedImage = profile.Triggers.ImagePath;
                    return false;
                }
                profile.Triggers.ImagePath = carriedName;
                if (carriedName == null) dropped++; else carried++;
            }

            if (carried > 0 || dropped > 0)
                DiagnosticLog.Info($"[Save] Carried {carried} reference image(s) '{srcKey}' → '{dstKey}'"
                    + (dropped > 0 ? $"; {dropped} source PNG(s) were already missing." : "."));
            return true;
        }

        /// <summary>
        /// Copies one reference PNG into <paramref name="dstKey"/>'s image folder under a fresh GUID
        /// name. True with a non-null <paramref name="carriedName"/> on success; true with null when
        /// the source PNG is already gone (nothing to carry — the caller drops the reference and
        /// counts it); false only when a PNG that exists could not be copied, which aborts the save.
        /// </summary>
        private static bool TryCarryOneImage(string srcKey, string dstKey, string imagePath, out string? carriedName)
        {
            carriedName = null;

            // Which folder the PNG is ACTUALLY in is a question about the disk, not about what this
            // controller believes is active. _activeProfileName and the bridge's CurrentProfileName
            // are maintained by different call sites and can disagree — deleting the active profile
            // drops the bridge to "No Profile" (new captures go to "default") while the controller
            // still names the profile that was deleted. Probing both candidates costs one
            // File.Exists and turns that disagreement from "the image is silently dropped" into a
            // correct copy. Filenames are fresh GUIDs, so the wrong folder cannot answer for the
            // right one; the active profile is tried first regardless.
            string? foundIn = ImageStorageService.ReferenceImageExists(srcKey, imagePath) ? srcKey
                : ImageStorageService.ReferenceImageExists(NoProfileImageFolder, imagePath) ? NoProfileImageFolder
                : null;

            if (foundIn == null)
            {
                // Dangling BEFORE the save — the user deleted the PNG by hand, or an earlier failure
                // left the row pointing at nothing. Carrying the name over would hand the new profile
                // a reference that resolves into its own empty folder; dropping it makes the Sheet
                // show "no image captured", which is the same choice HandleActionsPaste makes.
                DiagnosticLog.Info($"[Save] Reference image '{imagePath}' is not on disk under '{srcKey}' or '{NoProfileImageFolder}'; '{dstKey}' saved without it.");
                return true;
            }

            carriedName = ImageStorageService.CloneReferenceImage(foundIn, imagePath, dstKey);
            if (carriedName != null) return true;

            // The file is there and the copy still failed: disk full, locked by an AV scan or a
            // sync client, destination not writable. CloneReferenceImage swallows the exception, so
            // this is everything we know — the caller turns it into a refusal to save rather than a
            // half-written profile.
            DiagnosticLog.Error($"[Save] Copy of reference image '{imagePath}' from '{foundIn}' to '{dstKey}' failed; save aborted.");
            return false;
        }

        public async Task<UserProfile?> LoadProfileByNameAsync(string profileName)
        {
            // DiagnosticLog, not Debug.WriteLine: the latter is compiled out of Release, so a lookup
            // that failed in the field — a file gone between two calls, an unreadable JSON — left
            // no line saying which of the four reasons it was.
            if (string.IsNullOrEmpty(profileName))
            {
                DiagnosticLog.Warn("[Profiles] LoadProfileByName called with an empty name.");
                return null;
            }

            // The published snapshot, not ProfileEntries: this also runs on the replay's pool
            // thread (see _profilePathsByName).
            if (!_profilePathsByName.TryGetValue(profileName, out var filePath))
            {
                DiagnosticLog.Info($"[Profiles] LoadProfileByName: '{profileName}' is not in the profile list.");
                return null;
            }

            if (!File.Exists(filePath))
            {
                DiagnosticLog.Warn($"[Profiles] LoadProfileByName: the file of '{profileName}' is gone ({filePath}).");
                return null;
            }

            var profile = await SettingsManager.LoadProfileAsync(filePath);
            if (profile == null)
            {
                DiagnosticLog.Error($"[Profiles] LoadProfileByName: '{profileName}' could not be read from {filePath}.");
                return null;
            }

            // Same validator hook as LoadProfileAsync — also covers sub-profile calls via
            // RunProfile (MainWindow wires SetProfileLookup → this method) so a nested
            // RunProfile target that's hand-edited with an unbalanced block gets repaired
            // before the engine's BuildBlockMap runs over it.
            var blockFix = ConditionalBlockValidator.ValidateAndRepairBlocks(profile.Actions);
            if (blockFix.HadFixups && FirstBlockFixNotice(filePath))
            {
                DiagnosticLog.Info($"[ConditionalBlocks] Auto-repaired '{profileName}': removed {blockFix.OrphansRemoved} orphan(s), appended {blockFix.EndIfsAppended} synthetic ENDIF(s)");
                OnAlert?.Invoke(FormatBlockFixupToast(profileName, blockFix), "info");
            }

            return profile;
        }

        // File path → the write stamp its auto-repair was last announced for. The repair lives only
        // in the loaded copy — nothing writes it back — so every read of an unsaved broken file
        // repairs it again, and a RunProfile inside a loop, or an automation firing for hours,
        // re-toasted the same "Auto-repaired" once per call. The engine still gets the repaired list
        // every time; the user is told once per version of the file. Locked: the RunProfile lookup
        // runs on the replay's thread.
        private readonly Dictionary<string, DateTime> _blockFixAnnounced = new(StringComparer.OrdinalIgnoreCase);

        private bool FirstBlockFixNotice(string filePath)
        {
            DateTime stamp;
            try { stamp = File.GetLastWriteTimeUtc(filePath); }
            catch { return true; }
            lock (_blockFixAnnounced)
            {
                if (_blockFixAnnounced.TryGetValue(filePath, out var announced) && announced == stamp) return false;
                _blockFixAnnounced[filePath] = stamp;
                return true;
            }
        }

        /// <summary>
        /// Builds a one-line human-readable summary of what the conditional-block validator
        /// just fixed up ("Auto-repaired conditional blocks in 'X': appended 2 closing markers,
        /// removed 1 orphan"), in the interface's language: one whole sentence per case, the
        /// plurals in the catalog (engine-compat, repair). Both counters at once take the two
        /// counted phrases into one sentence, since a plural follows one count.
        /// </summary>
        private static string FormatBlockFixupToast(string profileName, ConditionalBlockValidator.BlockValidationResult fix)
        {
            // "closing marker", not "EndIf": since the loop blocks joined, the synthetic
            // closer may be an EndLoop — the counter is family-blind by design.
            int appended = fix.EndIfsAppended, removed = fix.OrphansRemoved;
            if (removed == 0)
                return S.CompatRepairAppended(n: S.Num(appended), name: profileName, count: appended);
            if (appended == 0)
                return S.CompatRepairRemoved(n: S.Num(removed), name: profileName, count: removed);
            return S.CompatRepairBoth(
                markers: S.CompatRepairMarkers(n: S.Num(appended), count: appended),
                name: profileName,
                orphans: S.CompatRepairOrphans(n: S.Num(removed), count: removed));
        }

        /// <summary>
        /// Writes <paramref name="profile"/> over the named profile's file. False — and a toast — when
        /// the name is no longer in the list: renamed or deleted outside the app between the caller's
        /// load and this save. That used to return as if it had written, so a hotkey assigned in that
        /// window was mirrored into memory, then vanished on the next list read with nothing said.
        /// </summary>
        public async Task<bool> SaveProfileByNameAsync(string profileName, UserProfile profile)
        {
            var entry = ProfileEntries.FirstOrDefault(p => p.Name == profileName);
            if (entry == null)
            {
                DiagnosticLog.Warn($"[Profiles] Save of '{profileName}' skipped: it is no longer in the profile list.");
                OnAlert?.Invoke(S.ProfilesAlertsSaveGone(name: profileName), "error");
                return false;
            }

            // Stamp UpdatedAt on every save so the Info tab + Import Preview show a
            // meaningful "last modified" date. CreatedAt is only set if missing, so
            // pre-existing profiles get a CreatedAt the first time they're saved after
            // this feature lands (best we can do without inventing past dates).
            var nowUtc = DateTime.UtcNow;
            profile.UpdatedAt = nowUtc;
            if (profile.CreatedAt == null) profile.CreatedAt = nowUtc;
            await SettingsManager.SaveProfileAsync(entry.FilePath, profile);
            MirrorSavedWindowFlags(profileName, profile);
            return true;
        }

        /// <summary>
        /// Copies the window flags just written for <paramref name="profileName"/> onto its list
        /// entry. For a profile with its own target the entry IS where GetEffectiveRelativeCoordinates
        /// and friends read the flag, and it is otherwise refreshed only when something re-reads the
        /// whole list. A save that skipped that re-read left the entry naming the old coordinate
        /// space while the file held coordinates converted to the new one.
        /// </summary>
        public void MirrorSavedWindowFlags(string profileName, UserProfile saved)
        {
            var entry = ProfileEntries.FirstOrDefault(p => p.Name == profileName);
            if (entry == null) return;
            entry.UseRelativeCoordinates = saved.UseRelativeCoordinates;
            entry.BringToFocus = saved.BringToFocus;
            entry.RestorePosition = saved.RestorePosition;
            entry.RestoreSize = saved.RestoreSize;
        }

        /// <summary>
        /// The list entry after the app wrote the OPEN profile's own state to its file (the bridge's
        /// save as you go), without re-reading every profile: the dates, the step count, the
        /// profiles its RunProfile steps call and the window flags. The rest of what the file holds
        /// (hotkey, hotstring, window target, automation, info) has handlers that write it to disk
        /// themselves and refresh the list, so the entry already says the same. The write is marked
        /// as the app's own, so the watcher does not reload the list for it either.
        /// </summary>
        public void NoteSavedByApp(string profileName, UserProfile saved)
        {
            MarkOwnWrite();
            var entry = ProfileEntries.FirstOrDefault(p => p.Name == profileName);
            if (entry == null) return;
            entry.CreatedAt = saved.CreatedAt;
            entry.UpdatedAt = saved.UpdatedAt;
            entry.ActionCount = saved.Actions.Count;
            (entry.RunProfileTargets, entry.RunOverDataTargets) = RunTargetsOf(saved.Actions);
            MirrorSavedWindowFlags(profileName, saved);
        }

        public void ResetProfile()
        {
            AppSettingsManager.ActivateProfile(UserProfile.Default);
            UpdateProfileColors(null);
        }

        #endregion

        #region Profile List Management

        /// <summary>
        /// Names of profile.json files that failed to load on the last LoadProfileListAsync
        /// pass. Surfaced via <see cref="GetAndClearLoadFailures"/> so the bridge can show
        /// the user a toast on startup instead of silently dropping the broken profiles.
        /// </summary>
        private readonly List<string> _loadFailures = new();

        /// <summary>
        /// Returns the list of profile names that failed to load on the most recent refresh,
        /// then clears the list. Called once by the bridge after profiles:updated is pushed
        /// so the alert fires exactly once per failed load.
        /// </summary>
        /// True once the current <see cref="_loadFailures"/> have been shown to the user. Replaces
        /// the old "clear the list to mark it consumed", which conflated two different questions:
        /// "have we told the user?" and "which profiles are unreadable right now?".
        ///
        /// The list is the answer to the SECOND one, and <see cref="AllKnownProfileNames"/> depends
        /// on it to keep the automation prune from reading "failed to parse" as "deleted". Draining
        /// it for the toast therefore reopened, a few lines later, the exact data loss the prune fix
        /// closed: from the boot toast until the next full list reload, any resync passed a list
        /// missing the unreadable profile and its fire history was pruned off disk. Arming an
        /// automation right after seeing "1 profile(s) couldn't load" lands inside that window.
        private bool _failuresReported;

        public IReadOnlyList<string> GetAndClearLoadFailures()
        {
            if (_failuresReported) return Array.Empty<string>();
            _failuresReported = true;
            return _loadFailures.ToList();
        }

        /// <summary>
        /// Every profile this app knows exists — the loaded ones AND the ones whose JSON failed to
        /// parse on the last pass. This is the list TriggerService.Reload prunes fire stats
        /// against, and the distinction is load-bearing: the prune is write-through to the sidecar,
        /// so anything missing here is read as DELETED and has its history destroyed permanently.
        /// A file that merely failed to parse is still on disk and usually readable next pass.
        ///
        /// Exists as one property because the two call sites that feed the prune drifted before —
        /// getting the argument right in one place and wrong in the other is the failure mode.
        /// Raw names, not the sanitized folder form of <see cref="FailedLoadFolders"/>: the daemon
        /// keys its stats on the profile name.
        /// </summary>
        public IReadOnlyList<string> AllKnownProfileNames =>
            ProfileEntries.Select(p => p.Name).Concat(_loadFailures).ToList();

        private async Task LoadProfileListAsync()
        {
            string profileDir = AppIdentity.ProfilesDir;

            Directory.CreateDirectory(profileDir);

            // Sweep any orphan temp files left behind by a previous atomic-save that hit
            // the rare "AV held the temp past both the move retry AND the cleanup Delete"
            // path. Without this, leaked temps accumulate over time and clutter the
            // user's Profiles directory. Matches Path.GetRandomFileName() format strictly
            // so real .json / .png / user files stay untouched. Idempotent + cheap.
            FileHelper.CleanupOrphanTemps(profileDir);

            var files = Directory.GetFiles(profileDir, "*.json")
                .Where(f => !string.Equals(Path.GetFileName(f), "profile-order.json", StringComparison.OrdinalIgnoreCase))
                .ToList();

            // Build into LOCALS, then swap in one synchronous block once every file is in.
            // These four used to be cleared up front and filled inside the read loop — so for
            // ~80 profiles the live collections sat empty, then partial, across ~80 yields to
            // the message pump. Any reader that landed in that window saw a short list: the
            // Automation panel polls automation:request every 2s and BuildAutomationStatePayload
            // projects straight off ProfileEntries, which is why its list visibly vanished and
            // came back whenever a save triggered a reload. Nothing may observe a partial
            // rebuild, so the swap has to be atomic w.r.t. the pump — no await between Clear()
            // and the last Add().
            var loadedEntries = new List<ProfileEntry>();
            var loadedTargets = new Dictionary<string, WindowTarget>();
            // Keyed by image FOLDER, which NTFS matches without regard to case — so this map must
            // too, or a case-only rename ("farm" → "Farm", whose folder keeps its spelling) left the
            // startup sweep unable to find the folder's owner and it erased every PNG in it.
            var loadedImages = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);
            var loadedFailures = new List<string>();

            // Read and deserialize every profile OFF the dispatcher, several files at a time.
            //
            // The serial `await SettingsManager.LoadProfileAsync(file)` this replaces cost the SUM
            // of ~81 file reads rather than the max, and every one of them was paid on the UI
            // thread: Program.Main installs a DispatcherQueueSynchronizationContext as the
            // process-wide default and that read carries no ConfigureAwait(false), so each
            // continuation — the JSON parse plus both projection passes below — resumed on the
            // dispatcher. On the startup path that is the very dispatcher that owes WebView2 its
            // handshake inside the ui:ready watchdog's window, so the profile sweep was buying
            // itself the reload the watchdog exists to perform.
            //
            // Task.Run is load-bearing here, not decoration: it is what makes LoadProfileAsync
            // START on a pool thread. Called directly it would begin on the UI thread and capture
            // that context at its own await, and no ConfigureAwait on THIS side can undo that —
            // the await that would need annotating lives in SettingsManager.
            //
            // A fixed set of pumps draws indices off a shared counter instead of launching one
            // task per file, because the folder lives under Documents, which is routinely
            // OneDrive-backed: eighty simultaneous opens against a sync provider turns a fast
            // local read into a hydration stampede. Results land in an index-keyed array — the
            // workers share nothing writable, and the publish below is still plain file order,
            // so a same-named collision resolves last-wins exactly as the serial loop did.
            var results = new ProfileLoadResult?[files.Count];
            if (files.Count > 0)
            {
                int nextIndex = -1;
                var pumps = new Task[Math.Min(files.Count, MaxConcurrentProfileReads)];
                for (int w = 0; w < pumps.Length; w++)
                {
                    pumps[w] = Task.Run(async () =>
                    {
                        int i;
                        while ((i = Interlocked.Increment(ref nextIndex)) < files.Count)
                            results[i] = await ReadOneProfileAsync(files[i]).ConfigureAwait(false);
                    });
                }

                // Deliberately NOT ConfigureAwait(false): everything from here down publishes into
                // ProfileEntries and arms the hooks, the automation daemon and the tray — all
                // UI-thread state — so this is precisely where the work has to come back. It is
                // also the only yield left in the method, where there used to be one per profile.
                await Task.WhenAll(pumps);
            }

            foreach (var result in results)
            {
                // Only null if a pump never reached this slot, which Task.WhenAll would already
                // have rethrown for. Kept so a future change to the pump can't turn that into a
                // NullReferenceException halfway through the publish.
                if (result == null) continue;

                if (result.Failed)
                {
                    if (!string.IsNullOrEmpty(result.Name)) loadedFailures.Add(result.Name);
                    continue;
                }

                // Deserialized to null — the file vanished between the enumeration and the read,
                // or its contents were the literal `null`. Neither an entry nor a failure: the
                // same silence the serial loop kept.
                if (result.Entry == null) continue;

                loadedEntries.Add(result.Entry);
                if (result.Target != null) loadedTargets[result.Name] = result.Target;
                // Sanitized here rather than inside the worker so the parallel pass calls into no
                // other service and cannot be broken by one becoming thread-unsafe. MERGED, not
                // assigned: two names that share a folder (they differ only in case, or sanitize
                // alike) share its PNGs, and last-wins would hand the first one's images to the sweep.
                var folderKey = ImageStorageService.GetSanitizedProfileFolder(result.Name);
                if (!loadedImages.TryGetValue(folderKey, out var folderRefs))
                    loadedImages[folderKey] = folderRefs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (result.ImageRefs != null) folderRefs.UnionWith(result.ImageRefs);
            }

            // The swap. No await from here to the last Add(), so the pump never sees a
            // half-built list. ProfileEntries is an ObservableCollection others bind to, so the
            // instance is reused rather than replaced.
            ProfileEntries.Clear();
            foreach (var e in loadedEntries) ProfileEntries.Add(e);
            var paths = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (var e in loadedEntries) paths.TryAdd(e.Name, e.FilePath); // first wins, as FirstOrDefault did
            _profilePathsByName = paths;
            _cachedWindowTargets = loadedTargets;
            _referencedImagesByProfile = loadedImages;
            _loadFailures.Clear();
            _loadFailures.AddRange(loadedFailures);
            // A fresh scan is fresh news: whatever failed now has not been reported yet, and
            // whatever no longer fails must stop counting as known-but-unreadable.
            _failuresReported = false;

            await LoadProfileOrderAsync();
            PopulateEffectiveTargets();

            // Teclado (branch teclado): the game keys run library macros by name, so they learn every
            // version of the list — name → file, with the effective (folder-inherited) coordinate space.
            var tecladoLibrary = new Dictionary<string, TecladoMacros.LibraryEntry>(StringComparer.Ordinal);
            foreach (var e in ProfileEntries)
                tecladoLibrary.TryAdd(e.Name, new TecladoMacros.LibraryEntry(e.FilePath, e.EffectiveUseRelativeCoordinates));
            TecladoService.LibraryChanged(tecladoLibrary);
            // Deck (branch deck): the buttons name their macros too; a name that left the list shows as missing.
            DeckService.LibraryChanged(ProfileEntries.Select(e => e.Name));

            var map = GetProfileHotkeys();
            InputHookManager.RegisterProfileHotkeys(map);
            InputHookManager.RegisterProfileTriggerModes(GetProfileTriggerModes());
            var windowTargets = GetProfileWindowTargets();
            InputHookManager.RegisterProfileWindowTargets(windowTargets, GetBringToFocusProfiles());
            var hotstringMap = GetProfileHotstrings();
            InputHookManager.RegisterProfileHotstrings(hotstringMap);

            // Automation daemon sync — this is the one place that sees every profile reload
            // (disk watcher, imports, saves, toggles), so the watcher pool re-arms here.
            // Reload is diff-based: unchanged triggers keep their running loops and state.
            // The second argument is EVERY profile name, not just the trigger-bearing ones: it is
            // what the daemon prunes stale fire stats against, and GetProfileTriggers() drops
            // disabled profiles — which would otherwise read as "deleted" and wipe their history.
            //
            // ProfileEntries alone is not "every profile" though: a profile whose JSON failed to
            // parse never makes it into the collection (see the Failed branch of the load loop
            // above). The prune is write-through to the sidecar, so a single unreadable file — a
            // half-flushed save, antivirus holding it, a disk hiccup — permanently destroyed that
            // automation's fire history and its interval anchor, for a profile still sitting on
            // disk and readable again on the next pass. Union in the failures, which were just
            // refreshed a few lines up. They are raw profile names, which is what the daemon keys
            // on; FailedLoadFolders is the sanitized FOLDER form and would not match.
            TriggerService.Instance?.Reload(GetProfileTriggers(), AllKnownProfileNames);

            // Diagnostic snapshot of what's actually ARMED after a (re)load — answers "is my
            // hotkey even registered, and to which target?" without a repro. Fires on profile
            // load/change (low frequency), so it's safe for the disk-per-write logger.
            try
            {
                // Same snapshot the registration above used — rebuilding it here walked every
                // profile against every folder a second time for a log line.
                var targets = windowTargets;
                string armed = map.Count == 0
                    ? "none"
                    : string.Join(", ", map.Select(kv =>
                    {
                        targets.TryGetValue(kv.Key, out var t);
                        string tgt = t == null
                            ? "any-window"
                            : $"{t.ProcessName}{(string.IsNullOrEmpty(t.WindowTitle) ? "" : "/" + t.WindowTitle)}";
                        return $"'{kv.Key}'={kv.Value}->[{tgt}]";
                    }));
                var skipped = ProfileEntries
                    .Where(e => e.IsDisabled && !string.IsNullOrEmpty(e.Hotkey))
                    .Select(e => $"'{e.Name}'({e.Hotkey})")
                    .ToList();
                // Keys the hook still believes are down that the OS says are not, appended to the
                // line that already exists rather than spent on a new one. A modifier stranded in
                // the hook's chord state is silent by construction — every later hotkey composes to
                // "Ctrl+PageUp" and simply misses the map, which is not an error anywhere — so the
                // only trace it can leave is one it is handed. This line is the right carrier
                // because it lands one message AFTER a save, which is precisely where the strand
                // happened: the overwrite dialog suppresses the hook while the user is still
                // holding the Ctrl of Ctrl+S. The cross-check inside the snapshot is what makes it
                // empty on a healthy arm rather than merely usually empty.
                //
                // Comma-separated, never "+": a "+"-joined list is character-for-character a
                // composed hotkey, which is the one vocabulary this line must not borrow when the
                // failure it reports is "everything is composing as Ctrl+X" — and with both Ctrls
                // stranded it would read "Ctrl+Ctrl".
                var strandedKeys = InputHookManager.SnapshotStrandedKeys();
                DiagnosticLog.Info(
                    $"Hotkeys armed ({map.Count}): {armed}. Hotstrings: {hotstringMap.Count}." +
                    (skipped.Count > 0 ? $" Skipped (disabled w/ hotkey): {string.Join(", ", skipped)}." : "") +
                    (strandedKeys.Count > 0 ? $" Stranded: {string.Join(", ", strandedKeys)}." : ""));
            }
            catch (Exception ex) { DiagnosticLog.Info($"Hotkeys armed-summary log failed: {ex.Message}"); }
        }

        /// <summary>
        /// How many profile files <see cref="LoadProfileListAsync"/> reads at once. The ceiling
        /// that matters is I/O concurrency, not cores — each unit of work is one small file read
        /// plus a JSON parse — and it is kept deliberately modest because the profile folder sits
        /// under Documents, which is commonly redirected to OneDrive. Enough to collapse ~81
        /// serial round trips into a handful of batches without stampeding a sync provider.
        /// </summary>
        private const int MaxConcurrentProfileReads = 8;

        /// <summary>
        /// Everything one profile file contributes to the list rebuild. Produced entirely off the
        /// UI thread and published by the caller in file order, so the result is what the old
        /// serial loop produced, entry for entry.
        /// <para>
        /// The three states are distinct on purpose: <see cref="Entry"/> non-null is a loaded
        /// profile; <see cref="Failed"/> is a file that threw and must be named in the startup
        /// toast; and neither set is a file that deserialized to null, which the serial loop
        /// passed over in silence and which must keep doing so — reporting it would turn a
        /// vanished temp file into a scary "profile couldn't load".
        /// </para>
        /// </summary>
        private sealed class ProfileLoadResult
        {
            public string Name = "";
            public ProfileEntry? Entry;
            public WindowTarget? Target;
            public HashSet<string>? ImageRefs;
            public bool Failed;
        }

        /// <summary>
        /// Reads and projects ONE profile file. Deliberately static and self-contained: it touches
        /// no controller state, no collection anything else can see, and no other service, which
        /// is what makes running several at a time safe. Never throws — a file that can't be read
        /// or parsed comes back flagged, so one corrupt profile can't take the whole list with it.
        /// </summary>
        private static async Task<ProfileLoadResult> ReadOneProfileAsync(string file)
        {
            var name = Path.GetFileNameWithoutExtension(file);
            try
            {
                var profile = await SettingsManager.LoadProfileAsync(file).ConfigureAwait(false);
                if (profile == null) return new ProfileLoadResult { Name = name };

                bool hasTarget = profile.TargetWindow != null
                    && (!string.IsNullOrEmpty(profile.TargetWindow.ProcessName)
                        || !string.IsNullOrEmpty(profile.TargetWindow.WindowTitle));

                var (runRefs, overDataRefs) = RunTargetsOf(profile.Actions);

                var entry = new ProfileEntry
                {
                    Name = name,
                    FilePath = file,
                    Hotkey = profile.CustomHotkey,
                    Hotstring = profile.CustomHotstring?.Sequence,
                    HotstringInstant = profile.CustomHotstring?.Instant ?? false,
                    HasWindowTarget = hasTarget,
                    WindowTargetProcessName = profile.TargetWindow?.ProcessName,
                    WindowTargetWindowTitle = profile.TargetWindow?.WindowTitle,
                    WindowTargetTitleMatchMode = profile.TargetWindow?.TitleMatchMode ?? "contains",
                    UseRelativeCoordinates = profile.UseRelativeCoordinates,
                    BringToFocus = profile.BringToFocus,
                    RestorePosition = profile.RestorePosition,
                    RestoreSize = profile.RestoreSize,
                    TriggerMode = profile.TriggerMode,
                    IsDisabled = profile.IsDisabled,
                    // Automation trigger mirror — TriggerService re-arms from this and the
                    // Automation panel projects configs from it (no per-profile re-read).
                    Triggers = profile.Triggers,
                    // Mirror sharing metadata into the sidebar entry so the UI can render
                    // icon/tags/version badges without re-reading the JSON. Null tags stays
                    // null (don't coerce to empty list — the UI distinguishes "no tags set"
                    // from "tags were set then all removed").
                    Description = profile.Description,
                    Tags = profile.Tags,
                    IconEmoji = profile.IconEmoji,
                    ProfileVersion = profile.ProfileVersion,
                    CreatedAt = profile.CreatedAt,
                    UpdatedAt = profile.UpdatedAt,
                    AppMinVersion = profile.AppMinVersion,
                    ActionCount = profile.Actions.Count,
                    RunProfileTargets = runRefs,
                    RunOverDataTargets = overDataRefs
                };

                // Collect referenced PNG filenames for orphan-cleanup at startup.
                // IF rows with ConditionType="ImageFound" share the same per-profile
                // ImagePath storage as WaitImage — leaving them out of the reference
                // set causes the cleanup to delete the captured PNG and the Sheet
                // reopens with an empty thumbnail after the next restart.
                var refs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var a in profile.Actions)
                {
                    if (string.IsNullOrEmpty(a.ImagePath)) continue;
                    if (a.ActionType == "WaitImage"
                        || (a.CarriesConditionProbe && string.Equals(a.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase)))
                    {
                        refs.Add(a.ImagePath);
                    }
                }
                // Automation image-watcher PNG lives OUTSIDE Actions — leaving it out
                // of the reference set makes this very cleanup delete it at the next
                // startup, silently killing the armed watcher.
                if (string.Equals(profile.Triggers?.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase)
                    && !string.IsNullOrEmpty(profile.Triggers?.ImagePath))
                {
                    refs.Add(profile.Triggers!.ImagePath!);
                }

                return new ProfileLoadResult
                {
                    Name = name,
                    Entry = entry,
                    Target = hasTarget ? profile.TargetWindow : null,
                    ImageRefs = refs
                };
            }
            catch (Exception ex)
            {
                // Profile JSON is corrupt, has incompatible types, or otherwise can't be
                // deserialized. Record the name so the bridge can surface a single
                // user-visible alert listing all failed profiles ("3 profiles couldn't
                // load: foo, bar, baz") instead of letting the user discover the loss
                // by noticing missing entries.
                DiagnosticLog.Error($"Profile load failed: '{name}' ({Path.GetFileName(file)})", ex);
                return new ProfileLoadResult { Name = name, Failed = true };
            }
        }

        /// <summary>
        /// The profiles a list of steps calls through RunProfile, and the over-data subset of them
        /// (for the called profile's Data panel, see ProfileEntry.RunOverDataTargets). The Export
        /// dialog discloses the first list as the sub-profiles that ride along with a selection.
        /// Trimmed, non-empty and distinct ORDINAL, so a case-differing ref stays a separate entry
        /// and resolves on its own, matching the Ordinal lookup ExpandWithRunProfileDependenciesAsync
        /// uses when it actually bundles them. null (not an empty list) when nothing is called,
        /// which keeps the profiles:updated payload lean for the common case.
        /// </summary>
        private static (List<string>? Runs, List<string>? OverData) RunTargetsOf(IEnumerable<ActionItem> actions)
        {
            static List<string>? Keys(IEnumerable<ActionItem> rows)
            {
                var keys = rows
                    .Select(a => a.Key?.Trim())
                    .Where(k => !string.IsNullOrEmpty(k))
                    .Select(k => k!)
                    .Distinct(StringComparer.Ordinal)
                    .ToList();
                return keys.Count > 0 ? keys : null;
            }
            var runs = actions.Where(a => string.Equals(a.ActionType, "RunProfile", StringComparison.OrdinalIgnoreCase)).ToList();
            return (Keys(runs), Keys(runs.Where(a => a.RunOverData == true)));
        }

        /// <summary>
        /// Derives the effective target (own > folder-inherited > none) for every entry and
        /// fills the EffectiveTarget* fields. Called after the profile order is loaded so
        /// folder membership is known. Idempotent — safe to call repeatedly after order
        /// changes (e.g. user moved profile into/out of a folder). Cheap (linear in
        /// ProfileEntries.Count), so PushProfilesUpdate refreshes before serializing.
        /// </summary>
        /// <summary>
        /// profile name → the FIRST folder in <c>_profileOrder.Folders</c> that lists it, i.e. exactly
        /// what <c>Folders.FirstOrDefault(f =&gt; f.Items.Contains(name))</c> resolves to (first match
        /// wins, ordinal comparison, matching List&lt;string&gt;.Contains).
        ///
        /// Built in ONE pass by the two callers that need folder membership for EVERY profile, which
        /// were paying O(profiles × folders × items) per profile-list refresh — and a refresh runs on
        /// every save, rename, delete, toggle, reorder and disk-watcher event. Deliberately a local
        /// per-call map rather than controller state: nothing to invalidate, so no way for it to go
        /// stale against the ~10 sites that mutate the order.
        /// </summary>
        private Dictionary<string, ProfileFolder> BuildFolderByProfileName()
        {
            var map = new Dictionary<string, ProfileFolder>(StringComparer.Ordinal);
            foreach (var folder in _profileOrder.Folders)
                foreach (var item in folder.Items)
                    if (!map.ContainsKey(item)) map[item] = folder;
            return map;
        }

        public void PopulateEffectiveTargets()
        {
            var folderByProfile = BuildFolderByProfileName();
            foreach (var entry in ProfileEntries)
            {
                if (entry.HasWindowTarget)
                {
                    entry.HasEffectiveTarget = true;
                    entry.EffectiveTargetSource = "own";
                    entry.EffectiveTargetFolderName = null;
                    entry.EffectiveTargetProcessName = entry.WindowTargetProcessName;
                    entry.EffectiveTargetWindowTitle = entry.WindowTargetWindowTitle;
                    entry.EffectiveTargetTitleMatchMode = entry.WindowTargetTitleMatchMode;
                    // Rel-coords travels WITH the target, exactly like the switches above: a
                    // profile that owns its target owns this flag too. UseRelativeCoordinates on
                    // the entry is the profile's OWN value, which is only the effective one here.
                    entry.EffectiveUseRelativeCoordinates = entry.UseRelativeCoordinates;
                    continue;
                }

                folderByProfile.TryGetValue(entry.Name, out var folder);
                var folderTarget = folder?.TargetWindow;
                bool folderHasTarget = folderTarget != null
                    && (!string.IsNullOrEmpty(folderTarget.ProcessName) || !string.IsNullOrEmpty(folderTarget.WindowTitle));

                if (folderHasTarget)
                {
                    entry.HasEffectiveTarget = true;
                    entry.EffectiveTargetSource = "folder";
                    entry.EffectiveTargetFolderName = folder!.Name;
                    entry.EffectiveTargetProcessName = folderTarget!.ProcessName;
                    entry.EffectiveTargetWindowTitle = folderTarget.WindowTitle;
                    entry.EffectiveTargetTitleMatchMode = folderTarget.TitleMatchMode;
                    // Inherited target → inherited flag, matching GetEffectiveRelativeCoordinates
                    // (and what profile activation writes into UserProfile.Current).
                    entry.EffectiveUseRelativeCoordinates = folder.UseRelativeCoordinates;
                }
                else
                {
                    entry.HasEffectiveTarget = false;
                    entry.EffectiveTargetSource = null;
                    entry.EffectiveTargetFolderName = null;
                    entry.EffectiveTargetProcessName = null;
                    entry.EffectiveTargetWindowTitle = null;
                    entry.EffectiveTargetTitleMatchMode = "contains";
                    // No target anywhere → nothing to be relative TO. Replay agrees: with a null
                    // target TryResolveRelativeOffset yields a zero offset, i.e. plain absolute.
                    entry.EffectiveUseRelativeCoordinates = false;
                }
            }
        }

        // Snapshot of WaitImage ImagePath references built during the last LoadProfileListAsync.
        // Consumed by the startup orphan-cleanup pass in MainWindow.
        public IReadOnlyDictionary<string, HashSet<string>> ReferencedImagesByProfile => _referencedImagesByProfile;
        // Profiles that exist on disk but FAILED to load this pass, mapped to their sanitized image
        // folder names. CleanupOrphanImages keeps these folders intact so a transient load failure
        // (corrupt/half-written JSON) doesn't permanently delete the profile's reference PNGs.
        public IReadOnlySet<string> FailedLoadFolders =>
            _loadFailures.Select(ImageStorageService.GetSanitizedProfileFolder).ToHashSet(StringComparer.OrdinalIgnoreCase);

        public async Task RefreshProfileListAsync(bool suppressWatcher = false)
        {
            // Read BEFORE the load: every write that finished before this refresh — the caller's
            // own, whose echo the window exists to swallow — is part of it, and anything that lands
            // after it is not.
            if (suppressWatcher) MarkOwnWrite();

            await LoadProfileListAsync();

            // Restore active profile state after list rebuild
            if (_activeProfileName != null)
                UpdateProfileColors(_activeProfileName);
        }

        private void SetupProfileWatcher()
        {
            string profileDir = AppIdentity.ProfilesDir;

            if (!Directory.Exists(profileDir))
                Directory.CreateDirectory(profileDir);

            profileWatcher = new FileSystemWatcher(profileDir, "*.json")
            {
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite
            };

            profileWatcher.Created += OnProfileFolderChanged;
            profileWatcher.Deleted += OnProfileFolderChanged;
            profileWatcher.Renamed += OnProfileFolderChanged;
            profileWatcher.EnableRaisingEvents = true;
        }

        private async void OnProfileFolderChanged(object sender, FileSystemEventArgs e)
        {
            // Ignore profile-order.json changes — it's not a profile file
            if (string.Equals(Path.GetFileName(e.FullPath), "profile-order.json", StringComparison.OrdinalIgnoreCase))
                return;

            // A profile renamed to another profile name. Only .json on BOTH sides: an atomic save
            // lands as a rename from a random temp name, which is not a profile. Handed over right
            // away, ahead of the debounced reload below, so the new name already carries its images
            // and history when the list re-reads it.
            if (e is RenamedEventArgs r
                && r.OldFullPath.EndsWith(".json", StringComparison.OrdinalIgnoreCase)
                && r.FullPath.EndsWith(".json", StringComparison.OrdinalIgnoreCase)
                && !string.Equals(Path.GetFileName(r.OldFullPath), "profile-order.json", StringComparison.OrdinalIgnoreCase))
            {
                string oldName = Path.GetFileNameWithoutExtension(r.OldFullPath);
                string newName = Path.GetFileNameWithoutExtension(r.FullPath);
                string newPath = r.FullPath;
                // Ordinal: a case-only rename ("farm" → "Farm") IS a rename here. The list re-reads
                // under the new spelling, and whatever still holds the old one by exact name — the
                // profile on screen, whose next save then missed its own entry, and the data and
                // cycle cursors — must be told, or they fall silent. The app's own case-only renames
                // mark their echo like any other (HandleProfileRename).
                if (!string.Equals(oldName, newName, StringComparison.Ordinal))
                    window.DispatcherQueue.TryEnqueue(() => OnProfileRenamedExternally?.Invoke(oldName, newName, newPath));
            }

            // Atomically retire the in-flight debounce and start a fresh one. Without the lock,
            // two overlapping watcher callbacks could Cancel/Dispose the same CTS twice (or await
            // a disposed token) and both reach RefreshProfileList.
            CancellationToken token;
            lock (_debounceLock)
            {
                debounceCts?.Cancel();
                debounceCts?.Dispose();
                debounceCts = new CancellationTokenSource();
                token = debounceCts.Token;
            }

            try
            {
                await Task.Delay(300, token);
                if (!token.IsCancellationRequested)
                {
                    window.DispatcherQueue.TryEnqueue(async () =>
                    {
                        // Inside the window, skip only a pure echo: the folder exactly as the
                        // suppressing refresh read it. It used to skip EVERYTHING — a profile
                        // written from outside within 2 s of any in-app refresh (a Save, a create)
                        // stayed out of the list until the next change to the folder happened to
                        // reload it. A file created, deleted, renamed or rewritten after that
                        // refresh began is news no load has read, whoever wrote it.
                        if (DateTime.UtcNow < suppressWatcherUntil
                            && string.Equals(ProfileFolderState(), _suppressedFolderState, StringComparison.Ordinal))
                            return;
                        try
                        {
                            await RefreshProfileListAsync();
                            OnListChangedExternally?.Invoke();
                        }
                        catch (Exception ex)
                        {
                            DiagnosticLog.Error("RefreshProfileList background refresh failed", ex);
                        }
                    });
                }
            }
            // TaskCanceledException: this debounce was superseded by a newer event.
            // ObjectDisposedException: the CTS this token belongs to was disposed by a
            // concurrent supersede/Dispose() between the snapshot and the await. Both are benign.
            catch (TaskCanceledException) { }
            catch (ObjectDisposedException) { }
        }

        // What the watcher's echo test compares: every profile file (the watcher's own *.json
        // filter, minus profile-order.json, which it ignores) with its size and last write, in
        // ordinal name order so a case-only rename counts as a change. The atomic save's temp names
        // (Path.GetRandomFileName: 8.3, never .json) stay out of it. A folder that cannot be read
        // yields a token that matches nothing, so the reload runs — the answer the old window
        // could never give.
        private static string ProfileFolderState()
        {
            string profileDir = AppIdentity.ProfilesDir;
            try
            {
                var state = new System.Text.StringBuilder();
                foreach (var file in new DirectoryInfo(profileDir).EnumerateFiles("*.json")
                             .Where(f => !string.Equals(f.Name, "profile-order.json", StringComparison.OrdinalIgnoreCase))
                             .OrderBy(f => f.Name, StringComparer.Ordinal))
                {
                    state.Append(file.Name).Append('|').Append(file.Length).Append('|')
                         .Append(file.LastWriteTimeUtc.Ticks).Append('\n');
                }
                return state.ToString();
            }
            catch (Exception)
            {
                return "unreadable:" + Guid.NewGuid().ToString("N");
            }
        }

        // Marks the writes the app has just finished as its own: for the next 2 s the watcher skips
        // a reload that would find the folder exactly as it is now (see OnProfileFolderChanged).
        private void MarkOwnWrite()
        {
            _suppressedFolderState = ProfileFolderState();
            suppressWatcherUntil = DateTime.UtcNow.AddSeconds(2);
        }

        #endregion // Profile List Management

        #region Profile UI Interactions

        /// <param name="loopOnly">
        /// True when the ONLY pending change is a run-settings edit — Loops, Interval, Game Mode or
        /// Return cursor (all ride one flag, HasUnsavedLoopChange). "You have unsaved
        /// actions" would be a lie there — the action list is untouched, and on a profile with
        /// no actions at all it reads as a bug rather than a prompt.
        /// </param>
        /// <param name="beforeWhat">
        /// What the user is about to do, completing "Save before ___?". The text used to say
        /// "closing" for every caller, including the profile switch — so answering it looked like
        /// it would close the app, and when it merely switched profiles the app staying open read
        /// as the dialog having failed. Name the actual action instead: one of the catalog's
        /// S.ProfilesUnsavedBefore* texts (closing, continuing, updating, switching, creating,
        /// exporting, loading), which in Portuguese are infinitives that follow "antes de". Null
        /// is "closing".
        /// </param>
        public async Task<ContentDialogResult> ShowUnsavedChangesDialogAsync(bool loopOnly = false, string? beforeWhat = null)
        {
            beforeWhat ??= S.ProfilesUnsavedBeforeClosing;
            var messageBlock = new TextBlock
            {
                Text = loopOnly
                    ? S.ProfilesUnsavedRunSettings(beforeWhat: beforeWhat)
                    : S.ProfilesUnsavedActions(beforeWhat: beforeWhat),
                TextWrapping = TextWrapping.Wrap
            };

            var dialog = new ContentDialog
            {
                Title = S.ProfilesUnsavedTitle,
                XamlRoot = window.Content.XamlRoot,
                RequestedTheme = ElementTheme.Dark,
                PrimaryButtonText = S.ProfilesUnsavedSave,
                SecondaryButtonText = S.ProfilesUnsavedDiscard,
                CloseButtonText = S.ProfilesCancel,
                DefaultButton = ContentDialogButton.Primary,
                CornerRadius = new CornerRadius(8),
                Content = messageBlock
            };
            ApplyDialogTheme(dialog, messageBlock);

            // See ModalGate. `None` is precisely "the user did not choose Save or Discard", which
            // every caller already maps to "do not proceed with the switch/close" — so a switch
            // requested while the unsaved-changes prompt is still up is simply dropped, and the
            // prompt the user is looking at stays the one that matters.
            using var gate = Services.ModalGate.TryEnter("unsaved changes");
            if (gate == null) return ContentDialogResult.None;

            return await dialog.ShowAsync();
        }

        /// <summary>
        /// The close guard's question when an open EDITOR — not the profile — holds the work: the
        /// Sheet, a row or insert dialog, the Data table, the Automations panel. That work lives in
        /// the UI until the editor's own Save, so the profile prompt's "Save" cannot keep it, and
        /// offering Save here would be the lie the old close path told. Two answers: close anyway,
        /// or stay. True = close anyway.
        /// </summary>
        public async Task<bool> ShowUnappliedEditsDialogAsync(string sentence)
        {
            var messageBlock = new TextBlock
            {
                Text = S.ProfilesUnappliedBody(sentence: sentence),
                TextWrapping = TextWrapping.Wrap
            };

            var dialog = new ContentDialog
            {
                Title = S.ProfilesUnappliedTitle,
                XamlRoot = window.Content.XamlRoot,
                RequestedTheme = ElementTheme.Dark,
                PrimaryButtonText = S.ProfilesUnappliedCloseAnyway,
                CloseButtonText = S.ProfilesCancel,
                // Cancel is the default: Enter on a prompt the user did not expect must not be the
                // key that throws the work away.
                DefaultButton = ContentDialogButton.Close,
                CornerRadius = new CornerRadius(8),
                Content = messageBlock
            };
            ApplyDialogTheme(dialog, messageBlock);

            // See ModalGate. Refused = stay open, the same reading every caller gives Cancel.
            using var gate = Services.ModalGate.TryEnter("unapplied edits");
            if (gate == null) return false;

            return await dialog.ShowAsync() == ContentDialogResult.Primary;
        }

        public void UpdateProfileColors(string? activeProfileName)
        {
            _activeProfileName = activeProfileName;
            foreach (var entry in ProfileEntries)
                entry.IsActive = (activeProfileName != null && entry.Name == activeProfileName);
        }

        #endregion

        #region Profile Hotkey Management

        /// <summary>
        /// Hotkey collisions detected on the most recent <see cref="GetProfileHotkeys"/> call.
        /// Each entry is a whole sentence in the interface's language ("Hotkey 'Ctrl+F5' is bound to
        /// 2 macros … — only one will fire") — the bridge surfaces these as toasts (type "info": a
        /// warning, nothing failed) so the user knows two profiles fight for the same combo. Cleared at the start of
        /// each GetProfileHotkeys call so we don't accumulate stale warnings.
        /// </summary>
        private readonly List<string> _hotkeyCollisions = new();

        // Hotstring collisions found by the most recent GetProfileHotstrings call — same shape and
        // same drain as the hotkey ones, cleared at the start of each call.
        private readonly List<string> _hotstringCollisions = new();

        public IReadOnlyList<string> GetAndClearHotkeyCollisions()
        {
            var copy = _hotkeyCollisions.Concat(_hotstringCollisions).ToList();
            _hotkeyCollisions.Clear();
            _hotstringCollisions.Clear();
            return copy;
        }

        public Dictionary<string, string> GetProfileHotkeys()
        {
            var hotkeys = new Dictionary<string, string>();
            _hotkeyCollisions.Clear();
            // Detect TRUE collisions only — two profiles with the same hotkey but DIFFERENT
            // target windows are intentionally supported: IsForegroundWindowMatch disambiguates
            // at fire time based on which window is foreground. That's a feature (e.g. Ctrl+F1
            // does action A in Roblox and action B in Notepad). The collision is only a real
            // problem when the targets overlap, which we approximate as identical (or both
            // null) — anything else is a designed-for, silent-by-design hotkey routing.
            var byHotkey = new Dictionary<string, List<ProfileEntry>>(StringComparer.OrdinalIgnoreCase);

            // Cleared for EVERY entry, not just the candidates: this method also runs after a
            // rename or a disable, and a stale true would leave a warning badge on a row whose
            // conflict is gone.
            foreach (var entry in ProfileEntries) entry.HotkeyConflict = false;

            foreach (var entry in ProfileEntries)
            {
                if (string.IsNullOrEmpty(entry.Hotkey) || entry.IsDisabled) continue;
                if (!byHotkey.TryGetValue(entry.Hotkey, out var list))
                {
                    list = new List<ProfileEntry>();
                    byHotkey[entry.Hotkey] = list;
                }
                list.Add(entry);
                hotkeys[entry.Name] = entry.Hotkey;
            }

            foreach (var (hotkey, candidates) in byHotkey)
            {
                if (candidates.Count <= 1) continue;
                // Group by effective target signature. Profiles in the SAME bucket overlap →
                // real collision. Profiles in DIFFERENT buckets are routed by foreground gate.
                var byTargetSignature = candidates
                    .GroupBy(e => GetEffectiveTargetSignature(e))
                    .Where(g => g.Count() > 1);

                foreach (var collidingGroup in byTargetSignature)
                {
                    // Stamp the entries so the sidebar can mark the chip. Same grouping that
                    // produces the toast text below — one definition, so a badge can never
                    // disagree with the warning the user was shown.
                    foreach (var e in collidingGroup) e.HotkeyConflict = true;
                    var names = collidingGroup.Select(e => e.Name).ToList();
                    var list = string.Join(", ", names);
                    _hotkeyCollisions.Add(string.IsNullOrEmpty(collidingGroup.Key)
                        ? S.ProfilesCollisionHotkeyNoTarget(hotkey: hotkey, n: S.Num(names.Count), names: list)
                        : S.ProfilesCollisionHotkey(hotkey: hotkey, n: S.Num(names.Count), names: list, target: DescribeEffectiveTarget(collidingGroup.First())));
                }
            }

            return hotkeys;
        }

        /// <summary>
        /// Produces a stable string describing an entry's EFFECTIVE target window (own or
        /// folder-inherited). Used to detect "real" hotkey collisions — profiles with the
        /// same hotkey but different target signatures coexist fine because the foreground
        /// gate routes between them. Empty string when the entry has no effective target.
        /// </summary>
        private static string GetEffectiveTargetSignature(ProfileEntry e)
        {
            if (!e.HasEffectiveTarget) return "";
            // Two targets that the matcher treats as one window must give one signature, or two
            // profiles sharing a hotkey there collide at runtime with no badge and no toast. The
            // matcher ignores case in a contains-title and in the process name, and reads "chrome"
            // as "chrome.exe" (WindowMatcher.ProcessNameMatches). A REGEX title keeps its case:
            // lowering a pattern changes what it means (\D is not \d).
            var proc = (e.EffectiveTargetProcessName ?? "").Trim().ToLowerInvariant();
            if (proc.EndsWith(".exe", StringComparison.Ordinal)) proc = proc[..^4];
            bool regex = string.Equals(e.EffectiveTargetTitleMatchMode, "regex", StringComparison.OrdinalIgnoreCase);
            var title = e.EffectiveTargetWindowTitle ?? "";
            if (!regex) title = title.ToLowerInvariant();
            return $"{proc}|{title}|{(regex ? "regex" : "contains")}";
        }

        /// <summary>
        /// The effective target a collision warning names, written the way the page writes a window —
        /// the process and the title, "notepad.exe / Untitled". The signature the entries are grouped
        /// by ("notepad|untitled|contains") is an internal key, lowered, never something to show.
        /// </summary>
        private static string DescribeEffectiveTarget(ProfileEntry e)
        {
            var proc = (e.EffectiveTargetProcessName ?? "").Trim();
            var title = (e.EffectiveTargetWindowTitle ?? "").Trim();
            if (proc.Length == 0) return title;
            return title.Length == 0 ? proc : $"{proc} / {title}";
        }

        public Dictionary<string, TriggerMode> GetProfileTriggerModes()
        {
            var modes = new Dictionary<string, TriggerMode>();

            foreach (var entry in ProfileEntries)
            {
                if (!string.IsNullOrEmpty(entry.Hotkey) && !entry.IsDisabled)
                    modes[entry.Name] = entry.TriggerMode;
            }

            return modes;
        }

        // Clone a trigger config with Armed forced off — the shared helper for every path
        // that materializes a profile on a machine that didn't arm it (import, Save-As-New,
        // duplicate). null passes through.
        public static ProfileTriggerConfig? DisarmedTriggerClone(ProfileTriggerConfig? config)
        {
            if (config == null) return null;
            var clone = config.Clone();
            clone.Armed = false;
            return clone;
        }

        // Every profile's automation trigger config (armed or not — TriggerService needs the
        // disarmed ones too so the panel can list + re-arm them). Disabled profiles are
        // excluded outright: IsDisabled means "this profile must not fire", same rule the
        // hotkey map applies above.
        public List<(string Name, ProfileTriggerConfig Config)> GetProfileTriggers()
        {
            var result = new List<(string, ProfileTriggerConfig)>();
            foreach (var entry in ProfileEntries)
            {
                if (entry.Triggers == null || entry.IsDisabled) continue;
                result.Add((entry.Name, entry.Triggers));
            }
            return result;
        }

        public Dictionary<string, HotstringConfig> GetProfileHotstrings()
        {
            var hotstrings = new Dictionary<string, HotstringConfig>();
            _hotstringCollisions.Clear();

            foreach (var entry in ProfileEntries)
            {
                if (!string.IsNullOrEmpty(entry.Hotstring) && !entry.IsDisabled)
                {
                    hotstrings[entry.Name] = new HotstringConfig
                    {
                        Sequence = entry.Hotstring.ToLowerInvariant(),
                        Instant = entry.HotstringInstant
                    };
                }
            }

            // The hotkey rule, for hotstrings: the same sequence on profiles whose effective targets
            // overlap means only one fires (the matcher keeps the last in file order). The assign
            // path refuses this (GetHotstringConflict), but import and a hand-edited JSON do not
            // pass through it — and unlike a hotkey there was no warning at all.
            foreach (var group in ProfileEntries
                .Where(e => !string.IsNullOrEmpty(e.Hotstring) && !e.IsDisabled)
                .GroupBy(e => (Seq: e.Hotstring!.ToLowerInvariant(), Target: GetEffectiveTargetSignature(e)))
                .Where(g => g.Count() > 1))
            {
                var names = group.Select(e => e.Name).ToList();
                var list = string.Join(", ", names);
                _hotstringCollisions.Add(string.IsNullOrEmpty(group.Key.Target)
                    ? S.ProfilesCollisionHotstringNoTarget(hotstring: group.Key.Seq, n: S.Num(names.Count), names: list)
                    : S.ProfilesCollisionHotstring(hotstring: group.Key.Seq, n: S.Num(names.Count), names: list, target: DescribeEffectiveTarget(group.First())));
            }

            return hotstrings;
        }

        public Dictionary<string, WindowTarget> GetProfileWindowTargets()
        {
            var effective = new Dictionary<string, WindowTarget>(_cachedWindowTargets);
            var folderByProfile = BuildFolderByProfileName();

            // Add folder-inherited targets for profiles without their own target
            foreach (var entry in ProfileEntries)
            {
                if (effective.ContainsKey(entry.Name)) continue;
                folderByProfile.TryGetValue(entry.Name, out var folder);
                if (folder?.TargetWindow != null &&
                    (!string.IsNullOrEmpty(folder.TargetWindow.ProcessName) || !string.IsNullOrEmpty(folder.TargetWindow.WindowTitle)))
                {
                    effective[entry.Name] = folder.TargetWindow;
                }
            }

            return effective;
        }

        public WindowTarget? GetEffectiveWindowTarget(string profileName)
        {
            if (_cachedWindowTargets.TryGetValue(profileName, out var profileTarget))
                return profileTarget;

            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Items.Contains(profileName));
            if (folder?.TargetWindow != null &&
                (!string.IsNullOrEmpty(folder.TargetWindow.ProcessName) || !string.IsNullOrEmpty(folder.TargetWindow.WindowTitle)))
                return folder.TargetWindow;

            return null;
        }

        /// <summary>
        /// True when the profile owns its window target — the same gate every GetEffective* below
        /// uses to choose between the profile's own values and its folder's.
        /// </summary>
        public bool HasOwnWindowTarget(string profileName) => _cachedWindowTargets.ContainsKey(profileName);

        public bool GetEffectiveRelativeCoordinates(string profileName)
        {
            // Profile's own target takes priority
            if (_cachedWindowTargets.ContainsKey(profileName))
            {
                var entry = ProfileEntries.FirstOrDefault(p => p.Name == profileName);
                return entry?.UseRelativeCoordinates ?? false;
            }
            // Folder target inheritance
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Items.Contains(profileName));
            return folder?.UseRelativeCoordinates ?? false;
        }

        public bool GetEffectiveBringToFocus(string profileName)
        {
            if (_cachedWindowTargets.ContainsKey(profileName))
            {
                var entry = ProfileEntries.FirstOrDefault(p => p.Name == profileName);
                return entry?.BringToFocus ?? false;
            }
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Items.Contains(profileName));
            return folder?.BringToFocus ?? false;
        }

        // Effective Restore Position/Size + geometry. Profile's own values take priority when the
        // profile has its own target; otherwise fall back to the folder. A profile that has no
        // target and is not in a folder with a target gets defaults (false/0). The fall-through
        // mirrors the BringToFocus/UseRelativeCoordinates pattern above.
        public bool GetEffectiveRestorePosition(string profileName)
        {
            if (_cachedWindowTargets.ContainsKey(profileName))
            {
                var entry = ProfileEntries.FirstOrDefault(p => p.Name == profileName);
                return entry?.RestorePosition ?? false;
            }
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Items.Contains(profileName));
            return folder?.RestorePosition ?? false;
        }

        public bool GetEffectiveRestoreSize(string profileName)
        {
            if (_cachedWindowTargets.ContainsKey(profileName))
            {
                var entry = ProfileEntries.FirstOrDefault(p => p.Name == profileName);
                return entry?.RestoreSize ?? false;
            }
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Items.Contains(profileName));
            return folder?.RestoreSize ?? false;
        }

        /// <summary>
        /// Effective geometry (WindowX/Y/Width/Height) for the given profile, resolved with the
        /// SAME gate as every other inherited field above (<see cref="GetEffectiveRestorePosition"/>
        /// et al): the profile's own TARGET decides. With an own target the profile keeps its own
        /// geometry — passed in by the caller, since it lives on the loaded UserProfile rather than
        /// on the list entry. Without an own target the profile has no window context of its own,
        /// so the folder's geometry applies WHOLE and the profile's own numbers are ignored.
        ///
        /// Ignoring them is the point. Nothing on disk tells a rect the user deliberately captured
        /// apart from a leftover: a targetless profile's four numbers may come from a target that
        /// was later removed, from the recorder's auto-seed on the first recorded click, or from
        /// "Convert coords → Relative" stamping the window it converted against. Honouring them
        /// paired a folder-inherited Restore flag with a profile coordinate and moved the target
        /// window to the leftover position — the reported bug. The folder is the only side that
        /// can have meant it, so the folder's rect applies whole or nothing applies.
        ///
        /// Returns NULL when neither side ever captured anything — see
        /// <see cref="TrueReplayer.Helpers.WindowMatcher.CapturedRect"/> for the rule and for why
        /// the caller must then suppress Restore Position AND Restore Size rather than pass zeroes.
        /// </summary>
        public (int X, int Y, int Width, int Height)? GetEffectiveGeometry(
            string profileName, int ownX, int ownY, int ownWidth, int ownHeight)
        {
            if (_cachedWindowTargets.ContainsKey(profileName))
                return TrueReplayer.Helpers.WindowMatcher.CapturedRect(ownX, ownY, ownWidth, ownHeight);

            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Items.Contains(profileName));
            if (folder == null) return null;
            return TrueReplayer.Helpers.WindowMatcher.CapturedRect(
                folder.WindowX, folder.WindowY, folder.WindowWidth, folder.WindowHeight);
        }

        /// <summary>
        /// Name of the folder <paramref name="profileName"/> inherits its window target from, or
        /// null when the profile owns its target, is in no folder, or its folder has no usable
        /// target. Used to refuse UI actions that would write per-profile window state the
        /// inheritance rules then ignore.
        /// </summary>
        public string? GetInheritedTargetFolderName(string profileName)
        {
            if (_cachedWindowTargets.ContainsKey(profileName)) return null;
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Items.Contains(profileName));
            if (folder == null || !TrueReplayer.Helpers.WindowMatcher.IsUsable(folder.TargetWindow)) return null;
            return folder.Name;
        }

        /// <summary>
        /// Folder-inherited execution context for a profile that has no target of its own.
        /// Returns null when the profile already has its own target (caller should use the
        /// profile's own values), or when no folder applies / the folder has no target.
        /// Used by the RunProfile chaining path so a sub-profile inheriting from its folder
        /// actually switches into the folder's context, instead of running against the
        /// caller's window.
        /// </summary>
        public readonly record struct FolderInheritedContext(
            WindowTarget Target,
            bool UseRelativeCoordinates,
            bool BringToFocus,
            bool RestorePosition,
            bool RestoreSize,
            int X, int Y, int Width, int Height);

        public FolderInheritedContext? GetFolderInheritedContext(string profileName)
        {
            // Profile has own target → no folder inheritance applies. Caller uses the profile's
            // disk-loaded values directly. (_cachedWindowTargets is only ever replaced whole.)
            if (_cachedWindowTargets.ContainsKey(profileName)) return null;
            // The frozen copy, not _profileOrder: this is the replay engine's RunProfile lookup and
            // runs on the replay's pool thread (see PublishFolderContexts).
            return _folderContexts.TryGetValue(profileName, out var ctx) ? ctx : null;
        }

        /// <summary>
        /// Freezes, for every profile that sits in a folder with a usable target, the context
        /// GetFolderInheritedContext hands the engine — and swaps it in by reference.
        ///
        /// That lookup runs on the replay's pool thread while every folder edit mutates
        /// _profileOrder in place on the UI thread. A chained RunProfile that landed mid-edit either
        /// threw "Collection was modified" out of the whole run, or — between MoveToFolderAsync's
        /// remove and its add — found the profile in no folder and ran it against the CALLER's
        /// window with nothing said. Called on the UI thread after every change: each edit ends in
        /// SaveProfileOrderAsync, which publishes before it writes, and every load ends here.
        /// </summary>
        private void PublishFolderContexts()
        {
            var contexts = new Dictionary<string, FolderInheritedContext>(StringComparer.Ordinal);
            // The first folder that lists a profile owns it — the FirstOrDefault rule every
            // resolver in this file uses — even when that folder has no usable target.
            var claimed = new HashSet<string>(StringComparer.Ordinal);
            foreach (var folder in _profileOrder.Folders)
            {
                if (folder?.Items == null) continue;
                bool usable = TrueReplayer.Helpers.WindowMatcher.IsUsable(folder.TargetWindow);
                FolderInheritedContext? ctx = null;
                if (usable)
                {
                    // Same rect rule as GetEffectiveGeometry, and the same consequence: with nothing
                    // ever captured there is no rect to restore, so the Restore flags must be dropped
                    // too. A chained sub-profile that kept them would run applyPos against (0,0) — the
                    // direct fire paths suppress exactly this, and the two must not disagree about the
                    // same profile.
                    var rect = TrueReplayer.Helpers.WindowMatcher.CapturedRect(
                        folder.WindowX, folder.WindowY, folder.WindowWidth, folder.WindowHeight);
                    ctx = new FolderInheritedContext(
                        folder.TargetWindow!,
                        folder.UseRelativeCoordinates,
                        folder.BringToFocus,
                        rect is not null && folder.RestorePosition,
                        rect is not null && folder.RestoreSize,
                        rect?.X ?? 0,
                        rect?.Y ?? 0,
                        rect?.Width ?? 0,
                        rect?.Height ?? 0);
                }
                foreach (var name in folder.Items)
                {
                    if (name == null || !claimed.Add(name)) continue;
                    if (ctx.HasValue) contexts[name] = ctx.Value;
                }
            }
            _folderContexts = contexts;
        }

        public async Task SetFolderWindowTargetAsync(
            string folderName,
            WindowTarget target,
            bool relativeCoordinates = false,
            bool bringToFocus = false,
            bool restorePosition = false,
            bool restoreSize = false)
        {
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Name == folderName);
            if (folder != null)
            {
                folder.TargetWindow = target;
                folder.UseRelativeCoordinates = relativeCoordinates;
                folder.BringToFocus = bringToFocus;
                folder.RestorePosition = restorePosition;
                folder.RestoreSize = restoreSize;
                await SaveProfileOrderAsync();
            }
        }

        public async Task SetFolderGeometryAsync(string folderName, int x, int y, int width, int height)
        {
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Name == folderName);
            if (folder != null)
            {
                folder.WindowX = x;
                folder.WindowY = y;
                folder.WindowWidth = width;
                folder.WindowHeight = height;
                await SaveProfileOrderAsync();
            }
        }

        public HashSet<string> GetBringToFocusProfiles()
        {
            var set = new HashSet<string>();
            var folderByProfile = BuildFolderByProfileName();
            foreach (var entry in ProfileEntries)
            {
                if (entry.IsDisabled) continue;
                // Profile's own bring-to-focus
                if (entry.BringToFocus && entry.HasWindowTarget)
                {
                    set.Add(entry.Name);
                    continue;
                }
                // Folder-inherited bring-to-focus
                if (!entry.HasWindowTarget)
                {
                    folderByProfile.TryGetValue(entry.Name, out var folder);
                    if (folder?.BringToFocus == true && folder.TargetWindow != null)
                        set.Add(entry.Name);
                }
            }
            return set;
        }

        public async Task RemoveFolderWindowTargetAsync(string folderName)
        {
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Name == folderName);
            if (folder != null)
            {
                // Mirror HandleProfileRemoveWindowTarget on profiles: wipe everything dependent
                // on the target so we don't leave dangling Restore Position/Size toggles or
                // orphaned geometry. The user can re-set it later from scratch.
                folder.TargetWindow = null;
                folder.UseRelativeCoordinates = false;
                folder.BringToFocus = false;
                folder.RestorePosition = false;
                folder.RestoreSize = false;
                folder.WindowX = 0;
                folder.WindowY = 0;
                folder.WindowWidth = 0;
                folder.WindowHeight = 0;
                await SaveProfileOrderAsync();
            }
        }

        #endregion

        #region Profile Export/Import

        /// <summary>
        /// Transitive closure of a selection over RunProfile references: for each seed, walk its
        /// RunProfile rows (Key = the called profile name) and pull in any that resolve to a LOCAL
        /// profile, recursively. Mirrors replay's lookup (ActionExecution.HandleRunProfile: Key.Trim()
        /// then LoadProfileByNameAsync's Ordinal name match) so it bundles exactly the sub-profiles
        /// that would actually be called — a case-differing/dangling ref names nothing to include.
        /// Returns the seeds plus every newly-pulled dependency, in discovery order.
        /// </summary>
        public async Task<List<string>> ExpandWithRunProfileDependenciesAsync(List<string> seeds)
        {
            var result = new List<string>(seeds);
            var seen = new HashSet<string>(seeds, StringComparer.OrdinalIgnoreCase);
            var queue = new Queue<string>(seeds);
            while (queue.Count > 0)
            {
                var profile = await LoadProfileByNameAsync(queue.Dequeue());
                if (profile == null) continue;
                foreach (var act in profile.Actions)
                {
                    if (!string.Equals(act.ActionType, "RunProfile", StringComparison.OrdinalIgnoreCase)) continue;
                    var refName = act.Key?.Trim();
                    if (string.IsNullOrEmpty(refName)) continue;
                    // Ordinal match to a local profile — same resolution replay uses, so we never
                    // bundle a profile a dead (case-differing) ref would not actually reach.
                    var localName = ProfileEntries.FirstOrDefault(e => string.Equals(e.Name, refName, StringComparison.Ordinal))?.Name;
                    if (localName != null && seen.Add(localName))
                    {
                        result.Add(localName);
                        queue.Enqueue(localName);
                    }
                }
            }
            return result;
        }

        // Returns (exported count, missing-image count, names of the EXTRA sub-profiles that got
        // bundled by dependency expansion beyond the caller's selection). That third value is the
        // AUTHORITATIVE egress disclosure: it is derived from the envelope actually written, AFTER
        // any Save-on-export flushed the active profile, so it names exactly what left the machine
        // even when the dialog's pre-export "+N included" preview (built from a disk snapshot) was
        // stale. Empty when nothing extra rode along.
        // With `teclado` (the Keyboard page's Export), the game rides beside its macros and names the file;
        // it may run no macro at all, and then the file carries the game alone.
        public async Task<(int exported, int missingImages, List<string> bundledDependencies, string? savedPath)> ExportProfilesAsync(List<string> profileNames, bool includeOrganization = false, bool includeDependencies = false, TecladoService.Game? teclado = null)
        {
            var envelope = new ProfileExportEnvelope { Teclado = teclado };
            // Original selection, captured before dependency expansion mutates profileNames, so we
            // can name what the closure ADDED (envelope profiles minus these) for the export toast.
            var seedNames = new HashSet<string>(profileNames, StringComparer.OrdinalIgnoreCase);
            // Distinct (profile, imagePath) refs whose PNG was gone on disk at export time, so the
            // export toast can warn the sender that some rows will arrive broken. Keyed profile+path
            // to mirror the per-profile-per-path dedup the `images` dict does below.
            var missingImagePaths = new HashSet<string>();

            // Show the Save dialog BEFORE building the envelope — the build loop below reads every
            // reference PNG as base64 (the expensive part), so a cancel here must waste none of it.
            // defaultName comes from the SELECTED names; dependency expansion (if any) only grows the
            // count afterwards, so a single selection that pulls deps still names the sensible default.
            // Multi-profile default carries the date: the literal "macros" made every successive
            // export overwrite the previous one in the sender's Save dialog.
            var defaultName = teclado != null
                ? string.Concat(teclado.Name.Split(Path.GetInvalidFileNameChars())).Trim()
                : profileNames.Count == 1
                ? profileNames[0]
                : S.ProfilesNamesExport(date: DateTime.Now.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture));
            var fileName = await ShowFileDialogAsync(new WinForms.SaveFileDialog
            {
                Title = S.ProfilesPickerExport,
                Filter = $"{S.ProfilesFilterMacros} (*.trprofile)|*.trprofile",
                FileName = defaultName,
                DefaultExt = "trprofile"
            }, "export macros");
            if (fileName == null) return (-1, 0, new List<string>(), null);   // user cancelled the Save dialog — nothing built yet

            // Optionally pull in the sub-profiles this selection RunProfile-calls (transitive closure),
            // so a chain doesn't arrive broken at the receiver. After the dialog so a cancel costs nothing.
            if (includeDependencies)
                profileNames = await ExpandWithRunProfileDependenciesAsync(profileNames);

            foreach (var name in profileNames)
            {
                var profile = await LoadProfileByNameAsync(name);
                if (profile == null) continue;

                // Collect reference images for WaitImage AND IF Image rows — both share the
                // same per-profile PNG storage, so an exported envelope that bundles only the
                // WaitImage PNGs would arrive at the receiver with broken IF Image rows.
                Dictionary<string, string>? images = null;
                foreach (var action in profile.Actions)
                {
                    if (string.IsNullOrEmpty(action.ImagePath)) continue;
                    bool refsImage = action.ActionType == "WaitImage"
                        || (action.CarriesConditionProbe && string.Equals(action.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase));
                    if (refsImage)
                    {
                        var base64 = ImageStorageService.ReadAsBase64(name, action.ImagePath);
                        if (base64 != null)
                        {
                            images ??= new Dictionary<string, string>();
                            images[action.ImagePath] = base64;
                        }
                        else
                        {
                            // PNG missing/unresolvable on disk → this row will export broken.
                            // Record it (deduped) so the export toast can warn the sender.
                            missingImagePaths.Add(name + "\0" + action.ImagePath);
                        }
                    }
                }
                // Automation image-watcher PNG (profile-level, outside Actions) rides the same
                // Images dict — without it the receiver's image trigger probes a missing file.
                if (string.Equals(profile.Triggers?.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase)
                    && !string.IsNullOrEmpty(profile.Triggers?.ImagePath)
                    && (images == null || !images.ContainsKey(profile.Triggers!.ImagePath!)))
                {
                    var trigBase64 = ImageStorageService.ReadAsBase64(name, profile.Triggers!.ImagePath!);
                    if (trigBase64 != null)
                    {
                        images ??= new Dictionary<string, string>();
                        images[profile.Triggers!.ImagePath!] = trigBase64;
                    }
                    else
                    {
                        missingImagePaths.Add(name + "\0" + profile.Triggers!.ImagePath!);
                    }
                }

                // Recompute AppMinVersion on every export so the value always reflects the current
                // action set — never trust the last persisted value, since the user may have
                // edited the profile since the last export and added/removed gating features.
                var computedMinVersion = ProfileCompatibility.ComputeMinVersion(profile);

                // SEC: scrub each action's KeyHtml before it leaves the machine, so a profile that
                // imported a poisoned .trprofile can't launder the hostile markup onward on re-export
                // (the receiver's sink sanitizer protects them, but a pre-sanitizer build would paste
                // it raw). Runs AFTER ComputeMinVersion so emptying a fully-hostile KeyHtml can't drop
                // the exported AppMinVersion below the rich-text pin. `profile` is a throwaway loaded
                // for this export (LoadProfileByNameAsync returns a fresh instance), so mutating its
                // actions in place is safe. KeyMarkdown is pasted as PLAIN text (never CF_HTML), so it
                // is not a markup vector and is left untouched.
                foreach (var a in profile.Actions)
                    if (!string.IsNullOrEmpty(a.KeyHtml))
                        a.KeyHtml = HtmlSanitizer.Sanitize(a.KeyHtml);

                envelope.Profiles.Add(new ProfileExportEntry
                {
                    Name = name,
                    CustomHotkey = profile.CustomHotkey,
                    CustomHotstring = profile.CustomHotstring,
                    TargetWindow = profile.TargetWindow,
                    UseRelativeCoordinates = profile.UseRelativeCoordinates,
                    WindowWidth = profile.WindowWidth,
                    WindowHeight = profile.WindowHeight,
                    WindowX = profile.WindowX,
                    WindowY = profile.WindowY,
                    RestorePosition = profile.RestorePosition,
                    RestoreSize = profile.RestoreSize,
                    BringToFocus = profile.BringToFocus,
                    TriggerMode = profile.TriggerMode,
                    BatchDelay = profile.BatchDelay,
                    IsDisabled = profile.IsDisabled,
                    // Per-profile loop travels with the export. Normalized here too so an
                    // older profile.json still holding the 0 sentinel exports as 1×.
                    EnableLoop = profile.EnableLoop,
                    LoopCount = UserProfile.NormalizeLoopCount(profile.LoopCount),
                    LoopIntervalEnabled = profile.LoopIntervalEnabled,
                    LoopInterval = profile.LoopInterval >= 0 ? profile.LoopInterval : 0,
                    GameMode = profile.GameMode,
                    RestoreCursor = profile.RestoreCursor,
                    DelayVariation = profile.DelayVariation,
                    FastApproach = profile.FastApproach,
                    Actions = profile.Actions,
                    Images = images,
                    Data = profile.Data,
                    Triggers = profile.Triggers,
                    // Sharing metadata — copy verbatim from the source profile so the .trprofile
                    // carries description/tags/etc for the receiver's Import Preview.
                    Description = profile.Description,
                    Tags = profile.Tags,
                    CreatedAt = profile.CreatedAt,
                    UpdatedAt = profile.UpdatedAt,
                    ProfileVersion = profile.ProfileVersion,
                    AppMinVersion = computedMinVersion,
                    IconEmoji = profile.IconEmoji
                });
            }

            // None of the requested names loaded — distinct from cancel. A game still makes a file.
            if (envelope.Profiles.Count == 0 && teclado == null) return (0, 0, new List<string>(), null);

            if (includeOrganization)
            {
                var exportedNames = new HashSet<string>(envelope.Profiles.Select(p => p.Name));
                envelope.Organization = new ProfileExportOrganization
                {
                    Pinned = _profileOrder.Pinned.Where(n => exportedNames.Contains(n)).ToList(),
                    Folders = _profileOrder.Folders
                        .Where(f => f.Items.Any(i => exportedNames.Contains(i)))
                        .Select(f => new ProfileFolder
                        {
                            Name = f.Name,
                            Color = f.Color,
                            Collapsed = false,
                            Items = f.Items.Where(i => exportedNames.Contains(i)).ToList(),
                            TargetWindow = f.TargetWindow,
                            UseRelativeCoordinates = f.UseRelativeCoordinates,
                            BringToFocus = f.BringToFocus,
                            RestorePosition = f.RestorePosition,
                            RestoreSize = f.RestoreSize,
                            WindowX = f.WindowX,
                            WindowY = f.WindowY,
                            WindowWidth = f.WindowWidth,
                            WindowHeight = f.WindowHeight
                        }).ToList(),
                    UngroupedOrder = _profileOrder.UngroupedOrder.Where(n => exportedNames.Contains(n)).ToList()
                };
            }

            var options = new JsonSerializerOptions
            {
                WriteIndented = true,
                PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                TypeInfoResolver = new DefaultJsonTypeInfoResolver()
            };

            var json = JsonSerializer.Serialize(envelope, options);
            // Atomic temp+move so a mid-write crash can't truncate an existing export (item-d).
            await Services.FileHelper.WriteAllTextAtomicAsync(fileName, json);
            // Sub-profiles that rode along beyond the selection — read off the ACTUAL envelope in
            // its authored order, so the toast names exactly what shipped (immune to the dialog's
            // possibly-stale preview). Empty unless dependency expansion added something.
            var bundledDependencies = envelope.Profiles
                .Select(p => p.Name)
                .Where(n => !seedNames.Contains(n))
                .ToList();
            // savedPath rides back so the bridge can offer "Show in folder" on the success
            // toast — the reveal handler only ever opens the path the backend itself wrote.
            return (envelope.Profiles.Count, missingImagePaths.Count, bundledDependencies, fileName);
        }

        /// <summary>
        /// Phase 1 of the two-step import flow. Opens the file picker and parses the .trprofile
        /// envelope without writing anything to disk. Caller (WebViewBridge.HandleProfileImport)
        /// holds the parsed envelope server-side and ships preview metadata to the frontend so
        /// the user can review + select before any disk write happens.
        ///
        /// Returns a discriminated <see cref="ImportPrepareResult"/>: Cancelled is the ONE
        /// legitimate silent case (user closed the picker); TooLarge / ReadError / ParseError /
        /// NoProfiles are real failures the bridge surfaces as an error toast so a corrupt import
        /// is never indistinguishable from a cancel. With <paramref name="droppedFile"/> (a file
        /// dropped on the first-run screen) there is no picker: that file is read.
        /// </summary>
        public async Task<ImportPrepareResult> PrepareImportPreviewAsync(string? droppedFile = null)
        {
            // Title + InitialDirectory: the .trprofile the user just received almost always
            // sits in Downloads, and the untitled picker opened wherever Windows last was.
            // Honest caveat: Windows honours InitialDirectory only until this app has a
            // last-visited MRU folder for the dialog — after the first pick, the MRU wins.
            // Still worth it: it fixes exactly the first-run case where the user is most
            // lost. A null Downloads (shell refusal) leaves the default behavior.
            var fileName = droppedFile ?? await ShowFileDialogAsync(new WinForms.OpenFileDialog
            {
                Title = S.ProfilesPickerImport,
                Filter = $"{S.ProfilesFilterMacros} (*.trprofile)|*.trprofile",
                DefaultExt = "trprofile",
                InitialDirectory = Interop.NativeMethods.TryGetDownloadsFolder() ?? string.Empty
            }, "import macros");

            if (fileName == null) return new ImportPrepareResult(ImportPrepareStatus.Cancelled, null, null, null);

            try
            {
                // Reject an oversized/hostile .trprofile before reading it into memory (OOM guard).
                var info = new FileInfo(fileName);
                if (info.Length > 50L * 1024 * 1024)
                {
                    try { DiagnosticLog.Info("[Import] File exceeds 50 MB — refused."); } catch { }
                    return new ImportPrepareResult(ImportPrepareStatus.TooLarge, null, fileName, null);
                }
                // Read + migrate + deserialize off the UI thread — MigrateProfileJson + JsonSerializer.Deserialize are synchronous CPU work that would otherwise block WinUI.
                // ParseImportEnvelope returns a TUPLE (not an out param) so it composes inside Task.Run.
                var (envelope, parseError) = await Task.Run(() => ParseImportEnvelope(File.ReadAllText(fileName)));
                return parseError switch
                {
                    ImportParseError.None => new ImportPrepareResult(ImportPrepareStatus.Ok, envelope, fileName, null),
                    ImportParseError.NoProfiles => new ImportPrepareResult(ImportPrepareStatus.NoProfiles, null, fileName, null),
                    _ => new ImportPrepareResult(ImportPrepareStatus.ParseError, null, fileName, null),
                };
            }
            catch (Exception ex)
            {
                try { DiagnosticLog.Info($"[Import] Read error: {ex.Message}"); } catch { }
                // Detail follows a colon in the bridge's notice: the engine's own sentence for the
                // common failures (in use, access denied…), in the interface's language.
                return new ImportPrepareResult(ImportPrepareStatus.ReadError, null, fileName, S.Reason(ex));
            }
        }

        /// <summary>
        /// Migrate + deserialize + validate a .trprofile JSON string into an envelope. Returns the
        /// envelope with <see cref="ImportParseError.None"/>, or (null, Malformed) when the JSON is
        /// corrupt/unreadable, or (null, NoProfiles) when it parses but carries no profiles — the
        /// caller maps those to distinct user-facing messages. Sole caller: PrepareImportPreviewAsync.
        /// </summary>
        public static (ProfileExportEnvelope? envelope, ImportParseError error) ParseImportEnvelope(string json)
        {
            try
            {
                json = SettingsManager.MigrateProfileJson(json);
                var options = new JsonSerializerOptions
                {
                    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
                    PropertyNameCaseInsensitive = true,   // tolerate a hand-edited/foreign .trprofile with PascalCase or mixed keys
                    TypeInfoResolver = new DefaultJsonTypeInfoResolver()
                };
                var envelope = JsonSerializer.Deserialize<ProfileExportEnvelope>(json, options);
                if (envelope == null) return (null, ImportParseError.NoProfiles);
                envelope.Profiles ??= new List<ProfileExportEntry>();
                // A Keyboard game exported alone (its keys run no macro) is a file with something in it.
                if (envelope.Profiles.Count == 0 && envelope.Teclado == null) return (null, ImportParseError.NoProfiles);
                return (envelope, ImportParseError.None);
            }
            catch (Exception ex)
            {
                // DiagnosticLog (not Debug.WriteLine): the latter is compiled out of Release, which is
                // exactly why a corrupt import produced no trace for the user to report.
                try { DiagnosticLog.Info($"[Import] ParseImportEnvelope error: {ex.Message}"); } catch { }
                return (null, ImportParseError.Malformed);
            }
        }

        /// <summary>
        /// Phase 2 of the two-step import flow. Writes the user-selected subset of profiles
        /// from a previously parsed envelope, using the per-profile conflict resolution
        /// decided ahead-of-time in the React Import Preview dialog. Filters out profiles
        /// whose AppMinVersion exceeds the running app version as a safety net (the
        /// frontend already disables them, but trust-and-verify).
        ///
        /// `conflictResolutions` maps the source profile name → Overwrite | Rename | Skip.
        /// Missing entries default to Rename (safest — never silently destroys local work).
        /// The old `ShowImportConflictDialogAsync` is no longer called; the React dialog
        /// surfaces all decisions up-front so the import runs without further prompts.
        /// </summary>

        /// <summary>
        /// Allocate the next free "baseName (N)" (N from 2) for an import, skipping names already on
        /// disk OR claimed earlier in this batch. The single source of the Rename + Overwrite-collision
        /// numbering used in ConfirmImportAsync.
        /// </summary>
        private static string AllocateImportName(string baseName, string profileDir, ISet<string> allocated)
        {
            int counter = 2;
            string finalName, path;
            do
            {
                finalName = $"{baseName} ({counter})";
                path = Path.Combine(profileDir, finalName + ".json");
                counter++;
            } while (File.Exists(path) || allocated.Contains(finalName));
            return finalName;
        }

        public async Task<(int imported, int skipped, bool hasOrganization, List<string> imageFailureNames, List<string> writtenNames, List<string> adoptedFolderTargets, List<string> keptLocalFolderTargets, List<(string requested, string final)> renamedPairs)> ConfirmImportAsync(
            ProfileExportEnvelope envelope,
            HashSet<string> selectedNames,
            Dictionary<string, ImportConflictResult> conflictResolutions)
        {
            bool hasOrganization = envelope.Organization != null;
            string profileDir = AppIdentity.ProfilesDir;
            Directory.CreateDirectory(profileDir);

            string runningVersion = typeof(ProfileController).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";

            int imported = 0;
            int skipped = 0;

            // Only iterate the entries the user actually selected. Maintains source order so
            // multi-profile imports feel deterministic. Declared up here because RecordImageFailure
            // (below) reads its Count to decide whether to profile-label a failure.
            //
            // EXACT names: the preview lists every envelope entry as its own row, so an envelope
            // carrying "Farm" and "farm" shows two checkboxes, and ticking one must not import both.
            // Case-insensitive matching is for conflicts with profiles already on disk, below.
            var chosen = new HashSet<string>(selectedNames, StringComparer.Ordinal);
            var toImport = envelope.Profiles.Where(p => chosen.Contains(p.Name)).ToList();

            // Names of reference PNGs that didn't restore (present-but-rejected OR absent-from-envelope),
            // deduped so two rows sharing one missing path count once. The bridge names them in the
            // warning toast — the old int count said "N couldn't be restored" without saying WHICH.
            var imageFailureNames = new List<string>();
            var imageFailureSeen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            // Record one failed reference image. Labels with the profile name only when the batch
            // imports more than one profile (so a single-profile import stays terse); dedups on the
            // labelled string so two rows sharing a path count once within a profile but the same
            // filename in two profiles stays distinct.
            void RecordImageFailure(string imageName, string profileFinalName)
            {
                var label = toImport.Count > 1 ? $"{profileFinalName}: {imageName}" : imageName;
                if (imageFailureSeen.Add(label)) imageFailureNames.Add(label);
            }

            // Canonical Profiles dir (with trailing separator) for the containment check below.
            string canonicalProfileDir = Path.GetFullPath(profileDir);
            if (!canonicalProfileDir.EndsWith(Path.DirectorySeparatorChar))
                canonicalProfileDir += Path.DirectorySeparatorChar;

            // Names already claimed by earlier entries in THIS batch. The rename loop below only
            // consulted File.Exists, which misses collisions against an earlier selected entry that
            // either (a) shares the same source name with no pre-existing file on disk, or (b) was
            // assigned a "name (N)" that a later entry then independently computes to the same value.
            // Tracking allocations here keeps the numbering consistent and prevents two imports
            // silently resolving to the same path. Seeded as collisions are resolved below.
            var allocatedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Maps each successfully-imported entry's ORIGINAL envelope name -> the finalName it was
            // written under (== original unless a Rename/Overwrite collision bumped it to "name (N)").
            // This is both the rename map AND the authoritative "names actually imported this batch"
            // set, threaded into MergeImportedOrganizationAsync so renamed imports get re-foldered /
            // re-pinned under their new name (BUG3 fix). Ordinal-ignore-case so org name lookups match
            // regardless of casing, mirroring allocatedNames / onDisk.
            var importedRenames = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            // COLLISION renames only, for the user-facing result disclosure: (post-.json-strip
            // requested name, allocated "name (N)"). Deliberately NOT derived from importedRenames,
            // whose keys are raw envelope names — "Farm.json" → "Farm" is a suffix strip, not a
            // collision, and must not be reported as "name was taken".
            var renamedPairs = new List<(string requested, string final)>();

            // Every profile this batch actually wrote, kept for the RunProfile reference remap that
            // runs after the loop (see below). Held purely to avoid re-reading what we just wrote —
            // the remap is still a genuine SECOND write pass, since the rename set isn't complete
            // until the loop ends. Cheap: profile.Actions IS entry.Actions (same collection), so this
            // holds no more action data than the envelope already does.
            var writtenProfiles = new List<(string FinalName, string TargetPath, UserProfile Profile)>();

            // original name -> finalName, for entries this batch actually BUMPED. Drives the remap
            // pass after the loop. Populated inside the loop from the loop-local (entry.Name,
            // finalName) pair — deliberately NOT rebuilt from importedRenames afterwards, even
            // though that dictionary holds the same pairs: it is OrdinalIgnoreCase, and .NET's
            // indexer keeps the FIRST-inserted key when a later comparer-equal name lands in the
            // same bucket. A hand-crafted envelope carrying both "Farm" and "farm" therefore
            // collapses to one slot whose key is a name the caller never wrote — which would rewrite
            // a CORRECT reference onto the wrong profile. Keying off the loop-local name keeps the
            // two variants in distinct slots. ORDINAL to match replay resolution (see the pass).
            var renamedTargets = new Dictionary<string, string>(StringComparer.Ordinal);

            foreach (var entry in toImport)
            {
                // Per-entry isolation (minimal-diff wrap): a single throwing entry (bad
                // SaveProfileAsync, malformed data) is logged, counted as skipped, and the batch
                // continues — instead of unwinding out of the whole import and losing the entries
                // already written. Body indentation left as-is to keep the diff reviewable.
                try
                {
                // Hard compatibility gate — refuse to write a profile the running app can't run.
                // Frontend already filters but a stale preview or hand-crafted message could slip
                // through. Counted as skipped so the user sees the number.
                if (!ProfileCompatibility.IsCompatible(entry.AppMinVersion, runningVersion))
                {
                    skipped++;
                    continue;
                }
                // Authoritative path-traversal guard. entry.Name comes verbatim from the untrusted
                // .trprofile envelope and feeds Path.Combine below; a name like "..\\..\\evil" would
                // escape the Profiles dir. Reject anything that isn't a bare file name. Skipped+counted
                // so a poisoned entry never silently writes outside the sandbox.
                if (!IsSafeProfileName(entry.Name))
                {
                    skipped++;
                    continue;
                }
                // Strip a ".json" the envelope already carries, instead of appending a second one.
                // Import was the only writer that appended unconditionally: the create and rename
                // paths in WebViewBridge both do `if (!name.EndsWith(".json")) name += ".json"`.
                // So an entry named "Farm.json" landed on disk as "Farm.json.json" and showed up
                // as "Farm.json" (the display name is GetFileNameWithoutExtension), while the very
                // same name typed into the UI produced "Farm.json" on disk and showed "Farm".
                // Worse, the File.Exists conflict check below compared "Farm.json.json" against an
                // existing "Farm.json" and found no conflict, so the import silently created a
                // second profile that every `FirstOrDefault(p => p.Name == name)` lookup in the app
                // could shadow — one of them unreachable: it would not open, rename or delete.
                // IsSafeProfileName above is already extension-insensitive (it validates the part
                // before the dot), so what is stripped here is exactly what it approved.
                string importName = entry.Name;
                if (importName.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                    importName = importName[..^5];
                // "\.json" on its own strips to nothing. Skipped and counted like any other
                // rejected entry rather than allowed to become an empty file name.
                if (string.IsNullOrWhiteSpace(importName))
                {
                    skipped++;
                    continue;
                }
                string targetPath = Path.Combine(profileDir, importName + ".json");
                string finalName = importName;

                // Treat a name claimed by an earlier batch entry the same as a name already on disk —
                // both must trigger conflict resolution so we never assign two imports the same path.
                if (File.Exists(targetPath) || allocatedNames.Contains(finalName))
                {
                    // Look up the user's decision from the preview dialog. Default Rename when
                    // the entry is missing — matches the safest default the dialog already uses.
                    var resolution = conflictResolutions.TryGetValue(entry.Name, out var r)
                        ? r
                        : ImportConflictResult.Rename;

                    if (resolution == ImportConflictResult.Skip)
                    {
                        skipped++;
                        continue;
                    }

                    if (resolution == ImportConflictResult.Rename)
                    {
                        finalName = AllocateImportName(importName, profileDir, allocatedNames);
                        targetPath = Path.Combine(profileDir, finalName + ".json");
                    }
                    // Overwrite: leave targetPath / finalName as-is — File.WriteAllTextAsync below
                    // replaces the existing file atomically. Guard against a second selected entry
                    // also overwriting the SAME target: if an earlier batch entry already claimed
                    // this name, fall back to a fresh "name (N)" so the later import isn't lost.
                    else if (resolution == ImportConflictResult.Overwrite && allocatedNames.Contains(finalName))
                    {
                        finalName = AllocateImportName(importName, profileDir, allocatedNames);
                        targetPath = Path.Combine(profileDir, finalName + ".json");
                    }
                }

                var profile = new UserProfile
                {
                    Actions = entry.Actions ?? new ObservableCollection<ActionItem>(),
                    CustomHotkey = entry.CustomHotkey,
                    CustomHotstring = entry.CustomHotstring,
                    TargetWindow = entry.TargetWindow,
                    UseRelativeCoordinates = entry.UseRelativeCoordinates,
                    WindowWidth = entry.WindowWidth,
                    WindowHeight = entry.WindowHeight,
                    WindowX = entry.WindowX,
                    WindowY = entry.WindowY,
                    RestorePosition = entry.RestorePosition,
                    RestoreSize = entry.RestoreSize,
                    BringToFocus = entry.BringToFocus,
                    TriggerMode = entry.TriggerMode,
                    BatchDelay = entry.BatchDelay ?? "Delay (ms)",
                    IsDisabled = entry.IsDisabled,
                    // Per-profile loop. Import is a TRUST BOUNDARY: a hand-crafted or
                    // legacy .trprofile can carry 0 (the old "forever" sentinel), a negative,
                    // or 99999. Normalize on the way in so the sentinel can never re-enter
                    // through sharing — BuildLoopConfig clamps again at run time, but a bad
                    // value written to disk here would show a wrong number in the UI.
                    EnableLoop = entry.EnableLoop,
                    LoopCount = UserProfile.NormalizeLoopCount(entry.LoopCount),
                    LoopIntervalEnabled = entry.LoopIntervalEnabled,
                    LoopInterval = entry.LoopInterval >= 0 ? entry.LoopInterval : 0,
                    // A bool? has no out-of-range value to normalize — null (absent) follows.
                    GameMode = entry.GameMode,
                    RestoreCursor = entry.RestoreCursor,
                    // The jitter does: a percent, 0..100, the bound the Replay options keep.
                    DelayVariation = entry.DelayVariation is int jitter ? Math.Clamp(jitter, 0, 100) : null,
                    FastApproach = entry.FastApproach,
                    // Round-trip sharing metadata. Pre-metadata .trprofile files leave these null
                    // (System.Text.Json default-inits when the property is missing in the JSON),
                    // which is exactly what we want — the Info tab will render "Unknown" / empty.
                    // Clamped to the same 500 the metadata handler enforces, because a .trprofile
                    // is a FILE — hand-edited, or written by an older build — and this was the one
                    // door into the field that did not check. The editor only clamps what the user
                    // types, so a 3 200-character description arrived intact, showed "3200 / 500",
                    // and the first keystroke in the textarea destroyed 2 700 characters in
                    // silence. Cut where it ENTERS, once.
                    Description = entry.Description != null && entry.Description.Length > MaxDescriptionLength
                        ? entry.Description.Substring(0, MaxDescriptionLength)
                        : entry.Description,
                    Tags = entry.Tags,
                    CreatedAt = entry.CreatedAt,
                    UpdatedAt = entry.UpdatedAt,
                    // ProfileVersion has a non-null default of 1 on ProfileExportEntry, so a missing
                    // field in the JSON deserializes to 1 anyway. Keep that behaviour explicit here.
                    ProfileVersion = entry.ProfileVersion > 0 ? entry.ProfileVersion : 1,
                    AppMinVersion = entry.AppMinVersion,
                    IconEmoji = entry.IconEmoji,
                    Data = entry.Data,
                    // Armed is FORCED off on import: a shared .trprofile must never start
                    // self-firing (interval/schedule/condition-driven mouse+keyboard) the
                    // moment import completes — the receiver re-arms explicitly.
                    Triggers = DisarmedTriggerClone(entry.Triggers)
                };
                // No RestoreSize inference here: ParseImportEnvelope already ran the envelope
                // through SettingsManager.MigrateProfileJson, which infers on the raw JSON of each
                // entry — so entry.RestoreSize is already the migrated value. Re-running it on the
                // deserialized profile is what made the flag impossible to switch off.

                // Defense in depth: confirm the resolved write path stays directly inside the
                // Profiles dir before writing. Also re-validates the rename-derived finalName
                // ("name (N)"). Mirrors ImageStorageService.TryResolveImageFile's containment check.
                if (!Path.GetFullPath(targetPath).StartsWith(canonicalProfileDir, StringComparison.OrdinalIgnoreCase))
                {
                    skipped++;
                    continue;
                }

                await SettingsManager.SaveProfileAsync(targetPath, profile);
                // Claim this name for the batch only AFTER a successful write, so a throwing save
                // (caught per-entry below) doesn't leave the name claimed and needlessly bump a
                // later same-named entry to "name (2)".
                allocatedNames.Add(finalName);

                // Restore embedded WaitImage / If-ImageFound reference images, tracking which keys
                // actually landed on disk. A silently-missing PNG turns WaitImage / If-ImageFound
                // into a replay-halting no-op for the receiver, so we then count every image-
                // referencing row whose PNG never got written — covering BOTH the present-but-
                // unwritable case AND the missing-in-envelope case (dropped at export, BUG-3).
                var restoredKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                if (entry.Images != null && entry.Images.Count > 0)
                {
                    foreach (var kvp in entry.Images)
                    {
                        if (ImageStorageService.SaveFromBase64(kvp.Value, finalName, kvp.Key))
                            restoredKeys.Add(kvp.Key);
                        else
                            RecordImageFailure(kvp.Key, finalName); // present-but-rejected (bad name / not a PNG / corrupt base64) — SaveFromBase64 logged the reason
                    }
                }
                // Same refsImage predicate as the export collector so both sides agree on which
                // rows need a PNG. Counts per dead row (two rows sharing a missing path count 2).
                foreach (var imgAction in profile.Actions)
                {
                    if (string.IsNullOrEmpty(imgAction.ImagePath)) continue;
                    bool refsImage = imgAction.ActionType == "WaitImage"
                        || (imgAction.CarriesConditionProbe && string.Equals(imgAction.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase));
                    // Count only genuinely-absent PNGs: not restored from this envelope AND not
                    // already present on disk (an Overwrite re-import may legitimately omit images
                    // the receiver already has — those rows still resolve at replay).
                    if (refsImage
                        && !restoredKeys.Contains(imgAction.ImagePath)
                        && !ImageStorageService.ReferenceImageExists(finalName, imgAction.ImagePath))
                        RecordImageFailure(imgAction.ImagePath!, finalName); // absent-from-envelope (dropped at export, BUG-3)
                }

                // The automation trigger's own reference PNG, which the loop above cannot see: it
                // walks Actions, and a watcher's image lives on Triggers. The EXPORT collector does
                // include it, so the sender was warned that the envelope was missing a file while
                // the receiver was told nothing — the comment above claims both sides agree on
                // which images matter, and this is the row where they did not.
                //
                // Only the absent-from-envelope case needs adding: a present-but-rejected image is
                // already reported by the Images loop, which walks every key. The profile also
                // arrives DISARMED, so nothing fires blind — arming it later stops the watcher with
                // "reference image missing", which is the deliberate behaviour. This is about the
                // receiver knowing at import time.
                var trig = profile.Triggers;
                if (trig != null
                    && !string.IsNullOrEmpty(trig.ImagePath)
                    && string.Equals(trig.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase)
                    && !restoredKeys.Contains(trig.ImagePath)
                    && !ImageStorageService.ReferenceImageExists(finalName, trig.ImagePath))
                    RecordImageFailure(trig.ImagePath!, finalName);

                imported++;
                // Record original -> final so the org merge can remap folder/pin references. Keyed by
                // the original envelope name (what org.Folders / org.Pinned reference); value is the
                // name actually written on disk ("name (N)" when renamed). Only reached on a real
                // write, so Skipped/incompatible/unsafe entries are never added — exactly the gate the
                // merge needs (no dangling refs, never touches the pre-existing same-named profile).
                importedRenames[entry.Name] = finalName;
                // Same gate as importedRenames (only reached on a real write), so the remap pass
                // below can never touch a skipped/incompatible entry or a pre-existing profile.
                writtenProfiles.Add((finalName, targetPath, profile));
                // Record the rename for the RunProfile remap. Exact-case Ordinal comparison so this
                // is precisely "did a collision bump this entry?" — a Skip never gets here, so a
                // "keep mine" ref correctly keeps pointing at the recipient's local copy.
                if (!string.Equals(entry.Name, finalName, StringComparison.Ordinal))
                    renamedTargets[entry.Name] = finalName;
                // importName (post-strip) vs finalName differs ONLY when AllocateImportName bumped
                // a collision — exactly the "landed under a different name" fact the result dialog
                // must disclose. renamedTargets above can't serve here: its key is the RAW envelope
                // name, so a mere ".json" strip would read as a rename.
                if (!string.Equals(importName, finalName, StringComparison.Ordinal))
                    renamedPairs.Add((importName, finalName));
                }
                catch (Exception ex)
                {
                    try { DiagnosticLog.Info($"[Import] Skipped '{entry.Name}': {ex.Message}"); } catch { }
                    skipped++;
                    continue;
                }
            }

            // ── RunProfile reference remap (second write pass) ──────────────────────────────
            // A renamed sub-profile leaves its callers' RunProfile rows pointing at the ORIGINAL
            // name. That name isn't dangling on the receiving machine — it late-binds to the
            // RECIPIENT's unrelated same-named profile and EXECUTES it. Renaming a profile in-app
            // already carries this obligation (HandleProfileRename -> ScanRunProfileReferencesAsync,
            // "otherwise those references become silent no-ops at replay time"); import was the one
            // path that forgot.
            //
            // WHY AFTER THE LOOP: SaveProfileAsync above is per-entry, and renamedTargets is filled
            // per-entry too, so it is incomplete at every iteration. Rewriting in-loop would fix only
            // refs to targets processed EARLIER in the envelope — and [A(calls B), B] (caller before
            // callee) is the common authoring order, i.e. exactly the failing case. (Building the MAP
            // in-loop is fine and is what we do; only the REWRITE has to wait for the full map.)
            // Deferring the writes themselves isn't an option either: allocatedNames is claimed only
            // after a successful write, and the per-entry try/catch counts a throwing save as skipped
            // and continues the batch. Both need the write to stay inside the iteration.
            //
            // WHY ORDINAL (both the renamedTargets comparer and the Trim below): replay resolves a
            // sub-profile by Ordinal equality on the TRIMMED key — HandleRunProfile does
            // action.Key?.Trim(), then LoadProfileByNameAsync matches `p.Name == profileName`. The
            // remap must mirror that EXACTLY. Matching ignore-case would hit a Key of "farm" against
            // an envelope entry "Farm" and rewrite it to the exact "Farm (2)", which DOES resolve —
            // turning a reference that is dead-but-harmless today into one that starts firing
            // synthetic input. If LoadProfileByNameAsync is ever aligned to OrdinalIgnoreCase, this
            // comparer and that Trim must be revisited in the SAME change.
            if (renamedTargets.Count > 0)
            {
                // Only profiles THIS batch wrote. Deliberately not ScanRunProfileReferencesAsync
                // despite the exact shape match: that one walks every profile on disk and would
                // repoint the recipient's pre-existing, untouched profiles at freshly-imported
                // renames. It's the reference implementation, not a callee.
                foreach (var (finalName, targetPath, profile) in writtenProfiles)
                {
                    bool touched = false;
                    foreach (var act in profile.Actions)
                    {
                        if (act.ActionType != "RunProfile") continue;
                        var refName = act.Key?.Trim();
                        if (string.IsNullOrEmpty(refName)) continue;
                        if (renamedTargets.TryGetValue(refName, out var newName))
                        {
                            act.Key = newName;
                            touched = true;
                        }
                    }
                    if (!touched) continue;

                    // Own isolation, mirroring the per-entry try/catch above: the profile is already
                    // correctly written and only its refs are stale, so a failed re-save must not
                    // unwind the batch.
                    try
                    {
                        await SettingsManager.SaveProfileAsync(targetPath, profile);
                        DiagnosticLog.Info($"[Import] Remapped RunProfile reference(s) in '{finalName}'.");
                    }
                    catch (Exception ex)
                    {
                        try { DiagnosticLog.Info($"[Import] RunProfile remap re-save failed for '{finalName}': {ex.Message}"); } catch { }
                    }
                }
            }

            if (imported > 0)
                await RefreshProfileListAsync(true);

            // Merge organization if present
            var adoptedFolderTargets = new List<string>();
            var keptLocalFolderTargets = new List<string>();
            if (hasOrganization && imported > 0)
            {
                (adoptedFolderTargets, keptLocalFolderTargets) =
                    await MergeImportedOrganizationAsync(envelope.Organization!, importedRenames);

                // Refresh AGAIN, after the merge. The refresh above ran before folder membership
                // and folder targets existed, so everything derived from them was computed against
                // the pre-merge layout: PopulateEffectiveTargets, the hotkey-collision buckets
                // (which group by effective target, so imported profiles looked target-less and
                // collisions were judged against the wrong signature), and — the one with teeth —
                // InputHookManager.RegisterProfileWindowTargets, whose snapshot is what the
                // low-level hook consults to decide whether a hotkey may fire from the current
                // foreground window. An UNREGISTERED profile is treated as "any window", so a
                // freshly imported macro whose target is folder-inherited would fire anywhere
                // until something else happened to reload the list. Since almost every profile
                // here inherits its target from its folder rather than setting its own, that is
                // the normal case, not an edge.
                await RefreshProfileListAsync(true);
            }

            // Final on-disk names actually written this batch (== source name unless a collision
            // bumped it to "name (N)"). The bridge uses this to detect whether the profile
            // currently loaded in the grid was overwritten, so it can reload it instead of
            // leaving a stale in-memory copy that a later Save would clobber the import with.
            return (imported, skipped, hasOrganization, imageFailureNames, importedRenames.Values.ToList(), adoptedFolderTargets, keptLocalFolderTargets, renamedPairs);
        }

        // Delegates to the shared validator (single owner for this security/data-loss check —
        // was duplicated here + in WebViewBridge). Guards against a malicious/buggy .trprofile
        // envelope smuggling path separators/traversal, a trailing dot/space, or a reserved
        // device name into a profile name that later feeds Path.Combine.
        private static bool IsSafeProfileName(string name) => Services.ProfileNameValidator.IsSafe(name);

        /// <returns>Names of EXISTING folders whose empty window context this import filled in —
        /// the caller reports them, because a target quietly appearing is as confusing as one
        /// quietly missing.</returns>
        private async Task<(List<string> Adopted, List<string> KeptLocal)> MergeImportedOrganizationAsync(
            ProfileExportOrganization org,
            IReadOnlyDictionary<string, string> importedRenames)
        {
            // Only honour pins/folder-membership for profiles that THIS import actually wrote.
            // importedRenames maps each imported entry's original envelope name (what org.Folders /
            // org.Pinned reference) -> the name it landed under on disk ("name (2)" when a collision
            // forced a rename). Gating on the map replaces the old onDisk gate while fixing BUG3:
            //   * Skipped / incompatible / unsafe entries are absent from the map -> excluded.
            //   * A renamed import is remapped to its new name -> re-foldered / re-pinned correctly.
            //   * The pre-existing same-named profile was NOT imported, so it's never in the map and
            //     is never re-pinned / moved (no dangling refs, no clobbering local layout).
            // RefreshProfileListAsync(true) ran in the caller, so the remapped names exist on disk.

            // Folders whose window context this import filled in — reported to the caller so the
            // result can say so out loud. A target arriving (or NOT arriving) silently is what made
            // the original bug invisible.
            var adoptedFolderTargets = new List<string>();
            // Folders where the receiver already had a DIFFERENT target, so the sender's was dropped.
            var keptLocalFolderTargets = new List<string>();

            // Merge pinned: add new pinned items that aren't already pinned, remapped to final names.
            foreach (var name in org.Pinned ?? Enumerable.Empty<string>())  // null-guard: explicit JSON "pinned":null overrides the =new() initializer
            {
                if (importedRenames.TryGetValue(name, out var finalName) && !_profileOrder.Pinned.Contains(finalName))
                    _profileOrder.Pinned.Add(finalName);
            }

            // Merge folders: add new folders, merge items into existing folders
            foreach (var importedFolder in org.Folders ?? Enumerable.Empty<ProfileFolder>())
            {
                // Copy into a fresh list (don't alias the deserialized, untrusted collection into
                // the long-lived _profileOrder) and remap each item through importedRenames — keeping
                // only items this import wrote, under their final ("name (N)") name.
                var folderItems = (importedFolder.Items ?? new List<string>())  // Items can be null via explicit JSON null
                    .Where(importedRenames.ContainsKey)
                    .Select(n => importedRenames[n])
                    .ToList();

                // A folder that contributed NOTHING must not be created. folderItems comes out
                // empty whenever the user deselected its rows in the preview, or the compat gate
                // skipped them — and the old code still added the folder, so the receiver got a
                // phantom folder they never asked for, carrying the sender's window target.
                if (folderItems.Count == 0) continue;

                // Case-INSENSITIVE, matching how the app itself decides two folder names are the
                // same everywhere else (CreateFolderAsync / RenameFolderAsync both reject a
                // case-variant as a duplicate). With an ordinal match, a receiver whose folder is
                // "roblox" against a sender's "Roblox" got a SECOND folder, which the load-time
                // duplicate heal then renamed to "Roblox (2)" — and their own folder never received
                // the target.
                var existingFolder = _profileOrder.Folders
                    .FirstOrDefault(f => string.Equals(f.Name, importedFolder.Name, StringComparison.OrdinalIgnoreCase))
                    // The examples' folder is named in the interface's language (Examples / Exemplos):
                    // whoever switched languages already has it under the other name, and a second
                    // folder of examples beside it would only split them.
                    ?? (ExampleLibrary.IsFolderName(importedFolder.Name)
                        ? _profileOrder.Folders.FirstOrDefault(f => ExampleLibrary.IsFolderName(f.Name))
                        : null);
                // A profile belongs to exactly ONE folder. Every effective-target resolver in this
                // file picks the owning folder with FirstOrDefault(f => f.Items.Contains(name)), so
                // a name left in two folders resolves to whichever sits EARLIER in the list — the
                // receiver's pre-existing one. On an Overwrite import that silently handed the
                // profile the wrong window target (or none) even though the merge had stored the
                // right one, and it rendered the profile twice in the sidebar. Detach first.
                foreach (var other in _profileOrder.Folders)
                {
                    if (ReferenceEquals(other, existingFolder)) continue;
                    foreach (var item in folderItems) other.Items.Remove(item);
                }

                if (existingFolder != null)
                {
                    // Merge items into existing folder
                    foreach (var item in folderItems)
                    {
                        if (!existingFolder.Items.Contains(item))
                            existingFolder.Items.Add(item);
                    }

                    // ...and adopt the folder's WINDOW CONTEXT when the local folder has none.
                    //
                    // This branch used to copy Items only, which made the import silently
                    // receiver-dependent: a clean machine took the "add as new folder" path below
                    // and got the target, while a machine that already had a folder of that name
                    // got the profiles into a folder with NO target. Most profiles here INHERIT
                    // their target from the folder rather than setting their own, so the result is
                    // a macro that runs against whatever window happens to be focused — the exact
                    // failure a real user reported, and one nothing on screen explains.
                    //
                    // Only fill a GAP, never overwrite: a local folder that already carries a
                    // target is the receiver's own configuration and outranks the sender's. That
                    // keeps the merge idempotent and keeps re-importing from clobbering local work.
                    if (existingFolder.TargetWindow == null && importedFolder.TargetWindow != null)
                    {
                        existingFolder.TargetWindow = importedFolder.TargetWindow;
                        // The switches and geometry only mean anything alongside a target, so they
                        // travel as ONE unit with it. Splitting them would let a folder end up with
                        // "restore size" on and nothing to restore.
                        existingFolder.UseRelativeCoordinates = importedFolder.UseRelativeCoordinates;
                        existingFolder.BringToFocus = importedFolder.BringToFocus;
                        existingFolder.RestorePosition = importedFolder.RestorePosition;
                        existingFolder.RestoreSize = importedFolder.RestoreSize;
                        existingFolder.WindowX = importedFolder.WindowX;
                        existingFolder.WindowY = importedFolder.WindowY;
                        existingFolder.WindowWidth = importedFolder.WindowWidth;
                        existingFolder.WindowHeight = importedFolder.WindowHeight;
                        adoptedFolderTargets.Add(existingFolder.Name);
                    }
                    else if (importedFolder.TargetWindow != null
                             && existingFolder.TargetWindow != null
                             && !string.Equals(existingFolder.TargetWindow.ProcessName,
                                               importedFolder.TargetWindow.ProcessName,
                                               StringComparison.OrdinalIgnoreCase))
                    {
                        // Local target kept, sender's discarded — the right call, but not one to
                        // make silently: the imported profiles are now inside a folder pointing at
                        // a DIFFERENT window than the author intended, and they will run against it.
                        keptLocalFolderTargets.Add(existingFolder.Name);
                    }
                }
                else
                {
                    // Add as new folder
                    _profileOrder.Folders.Add(new ProfileFolder
                    {
                        Name = importedFolder.Name,
                        Color = importedFolder.Color,
                        Collapsed = false,
                        Items = folderItems,
                        TargetWindow = importedFolder.TargetWindow,
                        UseRelativeCoordinates = importedFolder.UseRelativeCoordinates,
                        BringToFocus = importedFolder.BringToFocus,
                        RestorePosition = importedFolder.RestorePosition,
                        RestoreSize = importedFolder.RestoreSize,
                        WindowX = importedFolder.WindowX,
                        WindowY = importedFolder.WindowY,
                        WindowWidth = importedFolder.WindowWidth,
                        WindowHeight = importedFolder.WindowHeight
                    });
                }

                // Remove imported folder items from ungrouped
                foreach (var item in folderItems)
                    _profileOrder.UngroupedOrder.Remove(item);
            }

            await SaveProfileOrderAsync();
            return (adoptedFolderTargets, keptLocalFolderTargets);
        }

        // ShowImportConflictDialogAsync was removed in 2.2.0 — conflict resolution moved
        // into the React Import Preview dialog (per-profile inline picker + bulk toolbar),
        // which eliminates the awkward C# dialog that crammed Overwrite/Rename/Skip plus
        // Overwrite-All/Skip-All into one screen. See ImportPreviewDialog.tsx.

        #endregion

        #region Profile Organization (Folders + Pin)

        public ProfileOrderData GetProfileOrder() => _profileOrder;

        private async Task LoadProfileOrderAsync()
        {
            // Built in a LOCAL and published once whole. Deserializing straight into _profileOrder
            // made the half-pruned object the live one while the prune below still ran.
            ProfileOrderData order;
            bool retryWrite = false;
            if (_profileOrderUnwritten)
            {
                // Memory is ahead of the file (the last write failed — see _profileOrderUnwritten):
                // re-reading it would undo the unsaved change. Keep memory, normalise it like a
                // fresh read, and retry the write at the end.
                order = _profileOrder;
                retryWrite = true;
                DiagnosticLog.Info("[Profiles] profile-order.json is behind memory (its last write failed); keeping the in-memory layout and retrying the write.");
            }
            else if (!File.Exists(ProfileOrderPath))
            {
                order = new ProfileOrderData();
                _profileOrderUnreadable = false;
                _profileOrderKnown = true;
            }
            else
            {
                var read = await Services.FileHelper.TryReadAllTextSharedAsync(ProfileOrderPath);
                if (!read.Ok)
                {
                    // UNREADABLE is not CORRUPT. A lock that outlived the retries (a scanner, OneDrive,
                    // the indexer at boot) used to land in the parse catch below: a backup that failed
                    // on the same lock, then a reset to an empty layout — whose next save, any pin or
                    // folder move, wrote that emptiness over a file that was never broken. Memory is
                    // kept instead. After a successful read this session it IS the layout (every edit
                    // writes through), and the next reload reads the file again. Before one — at boot —
                    // it is an empty stand-in, and _profileOrderUnreadable keeps SaveProfileOrderAsync
                    // from writing it until a read succeeds.
                    order = _profileOrder;
                    DiagnosticLog.Error("LoadProfileOrder: profile-order.json could not be read — the layout in memory is kept and the file is not written until it can be read",
                        read.Error ?? new IOException("unknown read failure"));
                    if (!_profileOrderKnown)
                    {
                        if (!_profileOrderUnreadable)
                            OnAlert?.Invoke(S.ProfilesOrderLocked, "info");
                        _profileOrderUnreadable = true;
                    }
                }
                else
                {
                    _profileOrderUnreadable = false;
                    _profileOrderKnown = true;
                    try
                    {
                        order = JsonSerializer.Deserialize<ProfileOrderData>(read.Text, OrderJsonOptions) ?? new ProfileOrderData();
                    }
                    catch (Exception ex)
                    {
                        // The order file exists but won't parse. Resetting to an empty order and letting a
                        // later save run would PERMANENTLY wipe the user's folders/pins/colours — UNLESS the
                        // original bytes are preserved first. So: copy the unreadable file to .bak (the
                        // recovery point) and alert the user, THEN reset to an empty order. A subsequent save
                        // may overwrite the corrupt original, but the .bak keeps a faithful copy to restore
                        // from, and not blocking saves means the user's first layout edit still persists.
                        DiagnosticLog.Error("LoadProfileOrder parse failed", ex);
                        try
                        {
                            string backupPath = ProfileOrderPath + ".bak";
                            File.Copy(ProfileOrderPath, backupPath, overwrite: true);
                            OnAlert?.Invoke(S.ProfilesOrderBackedUp(file: Path.GetFileName(backupPath)), "error");
                        }
                        catch (Exception backupEx)
                        {
                            DiagnosticLog.Error("LoadProfileOrder backup failed", backupEx);
                            OnAlert?.Invoke(S.ProfilesOrderReset, "error");
                        }
                        order = new ProfileOrderData();
                    }
                }
            }

            // An explicit JSON null overrides the = new() initializers, and every line below would
            // throw on it — taking the whole profile list reload down with it.
            order.Pinned ??= new List<string>();
            order.Folders ??= new List<ProfileFolder>();
            order.UngroupedOrder ??= new List<string>();
            order.Folders.RemoveAll(f => f == null);
            foreach (var folder in order.Folders)
                folder.Items ??= new List<string>();

            // Keep only names that still exist, respelled the way the disk spells them NOW.
            //
            // AllKnownProfileNames, not just ProfileEntries: a profile whose JSON failed to parse
            // this pass (AV/OneDrive holding the file, a half-flushed save) is still on disk and
            // usually readable next pass, but is absent from ProfileEntries. Pruning against
            // ProfileEntries alone strips it from Pinned/Folders/UngroupedOrder in memory, and the
            // next unrelated SaveProfileOrderAsync (pin, folder, move, rename) persists that loss —
            // silently dropping the pin and folder-inherited window target.
            //
            // Case-insensitive, like the file system that decides what a profile is: a profile
            // renamed only in case — in Explorer, or by an Overwrite import writing "Foo" over
            // "foo.json" — kept its old spelling in here, an exact-match prune dropped it, and it
            // fell out of its pin and folder (and so off its folder's window target) into Ungrouped.
            var current = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var n in AllKnownProfileNames) current.TryAdd(n, n);
            List<string> Keep(List<string> names)
            {
                var kept = new List<string>(names.Count);
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (var n in names)
                    if (n != null && current.TryGetValue(n, out var spelled) && seen.Add(spelled)) kept.Add(spelled);
                return kept;
            }
            order.Pinned = Keep(order.Pinned);
            foreach (var folder in order.Folders)
                folder.Items = Keep(folder.Items);
            order.Folders.RemoveAll(f => f.Items.Count == 0 && string.IsNullOrEmpty(f.Name));
            order.UngroupedOrder = Keep(order.UngroupedOrder);

            // Add any profiles not mentioned in order data to ungrouped
            var allReferenced = new HashSet<string>(order.Pinned);
            foreach (var folder in order.Folders)
                foreach (var item in folder.Items)
                    allReferenced.Add(item);
            foreach (var item in order.UngroupedOrder)
                allReferenced.Add(item);

            foreach (var entry in ProfileEntries)
            {
                if (!allReferenced.Contains(entry.Name))
                    order.UngroupedOrder.Add(entry.Name);
            }

            // Heal duplicate folder names (case-insensitive) that may have slipped in before the
            // create/rename guards existed. Duplicates break every by-Name folder lookup (delete /
            // colour / folder-inherited target all hit the FIRST match, orphaning the rest), so we
            // trim names and suffix the later collisions "Name (2)", "Name (3)", … Persisted only
            // when something actually changed; deterministic, so it re-heals on every load anyway.
            var seenFolderNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            bool folderNamesChanged = false;
            foreach (var folder in order.Folders)
            {
                var baseName = (folder.Name ?? string.Empty).Trim();
                // A name the app writes, so it is born in the interface's language (Folder / Pasta).
                if (string.IsNullOrEmpty(baseName)) baseName = S.ProfilesNamesFolder;
                var unique = baseName;
                int suffix = 2;
                while (seenFolderNames.Contains(unique)) unique = $"{baseName} ({suffix++})";
                if (!string.Equals(unique, folder.Name, StringComparison.Ordinal))
                {
                    folder.Name = unique;
                    folderNamesChanged = true;
                }
                seenFolderNames.Add(unique);
            }

            _profileOrder = order;
            PublishFolderContexts();
            // Never while the file is unreadable: that save would be refused and would come back
            // here to read again (see SaveProfileOrderAsync).
            if ((folderNamesChanged || retryWrite) && !_profileOrderUnreadable) await SaveProfileOrderAsync();
        }

        // True while the layout in memory is AHEAD of profile-order.json: the last write failed.
        // LoadProfileOrderAsync then keeps memory instead of re-reading the stale file — every list
        // reload (any profile saved, the watcher, an import) used to replace the layout with the
        // disk copy, silently undoing a move into a folder. That is not cosmetic: the folder is
        // where an inheriting profile gets its window target and coordinate space from.
        private bool _profileOrderUnwritten;

        // True once memory reflects profile-order.json this session: a read succeeded, the file
        // was absent, or a write went through. Until then, a read that fails leaves memory as a
        // stand-in rather than the layout.
        private bool _profileOrderKnown;

        // True while profile-order.json EXISTS but could not be read and memory has never been
        // the layout this session (see _profileOrderKnown): SaveProfileOrderAsync then refuses to
        // write the stand-in over the real file. Cleared by the next read that succeeds.
        private bool _profileOrderUnreadable;

        public async Task SaveProfileOrderAsync()
        {
            // Every layout edit ends here, synchronously after the mutation — so this is where the
            // engine's frozen copy catches up, before the first await.
            PublishFolderContexts();
            if (_profileOrderUnreadable)
            {
                // Memory holds the stand-in for a file that could not be read, plus the change just
                // made to it; written, the stand-in would replace the real folders and pins. Read the
                // file again instead. If it reads now, its layout takes over and the change is lost
                // — said so; if not, the change stays unsaved, and so does the file.
                await LoadProfileOrderAsync();
                // Either way the change did not take: an error while the file still cannot be read,
                // a notice once it is back (the layout is fine, the change only needs repeating).
                if (_profileOrderUnreadable) OnAlert?.Invoke(S.ProfilesOrderStillUnreadable, "error");
                else OnAlert?.Invoke(S.ProfilesOrderReloaded, "info");
                return;
            }
            await _profileOrderLock.WaitAsync();
            try
            {
                var json = JsonSerializer.Serialize(_profileOrder, OrderJsonOptions);
                await Services.FileHelper.WriteAllTextAtomicAsync(ProfileOrderPath, json);
                _profileOrderUnwritten = false;
                _profileOrderKnown = true;
            }
            catch (Exception ex)
            {
                // Non-fatal for the profiles themselves, but NOT "only the layout": folders carry
                // window targets. Kept in memory and retried by the next reload; said once per
                // failure streak, not per retry.
                DiagnosticLog.Error("SaveProfileOrder write failed", ex);
                if (!_profileOrderUnwritten)
                    OnAlert?.Invoke(S.ProfilesOrderSaveFailed(reason: S.Reason(ex)), "error");
                _profileOrderUnwritten = true;
            }
            finally
            {
                _profileOrderLock.Release();
            }
        }

        public async Task RemoveProfileFromOrderAsync(string name)
        {
            _profileOrder.Pinned.Remove(name);
            _profileOrder.UngroupedOrder.Remove(name);
            foreach (var folder in _profileOrder.Folders)
                folder.Items.Remove(name);
            // Remove empty folders? No — user may want to keep them
            await SaveProfileOrderAsync();
        }

        public async Task RenameProfileInOrderAsync(string oldName, string newName)
        {
            // Update pinned
            var pinnedIndex = _profileOrder.Pinned.IndexOf(oldName);
            if (pinnedIndex >= 0) _profileOrder.Pinned[pinnedIndex] = newName;

            // Update folders
            foreach (var folder in _profileOrder.Folders)
            {
                var itemIndex = folder.Items.IndexOf(oldName);
                if (itemIndex >= 0) folder.Items[itemIndex] = newName;
            }

            // Update ungrouped order
            var ungroupedIndex = _profileOrder.UngroupedOrder.IndexOf(oldName);
            if (ungroupedIndex >= 0) _profileOrder.UngroupedOrder[ungroupedIndex] = newName;

            await SaveProfileOrderAsync();
        }

        public async Task PinProfileAsync(string name)
        {
            if (!_profileOrder.Pinned.Contains(name))
                _profileOrder.Pinned.Add(name);
            await SaveProfileOrderAsync();
        }

        public async Task UnpinProfileAsync(string name)
        {
            _profileOrder.Pinned.Remove(name);
            await SaveProfileOrderAsync();
        }

        // Returns false (changing nothing) when a folder with the same name already exists —
        // compared trimmed + case-insensitively so "Work", "work" and "Work " can't coexist.
        // Duplicate folder names break folder identity (every folder lookup is by Name), so the
        // bridge surfaces a toast on false instead of the old silent no-op.
        public async Task<bool> CreateFolderAsync(string folderName, string color)
        {
            folderName = (folderName ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(folderName)) return false;
            if (_profileOrder.Folders.Any(f => string.Equals(f.Name, folderName, StringComparison.OrdinalIgnoreCase)))
                return false;
            _profileOrder.Folders.Insert(0, new ProfileFolder { Name = folderName, Color = color });
            await SaveProfileOrderAsync();
            return true;
        }

        // Returns false (without renaming) when the target name is empty or already used by a
        // DIFFERENT folder (trimmed + case-insensitive). Renaming a folder onto an existing name
        // used to silently create two folders sharing a name, which corrupts every by-Name lookup
        // (delete / colour / folder-inherited target all hit the wrong one).
        public async Task<bool> RenameFolderAsync(string oldName, string newName)
        {
            newName = (newName ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(newName)) return false;
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Name == oldName);
            if (folder == null) return false;
            // Exact-same-name (ordinal) rename is a no-op → success. A pure re-casing of self
            // ("Work" → "work") is intentionally NOT short-circuited here — it falls through to the
            // collision check below, which excludes THIS folder via ReferenceEquals and then applies
            // a real rename. Do NOT switch this to OrdinalIgnoreCase: that would silently drop
            // legitimate case-only renames.
            if (string.Equals(folder.Name, newName, StringComparison.Ordinal)) return true;
            if (_profileOrder.Folders.Any(f => !ReferenceEquals(f, folder)
                    && string.Equals(f.Name, newName, StringComparison.OrdinalIgnoreCase)))
                return false;
            folder.Name = newName;
            await SaveProfileOrderAsync();
            return true;
        }

        /// <summary>
        /// Removes a folder, and with <paramref name="deleteProfiles"/> the profile files inside it.
        /// Returns the profiles whose file could NOT be deleted — they survive, keep their pin and
        /// move to the ungrouped list, and the caller must neither wipe their images nor treat them
        /// as deleted. The failure used to be swallowed by an empty catch while the name was still
        /// dropped from every order bucket.
        /// </summary>
        public async Task<IReadOnlyList<string>> DeleteFolderAsync(string folderName, bool deleteProfiles = false)
        {
            var failed = new List<string>();
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Name == folderName);
            if (folder != null)
            {
                if (deleteProfiles)
                {
                    // Delete all profile files inside the folder
                    foreach (var item in folder.Items)
                    {
                        var entry = ProfileEntries.FirstOrDefault(p => p.Name == item);
                        if (entry != null && File.Exists(entry.FilePath))
                        {
                            try { File.Delete(entry.FilePath); }
                            catch (Exception ex)
                            {
                                DiagnosticLog.Warn($"[Profiles] Delete All in folder '{folderName}': could not delete '{item}': {ex.Message}");
                                failed.Add(item);
                                if (!_profileOrder.UngroupedOrder.Contains(item))
                                    _profileOrder.UngroupedOrder.Add(item);
                                continue;
                            }
                        }
                        // Remove the deleted profile from every order bucket — not just Pinned —
                        // so its name can't linger as a ghost in UngroupedOrder.
                        _profileOrder.Pinned.Remove(item);
                        _profileOrder.UngroupedOrder.Remove(item);
                    }
                }
                else
                {
                    // Move items back to ungrouped
                    foreach (var item in folder.Items)
                    {
                        if (!_profileOrder.UngroupedOrder.Contains(item))
                            _profileOrder.UngroupedOrder.Add(item);
                    }
                }
                _profileOrder.Folders.Remove(folder);
                await SaveProfileOrderAsync();

                if (deleteProfiles)
                    await RefreshProfileListAsync(true);
            }
            return failed;
        }

        public async Task SetFolderColorAsync(string folderName, string color)
        {
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Name == folderName);
            if (folder != null)
            {
                folder.Color = color;
                await SaveProfileOrderAsync();
            }
        }

        public async Task ToggleFolderCollapseAsync(string folderName)
        {
            var folder = _profileOrder.Folders.FirstOrDefault(f => f.Name == folderName);
            if (folder != null)
            {
                folder.Collapsed = !folder.Collapsed;
                await SaveProfileOrderAsync();
            }
        }

        /// <summary>
        /// Bulk set the collapsed flag on every folder. Used by the panel header's
        /// Collapse-all / Expand-all button (a folder context-menu item until 9beaedb)
        /// — avoids the N disk writes that iterating per-folder
        /// ToggleFolderCollapseAsync would cause.
        /// No-op (no save) if nothing actually changes.
        /// </summary>
        public async Task SetAllFoldersCollapsedAsync(bool collapsed)
        {
            bool changed = false;
            foreach (var folder in _profileOrder.Folders)
            {
                if (folder.Collapsed != collapsed)
                {
                    folder.Collapsed = collapsed;
                    changed = true;
                }
            }
            if (changed) await SaveProfileOrderAsync();
        }

        public async Task MoveToFolderAsync(string profileName, string? folderName)
        {
            // Resolved BEFORE the profile is detached. A folder that no longer exists — deleted or
            // renamed between the drag starting and the drop — used to leave the profile removed
            // from everywhere and added nowhere, and that orphaned layout was saved: the profile
            // vanished from the sidebar until the next full reload. It lands in Ungrouped instead.
            var targetFolder = folderName == null ? null : _profileOrder.Folders.FirstOrDefault(f => f.Name == folderName);
            if (folderName != null && targetFolder == null)
                DiagnosticLog.Warn($"[Profiles] Move of '{profileName}' to folder '{folderName}': no such folder any more — moved to Ungrouped.");

            // Remove from current folder or ungrouped
            foreach (var folder in _profileOrder.Folders)
                folder.Items.Remove(profileName);
            _profileOrder.UngroupedOrder.Remove(profileName);

            if (targetFolder != null)
                targetFolder.Items.Add(profileName);
            else
                _profileOrder.UngroupedOrder.Add(profileName);

            await SaveProfileOrderAsync();
        }

        public async Task ReorderProfilesAsync(List<string>? pinned, List<ProfileFolder>? folders, List<string>? ungrouped)
        {
            // The incoming lists come from the (untrusted) frontend drag/drop payload. Validate every
            // name against the profiles that actually exist on disk before persisting, mirroring the
            // onDisk gate in MergeImportedOrganizationAsync — otherwise a stale or malformed payload
            // could inject names for profiles that don't exist or silently drop real ones into a
            // garbage order file. Unknown names are filtered; duplicates are collapsed (first wins).
            // AllKnownProfileNames, the set LoadProfileOrderAsync keeps: the layout now holds a
            // profile that failed to load this pass, and the frontend sends folders back with their
            // raw items — gating on the loaded ones alone dropped it on the next folder drag.
            var onDisk = AllKnownProfileNames.ToHashSet(StringComparer.Ordinal);
            List<string> Sanitize(List<string> names)
            {
                var result = new List<string>(names.Count);
                var seen = new HashSet<string>(StringComparer.Ordinal);
                foreach (var n in names)
                {
                    if (onDisk.Contains(n) && seen.Add(n))
                        result.Add(n);
                }
                return result;
            }

            if (pinned != null) _profileOrder.Pinned = Sanitize(pinned);
            if (folders != null)
            {
                // Preserve existing folder data (TargetWindow, UseRelativeCoordinates, BringToFocus)
                // Only reorder based on incoming folder names and items
                var reordered = new List<ProfileFolder>();
                foreach (var incoming in folders)
                {
                    var validItems = Sanitize(incoming.Items);
                    var existing = _profileOrder.Folders.FirstOrDefault(f => f.Name == incoming.Name);
                    if (existing != null)
                    {
                        existing.Items = validItems;
                        reordered.Add(existing);
                    }
                    else
                    {
                        incoming.Items = validItems;
                        reordered.Add(incoming);
                    }
                }
                _profileOrder.Folders = reordered;
            }
            if (ungrouped != null) _profileOrder.UngroupedOrder = Sanitize(ungrouped);
            await SaveProfileOrderAsync();
        }

        #endregion

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            if (profileWatcher != null)
            {
                profileWatcher.EnableRaisingEvents = false;
                profileWatcher.Dispose();
                profileWatcher = null;
            }

            lock (_debounceLock)
            {
                debounceCts?.Cancel();
                debounceCts?.Dispose();
                debounceCts = null;
            }

            // Intentionally NOT disposing _profileOrderLock: an in-flight SaveProfileOrderAsync may
            // still be awaiting WaitAsync or sitting between WaitAsync and Release(), and disposing
            // the semaphore underneath it throws ObjectDisposedException (and could leak the slot).
            // SemaphoreSlim holds no unmanaged handle here (AvailableWaitHandle is never queried), so
            // letting the GC reclaim it after the last save completes is safe. The _disposed guard
            // above plus _debounceLock already make any in-flight watcher callback benign.
        }
    }
}
