using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;
using TrueReplayer.Models;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Computes the minimum TrueReplayer version a given profile needs in order to run.
    /// Used at export time so a shared .trprofile carries an AppMinVersion the receiver
    /// can check against their installed version before importing.
    ///
    /// The lookup table is intentionally small — only features that are NEW since the
    /// project's "1.0.0 baseline" need entries. Anything missing from the table is
    /// assumed to be available in 1.0.0. When you add a new action type or a profile-
    /// level switch that wouldn't work on older builds, add a row here and the export
    /// flow picks it up automatically.
    ///
    /// Format choice: plain "MAJOR.MINOR.PATCH" string parsed lazily by IsCompatible —
    /// no NuGet dep on Semver. Pre-release suffixes are not supported (we don't ship
    /// pre-release builds publicly).
    /// </summary>
    public static class ProfileCompatibility
    {
        /// <summary>The version below which we don't bother emitting AppMinVersion at all.</summary>
        private static readonly Version BaselineVersion = new(1, 0, 0);

        /// <summary>
        /// Feature → minimum version that supports it. Add new entries here whenever
        /// you ship a feature that can be persisted into a profile and wouldn't load
        /// on older builds.
        /// </summary>
        private static readonly List<(Func<UserProfile, bool> Detect, Version MinVersion, string FeatureName)> FeatureMatrix = new()
        {
            // WaitImage was added in 2.0 — actions of this type fail on older releases.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "WaitImage", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 0, 0), "WaitImage"),

            // Relative coordinates require the window-tracking pipeline, first released in 2.1.0.
            //
            // Was 2.0.5, a version that NEVER EXISTED: sweeping every <Version> this csproj has
            // ever held shows the 2.x line going straight from 2.0.0 to 2.1.0. Behaviour is
            // unchanged for every build that can actually run — no release falls in [2.0.5,
            // 2.1.0), so "running >= 2.0.5" and "running >= 2.1.0" answer identically — but the
            // number is user-visible in the Info tab and in import diagnostics, and quoting a
            // version nobody can install or upgrade to is a dead end for whoever reads it.
            //
            // Raised to 2.1.0 rather than lowered to 2.0.0 deliberately: 2.0.5 already rejected
            // 2.0.0, so 2.1.0 preserves that verdict, while 2.0.0 would LOOSEN the gate and let a
            // 2.0.0 build import a profile the old pin deliberately kept away from it.
            (p => p.UseRelativeCoordinates,
                new Version(2, 1, 0), "UseRelativeCoordinates"),

            // WhilePressed / Toggle trigger modes landed in 2.1.0; older builds only handle OnPress/OnRelease.
            (p => p.TriggerMode == TriggerMode.WhilePressed || p.TriggerMode == TriggerMode.Toggle,
                new Version(2, 1, 0), "TriggerMode WhilePressed/Toggle"),

            // DoubleTap / Hold trigger modes — an older build's JsonStringEnumConverter THROWS
            // on the unknown enum string: the local profile.json fails to load entirely (a
            // _loadFailures toast, worse than divergence), and inside a .trprofile envelope the
            // parse failure bricks the WHOLE batch with a generic "corrupt file" error before
            // the per-entry compat gate ever runs. The pin can't soften either failure (it is
            // metadata inside the same JSON) — it exists so the export carries an honest
            // AppMinVersion. Introduced after 2.8.1 — bump at release.
            (p => p.TriggerMode == TriggerMode.DoubleTap || p.TriggerMode == TriggerMode.Hold,
                new Version(2, 9, 0), "TriggerMode double-tap/hold"),

            // Mouse X-button hotkey ("XButton1"/"XButton2" in CustomHotkey) — an older build's
            // mouse hook never decodes WM_XBUTTON*, so the hotkey is silently dead (profile
            // loads fine, trigger never fires). Same divergence class as the mode pins.
            // Introduced after 2.8.1 — bump at release.
            (p => p.CustomHotkey?.Contains("XButton", StringComparison.OrdinalIgnoreCase) == true,
                new Version(2, 9, 0), "Mouse-button hotkey"),

            // WaitPixelColor + the pixel:* bridge messages were introduced in 2.1.4.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "WaitPixelColor", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 1, 4), "WaitPixelColor"),

            // Conditional logic (IF / ELSE / ENDIF blocks) — older builds don't understand
            // the new action types and would treat them as no-op rows (worse: the body of
            // a "false" branch would execute unconditionally). Pin the whole feature to
            // 2.3.0 the moment ANY of the three structural rows appears.
            (p => p.Actions.Any(a => !string.IsNullOrEmpty(a.ActionType) && (
                string.Equals(a.ActionType, "If", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(a.ActionType, "Else", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(a.ActionType, "EndIf", StringComparison.OrdinalIgnoreCase))),
                new Version(2, 3, 0), "Conditional logic (If/Else/EndIf)"),

            // IF poll-timeout (ConditionTimeout > 0) shipped 2.6.9. A 2.3.0-2.6.8 build
            // understands IF but ignores this field → does an instant single probe instead of
            // polling up to N ms → can read the condition false before it becomes true and take
            // the Else branch (silent divergence). The field is JsonIgnore-when-default so it is
            // only present when > 0; predicate is exact.
            (p => p.Actions.Any(a => a.ConditionTimeout > 0),
                new Version(2, 6, 9), "IF condition poll timeout"),

            // New If-condition families — an older build hits the unknown-ConditionType
            // else-branch in InstantProbe → treats the probe as false → always takes the
            // Else branch, a silent semantic divergence. Pin to the build that introduces
            // them (2.8.0, the introducing build), same as the
            // ActivateWindow / cycle pins. One row per family so import diagnostics name it.
            (p => p.Actions.Any(a => string.Equals(a.ConditionType, "Random", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 8, 0), "If Random condition"),
            (p => p.Actions.Any(a => string.Equals(a.ConditionType, "Variable", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 8, 0), "If Variable condition"),
            (p => p.Actions.Any(a => string.Equals(a.ConditionType, "ProcessRunning", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 8, 0), "If Process Running condition"),
            (p => p.Actions.Any(a => string.Equals(a.ConditionType, "FileExists", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 8, 0), "If File Exists condition"),
            (p => p.Actions.Any(a => string.Equals(a.ConditionType, "TimeWindow", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 8, 0), "If Time condition"),

            // The 2.6.12 If-condition families have the SAME unknown-ConditionType failure
            // mode as the 2.8.0 block above, but were never pinned. A 2.3.0-2.6.11 build
            // understands If/Else/EndIf yet hits InstantProbe's unknown-condition else-branch
            // → treats the probe as false → always takes the Else branch (silent divergence).
            (p => p.Actions.Any(a => string.Equals(a.ConditionType, "WindowOpen", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 6, 12), "If Window condition"),
            (p => p.Actions.Any(a => string.Equals(a.ConditionType, "ClipboardMatch", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 6, 12), "If Clipboard condition"),
            (p => p.Actions.Any(a => string.Equals(a.ConditionType, "BrowserElementState", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 6, 12), "If Browser element condition"),

            // Data-loop table (Model A) — older builds leave {row:column} tokens literal and
            // don't loop over the rows, a silent divergence. Pin to the introducing build
            // (2.8.0).
            (p => p.Data != null,
                new Version(2, 8, 0), "Data-loop table"),

            // Per-row skip-on-error (OnRowError == "skip") — an older build ignores the unknown
            // JSON property and HALTS the whole run on the first failed row instead of skipping,
            // a silent behavioural divergence. Property-level pin so plain tables keep the
            // 2.8.0 floor. Gated on LoopOverData although skip is NOT inert without it: a For
            // Each Data Row block and a caller's "Run once per data row" read the policy too.
            // Those two paths carry their own pins (For Each 2.25.0, RunProfile over data 2.9.0)
            // and each shipped in the same commit as its skip handling, so no build that runs
            // the path ignores the skip. Introduced after 2.8.1 — bump at release.
            (p => p.Data is { LoopOverData: true } d && string.Equals(d.OnRowError, "skip", StringComparison.OrdinalIgnoreCase),
                new Version(2, 9, 0), "Data-loop skip-on-error"),

            // Data-loop cell modifiers ({row:column:mods}) — an older build's row-token regex
            // requires '}' right after the column name, so the WHOLE token stays literal and
            // gets typed into the target verbatim (worse than the clipboard-mods degradation,
            // where at least the content substitutes). Text-scan over every token-resolved
            // string field. Introduced after 2.8.1 — bump at release.
            (p => p.Actions.Any(UsesModifiedRowToken),
                new Version(2, 9, 0), "Data-loop cell modifiers"),

            // Windows clipboard-history token {winclip:N} — an older build has no WinClipTokenRegex,
            // so the whole token stays literal and gets typed into the target verbatim (same failure
            // class as the modified-row token above). Text-scan over every token-resolved field.
            // Introduced in 2.9.3.
            (p => p.Actions.Any(UsesWinClipToken),
                new Version(2, 9, 3), "Clipboard history token"),

            // Sequential data-row token {rownext:column} — an older build has no RowNextTokenRegex, so
            // the whole token stays literal and gets typed into the target verbatim (same failure class
            // as the modified-row and winclip tokens above). Text-scan over every token-resolved field.
            // Introduced in 2.9.5.
            (p => p.Actions.Any(UsesRowNextToken),
                new Version(2, 9, 5), "Sequential data-row token"),

            // Sequential clipboard token {clipboard:next} — WORSE than the literal-token failures
            // above, because it doesn't look broken. ApplyClipboardModifiers documents that unknown
            // modifiers are silently ignored (forward-compatibility by design), so an older build
            // drops "next" and pastes the ENTIRE clipboard where the author meant ONE line — into a
            // chat, a form, a customer reply. Introduced in 2.9.9.
            (p => p.Actions.Any(UsesClipNextToken),
                new Version(2, 9, 9), "Sequential clipboard token"),

            // Reference modifier argument ("{clipboard:line:@i}", "{row:Qty:first:@n}") — the line
            // index comes from a variable, @counter or @row instead of a literal. An older build
            // has no '@' shape: the argument fails int.TryParse, the modifier is SKIPPED as a typo,
            // and the caller gets the WHOLE clipboard or the whole cell. Same silent class as the
            // sequential-token pin above — the profile imports cleanly and pastes far more than the
            // author meant, into a chat or a customer reply.
            // Detection delegates to ActionReplayer.ChainUsesTokenArg so the pin and the engine
            // cannot disagree about which segments are arguments.
            (p => p.Actions.Any(UsesTokenArgument),
                new Version(2, 9, 10), "Reference modifier argument"),

            // Clipboard list modifiers (range/lines/sort/dedupe/reverse/join) — shipped in 2.8.0
            // and never pinned, which was an omission rather than a decision: they degrade through
            // the SAME silent unknown-modifier default as {clipboard:next} above, so a 2.7.x build
            // pastes the whole unsorted, un-ranged content and looks like it worked. Pinned at the
            // version that introduced them, so no profile that already uses them changes meaning.
            (p => p.Actions.Any(UsesListModifier),
                new Version(2, 8, 0), "Clipboard list modifiers"),

            // Text-slice modifiers ({clipboard:words:6-}, {clipboard:after: - } and the rest of the
            // split family), plus an open-ended span on range ("range:6-", which an older parser
            // refuses outright, leaving `range` inert). Same silent class again: the author asked
            // for a fragment and an older build pastes everything. Introduced in 2.20.0.
            (p => p.Actions.Any(UsesSliceModifier),
                new Version(2, 20, 0), "Text-slice modifiers"),

            // A colon INSIDE a split delimiter, written as the escape "::" ({clipboard:after: :: }).
            // Before this version the split family consumed exactly ONE segment, so an older build
            // reads only the first piece of the delimiter and cuts at the wrong place — or, where
            // the delimiter is nothing but a colon, reads it as EMPTY, leaves the modifier inert
            // and pastes the whole content. Same silent class as the slice pin above: the author
            // asked for a fragment and gets something else without a word.
            // Detection delegates to ActionReplayer.ChainUsesEscapedColon so the pin cannot
            // disagree with the engine about which "::" is an escape — "{clipboard:join::upper}"
            // has meant "glue with nothing" since 2.8.0 and must NOT pin.
            (p => p.Actions.Any(UsesEscapedColonDelimiter),
                new Version(2, 23, 0), "Colon in split delimiter"),

            // The `dropnum` modifier ({clipboard:after: - :dropnum:x } — strip a leading digit
            // run + suffix when present, pass through untouched otherwise). An older build skips
            // the unknown name AND its suffix argument through the silent default, so it pastes
            // WITH the count still attached — and because dropnum is fail-open, the no-prefix
            // case produces identical output on both builds, hiding the divergence until the
            // one paste where it matters. Same silent class as {clipboard:next} above.
            (p => p.Actions.Any(UsesDropNumModifier),
                new Version(2, 24, 0), "Drop count modifier"),

            // The text-filter modifiers ({clipboard:noaccents} strips diacritics, {clipboard:digits}
            // keeps ASCII 0-9 only). An older build skips the unknown names through the silent
            // default and pastes the accented / fully-formatted text where the author asked for the
            // normalized form — the {clipboard:next} silent class. Detection delegates to the
            // engine walk (ChainUsesTextFilter) because the names can also appear as CONSUMED
            // arguments ("after:noaccents:x" is a delimiter, not a modifier) — a regex would
            // over-pin those, and would miss the arg-gate divergence chains ("line:noaccents",
            // where the old build read a failed literal gate and the new build applies the filter).
            // Shipped in 2.25.0.
            (p => p.Actions.Any(UsesTextFilterModifier),
                new Version(2, 25, 0), "Accent/digit filter modifiers"),

            // Random text-choice token {pick:a|b|c} — an older build has no PickTokenRegex, so the
            // whole token stays literal and gets typed into the target verbatim (the winclip
            // literal-token failure class). The ':' is mandatory in the detector, mirroring the
            // engine regex — a bare "{pick}" is literal on BOTH builds and must not pin.
            // Shipped in 2.25.0.
            (p => p.Actions.Any(UsesPickToken),
                new Version(2, 25, 0), "Random choice token"),

            // Ask-Input token {input:Label} / {input:Label|menu:a,b,c} — an older build has no
            // InputTokenRegex, so the whole token stays literal and gets typed into the target
            // verbatim (the winclip literal-token failure class), and the prompt the author built
            // the macro around never appears. Shipped in 2.9.0.
            (p => p.Actions.Any(UsesInputToken),
                new Version(2, 9, 0), "Ask-Input token"),

            // Clipboard-slot token {clip:name} — the READ half of Copy to Slot. The action is pinned
            // below (2.9.0), but a slot is also filled by the capture hotkey with no action in the
            // profile at all, and then nothing pinned the token: an older build has no
            // ClipSlotTokenRegex and types "{clip:1}" verbatim. Shipped in 2.9.0.
            (p => p.Actions.Any(UsesClipSlotToken),
                new Version(2, 9, 0), "Clipboard slot token"),

            // Random number token {random:a-b} — an older build has no RandomTokenRegex and types
            // the token verbatim (the literal-token class). Shipped in 2.8.0.
            (p => p.Actions.Any(UsesRandomToken),
                new Version(2, 8, 0), "Random number token"),

            // Run-state tokens {var:name}, {counter} and bare {row} — shipped together with Set
            // Variable in 2.6.12, and only the ACTION was pinned. A {var:} fed by a later feature
            // ({input:}, a slot), a {counter} in a plain repeating macro or a {row} anywhere had no
            // pin of their own, and an older build types them verbatim. Same floor as Set Variable,
            // so no profile that already carries that action changes its number.
            (p => p.Actions.Any(UsesRunStateToken),
                new Version(2, 6, 12), "Run-state tokens"),

            // The Stop action — ends the run early AS SUCCESS. An older build has no case for
            // it in the replay switch: the row is silently skipped and the run KEEPS GOING past
            // the point the author said "we're done" — the If/Else no-op class, and the rows
            // after a Stop are usually exactly the ones that must not run.
            // Shipped in 2.25.0.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "Stop", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 25, 0), "Stop action"),

            // The Return line — ends only the current pass (repeat iteration / data row); the
            // remaining passes continue. An older build no-ops the row and runs the rest of the
            // pass it was meant to cut short — the same silent-flow class as Stop.
            // Shipped in 2.25.0.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "Return", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 25, 0), "Return flow line"),

            // The While loop block — an older build has no case for While/EndLoop: both rows
            // no-op through the silent default, so the BODY RUNS EXACTLY ONCE regardless of
            // the condition — the If/Else no-op class (2.3.0), on a block whose whole point
            // is repetition. One row of either type pins the feature.
            // Shipped in 2.25.0.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "While", StringComparison.OrdinalIgnoreCase)
                || string.Equals(a.ActionType, "EndLoop", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 25, 0), "While loop"),

            // Break / Next Iteration — an older build no-ops the jump row: a Break-guarded
            // loop keeps looping, a Next keeps running the rest of the iteration it was
            // meant to cut short. Shared row (they ship together, same failure class).
            // Shipped in 2.25.0.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "BreakLoop", StringComparison.OrdinalIgnoreCase)
                || string.Equals(a.ActionType, "ContinueLoop", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 25, 0), "Loop control (Break/Next)"),

            // For Each Data Row — an older build no-ops opener and closer and runs the body
            // ONCE in the ambient context: a block written to fan out over N rows silently
            // degrades to a single pass with whatever {row:col} happens to resolve.
            // Shipped in 2.25.0.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "ForEachRow", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 25, 0), "For Each Data Row block"),

            // Assert quiet-stop (AssertOnFail == "StopReplay") — property-level pin, the
            // SlotMode=='clear' mold. An older build doesn't know the value and falls through
            // to the arms below it: in a plain run that's the LOUD halt (still stops, just
            // with an error toast — benign), but under a skip-mode data loop it's the row-skip
            // arm — the batch KEEPS RUNNING through the very thing the author said should end
            // it quietly. That flip is why this pins. Shipped in 2.25.0.
            (p => p.Actions.Any(a => string.Equals(a.AssertOnFail, "StopReplay", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 25, 0), "Assert quiet-stop policy"),

            // The Else If arm — the WORST degradation in this whole matrix, worse than the
            // While no-op class it otherwise resembles. An older build has no "ElseIf" case in
            // the replay switch AND none in BuildBlockMap, so the marker is invisible twice
            // over: the opening IF sees no branch after it and jumps a false probe straight to
            // the ENDIF, while a TRUE probe runs its body and then walks STRAIGHT THROUGH the
            // ElseIf marker into the next arm's body. So the old build does not merely skip a
            // branch — it EXECUTES TWO of them, firing actions the author wrote as mutually
            // exclusive alternatives. One row pins the feature.
            // Shipped in 2.26.0.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "ElseIf", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 26, 0), "Else If branch"),

            // A modifier chain on {clip:name} / {var:name} / {winclip:N}. Those heads carried no
            // chain before 2.20.0, so an older build's regex does not match the token at all and
            // types it out verbatim — the literal-token failure class of the winclip and
            // modified-row pins above, not the silent one.
            (p => p.Actions.Any(UsesChainOnNameToken),
                new Version(2, 20, 0), "Modifiers on slot/variable/history tokens"),

            // Desktop Assert — the worst possible degradation, which is exactly why it is pinned.
            // An older build has no "Assert" switch case, so the row is silently SKIPPED: the
            // guard the author added ("this window MUST be focused before I type a password")
            // simply does not run, and the macro proceeds as if the precondition held. The user
            // sees a profile that imports cleanly and behaves like the unguarded original.
            // Introduced in 2.9.9.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "Assert", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 9, 9), "Desktop Assert"),

            // Copy to Slot ({clip:name} capture) — an older build has no dispatch case for the
            // unknown ActionType → silently skips the capture and every {clip:} token resolves
            // empty. Introduced after 2.8.1 — bump at release.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "CopyToSlot", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 9, 0), "Copy to Slot"),

            // BrowserAssert — a DEDICATED row (the Browser* predicate below auto-pins 2.1.0,
            // but that is INSUFFICIENT: an older build has no dispatch case for the unknown
            // type, silently SKIPS the assertion → a broken page passes unnoticed. Pin to
            // 2.8.0 (the introducing build).
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "BrowserAssert", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 8, 0), "Browser assert"),

            // Browser actions (BrowserClick/Type/Navigate/WaitElement/SelectOption) all rely on the
            // Chrome extension + native host bridge added in 2.1.0.
            (p => p.Actions.Any(a => !string.IsNullOrEmpty(a.ActionType) &&
                a.ActionType.StartsWith("Browser", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 1, 0), "Browser actions"),

            // HoldKey / Keystroke combos were factored out of the regular Key actions in 2.0.0.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "HoldKey", StringComparison.OrdinalIgnoreCase) ||
                                      string.Equals(a.ActionType, "Keystroke", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 0, 0), "HoldKey/Keystroke"),

            // *ClickHold (press, hold for HoldDurationMs, release — the mouse twin of HoldKey).
            // A DEDICATED row, not a variation on the at-cursor / focus-click property pins
            // below: those describe a property an older build DROPS, while this is an unknown
            // TYPE. The replay switch has no default, so a pre-2.41.0 build skips the row
            // entirely — the press, the dwell and the release all vanish and the macro simply
            // continues without ever having clicked. Same reasoning, and same shape, as the
            // BrowserAssert row above. Pinned to the introducing build.
            (p => p.Actions.Any(a => !string.IsNullOrEmpty(a.ActionType) &&
                a.ActionType.EndsWith("ClickHold", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 41, 0), "Click and hold"),

            // Keystroke × N gap jitter (RepeatDelayJitterPct > 0) — an older build drops the
            // unknown property and fires the burst on a FIXED interval instead of the intended
            // ±% human-like variance (a constant gap is the classic bot tell). Silent behavioural
            // divergence, exactly this matrix's purpose. Property-level Detect so plain Keystroke
            // × N rows keep the 2.0.0 floor. Introduced in 2.9.5.
            (p => p.Actions.Any(a => a.RepeatDelayJitterPct is int rj && rj > 0),
                new Version(2, 9, 5), "Keystroke repeat jitter"),

            // RunProfile (profile chaining) shipped in the 2.0.0 line, same era as WaitImage /
            // HoldKey / Keystroke which ARE pinned here — but it was missed. A pre-2.0.0 build
            // has no "RunProfile" switch case (no default) → silently skips the sub-profile
            // call. Pinned to 2.0.0 for consistency.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "RunProfile", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 0, 0), "RunProfile (profile chaining)"),

            // RunProfile-over-data (data-loop Phase C) — an older build drops the unknown
            // RunOverData property and runs the sub-profile ONCE instead of once per data row
            // (silent divergence; a 40-row batch quietly becomes 1). Property-level Detect so
            // plain RunProfile rows keep the 2.0.0 floor. Introduced after 2.8.1 — bump at release.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "RunProfile", StringComparison.OrdinalIgnoreCase)
                && a.RunOverData == true),
                new Version(2, 9, 0), "RunProfile over data"),

            // Combined-mode single clicks (LeftClick/RightClick/MiddleClick — press+release in one
            // row) shipped in 2.4.0. Builds without the replay switch cases silently skip the click,
            // so pin the profile the moment one appears. Kept in lockstep with the app version so an
            // own-build export → import round-trips cleanly (IsCompatible rejects a pin above the
            // running version).
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "LeftClick", StringComparison.OrdinalIgnoreCase) ||
                                      string.Equals(a.ActionType, "RightClick", StringComparison.OrdinalIgnoreCase) ||
                                      string.Equals(a.ActionType, "MiddleClick", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 4, 0), "Combined clicks (LeftClick/RightClick/MiddleClick)"),

            // Focus click (IsFocusClick — the click is replayed a SECOND time a few pixels away so a
            // small target actually takes focus; see ActionReplayer.FocusTap) shipped in 2.5.2. The
            // 2.4.0 combined-click pin above only covers the click's EXISTENCE, which is why this
            // needs its own row: a 2.4.0-2.5.1 build HAS the replay case, so the row runs and the
            // profile looks fine, but it drops the unknown property and never fires the focus tap.
            // The small target (a Roblox chat box, a narrow form field) gets clicked WITHOUT taking
            // focus, and everything the macro types next goes to whatever was focused before —
            // silent divergence, exactly what this matrix exists to catch. There is no
            // [JsonExtensionData] anywhere in this repo, so that older build also ERASES the flag
            // on its next save of the profile.
            //
            // Property-level Detect gated on the three combined types, because the engine reads the
            // flag ONLY in those cases — on any other row it is runtime-inert and must not raise the
            // floor. Same reasoning as the data-loop skip-on-error pin above.
            (p => p.Actions.Any(a => a.IsFocusClick &&
                (string.Equals(a.ActionType, "LeftClick", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(a.ActionType, "RightClick", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(a.ActionType, "MiddleClick", StringComparison.OrdinalIgnoreCase))),
                new Version(2, 5, 2), "Focus click"),

            // Click × N inline repeat (RepeatCount > 1 on a LeftClick/RightClick/MiddleClick/
            // DoubleClick) — the 2.4.0 (combined) and 2.5.4 (double) pins above only cover the
            // click's EXISTENCE. An older build that HAS the click's replay case but predates this
            // feature ignores RepeatCount on it, so it fires the click ONCE instead of N times — a
            // silent behavioural divergence (a "click 5×" quietly becomes 1). Property-level Detect
            // so plain single/double clicks keep their existing floor. The gap-jitter pin above
            // already covers a click carrying RepeatDelayJitterPct; this adds the plain-count case.
            // Introduced in 2.9.6. TripleClick is deliberately ABSENT from this list: any profile
            // holding one already pins ≥ 2.31.0 through the "Triple click" row below, and
            // ComputeMinVersion takes the MAX — so a term here could never change a result. It
            // would be a check that looks like it does work and does not.
            (p => p.Actions.Any(a => a.RepeatCount > 1 &&
                (string.Equals(a.ActionType, "LeftClick", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(a.ActionType, "RightClick", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(a.ActionType, "MiddleClick", StringComparison.OrdinalIgnoreCase) ||
                 string.Equals(a.ActionType, "DoubleClick", StringComparison.OrdinalIgnoreCase))),
                new Version(2, 9, 6), "Click repeat (× N)"),

            // Click × N POSITION jitter (RepeatPositionJitterPx > 0) — an older build drops the
            // unknown property and fires every repeat at the SAME exact pixel instead of the
            // intended ±px scatter. Same silent-divergence class as the gap-jitter pin above:
            // the profile still runs, it just runs with the bot signature the user turned this
            // on to remove. Property-level Detect so plain click × N rows keep the 2.9.6 floor.
            // Introduced in 2.9.9.
            (p => p.Actions.Any(a => a.RepeatPositionJitterPx is int rp && rp > 0),
                new Version(2, 9, 9), "Click repeat position jitter"),

            // DoubleClick (two press/release pairs replayed as one row) shipped in 2.5.4 —
            // older builds have no replay switch case and would silently skip it.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "DoubleClick", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 5, 4), "Double click"),

            // TripleClick (three press/release pairs replayed as one row, so the target reads a
            // real triple-click — select-a-paragraph, which two DoubleClick rows cannot produce).
            // Older builds have no replay switch case, and the switch has NO default, so the row
            // is a silent no-op. Introduced in 2.31.0.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "TripleClick", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 31, 0), "Triple click"),

            // Click at cursor (AtCursor — the click ignores its stored X/Y and fires at the LIVE
            // cursor position). This is WORSE than a missing-type no-op: an older build HAS the
            // click's replay case, so the row runs — it just drops the unknown property and clicks
            // the STORED coordinate, somewhere else entirely, silently. And with no
            // [JsonExtensionData] anywhere in this codebase that build also ERASES the flag on its
            // next save. Property-level Detect gated on the click types that actually read it, so
            // an inert flag on any other row keeps that row's own floor — same shape as the focus
            // click pin above. Introduced in 2.31.0.
            (p => p.Actions.Any(a => a.AtCursor && ActionItem.IsCombinedClickType(a.ActionType)),
                new Version(2, 31, 0), "Click at cursor"),

            // ActivateWindow (launch/wait/focus a window mid-run) — older builds have no
            // replay switch case and would silently skip the row, leaving the following
            // actions to fire against whatever window happens to be focused. Pinned to
            // the build that introduces it (2.8.0) so an own-build export → import
            // round-trips cleanly — IsCompatible would reject a pin above the running
            // version.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "ActivateWindow", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 8, 0), "Activate Window"),

            // ActivateWindow window PLACEMENT (RestorePosition / RestoreSize + WindowX/Y/Width/
            // Height on the action) shipped AFTER 2.8.0. A 2.8.0 build has the ActivateWindow
            // replay case, so the row itself runs — but it drops the unknown placement properties
            // and activates the window WITHOUT moving/resizing it, leaving any following absolute
            // clicks to land against a wrong-placed window (silent divergence). Introduced in
            // 2.8.1; bumped from the 2.8.0 dev placeholder at release, in lockstep with the
            // version files (see [[workflow-release-procedure]]).
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "ActivateWindow", StringComparison.OrdinalIgnoreCase)
                && (a.RestorePosition || a.RestoreSize)),
                new Version(2, 8, 1), "Activate Window placement"),

            // ActivateWindow Phase 3 — VERB (maximize/minimize/close) + NTH-MATCH shipped after 2.8.1.
            // An older build has the ActivateWindow replay case, so the row runs — but it drops the
            // unknown WindowVerb/WindowMatchIndex and does the DEFAULT (activate the FIRST match),
            // e.g. focuses a window the user meant to CLOSE (silent divergence). Property-level Detect
            // so a plain ActivateWindow keeps the 2.8.0 floor. Pinned at 2.8.1 (≤ the running dev
            // version) so own-export→import round-trips; bump at release with the other pins.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "ActivateWindow", StringComparison.OrdinalIgnoreCase)
                && (!string.IsNullOrEmpty(a.WindowVerb) || (a.WindowMatchIndex is int mi && mi > 1))),
                new Version(2, 9, 0), "Activate Window verb/nth-match"),

            // SetVariable Cycle mode — older builds drop the unknown VariableMode property
            // and run the row in SET mode, storing the ENTIRE multi-line list instead of
            // one item per execution (silent semantic change, exactly what this matrix
            // gates). Pinned to the build that introduces it (2.8.0), same as Activate
            // Window.
            (p => p.Actions.Any(a => string.Equals(a.VariableMode, "cycle", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 8, 0), "Set Variable cycle mode"),

            // Set Variable Add mode — an older build drops the unknown VariableMode and runs the
            // row in SET mode: the counter the author increments is OVERWRITTEN with the step
            // ("1" forever) and a While guarded by it never advances — the cycle-mode silent
            // class. Introduced after 2.36.0 — bump at release if the release number differs.
            (p => p.Actions.Any(a => string.Equals(a.VariableMode, "add", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 37, 0), "Set Variable add mode"),

            // Loop-block tokens {loop} (iteration of the innermost While / For Each block) and
            // {datarow} (number of the current data row), plus the @loop / @datarow references in
            // a modifier chain. An older build types the tokens verbatim (the literal-token class)
            // and resolves the references EMPTY (TryResolveRefArg fails on an unknown name and the
            // int-argument modifiers fail empty rather than paste everything). Introduced after
            // 2.36.0 — bump at release if the release number differs.
            (p => p.Actions.Any(UsesLoopToken),
                new Version(2, 37, 0), "Loop iteration tokens"),

            // Date/time tokens with an argument — an offset ({date:+7}), a format ({time:HH:mm})
            // or both. An older build resolves only the bare {date}/{time}/{datetime} literals, so
            // the whole token is typed verbatim (the literal-token class). Introduced after 2.36.0 —
            // bump at release if the release number differs.
            (p => p.Actions.Any(UsesDateFormatToken),
                new Version(2, 37, 0), "Date/time format and offset"),

            // The value-shaping modifiers (replace / count / pad / default) — an older build skips
            // the unknown names through the silent default (and, for `replace`, its two arguments
            // too): `default` then pastes nothing where the author asked for a fallback and `pad`
            // pastes "7" for "007" — the {clipboard:next} silent class. Detection delegates to the
            // engine walk (ChainUsesShapeModifier): "join:default" is a separator and must not pin.
            // Introduced after 2.36.0 — bump at release if the release number differs.
            (p => p.Actions.Any(UsesShapeModifier),
                new Version(2, 37, 0), "Replace/count/pad/default modifiers"),

            // A modifier chain on {counter} / {loop} / {datarow}. Those heads carried no chain before
            // this version, so an older build's literal Replace does not match the token at all and
            // types it out verbatim — the 2.20.0 slot/variable/history chain pin, for the counters.
            // Introduced after 2.36.0 — bump at release if the release number differs.
            (p => p.Actions.Any(UsesCounterChainToken),
                new Version(2, 37, 0), "Modifiers on counter/loop/datarow tokens"),

            // Generated and machine values — {uuid} (a fresh identifier), {timestamp} (Unix time,
            // `:ms` for milliseconds) and {env:NAME} (an environment variable), each taking the
            // modifier chain. An older build has no resolver for any of them and types the token
            // verbatim (the literal-token class). Introduced after 2.36.0 — bump at release if the
            // release number differs.
            (p => p.Actions.Any(UsesMachineValueToken),
                new Version(2, 37, 0), "UUID/timestamp/env tokens"),

            // Browser Type key grammar = Send Text's (extension 1.4.18, shipped inside this build):
            // {space}, {home}, {end}, {pageup}, {pagedown}, a repeat count on any key ({tab:2}) and
            // {delay:N}. The extension that ships with an older build knows ten bare names and
            // types every one of these into the page as text (the literal-token class). Only the
            // BrowserType text: the other browser actions never press keys. Introduced after
            // 2.36.0 — bump at release if the release number differs.
            (p => p.Actions.Any(UsesBrowserKeyGrammar),
                new Version(2, 37, 0), "Browser Type key tokens (space/home/end/page, repeat, delay)"),

            // A data column named with anything beyond letters, digits and '_' — {row:Nome Completo},
            // {rownext:Preço (R$)}. An older build's RowDataTokenRegex / RowNextTokenRegex stop at
            // the old charset, so the whole token is typed verbatim (the literal-token class), and
            // its Data panel flags the header as an invalid token name. Introduced after 2.36.0 —
            // bump at release if the release number differs.
            (p => p.Actions.Any(UsesWideColumnName),
                new Version(2, 37, 0), "Data column names with spaces or accents"),

            // CopyToSlot Clear mode — an older build drops the unknown SlotMode property and
            // runs the row in CAPTURE mode, grabbing the current selection into the slot
            // instead of emptying it (silent semantic flip, and it fires a synthetic Ctrl+C
            // that a clear was never meant to). Introduced in 2.9.2.
            (p => p.Actions.Any(a => string.Equals(a.SlotMode, "clear", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 9, 2), "Copy to Slot clear mode"),

            // SendText rich text (KeyHtml) shipped AFTER 2.8.0. An older build drops the unknown
            // KeyHtml property and pastes the plain Key — content preserved, formatting silently
            // lost. That is a mild divergence (never literal markup), but formatting can be
            // load-bearing (a bolded warning, a numbered procedure), so gate it like the other
            // property-level pins. Predicate is on the FIELD, so existing plain SendText profiles
            // keep their old floor — and on the ActionType that reads it, because switching a row
            // away from SendText clears neither field. Introduced in 2.8.1; bumped from the
            // 2.8.0 dev placeholder at release, in lockstep with the ActivateWindow placement pin
            // and the version files.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "SendText", StringComparison.OrdinalIgnoreCase)
                && (!string.IsNullOrEmpty(a.KeyHtml) || !string.IsNullOrEmpty(a.KeyMarkdown))),
                new Version(2, 8, 1), "Rich text (SendText)"),

            // SendText typed delivery (SendMethod non-null — the payload is typed key by key via
            // SendInput instead of clipboard + Ctrl+V). An older build HAS the SendText replay case,
            // so the row RUNS — it just drops the unknown property and pastes. The reason the author
            // turned this on is that the target IGNORES Ctrl+V (a game chat, a terminal, an
            // anti-paste field), so that build delivers NOTHING and a following {enter} fires on an
            // empty box: whole content lost, not just formatting, which makes this strictly worse
            // than the rich-text pin above. It also clobbers-and-restores the clipboard the flag
            // exists to leave alone, and with no [JsonExtensionData] it ERASES the flag on save.
            //
            // Predicate is on the FIELD (any non-null SendMethod), not on the value "type": a second
            // typing strategy must add its OWN row at its own floor, because a 2.33.0 build
            // understands "type" and would silently paste anything else. Also gated on the
            // ActionType that reads it — actions:edit "actionType" does not clear the SendText
            // fields, so an inert flag on a row switched away from SendText must not raise that
            // profile's floor (the rich pin above over-pinned exactly that way until it was gated
            // the same). SendCharDelay needs no row of its own: it only means anything when
            // SendMethod is set, and ComputeMinVersion takes the MAX. Introduced in 2.33.0.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "SendText", StringComparison.OrdinalIgnoreCase)
                && !string.IsNullOrEmpty(a.SendMethod)),
                new Version(2, 33, 0), "Typed text delivery (SendText)"),

            // SetVariable base action ('set' mode, VariableMode null) shipped in 2.6.12.
            // Builds < 2.6.12 have no "SetVariable" case in the replay switch (which has NO
            // default) → silently skip the row → the variable is never written → downstream
            // {var} tokens resolve empty. Only the CYCLE sub-mode above is otherwise pinned,
            // leaving the base action unpinned.
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "SetVariable", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 6, 12), "Set Variable"),

            // Automation trigger (interval / schedule / condition self-firing) — an older build
            // has no Triggers property, so the config is DROPPED at load and any save from that
            // build rewrites the profile without it (no JsonExtensionData anywhere): the entire
            // automation silently evaporates. That is the destroy-on-round-trip class of
            // divergence this matrix exists for (the NotifyOnLapComplete no-pin precedent does
            // NOT apply — that field is a cosmetic notice, this is a whole feature's config).
            // Introduced after 2.8.1 — bump at release.
            (p => p.Triggers != null,
                new Version(2, 9, 0), "Automation trigger"),

            // Automation ImageFound search region (ROI). An older build has the Triggers property but
            // no SearchRegion field → it drops the ROI and scans full-screen (slower, more false
            // positives — behavioural divergence, not a hard failure). Property-level so plain triggers
            // keep the 2.9.0 floor; gates on BOTH W and H (matches the probe + projection). Introduced in 2.9.4.
            (p => p.Triggers is { SearchRegionW: > 0, SearchRegionH: > 0 },
                new Version(2, 9, 4), "Automation image search region"),

            // Automation poll interval. Same destroy-on-round-trip mechanism as the ROI pin above:
            // there is no [JsonExtensionData] on ProfileTriggerConfig, so an older build does not
            // merely IGNORE the property — it drops it, and any save from that build writes the
            // config back without it. A user who deliberately slowed an image watcher from 1 s to
            // 10 s (the knob exists because that watcher captures and scans the whole virtual
            // screen every tick) gets it silently reset to the default, i.e. 10x the CPU they
            // tuned away, with nothing on screen saying so. Property-level so plain triggers keep
            // the 2.9.0 floor; gated on > 0 because 0 IS the default and carries no information.
            // Introduced in 2.9.9.
            (p => p.Triggers is { PollIntervalMs: > 0 },
                new Version(2, 9, 9), "Automation poll interval"),

            // Automation watcher anchored to a window. EXACTAMENTE o mesmo mecanismo de
            // destruicao-no-round-trip dos dois pins acima: sem [JsonExtensionData] em
            // ProfileTriggerConfig, um build antigo nao ignora a propriedade — ele a DERRUBA, e
            // qualquer save daquele build reescreve a config sem ela.
            //
            // E aqui a perda e pior que nos vizinhos: la o usuario recupera CPU ou precisao; aqui
            // o vigia volta a tratar a coordenada como absoluta e passa a amostrar um ponto que
            // nao tem relacao com o alvo — dispara no lugar errado, ou nunca dispara, sem nada na
            // tela dizendo por que. Property-level para um gatilho comum manter o piso 2.9.0.
            // Gateado tambem no TIPO DE CONDICAO, e nao so na flag: so PixelColorMatch e ImageFound
            // tem ponto para ancorar, e o motor ignora a flag em qualquer outro tipo. Uma flag
            // residual — ligada e depois deixada para tras por uma troca de tipo — prendia o perfil
            // inteiro na 2.43.0 por uma propriedade que provadamente nao muda nada, e recusava o
            // import num build antigo sem nenhum ganho. O editor agora limpa a flag nessa troca; o
            // gate aqui cobre o que ja esta em disco e o que chega importado.
            // Gateado tambem no KIND, e nao so no tipo de condicao. So um gatilho de CONDICAO
            // sonda um ponto; num schedule o ConditionType e um resto de rascunho (o painel guarda
            // o campo ao trocar de kind, de proposito), e a flag ao lado dele nao significa nada.
            // Sem este termo a flag residual prendia o perfil pela OUTRA porta — a que o comentario
            // acima fecha e esta deixava aberta.
            //
            // O piso e 2.43.1, nao 2.43.0. A 2.43.0 lancou este dado com METADE da feature: o
            // daemon somava a origem da janela a cada tick enquanto o conta-gotas, o seletor de ROI
            // e o Test seguiam gravando coordenada de TELA. Um build 2.43.0 nao so le a coordenada
            // no espaco errado — qualquer save dele a REESCREVE em tela sob uma flag que afirma
            // janela. "Versao minima que abre este perfil com seguranca" e a versao cuja metade de
            // ESCRITA existe, e essa e a 2.43.1.
            (p => p.Triggers is { UseRelativeCoordinates: true } t
                  && string.Equals(t.Kind, "condition", StringComparison.OrdinalIgnoreCase)
                  && (string.Equals(t.ConditionType, "PixelColorMatch", StringComparison.OrdinalIgnoreCase)
                      || string.Equals(t.ConditionType, "ImageFound", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 43, 1), "Automation watcher window anchor"),

            // Automation active hours. NOT the destroy-on-round-trip mechanism of the two pins
            // above: TimeOfDay has existed since the 2.9.0 Triggers pin, so an older build reads
            // the string, keeps it, and writes it back intact. This is the ROI pin's class instead
            // — behavioural divergence — and the divergence is the more consequential of the two:
            // the older build does not know a RANGE means anything outside the schedule kind, so
            // it ignores the window entirely and fires around the clock. An automation the author
            // confined to working hours takes the mouse and keyboard at 03:00 on that build, which
            // is worse than the ROI pin's "slower and more false positives".
            //
            // Gated on the range actually parsing, and on a non-schedule kind, for the same reason
            // the poll-interval pin gates on > 0: for a schedule TimeOfDay IS the fire time and
            // carries no window, and a bare time on any kind is deliberately not a window (see
            // TriggerService.ParseActiveHours — profiles drafted as a schedule and switched to
            // condition keep one, and honouring it would silence them).
            // Introduced in 2.35.0.
            (p => p.Triggers is { } t
                  && !string.Equals(t.Kind, "schedule", StringComparison.OrdinalIgnoreCase)
                  && TriggerService.ParseActiveHours(t.TimeOfDay) != null,
                new Version(2, 35, 0), "Automation active hours"),

            // Per-profile loop count. Destroy-on-round-trip, same mechanism as the automation pins
            // above: an older build has no LoopCount on UserProfile (it was [JsonIgnore]d there and
            // absent from ProfileExportEntry entirely) and there is no [JsonExtensionData], so it
            // does not merely ignore the key — it drops it, and its own next save rewrites the file
            // without it. A profile the author set to 25× comes back as 1× with nothing saying so.
            //
            // GATED ON USE, deliberately. Every profile saved by this build now carries a loopCount,
            // so a bare `p => true`-shaped predicate would pin all ~81 local profiles and make the
            // Profile Info tab claim a 2.11.0 floor for a plain two-click macro. Only a profile that
            // actually asks to repeat (loop ON and more than one pass) loses anything on an old
            // build. Property-level precedents: the ROI and poll-interval pins above.
            // Introduced after 2.10.0 — bump at release if the release number differs.
            (p => p.EnableLoop && p.LoopCount > 1,
                new Version(2, 11, 0), "Per-profile loop count"),

            // Per-profile Game Mode. Same destroy-on-round-trip mechanism as the loop count just
            // above: an older build has no GameMode on UserProfile and no [JsonExtensionData], so
            // it drops the key and its own next save rewrites the file without it — the Roblox
            // macro set to walk its cursor goes back to whatever the app-wide switch says, with
            // nothing on screen saying so. Gated on USE for free: the field is written only when
            // set (null = follows), so a profile that never touched it carries no key and no pin.
            // Accepted by the owner on 2026-10-10 — see intencionais/parte-4.md.
            // Released in 2.46.0.
            (p => p.GameMode.HasValue,
                new Version(2, 46, 0), "Per-profile Game Mode"),

            // Per-profile cursor return. Same destroy-on-round-trip mechanism as Game Mode: an
            // older build drops the key, and the macro set to put the cursor back stops doing it
            // with nothing on screen saying why. Gated on USE the same way (written only when set).
            // Released in 2.47.0.
            (p => p.RestoreCursor.HasValue,
                new Version(2, 47, 0), "Per-profile cursor return"),

            // Screen text (OCR). Each family fails SILENTLY on an older build, which is the whole
            // reason for one row apiece: Wait for Text has no case in the action switch (no default),
            // so the row is skipped and its step reads "ok"; a ScreenText condition hits
            // InstantProbe's unknown-ConditionType branch → false → always the Else; Set Variable in
            // "screen" mode falls through to Set and stores VariableValue (usually empty → deletes
            // the variable). The automation watcher is the loud one (DescribeUnfireable stops it),
            // pinned anyway so the import names it. Released in 2.46.0, together with per-profile
            // Game Mode (one release after 2.45.1).
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "WaitText", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 46, 0), "Wait for Text"),
            (p => p.Actions.Any(a => string.Equals(a.ConditionType, "ScreenText", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 46, 0), "Screen text condition"),
            (p => p.Actions.Any(a => string.Equals(a.ActionType, "SetVariable", StringComparison.OrdinalIgnoreCase)
                && string.Equals(a.VariableMode, "screen", StringComparison.OrdinalIgnoreCase)),
                new Version(2, 46, 0), "Read screen text into a variable"),
            (p => p.Triggers != null && string.Equals(p.Triggers.ConditionType, "ScreenText", StringComparison.OrdinalIgnoreCase),
                new Version(2, 46, 0), "Automation screen text"),

            // Restore Size split from Restore Position; older builds only honour Position. Same
            // correction as the UseRelativeCoordinates pin above — the 2.0.5 this used to name
            // was never a real release (the 2.x line runs 2.0.0 then 2.1.0), so it is now 2.1.0.
            // Identical verdict for every installable build; only the number the user is shown
            // changes, from unreachable to real.
            (p => p.RestoreSize,
                new Version(2, 1, 0), "RestoreSize"),

            // Sharing-metadata round-trip itself is a 2.2 feature — anything carrying tags/description
            // came from a 2.2+ build. Older builds will ignore the metadata but load the actions fine,
            // so this is the floor for "no compatibility issues" rather than a hard requirement.
            (p => (p.Tags != null && p.Tags.Count > 0) || !string.IsNullOrEmpty(p.Description) || !string.IsNullOrEmpty(p.IconEmoji),
                new Version(2, 2, 0), "Profile sharing metadata"),
        };

        // {row:column:mods} — a row token carrying at least one modifier segment after the
        // column name. Mirrors ActionExecution.RowDataTokenRegex's modified form (column [^:}]+
        // since 2.37.0 — the wider names have their own pin below); the plain {row:column} shape
        // is NOT matched (already covered by the Data-loop table pin).
        private static readonly Regex ModifiedRowTokenRegex = new(
            @"\{row:[^:}]+:[^}]+\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // Key is resolved only on the key-simulation family + SendText; BrowserText only on
        // BrowserType/BrowserSelectOption (BrowserWaitElement text-match patterns go RAW to
        // the extension). Gate those two SHARED fields by ActionType so e.g. a browser
        // selector that merely looks like a modified row token can't over-pin a profile
        // that behaves identically on the older build.
        private static readonly HashSet<string> KeyResolvingActionTypes = new(StringComparer.OrdinalIgnoreCase)
            { "SendText", "Keystroke", "KeyDown", "KeyUp", "HoldKey" };
        private static readonly HashSet<string> BrowserTextResolvingActionTypes = new(StringComparer.OrdinalIgnoreCase)
            { "BrowserType", "BrowserSelectOption" };
        // The rows that evaluate a condition (EvaluateConditionWithTimeout's three callers).
        private static readonly HashSet<string> ConditionActionTypes = new(StringComparer.OrdinalIgnoreCase)
            { "If", "ElseIf", "While", "Assert" };

        /// <summary>
        /// Does <paramref name="contains"/> hold for a field the runtime token resolver actually
        /// reads on THIS row? Every token detector asks through here, so the gate lives once.
        ///
        /// Key and BrowserText were always gated by type; the other seven were scanned on every
        /// row. But switching a row's type (actions:edit "actionType") clears none of them, so a
        /// {pick:} left in the rich text of what is now a Wait row, or a {winclip} in the launch
        /// path of what is now a Keystroke, pinned the profile — and an older build that runs it
        /// identically refused the import. Readers, per ActionExecution: rich text and Markdown on
        /// SendText; the value on SetVariable; the operand on a Variable condition and the path on
        /// a FileExists condition; launch path and arguments on ActivateWindow.
        /// </summary>
        private static bool AnyTokenField(ActionItem a, Func<string?, bool> contains)
        {
            var type = a.ActionType;
            if (KeyResolvingActionTypes.Contains(type) && contains(a.Key)) return true;
            if (string.Equals(type, "SendText", StringComparison.OrdinalIgnoreCase)
                && (contains(a.KeyHtml) || contains(a.KeyMarkdown))) return true;
            if (BrowserTextResolvingActionTypes.Contains(type) && contains(a.BrowserText)) return true;
            if (string.Equals(type, "SetVariable", StringComparison.OrdinalIgnoreCase) && contains(a.VariableValue)) return true;
            if (ConditionActionTypes.Contains(type))
            {
                if (string.Equals(a.ConditionType, "Variable", StringComparison.OrdinalIgnoreCase) && contains(a.ConditionOperand)) return true;
                if (string.Equals(a.ConditionType, "FileExists", StringComparison.OrdinalIgnoreCase) && contains(a.FilePath)) return true;
                if (string.Equals(a.ConditionType, "ScreenText", StringComparison.OrdinalIgnoreCase) && contains(a.ConditionOperand)) return true;
            }
            // Wait for Text resolves its operand once per wait (ExecuteWaitText).
            if (string.Equals(type, "WaitText", StringComparison.OrdinalIgnoreCase) && contains(a.ConditionOperand)) return true;
            return string.Equals(type, "ActivateWindow", StringComparison.OrdinalIgnoreCase)
                && (contains(a.LaunchPath) || contains(a.LaunchArgs));
        }

        // Every string field the runtime token resolver touches — the fields where a
        // {row:column:mods} token can actually take effect (SendText/Keystroke Key + rich
        // flavors, browser text, Set Variable value, If-Variable operand, If-File path,
        // ActivateWindow launch path/args).
        private static bool UsesModifiedRowToken(ActionItem a) => AnyTokenField(a, ContainsModifiedRowToken);

        private static bool ContainsModifiedRowToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.Contains("{row", StringComparison.OrdinalIgnoreCase)
                && ModifiedRowTokenRegex.IsMatch(text);

        // {winclip:N} / bare {winclip} — mirrors ActionExecution.WinClipTokenRegex (index optional,
        // bare = 1). Same token-resolved field set as the modified-row scan (that is exactly where a
        // {winclip} token can take effect).
        // Widened with the chain the head gained, or this pin stops recognising its own token:
        // {winclip:2:trim} matched nothing here, so a profile using it kept the right
        // AppMinVersion only because the newer 2.20.0 pin happens to dominate — and the Info
        // tab's "Required by" list quietly stopped naming the history token at all.
        // The chain may not START with a digit — the engine's own guard, copied: without it the
        // optional index backtracks away and "{winclip:2-4}" / "{winclip:2:}" match here as a
        // chain, though the engine leaves them literal on every build. That pinned 2.9.3 on a
        // profile an older build runs identically, and refused its import there.
        private static readonly Regex WinClipTokenRegex = new(
            @"\{winclip(?::\d+)?(?::(?![0-9])[^}]+)?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesWinClipToken(ActionItem a) => AnyTokenField(a, ContainsWinClipToken);

        private static bool ContainsWinClipToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.Contains("{winclip", StringComparison.OrdinalIgnoreCase)
                && WinClipTokenRegex.IsMatch(text);

        // {rownext:column} / {rownext:column:mods} — mirrors ActionExecution.RowNextTokenRegex. Same
        // token-resolved field set as the modified-row / winclip scans (where a {rownext} can take effect).
        private static readonly Regex RowNextTokenRegex = new(
            @"\{rownext:[^:}]+(?::[^}]+)?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesRowNextToken(ActionItem a) => AnyTokenField(a, ContainsRowNextToken);

        private static bool ContainsRowNextToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.Contains("{rownext", StringComparison.OrdinalIgnoreCase)
                && RowNextTokenRegex.IsMatch(text);

        // Structural only: find each {clipboard[:chain]} and hand the chain to the ENGINE's own
        // splitter. Deciding "is this token sequential?" with a regex means re-implementing
        // ApplyClipboardModifiers' argument-consumption walk in a different language, and the two
        // drift: an earlier lookbehind-based version matched the walk everywhere except chains
        // like {clipboard:join:join:next} (a join separator that is itself the word "join"), where
        // the engine reads a sequential token and the regex refused to pin — shipping precisely
        // the silent whole-clipboard paste the pin exists to prevent.
        private static readonly Regex ClipboardTokenShapeRegex = new(
            @"\{clipboard(?::([^}]*))?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesClipNextToken(ActionItem a) => AnyTokenField(a, ContainsClipNextToken);

        private static bool ContainsClipNextToken(string? text)
        {
            if (string.IsNullOrEmpty(text) || !text.Contains("{clipboard", StringComparison.OrdinalIgnoreCase))
                return false;
            foreach (Match m in ClipboardTokenShapeRegex.Matches(text))
            {
                var chain = m.Groups[1].Success ? m.Groups[1].Value : null;
                if (ActionReplayer.TrySplitNextModifier(chain, out _)) return true;
            }
            return false;
        }

        // ── Modifier chains, wherever they can appear ───────────────────────────────────────
        // Every token head the shared applier serves. Groups 1-7 are the chains of {clipboard},
        // {row|rownext:col}, {var|clip:name}, {winclip[:N]}, {counter|loop|datarow}, {uuid|timestamp}
        // (a leading `ms` unit rides inside the timestamp chain — the walk steps over it as an
        // unknown name) and {env:name}; at most one is set per match. Each joined the list when its
        // head gained a chain — a pin that only knew the first two would miss "{clip:pedido:line:@i}"
        // entirely, and one that stopped at four would miss "{counter:line:@i}".
        // The winclip head carries the engine's no-leading-digit guard (see WinClipTokenRegex).
        private static readonly Regex ModifierChainHeadRegex = new(
            @"\{(?:clipboard(?::([^}]*))?|(?:row|rownext):[^:}]+(?::([^}]*))?|(?:var|clip):[A-Za-z0-9_]+(?::([^}]*))?|winclip(?::\d+)?(?::((?![0-9])[^}]+))?|(?:counter|loop|datarow)(?::([^}]*))?|(?:uuid|timestamp)(?::([^}]*))?|env:[A-Za-z0-9_()]+(?::([^}]*))?)\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        // The chain of every chain-bearing token in `text`, so each detector below states WHICH
        // question it asks and none of them repeats the group-picking.
        private static IEnumerable<string?> ModifierChainsIn(string text)
        {
            foreach (Match m in ModifierChainHeadRegex.Matches(text))
            {
                for (int g = 1; g <= 7; g++)
                {
                    if (!m.Groups[g].Success) continue;
                    yield return m.Groups[g].Value;
                    break;
                }
            }
        }

        private static bool UsesTokenArgument(ActionItem a) => AnyTokenField(a, ContainsTokenArgument);

        private static bool ContainsTokenArgument(string? text)
        {
            // Cheap reject first: no sigil anywhere means no reference anywhere.
            if (string.IsNullOrEmpty(text) || text.IndexOf('@') < 0) return false;
            // Delegate to the ENGINE's own walk rather than re-deciding here — the same
            // one-source-of-truth rule the {clipboard:next} pin above follows, and for the
            // same reason: a hand-written mirror drifts on chains like {clipboard:join:@x}
            // (a join separator that merely looks like a reference and must NOT pin).
            foreach (var chain in ModifierChainsIn(text))
                if (ActionReplayer.ChainUsesTokenArg(chain)) return true;
            return false;
        }

        // ── Text-slice modifiers (words / before / after / *last, and open-ended spans) ──────
        private static bool UsesSliceModifier(ActionItem a) => AnyTokenField(a, ContainsSliceModifier);

        private static bool ContainsSliceModifier(string? text)
        {
            if (string.IsNullOrEmpty(text) || text.IndexOf('{') < 0) return false;
            foreach (var chain in ModifierChainsIn(text))
                if (ActionReplayer.ChainUsesSliceModifier(chain)) return true;
            return false;
        }

        // ── The `dropnum` modifier — strip a leading digit run + suffix ─────────────────────
        private static bool UsesDropNumModifier(ActionItem a) => AnyTokenField(a, ContainsDropNumModifier);

        private static bool ContainsDropNumModifier(string? text)
        {
            if (string.IsNullOrEmpty(text) || text.IndexOf('{') < 0) return false;
            foreach (var chain in ModifierChainsIn(text))
                if (ActionReplayer.ChainUsesDropNum(chain)) return true;
            return false;
        }

        // ── The text-filter modifiers — noaccents / digits ──────────────────────────────────
        private static bool UsesTextFilterModifier(ActionItem a) => AnyTokenField(a, ContainsTextFilterModifier);

        private static bool ContainsTextFilterModifier(string? text)
        {
            if (string.IsNullOrEmpty(text) || text.IndexOf('{') < 0) return false;
            foreach (var chain in ModifierChainsIn(text))
                if (ActionReplayer.ChainUsesTextFilter(chain)) return true;
            return false;
        }

        // ── Random text-choice token {pick:a|b|c} ───────────────────────────────────────────
        // Mirrors ActionExecution.PickTokenRegex: ':' mandatory, options end at the first '}'.
        private static readonly Regex PickTokenRegex = new(
            @"\{pick:[^}]+\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesPickToken(ActionItem a) => AnyTokenField(a, ContainsPickToken);

        private static bool ContainsPickToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.Contains("{pick", StringComparison.OrdinalIgnoreCase)
                && PickTokenRegex.IsMatch(text);

        // ── Ask-Input token {input:Label} / {input:Label|menu:a,b,c} ─────────────────────────
        // Mirrors ActionExecution.InputTokenRegex: the label is [^}|]+ (spaces and ':' allowed),
        // the menu is optional, and a stray '|' that is not "|menu:" leaves the token literal on
        // BOTH builds, so it must not pin.
        private static readonly Regex AskInputTokenRegex = new(
            @"\{input:[^}|]+(?:\|menu:[^}]*)?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesInputToken(ActionItem a) => AnyTokenField(a, ContainsInputToken);

        private static bool ContainsInputToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.Contains("{input", StringComparison.OrdinalIgnoreCase)
                && AskInputTokenRegex.IsMatch(text);

        // ── Clipboard-slot token {clip:name} / {clip:name:mods} ──────────────────────────────
        // Mirrors ActionExecution.ClipSlotTokenRegex. The ':' right after "clip" is what keeps it
        // disjoint from {clipboard…}, whose fifth character is 'b'.
        private static readonly Regex SlotTokenRegex = new(
            @"\{clip:[A-Za-z0-9_]+(?::[^}]+)?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesClipSlotToken(ActionItem a) => AnyTokenField(a, ContainsClipSlotToken);

        private static bool ContainsClipSlotToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.Contains("{clip:", StringComparison.OrdinalIgnoreCase)
                && SlotTokenRegex.IsMatch(text);

        // ── Random number token {random:a-b} ─────────────────────────────────────────────────
        // Mirrors ActionExecution.RandomTokenRegex: two digit runs and a hyphen, nothing else —
        // "{random:abc}" is literal on both builds and must not pin.
        private static readonly Regex RandomNumberTokenRegex = new(
            @"\{random:\d+-\d+\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesRandomToken(ActionItem a) => AnyTokenField(a, ContainsRandomToken);

        private static bool ContainsRandomToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.Contains("{random", StringComparison.OrdinalIgnoreCase)
                && RandomNumberTokenRegex.IsMatch(text);

        // ── Run-state tokens {var:name}, {counter}, bare {row} ───────────────────────────────
        // {var:} mirrors ActionExecution.VarTokenRegex (a chain after the name is the 2.20.0 pin's
        // business; it matches here too and the higher pin wins). Bare {counter} is the no-chain
        // branch of RunStateChainTokenRegex and bare {row} a literal Replace in
        // ResolveRunStateTokens, so both are exact, case-insensitive substrings here. "{row:" is a
        // different token (the Data-loop pins), and "{counter:5}" — a chain, inert or not —
        // RESOLVES since 2.37.0 and is the counter-chain pin's business (UsesCounterChainToken):
        // its floor is not this one.
        private static readonly Regex VariableTokenRegex = new(
            @"\{var:[A-Za-z0-9_]+(?::[^}]+)?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesRunStateToken(ActionItem a) => AnyTokenField(a, ContainsRunStateToken);

        private static bool ContainsRunStateToken(string? text) =>
            !string.IsNullOrEmpty(text)
            && (text.Contains("{counter}", StringComparison.OrdinalIgnoreCase)
                || text.Contains("{row}", StringComparison.OrdinalIgnoreCase)
                || (text.Contains("{var:", StringComparison.OrdinalIgnoreCase) && VariableTokenRegex.IsMatch(text)));

        // ── Loop-block tokens {loop} / {datarow} and the @loop / @datarow references ─────────
        // The bare tokens are the no-chain branch of RunStateChainTokenRegex, matched here as
        // exact, case-insensitive substrings. "{loop:5}" is a chain (inert since 2.37.0) and pins
        // through UsesCounterChainToken, not here — the same 2.37.0 today, but a different entry.
        // The references ride a modifier chain and delegate to the engine walk (ChainUsesLoopRef)
        // for the reason every other chain pin does.
        private static bool UsesLoopToken(ActionItem a) => AnyTokenField(a, ContainsLoopToken);

        private static bool ContainsLoopToken(string? text)
        {
            if (string.IsNullOrEmpty(text) || text.IndexOf('{') < 0) return false;
            if (text.Contains("{loop}", StringComparison.OrdinalIgnoreCase)
                || text.Contains("{datarow}", StringComparison.OrdinalIgnoreCase)) return true;
            if (text.IndexOf('@') < 0) return false;
            foreach (var chain in ModifierChainsIn(text))
                if (ActionReplayer.ChainUsesLoopRef(chain)) return true;
            return false;
        }

        // ── Date/time tokens with an argument ────────────────────────────────────────────────
        // The instant every pin probe formats against. FIXED, never DateTime.Now: whether a
        // profile exports as 2.37.0 must not depend on the clock it was exported at, and a
        // calendar-overflow offset has to fall the same way on both surfaces. Same value as the
        // frontend gate's DATE_PROBE (tokenNormalize.ts).
        private static readonly DateTime DateProbe = new(2026, 1, 31, 13, 45, 30);

        private static bool UsesDateFormatToken(ActionItem a) => AnyTokenField(a, ContainsDateFormatToken);

        // Pins only when the ENGINE actually resolves the token. A regex that merely sees an
        // argument also caught "{date:x}", "{time:5}" and "{date:+999999y}", which .NET rejects
        // and the engine therefore leaves literal — on 2.36.0 too. Those profiles were exported
        // with a 2.37.0 floor and refused by a machine that would have run them identically, and
        // the Info tab named a feature the profile does not use. The bare {date}/{time}/{datetime}
        // have resolved since 1.0, so the argument is still required.
        //
        // Same doctrine the file already applies to {random:abc}, {pick} and {row:Nome Completo:}:
        // literal on every build does not pin. Ask ActionReplayer rather than re-implementing the
        // offset/format grammar here — one parser, one verdict.
        private static bool ContainsDateFormatToken(string? text)
        {
            if (string.IsNullOrEmpty(text)) return false;
            if (!text.Contains("{date", StringComparison.OrdinalIgnoreCase)
                && !text.Contains("{time", StringComparison.OrdinalIgnoreCase)) return false;
            foreach (Match m in ActionReplayer.DateTokenMatcher.Matches(text))
            {
                if (!m.Groups[2].Success) continue;   // bare token — resolved since 1.0
                // Invariant calendar on purpose: the floor has to describe the PROFILE, not the
                // machine that exported it. TokenCulture clones the current culture, and a culture
                // brings its calendar — under ar-SA (UmAlQura) "{date:+60y}" falls off the end and
                // reads as literal, so the very same file pinned 2.37.0 on one desk and nothing on
                // the next. Resolving at run time keeps using TokenCulture, which is what the
                // manual documents.
                if (ActionReplayer.TryFormatDateToken(m.Groups[1].Value, m.Groups[2].Value, DateProbe, out _,
                        System.Globalization.CultureInfo.InvariantCulture)) return true;
            }
            return false;
        }

        // ── The value-shaping modifiers — replace / count / pad / default ────────────────────
        private static bool UsesShapeModifier(ActionItem a) => AnyTokenField(a, ContainsShapeModifier);

        private static bool ContainsShapeModifier(string? text)
        {
            if (string.IsNullOrEmpty(text) || text.IndexOf('{') < 0) return false;
            foreach (var chain in ModifierChainsIn(text))
                if (ActionReplayer.ChainUsesShapeModifier(chain)) return true;
            return false;
        }

        // ── A chain on {counter} / {loop} / {datarow} ────────────────────────────────────────
        // Mirrors ActionExecution.RunStateChainTokenRegex with the chain made mandatory: the bare
        // counters have their own, older pins.
        private static readonly Regex CounterChainTokenRegex = new(
            @"\{(?:counter|loop|datarow):[^}]+\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesCounterChainToken(ActionItem a) => AnyTokenField(a, ContainsCounterChainToken);

        private static bool ContainsCounterChainToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.IndexOf('{') >= 0 && CounterChainTokenRegex.IsMatch(text);

        // ── {uuid} / {timestamp} / {env:NAME} ──────────────────────────────────────────────
        // Mirrors ActionExecution.UuidTokenRegex, TimestampTokenRegex (unit and chain folded into
        // one optional argument — the pin asks "is this the token", not which unit) and EnvTokenRegex.
        private static readonly Regex MachineValueTokenRegex = new(
            @"\{(?:uuid|timestamp)(?::[^}]+)?\}|\{env:[A-Za-z0-9_()]+(?::[^}]+)?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesMachineValueToken(ActionItem a) => AnyTokenField(a, ContainsMachineValueToken);

        private static bool ContainsMachineValueToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.IndexOf('{') >= 0 && MachineValueTokenRegex.IsMatch(text);

        // ── Browser Type key grammar beyond the ten bare names of extension ≤ 1.4.17 ─────────
        // The five new names with or without an argument, any of the ten old names WITH one (a
        // repeat count — and an unparsable one still changes the meaning: 1.4.17 typed "{enter:abc}"
        // out, 1.4.18 presses once), and {delay} in any form.
        private static readonly Regex BrowserKeyGrammarRegex = new(
            @"\{(?:space|home|end|pageup|pagedown|delay)(?::[^}]*)?\}|\{(?:enter|tab|esc|escape|backspace|delete|up|down|left|right):[^}]*\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesBrowserKeyGrammar(ActionItem a) =>
            string.Equals(a.ActionType, "BrowserType", StringComparison.OrdinalIgnoreCase)
            && !string.IsNullOrEmpty(a.BrowserText) && a.BrowserText.IndexOf('{') >= 0
            && BrowserKeyGrammarRegex.IsMatch(a.BrowserText);

        // ── {row:…} / {rownext:…} whose column has a character outside [A-Za-z0-9_] ──────────
        // The lookahead demands one such character inside the column segment (anything up to the
        // first ':' or '}'); the tail mirrors the engine's optional NON-EMPTY chain, so a dangling
        // "{row:Nome Completo:}" — literal on every build — does not pin.
        private static readonly Regex WideColumnTokenRegex = new(
            @"\{(?:row|rownext):(?=[^:}]*[^A-Za-z0-9_:}])[^:}]+(?::[^}]+)?\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesWideColumnName(ActionItem a) => AnyTokenField(a, ContainsWideColumnToken);

        private static bool ContainsWideColumnToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.Contains("{row", StringComparison.OrdinalIgnoreCase)
                && WideColumnTokenRegex.IsMatch(text);

        // ── A colon INSIDE a split delimiter, written "::" ──────────────────────────────────
        private static bool UsesEscapedColonDelimiter(ActionItem a) => AnyTokenField(a, ContainsEscapedColonDelimiter);

        private static bool ContainsEscapedColonDelimiter(string? text)
        {
            if (string.IsNullOrEmpty(text) || text.IndexOf('{') < 0) return false;
            foreach (var chain in ModifierChainsIn(text))
                if (ActionReplayer.ChainUsesEscapedColon(chain)) return true;
            return false;
        }

        // ── The list modifiers, which shipped in 2.8.0 and were never pinned ────────────────
        private static bool UsesListModifier(ActionItem a) => AnyTokenField(a, ContainsListModifier);

        private static bool ContainsListModifier(string? text)
        {
            if (string.IsNullOrEmpty(text) || text.IndexOf('{') < 0) return false;
            foreach (var chain in ModifierChainsIn(text))
                if (ActionReplayer.ChainUsesListModifier(chain)) return true;
            return false;
        }

        // ── A modifier chain on a slot / variable / history token ───────────────────────────
        // A DIFFERENT question from the two above: those ask which modifiers a chain uses, this
        // asks whether one of these three heads carries a chain at all. An older build's regex for
        // them ends right after the name, so the whole token fails to match and is typed out
        // literally — visibly broken rather than silently permissive, but still worth a pin.
        //
        // The winclip half is spelled as two alternatives on purpose: "\{winclip(?::\d+)?:[^}]+\}"
        // backtracks the optional index away and matches a plain {winclip:2}, which carries no
        // chain at all and must not pin. Both carry the engine's rule that a chain never STARTS
        // with a digit (see WinClipTokenRegex): "{winclip:2-4}" and "{winclip:2:5}" stay literal
        // on every build, so they are no chain either.
        private static readonly Regex ChainOnNameTokenRegex = new(
            @"\{(?:var|clip):[A-Za-z0-9_]+:[^}]+\}|\{winclip:\d+:(?![0-9])[^}]+\}|\{winclip:(?![0-9])[^}]+\}",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

        private static bool UsesChainOnNameToken(ActionItem a) => AnyTokenField(a, ContainsChainOnNameToken);

        private static bool ContainsChainOnNameToken(string? text) =>
            !string.IsNullOrEmpty(text) && text.IndexOf('{') >= 0 && ChainOnNameTokenRegex.IsMatch(text);

        /// <summary>
        /// Walks the feature matrix and returns the highest minimum version among all
        /// features the profile actually uses. Returns null when nothing beyond the
        /// 1.0 baseline is required (no AppMinVersion needs to be written).
        /// </summary>
        public static string? ComputeMinVersion(UserProfile profile)
        {
            Version highest = BaselineVersion;
            foreach (var (detect, version, _) in FeatureMatrix)
            {
                try
                {
                    if (detect(profile) && version > highest)
                        highest = version;
                }
                catch
                {
                    // A predicate throwing means the profile shape is unusual — skip that
                    // feature rather than failing the whole export. Worst case: AppMinVersion
                    // is slightly low, and the receiver sees a runtime error instead of a
                    // pre-import block. Acceptable degradation.
                }
            }
            return highest > BaselineVersion ? FormatVersion(highest) : null;
        }

        /// <summary>
        /// Compares an exported AppMinVersion against the currently running app version.
        /// Returns true when the profile can run (running ≥ required). A null required
        /// version means "no requirement" → always compatible.
        /// </summary>
        public static bool IsCompatible(string? requiredVersion, string runningVersion)
        {
            if (string.IsNullOrWhiteSpace(requiredVersion)) return true;
            // Present-but-unparseable required version (e.g. a hand-crafted "99.banana"): fail
            // CLOSED. The pin was clearly intended to gate, so a value we can't compare must be
            // treated as incompatible rather than waved through.
            if (!TryParseVersion(requiredVersion, out var required)) return false;
            if (!TryParseVersion(runningVersion, out var running)) return true;
            return running >= required;
        }

        /// <summary>
        /// Lists the feature names that pushed the AppMinVersion above the baseline.
        /// Used by the Info tab to render "Min version: 2.1.0 (because: TriggerMode WhilePressed)"
        /// so users can understand what's pinning their profile to a newer build.
        /// </summary>
        public static List<string> ListContributingFeatures(UserProfile profile)
        {
            // Single pass: evaluate each detect predicate exactly once, recording the
            // (version, name) of every feature the profile actually uses.
            var matches = new List<(Version Version, string Name)>();
            Version highest = BaselineVersion;
            foreach (var (detect, version, name) in FeatureMatrix)
            {
                try
                {
                    if (detect(profile))
                    {
                        matches.Add((version, name));
                        if (version > highest) highest = version;
                    }
                }
                catch { }
            }
            // Collect (in matrix order) every matched feature pinned at the highest version.
            var contributors = new List<string>();
            foreach (var (version, name) in matches)
            {
                if (version == highest) contributors.Add(name);
            }
            return contributors;
        }

        private static bool TryParseVersion(string s, out Version version)
        {
            // Strip any leading 'v' and only consume MAJOR[.MINOR[.PATCH]] — drop anything
            // after a '-' or '+' so we tolerate semver pre-release / build suffixes even
            // though we don't emit them.
            var trimmed = s.TrimStart('v', 'V');
            int cut = trimmed.IndexOfAny(new[] { '-', '+' });
            if (cut >= 0) trimmed = trimmed[..cut];
            return Version.TryParse(trimmed, out version!);
        }

        private static string FormatVersion(Version v)
        {
            // Always emit 3-part (MAJOR.MINOR.PATCH) for stability — .NET's Version.ToString()
            // omits trailing zero components ("2.0" instead of "2.0.0") which confuses semver
            // consumers on the frontend.
            int build = v.Build < 0 ? 0 : v.Build;
            return $"{v.Major}.{v.Minor}.{build}";
        }
    }
}
