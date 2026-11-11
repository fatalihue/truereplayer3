using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Text.Json.Serialization;

namespace TrueReplayer.Models
{
    /// <summary>
    /// Determines how a profile's hotkey behaves when pressed.
    /// OnPress  - fire once on key down (current default behavior).
    /// OnRelease - fire once on key up; key down is swallowed but does nothing.
    /// WhilePressed - start replay with infinite loop on key down, cancel on key up (autofire).
    /// Toggle - key down starts replay (respecting loop settings); pressing again stops it.
    /// DoubleTap - fire once when the key is pressed twice within the tap window (single
    ///             presses do nothing — the key is a dedicated trigger, downs are swallowed).
    /// Hold - fire once after the key has been held for the long-press threshold; a quick
    ///        tap does nothing (distinct from WhilePressed, which runs only WHILE held).
    /// </summary>
    [JsonConverter(typeof(JsonStringEnumConverter))]
    public enum TriggerMode
    {
        OnPress,
        OnRelease,
        WhilePressed,
        Toggle,
        DoubleTap,
        Hold
    }

    /// <summary>
    /// The shipped default of each global hotkey — the one place these strings live on the C# side.
    /// AppSettings (fresh install and Reset settings), the UserProfile initializers and the bridge's
    /// null fallbacks all read from here, and Settings › Hotkeys gets them (settings `hotkeyDefaults`)
    /// as the suggested keys. Each site used to restate its literal, and a default change reached some
    /// copies and not others: Foreground moved to Insert on 2026-05-22 and UserProfile.Default kept
    /// Ctrl+Insert; Capture Slot moved to Win+Ctrl+C on 2026-07-19 and the bridge's null fallback
    /// kept "". The frontend's pre-load placeholders (appStateReducers.ts) are a second copy by
    /// necessity (TS×C#), overwritten as soon as settings:loaded arrives.
    /// The suggested keys of the new interface (phase 3): Record and Replay off the tab keys of
    /// Chrome, Edge and VS Code, and Foreground and the Clicker off the bare Insert (overwrite) and
    /// ScrollLock (Excel) they had in TrueReplayer 2. Since 3.0.2 those two are Ctrl+Insert and
    /// Ctrl+Home, the owner's choice (2026-11-05). Like every app hotkey they are swallowed system-wide
    /// while the app runs — other apps lose Ctrl+Insert (copy) and Ctrl+Home (start of the text) — and
    /// Settings › Hotkeys says so under each. A default reaches new installs, Reset and "Use the
    /// suggested keys" only: appsettings.json stores every hotkey, so whoever updates keeps theirs.
    /// </summary>
    public static class HotkeyDefaults
    {
        public const string Recording = "Ctrl+F9";
        public const string Replay = "Ctrl+F10";
        public const string ProfileKeyToggle = "Pause";
        public const string Foreground = "Ctrl+Insert";
        public const string ModeToggle = "Ctrl+Home";
        public const string CaptureSlot = "Win+Ctrl+C";
        // Copy screen text (OCR → clipboard). A Win combo for the same reason as Capture Slot: the
        // shell binds nothing to Win+F12 out of the box (PowerToys Text Extractor sits on
        // Win+Shift+T, so not that one). Empty still means disabled if the user clears it.
        public const string CopyScreenText = "Win+F12";
        // The Clicker's pair, live only in the Clicker mode.
        public const string ClickerStart = "PageDown";
        public const string ClickerPause = "PageUp";
    }

    public class UserProfile
    {
        public static UserProfile Current { get; set; } = Default;

        public ObservableCollection<ActionItem> Actions { get; set; } = new();

        [JsonIgnore]
        public string RecordingHotkey { get; set; } = HotkeyDefaults.Recording;

        [JsonIgnore]
        public string ReplayHotkey { get; set; } = HotkeyDefaults.Replay;

        [JsonIgnore]
        public string ProfileKeyToggleHotkey { get; set; } = HotkeyDefaults.ProfileKeyToggle;

        [JsonIgnore]
        public string ForegroundHotkey { get; set; } = HotkeyDefaults.Foreground;

        // Flips UseCursorClick (Macro ↔ Clicker). Ctrl+Home by default since 3.0.2 (HotkeyDefaults);
        // empty never matches a keypress.
        [JsonIgnore]
        public string ModeToggleHotkey { get; set; } = HotkeyDefaults.ModeToggle;

        // Capture-selection → clipboard slot ({clip:1}…{clip:9}, sequential). Empty = disabled;
        // the shipped default is Win+Ctrl+C — see AppSettings.CaptureSlotHotkey.
        [JsonIgnore]
        public string CaptureSlotHotkey { get; set; } = HotkeyDefaults.CaptureSlot;

        // Copy screen text: hotkey → OCR → clipboard. Region "" = ask (drag each time), or
        // "x,y,w,h" absolute = always read that region. App settings mirrored here like the
        // other global hotkeys — never written into a profile file.
        [JsonIgnore]
        public string CopyScreenTextHotkey { get; set; } = HotkeyDefaults.CopyScreenText;

        [JsonIgnore]
        public string CopyScreenTextRegion { get; set; } = "";

        [JsonIgnore]
        public bool RecordMouse { get; set; } = true;
        [JsonIgnore]
        public bool RecordScroll { get; set; } = true;
        [JsonIgnore]
        public bool RecordKeyboard { get; set; } = true;

        [JsonIgnore]
        public bool UseCustomDelay { get; set; } = true;
        [JsonIgnore]
        public int CustomDelay { get; set; } = 100;

        // ── Per-profile loop (serialized) ──
        // These four used to be [JsonIgnore] global app settings, so profile A set to 3× made
        // profile B's hotkey run 3× too. They now belong to the profile and travel with it
        // (save / export / import). A profile.json written before this feature has no
        // "loopCount" key, so System.Text.Json leaves the initializer below — which is why the
        // default MUST be 1, not 0: the replay engine reads 0 as "run forever". Authored zero
        // is gone entirely for macros (UI floors at 1, BuildLoopConfig clamps 1..999); only
        // the WhilePressed / Toggle trigger modes still produce an infinite run, and they do it
        // through a separate boolean that never touches this field.
        public bool EnableLoop { get; set; } = false;
        public int LoopCount { get; set; } = 1;
        public bool LoopIntervalEnabled { get; set; } = false;
        public int LoopInterval { get; set; } = 200;

        /// <summary>Inclusive bounds for a macro loop count. 0 is NOT a legal authored value.</summary>
        public const int MinLoopCount = 1;
        public const int MaxLoopCount = 999;

        /// <summary>
        /// Single normalizer for every untrusted source of a loop count — disk, .trprofile
        /// import, and hand-edited JSON all funnel through here. Anything &lt;= 0 (including the
        /// legacy "0 = forever" sentinel and a negative from a corrupt file) becomes one pass.
        /// </summary>
        public static int NormalizeLoopCount(int n) => Math.Clamp(n, MinLoopCount, MaxLoopCount);

        // ── Per-profile Game Mode (serialized, optional) ──
        // The macro Game Mode master (ActionReplayer.SmoothMovement) is app-wide, so a Roblox
        // macro and a Notepad macro had to share one answer. This is the profile's own answer:
        // null = it never set one and FOLLOWS — the app default for a run it starts, the caller's
        // effective value when it runs as a sub-profile (RunProfile). Only the master moves here;
        // the Tuning knobs stay global (the Clicker reads them too).
        //
        // bool?, never an enum: an unknown enum string THROWS in an older build's converter and
        // the whole profile fails to load. Written only when set, so a profile that never touched
        // it stays byte-identical on disk (the serializer has no ignore-null policy of its own).
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? GameMode { get; set; }

        // ── Per-profile cursor return (serialized, optional) ──
        // When the run ends — finish, Stop or error — the cursor goes back to where it was when
        // the run started (ActionReplayer.StartAsync). null = FOLLOWS the app default
        // (ActionReplayer.RestoreCursorDefault). Only the ROOT profile of a run decides: a
        // sub-profile's value is ignored in a RunProfile chain, because the end of the run
        // belongs to whoever started it. Same bool? / written-only-when-set rule as GameMode.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? RestoreCursor { get; set; }

        // ── Per-profile jitter and fast approach (serialized, optional) ──
        // The macro's own Jitter (±% on each delay, 0 = none, at most 100) and Fast approach (jump,
        // then walk only the last stretch — it acts with Game Mode on). null = FOLLOWS the app's
        // (Settings) for a run it starts, and the caller's effective value when it runs as a
        // sub-profile — the same chain rule as GameMode, the movement setting they belong with.
        // Same written-only-when-set rule, so a profile that never touched them is unchanged.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public int? DelayVariation { get; set; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? FastApproach { get; set; }

        [JsonIgnore]
        public bool AlwaysOnTop { get; set; } = false;

        [JsonIgnore]
        public bool MinimizeToTray { get; set; } = true;

        [JsonIgnore]
        public bool StartMinimized { get; set; } = false;

        // Out-of-window run-end notifications — global (AppSettings.json), never
        // serialized per-profile. Both opt-in. See WebViewBridge.NotifyRunEnded.
        [JsonIgnore]
        public bool RunEndFlash { get; set; } = false;

        [JsonIgnore]
        public bool RunEndSound { get; set; } = false;

        public string BatchDelay { get; set; } = "Delay (ms)";
        public string? LastProfileDirectory { get; set; }

        public string? CustomHotkey { get; set; }
        public HotstringConfig? CustomHotstring { get; set; }
        public WindowTarget? TargetWindow { get; set; }
        public bool UseRelativeCoordinates { get; set; } = false;
        public int WindowWidth { get; set; } = 0;
        public int WindowHeight { get; set; } = 0;
        public int WindowX { get; set; } = 0;
        public int WindowY { get; set; } = 0;
        public bool RestorePosition { get; set; } = false;
        public bool RestoreSize { get; set; } = false;
        public bool BringToFocus { get; set; } = false;
        public TriggerMode TriggerMode { get; set; } = TriggerMode.OnPress;
        public bool IsDisabled { get; set; }

        // ── Profile metadata (sharing / library) ──
        // All optional with safe defaults so existing profile.json files load unchanged.
        // Description: short text shown in the Info tab and Import Preview. Plain text, ~200 chars.
        public string? Description { get; set; }
        // Tags: free-form labels (lowercased on save). Used for browsing/grouping community profiles.
        // Capped at 10 tags in the UI; backend doesn't enforce a hard limit to avoid breaking imports.
        public List<string>? Tags { get; set; }
        // CreatedAt / UpdatedAt: UTC. Set by ProfileController on create / save. Null on profiles
        // that predate this feature — UI renders "Unknown" rather than inventing a date.
        public DateTime? CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
        // ProfileVersion: author-controlled semver-less integer. Bumped manually when sharing a new
        // revision. Defaults to 1 for both new and pre-existing profiles.
        public int ProfileVersion { get; set; } = 1;
        // AppMinVersion: minimum TrueReplayer version required to run this profile, computed from
        // the feature set used (see ProfileCompatibility). Null = no special requirement (1.0+).
        // Recalculated on every export, stored here so subsequent edits can see the last value.
        public string? AppMinVersion { get; set; }
        // IconEmoji: single emoji character displayed in profile list + Import Preview. Validated
        // on the frontend; backend accepts any string and trims to first grapheme on save.
        public string? IconEmoji { get; set; }

        // Data-loop table (Model A): a small CSV-like table embedded in the profile JSON.
        // When LoopOverData is on, the whole profile re-runs once per row and {row:column}
        // tokens resolve to the current row's cells. null = feature not used (byte-identical
        // for old profiles). Embedded (not a sidecar) since it reuses the profile save/export
        // pipelines for free; large sets would want a sidecar but that's a later increment.
        public ProfileDataTable? Data { get; set; }

        // Automation trigger: fires this profile WITHOUT a hotkey press (interval / clock
        // schedule / watched condition). null = feature unused (byte-identical old profiles,
        // same convention as Data). Armed is persisted so the daemon re-arms at startup,
        // but it is MACHINE-LOCAL intent: import / duplicate / copy paths force it false so
        // a shared or cloned profile can never start self-firing without explicit consent.
        public ProfileTriggerConfig? Triggers { get; set; }

        [JsonIgnore]
        public bool ProfileKeyEnabled { get; set; } = true;

        // Automation master switch mirror (AppSettings-backed, global — same convention as
        // ProfileKeyEnabled above).
        [JsonIgnore]
        public bool AutomationEnabled { get; set; } = true;

        // No hotkeys here: they come from the property initializers (HotkeyDefaults), and neither
        // caller lets them reach the user — ResetProfile re-applies AppSettings right after, and a new
        // profile file never stores them ([JsonIgnore]). Restating them here is how one copy drifted.
        public static UserProfile Default => new UserProfile
        {
            RecordMouse = true,
            RecordScroll = true,
            RecordKeyboard = true,
            UseCustomDelay = true,
            CustomDelay = 100,
            EnableLoop = false,
            LoopCount = 1,
            LoopIntervalEnabled = false,
            LoopInterval = 200,
            ProfileKeyEnabled = true,
            Actions = new ObservableCollection<ActionItem>(),
            BatchDelay = "Delay (ms)",
            CustomHotkey = null,
            CustomHotstring = null
        };
    }

    public class WindowTarget
    {
        public string? ProcessName { get; set; }
        public string? WindowTitle { get; set; }
        public string TitleMatchMode { get; set; } = "contains";  // "contains" | "regex"
    }

    // Data-loop table. Headers name the columns ({row:header}); Rows are the data (each an
    // ordered list of cell strings, aligned to Headers by index; short rows tolerated =
    // missing cells resolve empty). LoopOverData drives the "run the profile once per row"
    // behaviour. Stored inside the profile JSON.
    public class ProfileDataTable
    {
        public List<string> Headers { get; set; } = new();
        public List<List<string>> Rows { get; set; } = new();
        public bool LoopOverData { get; set; }
        // Per-row error policy while looping over data: null/"halt" = stop the run on the
        // first failed row (classic behaviour); "skip" = log the row and continue with the
        // next one. Only meaningful when LoopOverData is on. Ignored-when-null so plain
        // tables stay byte-identical on disk (and in exports) to pre-feature builds.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? OnRowError { get; set; }
        // Cursor mode (LoopOverData OFF) only: announce when a run consumes the LAST row —
        // the list just finished a full pass and the next run wraps back to row 1. Without
        // it the wrap is silent and you only notice by seeing item #1 typed again.
        // null = default ON, so plain tables stay byte-identical on disk and only an
        // explicit opt-out is ever written. Deliberately NOT pinned in ProfileCompatibility:
        // an older build simply ignores the field and skips the notice — the macro itself
        // behaves identically, so there is nothing to warn an importer about.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? NotifyOnLapComplete { get; set; }
    }

    public class HotstringConfig
    {
        public string Sequence { get; set; } = string.Empty;
        public bool Instant { get; set; } = false;  // false = needs Enter/Space/Tab terminator
    }

    // Automation trigger config (one per profile). Kind selects which field group applies;
    // unused groups keep defaults and are harmless in the JSON. Executed by TriggerService —
    // N armed triggers watch concurrently, but fires funnel into the single replay engine
    // (skip-if-busy; there is only one mouse/keyboard).
    public class ProfileTriggerConfig
    {
        public string Kind { get; set; } = "interval";      // "interval" | "schedule" | "condition"
        // Armed = the daemon actively runs this trigger (and re-arms it at startup).
        public bool Armed { get; set; }

        // interval — every N seconds (runtime clamps to >= 5).
        public int IntervalSeconds { get; set; } = 300;

        // schedule — fire at TimeOfDay ("HH:mm", local) on the days in DaysOfWeek
        // (bitmask, Sun = 1<<0 — same convention as the If-Time condition; 0 = every day).
        public string? TimeOfDay { get; set; }
        public int DaysOfWeek { get; set; }

        // condition — poll a probe and fire on a false→true edge (or continuously, see
        // Retrigger). ConditionType: WindowOpen | ProcessRunning | FileExists |
        // PixelColorMatch | ImageFound | ClipboardChanged. Field names mirror the
        // If-condition fields on ActionItem so the concepts stay recognizably the same.
        public string? ConditionType { get; set; }
        public string? WindowProcessName { get; set; }
        public string? WindowTitle { get; set; }
        public string? WindowTitleMatchMode { get; set; }   // "contains" | "regex"
        public bool WindowMatchForegroundOnly { get; set; }

        // PixelColorMatch / ImageFound: ancorar as coordenadas na janela nomeada acima, em vez
        // de tratá-las como absolutas. OPT-IN explícito, e não "tem nome de processo preenchido":
        // trocar o tipo de condição no editor NÃO limpa WindowProcessName/WindowTitle (só os
        // campos de imagem são limpos), então um perfil que passou por WindowOpen carrega o nome
        // como resíduo. Inferir a partir dele mudaria, em silêncio, o ponto amostrado por
        // automações que já funcionam — a regressão que esta flag existe para impedir.
        //
        // Mesmo nome do campo do perfil (UserProfile.UseRelativeCoordinates) porque é a mesma
        // ideia: a coordenada é relativa ao canto da janela alvo.
        [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]
        public bool UseRelativeCoordinates { get; set; }
        public string? FilePath { get; set; }
        public int PixelX { get; set; }
        public int PixelY { get; set; }                     // absolute virtual-screen coords (no rel-coords for watchers)
        public string? PixelColor { get; set; }             // "#RRGGBB"
        public int PixelTolerance { get; set; } = 10;
        public string? ImagePath { get; set; }              // per-profile PNG, same store as WaitImage
        public double ImageConfidence { get; set; } = 0.8;  // runtime clamps to <= 0.99
        // Optional ImageFound search region (sub-rect, ABSOLUTE virtual-screen coords — no rel-coords
        // for watchers, same convention as PixelX/Y). null or W|H <= 0 = full virtual screen. Four
        // nullable ints (mirrors ActionItem.WaitImageSearchX/Y/W/H); treated as a unit.
        public int? SearchRegionX { get; set; }
        public int? SearchRegionY { get; set; }
        public int? SearchRegionW { get; set; }
        public int? SearchRegionH { get; set; }
        public string? ClipboardPattern { get; set; }       // contains-filter; empty = any clipboard change

        // ScreenText (OCR): reads the search region above — REQUIRED for this type, a whole-screen
        // read every tick costs ~0.45 s — and compares like the ScreenText If condition (same
        // names as ActionItem: ConditionOperator/ConditionOperand, OcrReadAs, OcrTextColor/Tolerance;
        // see ScreenTextMatcher). Written only when set, so other trigger types stay byte-identical.
        [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
        public string? ConditionOperator { get; set; }
        [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
        public string? ConditionOperand { get; set; }
        [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
        public string? OcrReadAs { get; set; }
        [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
        public string? OcrTextColor { get; set; }
        [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]
        public int? OcrColorTolerance { get; set; }

        // Firing policy (condition kind): CooldownSeconds <= 0 = the PER-CONDITION default, which
        // is 5 s for ClipboardChanged and 30 s for every other type. Reading "default 30 s" here is
        // what made a hardcoded 30 look right in the editor's seed, quietly overriding the one
        // default that differs — on the watcher that can fire in bursts;
        // Retrigger null/"edge" = must observe the condition false again before the next
        // fire, "level" = keep firing every cooldown while the condition stays true.
        public int CooldownSeconds { get; set; }
        public string? Retrigger { get; set; }

        // Condition poll cadence in ms; 0 = the per-condition default (TriggerService.PollCadenceMs).
        // A watcher's cost is entirely per-tick and very uneven — ImageFound captures the whole
        // virtual screen and runs a template match EVERY tick — so the interval is the one knob that
        // actually trades reaction time for CPU. PINNED ("Automation poll interval" @ 2.9.9): with
        // no [JsonExtensionData] here, an older build doesn't just ignore the property, it DROPS it
        // on any save — silently restoring the CPU cost the user tuned away.
        public int PollIntervalMs { get; set; }

        public ProfileTriggerConfig Clone() => (ProfileTriggerConfig)MemberwiseClone();
    }

    public class ProfileEntry : INotifyPropertyChanged
    {
        public string Name { get; set; } = string.Empty;
        public string FilePath { get; set; } = string.Empty;
        public string? Hotkey { get; set; }
        public string? Hotstring { get; set; }
        public bool HotstringInstant { get; set; }
        /// <summary>
        /// This profile's hotkey is REALLY contested — another enabled profile binds the same
        /// combo with the same effective target, so only one of them will ever fire. Stamped by
        /// GetProfileHotkeys, which is the single definition of "real collision" in the app:
        /// the same hotkey on DIFFERENT targets is not a conflict, it is deliberate routing by
        /// the foreground gate. Not persisted — derived on every list load.
        /// </summary>
        public bool HotkeyConflict { get; set; }
        // ── Profile metadata mirror (read from UserProfile on list load) ──
        // Surfaced here so the sidebar can render icon badges + tag chips without re-reading
        // the whole profile JSON. Not edited directly — Info tab calls profile:set-metadata
        // which reloads the profile, then RefreshProfileListAsync repopulates this entry.
        public string? Description { get; set; }
        public List<string>? Tags { get; set; }
        public string? IconEmoji { get; set; }
        public int ProfileVersion { get; set; } = 1;
        public DateTime? CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public string? AppMinVersion { get; set; }
        // Number of actions in the profile, read at list-load (the profile is already deserialized
        // + its actions iterated there, so this is free). Lets the Export dialog show per-profile
        // weight, matching the Import Preview which already renders "N actions".
        public int ActionCount { get; set; }
        // RunProfile refs this profile calls (the called profile names, trimmed). Mirrored onto
        // the list entry so the Export dialog can DISCLOSE which sub-profiles ride along with a
        // selection, WITHOUT re-reading every profile JSON — the list build already has the
        // actions in hand. (Sub-profiles are always bundled; the dialog names them rather than
        // offering an opt-out, since omitting them ships a chain that breaks silently.) Stored as
        // authored; resolving a ref to a LOCAL profile is an Ordinal match done by the consumer
        // (mirrors ProfileController.ExpandWithRunProfileDependenciesAsync, which is what actually
        // bundles them). null when the profile calls none, so the pushed payload stays lean.
        public List<string>? RunProfileTargets { get; set; }
        // The subset of RunProfileTargets called with "Run once per data row". The CALLED
        // profile's Data panel reads it: a caller walking the sub's table row by row obeys the
        // sub's own On row error (RunSubProfileOverDataAsync), whatever the sub's Loop over data
        // says — so the panel must offer that control there too. Same shape and freshness as
        // RunProfileTargets (read at list-load from the ON-DISK profile; null when none).
        public List<string>? RunOverDataTargets { get; set; }
        public bool HasWindowTarget { get; set; }
        public string? WindowTargetProcessName { get; set; }
        public string? WindowTargetWindowTitle { get; set; }
        public string WindowTargetTitleMatchMode { get; set; } = "contains";
        public bool UseRelativeCoordinates { get; set; }
        public bool BringToFocus { get; set; }
        public bool RestorePosition { get; set; }
        public bool RestoreSize { get; set; }
        // Effective target — what the hotkey gate actually uses for this profile. Differs from
        // HasWindowTarget when the profile has no target of its own but inherits one from its
        // folder. Lets the UI render an "inherited" badge so users can see the gating without
        // having to open the dialog. Populated by ProfileController.LoadProfileListAsync.
        public bool HasEffectiveTarget { get; set; }
        public string? EffectiveTargetSource { get; set; }  // "own" | "folder" | null
        public string? EffectiveTargetFolderName { get; set; }
        public string? EffectiveTargetProcessName { get; set; }
        public string? EffectiveTargetWindowTitle { get; set; }
        public string EffectiveTargetTitleMatchMode { get; set; } = "contains";
        // Whether coordinates for this profile are window-relative once inheritance is applied —
        // UseRelativeCoordinates above is the profile's OWN flag and reads false on a profile that
        // inherits both target and mode from its folder. The UI needs the effective one to say
        // which space an action's X/Y is in.
        public bool EffectiveUseRelativeCoordinates { get; set; }
        public TriggerMode TriggerMode { get; set; } = TriggerMode.OnPress;
        public bool IsDisabled { get; set; }
        // Automation trigger mirror (full config, in-memory only — ProfileEntry is never
        // persisted). Lets TriggerService re-arm and the Automation panel project configs
        // without re-reading every profile JSON. Populated by LoadProfileListAsync.
        public ProfileTriggerConfig? Triggers { get; set; }
        public string Display => string.IsNullOrEmpty(Hotkey) ? Name : $"{Name} ({Hotkey})";

        private bool _isActive;
        public bool IsActive
        {
            get => _isActive;
            set
            {
                if (_isActive != value)
                {
                    _isActive = value;
                    PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsActive)));
                }
            }
        }

        public event PropertyChangedEventHandler? PropertyChanged;
    }

    // ── Profile Organization (Folders + Pin) ──

    public class ProfileFolder
    {
        public string Name { get; set; } = string.Empty;
        public string Color { get; set; } = "#60CDFF";
        public bool Collapsed { get; set; } = false;
        public List<string> Items { get; set; } = new();
        public WindowTarget? TargetWindow { get; set; }
        public bool UseRelativeCoordinates { get; set; } = false;
        public bool BringToFocus { get; set; } = false;
        // Restore Position/Size + window geometry are inheritable just like the target itself.
        // A profile inside the folder uses these unless it overrides them at the profile level.
        // Defaults keep pre-existing folders (saved before this field set) working unchanged.
        public bool RestorePosition { get; set; } = false;
        public bool RestoreSize { get; set; } = false;
        public int WindowX { get; set; } = 0;
        public int WindowY { get; set; } = 0;
        public int WindowWidth { get; set; } = 0;
        public int WindowHeight { get; set; } = 0;
    }

    public class ProfileOrderData
    {
        public List<string> Pinned { get; set; } = new();
        public List<ProfileFolder> Folders { get; set; } = new();
        public List<string> UngroupedOrder { get; set; } = new();
    }

    public class ProfileExportEntry
    {
        public string Name { get; set; } = string.Empty;
        public string? CustomHotkey { get; set; }
        public HotstringConfig? CustomHotstring { get; set; }
        public WindowTarget? TargetWindow { get; set; }
        public bool UseRelativeCoordinates { get; set; } = false;
        public int WindowWidth { get; set; } = 0;
        public int WindowHeight { get; set; } = 0;
        public int WindowX { get; set; } = 0;
        public int WindowY { get; set; } = 0;
        public bool RestorePosition { get; set; } = false;
        public bool RestoreSize { get; set; } = false;
        public bool BringToFocus { get; set; } = false;
        public TriggerMode TriggerMode { get; set; } = TriggerMode.OnPress;
        public string BatchDelay { get; set; } = "Delay (ms)";
        public bool IsDisabled { get; set; }
        // Per-profile loop — mirrors UserProfile. The envelope maps field-by-field (it does NOT
        // serialize UserProfile), so omitting these here would silently drop a 3× profile back
        // to 1× on the receiver. Same 1-not-0 default rule as UserProfile: a pre-feature
        // .trprofile has no key and must deserialize to a single pass, never to "forever".
        public bool EnableLoop { get; set; } = false;
        public int LoopCount { get; set; } = 1;
        public bool LoopIntervalEnabled { get; set; } = false;
        public int LoopInterval { get; set; } = 200;
        // Per-profile Game Mode — mirrors UserProfile.GameMode, same field-by-field reason as the
        // loop fields above. null = follows; omitted when null so a plain export is unchanged.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? GameMode { get; set; }
        // Per-profile cursor return — mirrors UserProfile.RestoreCursor, same rule as GameMode.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? RestoreCursor { get; set; }
        // Per-profile jitter and fast approach — mirror UserProfile's, same rule as GameMode.
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public int? DelayVariation { get; set; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public bool? FastApproach { get; set; }
        public ObservableCollection<ActionItem> Actions { get; set; } = new();
        /// <summary>
        /// Embedded WaitImage reference images: filename → base64 PNG data.
        /// </summary>
        public Dictionary<string, string>? Images { get; set; }
        // ── Sharing metadata (round-tripped to the .trprofile envelope) ──
        // Same fields as UserProfile, copied at export time. All optional — pre-metadata
        // exports omit these and old apps reading new exports ignore unknown keys.
        public string? Description { get; set; }
        public List<string>? Tags { get; set; }
        public DateTime? CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
        public int ProfileVersion { get; set; } = 1;
        // AppMinVersion: semver-ish "MAJOR.MINOR.PATCH" string (e.g. "2.0.0", "2.1.0").
        // Computed by ProfileCompatibility.ComputeMinVersion on every export so it always
        // matches the feature set actually present in the actions.
        public string? AppMinVersion { get; set; }
        public string? IconEmoji { get; set; }
        // Data-loop table — round-tripped to the .trprofile envelope like the other
        // per-profile fields; null omitted, old apps ignore the unknown key.
        public ProfileDataTable? Data { get; set; }
        // Automation trigger — round-tripped so the receiver gets the configuration, but
        // the import builder FORCES Armed=false (a shared profile must never self-fire
        // without the receiver explicitly arming it).
        public ProfileTriggerConfig? Triggers { get; set; }
    }

    public class ProfileExportOrganization
    {
        public List<string> Pinned { get; set; } = new();
        public List<ProfileFolder> Folders { get; set; } = new();
        public List<string> UngroupedOrder { get; set; } = new();
    }

    public class ProfileExportEnvelope
    {
        public int Version { get; set; } = 1;
        public string ExportedAt { get; set; } = DateTime.UtcNow.ToString("o");
        public List<ProfileExportEntry> Profiles { get; set; } = new();
        public ProfileExportOrganization? Organization { get; set; }
        /// <summary>
        /// Teclado (branch teclado, phase 7): the game exported from the Keyboard page, beside the macros
        /// its keys run. Left out of every other export, so their files stay as they were; a TR3 without
        /// the Teclado reads the macros and skips it.
        /// </summary>
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public TrueReplayer.Services.TecladoService.Game? Teclado { get; set; }
    }
}