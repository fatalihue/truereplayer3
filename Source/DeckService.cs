using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using System.Threading;

namespace TrueReplayer.Services
{
    /// <summary>
    /// Deck: on-screen panels of buttons that run the library's macros and a few simple actions (branch
    /// "deck"; plan .claude/planos/deck-2026-11-19.md). The config lives in its own sidecar,
    /// Documents\TrueReplayer3\deck.json, with the protections of the Key Remaps and the Teclado: a copy of
    /// the last good read (deck.bak.json), and a quarantine that never writes over a file it could not
    /// read — edits go to deck.pending.json until the user says to replace it.
    ///
    /// Phase 1 keeps the config, checks it and hands it to the page; the native window comes in phase 2
    /// and the actions in phase 3. A button names its macro by name, as a Teclado key does: a rename in
    /// the library takes the buttons along, and a macro deleted leaves the button pointing to a name the
    /// page shows as missing, until a macro with that name exists again.
    /// </summary>
    public static class DeckService
    {
        /// <summary>The picture on a button or on a deck's collapsed pill.</summary>
        public sealed class Icon
        {
            /// <summary>none | lucide | emoji | app | image (see <see cref="IconKinds"/>).</summary>
            public string Kind { get; set; } = "none";
            /// <summary>lucide: the icon's name ("swords"), for the page.</summary>
            public string? Name { get; set; }
            /// <summary>lucide: the SVG the page drew for it, with stroke="currentColor"; the window draws it in the theme's ink.</summary>
            public string? Svg { get; set; }
            /// <summary>emoji: the emoji itself.</summary>
            public string? Value { get; set; }
            /// <summary>app: the .exe or .lnk the icon comes from. image: a file name in Documents\TrueReplayer3\Deck\images.</summary>
            public string? Path { get; set; }
        }

        /// <summary>What a button does. kind none is a button still being set up: it shows, and does nothing.</summary>
        public sealed class Action
        {
            /// <summary>none | macro | keys | text | open | folder | tr3 (see <see cref="ActionKinds"/>).</summary>
            public string Kind { get; set; } = "none";
            /// <summary>macro: the library macro's name.</summary>
            public string? Macro { get; set; }
            /// <summary>keys: the combo that goes out, in KeyUtils names ("Ctrl+Shift+K", "MediaPlayPause").</summary>
            public string? Combo { get; set; }
            /// <summary>text: what goes out, and how: type | paste.</summary>
            public string? Text { get; set; }
            public string? Send { get; set; }
            /// <summary>open: a program, file, folder or address; its arguments; bring it to the front when it is already open.</summary>
            public string? Target { get; set; }
            public string? Args { get; set; }
            public bool? Focus { get; set; }
            /// <summary>folder: the id of one of the deck's folders.</summary>
            public string? Folder { get; set; }
            /// <summary>tr3: one of <see cref="Commands"/>.</summary>
            public string? Command { get; set; }
        }

        public sealed class Tile
        {
            /// <summary>The place in the grid, row by row from 0. Kept up to 8×8 even when the grid is smaller: shrinking it hides buttons, never deletes them.</summary>
            public int Slot { get; set; }
            /// <summary>The text under the icon; absent = the macro's name (or the action's own).</summary>
            public string? Label { get; set; }
            /// <summary>One of the folders' colours, as data ("#22c55e"): it does not follow the theme, as a folder's does not.</summary>
            public string? Color { get; set; }
            public Icon? Icon { get; set; }
            public Action Action { get; set; } = new();
        }

        public sealed class Page
        {
            public string Id { get; set; } = "";
            public List<Tile> Tiles { get; set; } = new();
        }

        /// <summary>A grid of its own that a Folder button opens in the deck's place, with Back first.</summary>
        public sealed class Folder
        {
            public string Id { get; set; } = "";
            public string Name { get; set; } = "";
            public List<Tile> Tiles { get; set; } = new();
        }

        public sealed class ShowWhen
        {
            /// <summary>always | apps: only while one of <see cref="Apps"/> is in front.</summary>
            public string Kind { get; set; } = "always";
            public List<string> Apps { get; set; } = new();
        }

        public sealed class Summon
        {
            /// <summary>cursor | center (of the monitor, or of the area the game holds the cursor in).</summary>
            public string At { get; set; } = "cursor";
            /// <summary>Shown while the hotkey is held; letting go over a button runs it.</summary>
            public bool Hold { get; set; }
            /// <summary>Only the keys pick (1–9, 0, arrows, Enter): for a game that acts on a click it does not own.</summary>
            public bool KeysOnly { get; set; }
            public bool CloseAfterPick { get; set; } = true;
        }

        public sealed class Grid
        {
            public int Cols { get; set; } = 5;
            public int Rows { get; set; } = 3;
            /// <summary>s | m | l: 48, 64 or 80 DIP buttons.</summary>
            public string Size { get; set; } = "m";
        }

        public sealed class Place
        {
            /// <summary>The monitor's device path (phase 2); absent = the primary one.</summary>
            public string? Monitor { get; set; }
            /// <summary>The point of the work area the offset counts from (see <see cref="Anchors"/>).</summary>
            public string Anchor { get; set; } = "bottom-right";
            public double Dx { get; set; } = -24;
            public double Dy { get; set; } = -24;
        }

        public sealed class Look
        {
            /// <summary>100 | 85 | 70 | 50 | 0, the opacity away from the mouse. 0 = invisible until the mouse comes (the window keeps 1/255, so it still gets the mouse).</summary>
            public int RestOpacity { get; set; } = 100;
            /// <summary>Folds into a pill with the deck's icon and name.</summary>
            public bool Collapse { get; set; }
            /// <summary>Hides past the screen's edge, and comes back when the mouse reaches it.</summary>
            public bool EdgeHide { get; set; }
            /// <summary>The place does not move when dragged.</summary>
            public bool Locked { get; set; }
            /// <summary>The strip with the name and the pencil; a 1×1 deck without it is a lone button.</summary>
            public bool Header { get; set; } = true;
        }

        public sealed class Deck
        {
            public string Id { get; set; } = "";
            public string Name { get; set; } = "";
            public Icon? Icon { get; set; }
            /// <summary>The deck's own switch; the master one is <see cref="Config.Enabled"/>.</summary>
            public bool On { get; set; } = true;
            /// <summary>fixed: stays on screen. summon: only the hotkey shows it.</summary>
            public string Mode { get; set; } = "fixed";
            public ShowWhen ShowWhen { get; set; } = new();
            /// <summary>fixed: shows and hides it. summon: calls it.</summary>
            public string? Hotkey { get; set; }
            public Summon Summon { get; set; } = new();
            public Grid Grid { get; set; } = new();
            public Place Place { get; set; } = new();
            public Look Look { get; set; } = new();
            public List<Page> Pages { get; set; } = new();
            public List<Folder> Folders { get; set; } = new();
        }

        public sealed class Config
        {
            public int Version { get; set; } = SchemaVersion;
            /// <summary>The Deck's master switch (the tray's "Deck", the page's "Decks on").</summary>
            public bool Enabled { get; set; } = true;
            /// <summary>False: the decks stay out of screen captures, the engine's own (Wait Image, OCR) and OBS's.</summary>
            public bool ShowInCaptures { get; set; }
            /// <summary>A macro button pressed while another macro runs: swap | stop | ignore.</summary>
            public string BusyPress { get; set; } = "swap";
            /// <summary>Shows and hides every deck.</summary>
            public string? ToggleAllHotkey { get; set; }
            public List<Deck> Decks { get; set; } = new();
        }

        public const int SchemaVersion = 1;
        public const int MaxDecks = 16;
        public const int MaxGrid = 8;
        public const int MaxSlots = MaxGrid * MaxGrid;
        public const int MaxPages = 10;
        public const int MaxFolders = 32;
        public const int MaxApps = 8;
        public const int MaxNameLength = 60;
        public const int MaxLabelLength = 40;
        public const int MaxComboLength = 40;
        public const int MaxMacroNameLength = 200;
        public const int MaxTextLength = 4000;
        public const int MaxTargetLength = 2048;
        public const int MaxArgsLength = 512;
        public const int MaxSvgLength = 8000;
        public const int MaxEmojiLength = 32;
        public const int MaxPathLength = 260;
        public const double MaxOffset = 20_000;

        public static readonly IReadOnlyCollection<string> IconKinds = new[] { "none", "lucide", "emoji", "app", "image" };
        public static readonly IReadOnlyCollection<string> ActionKinds = new[] { "none", "macro", "keys", "text", "open", "folder", "tr3" };
        public static readonly IReadOnlyCollection<string> Commands = new[] { "record", "stopAll", "clicker", "teclado", "remaps", "automations", "shortcuts", "show" };
        public static readonly IReadOnlyCollection<string> Anchors = new[] { "top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right" };
        public static readonly IReadOnlyCollection<string> Sizes = new[] { "s", "m", "l" };
        public static readonly IReadOnlyCollection<string> BusyPresses = new[] { "swap", "stop", "ignore" };
        public static readonly IReadOnlyList<int> RestOpacities = new[] { 100, 85, 70, 50, 0 };

        private const string FileName = "deck.json";
        private const string BackupFileName = "deck.bak.json";
        public const string PendingFileName = "deck.pending.json";

        private static readonly JsonSerializerOptions ReadOptions = new() { PropertyNameCaseInsensitive = true };
        private static readonly JsonSerializerOptions WriteOptions = new()
        {
            WriteIndented = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };

        private static readonly object _lock = new();

        public static Config Current { get; private set; } = new();

        /// <summary>
        /// deck.json is there and could not be read or parsed (a sync agent, an antivirus, a hand edit).
        /// Not set for a file that is simply absent. While it is set, <see cref="Save"/> never touches deck.json.
        /// </summary>
        public static bool LoadFailed { get; private set; }

        /// <summary><see cref="Current"/> came from deck.bak.json because deck.json was unreadable.</summary>
        public static bool LoadedFromBackup { get; private set; }

        /// <summary>Why <see cref="LoadFailed"/> is set, in one line, for the page's notice; said when read, so it follows the interface's language.</summary>
        public static string? LoadFailureDetail => LoadFailed ? FailureDetail(_loadError, _loadErrorIsParse) : null;

        private static Exception? _loadError;
        private static bool _loadErrorIsParse;

        /// <summary>Raised after every Load and Save (the native decks follow it from phase 2).</summary>
        public static event System.Action? Changed;

        // The library's macro names, as the last list load saw them (ProfileController), for the report; and
        // each one's emoji, which a button without an icon of its own shows (DeckWindow).
        private static HashSet<string> _library = new(StringComparer.Ordinal);
        private static Dictionary<string, string> _emoji = new(StringComparer.Ordinal);
        private static bool _libraryKnown;
        // The library's names, the most recently changed first (Fase 6: the button's menu).
        private static List<string> _recent = new();

        /// <summary>Raised after an edit made on the decks themselves (a deck dragged to a new place): the page's state is stale.</summary>
        public static event System.Action? EditedOnScreen;

        private const int ReadRetryAttempts = 3;
        private const int ReadRetryDelayMs = 40;

        private static string GetPath()
        {
            string dir = AppIdentity.DocumentsRoot;
            Directory.CreateDirectory(dir);
            return System.IO.Path.Combine(dir, FileName);
        }

        private static string SiblingPath(string fileName) => System.IO.Path.Combine(System.IO.Path.GetDirectoryName(GetPath())!, fileName);

        public static void Load()
        {
            lock (_lock)
            {
                var path = GetPath();
                LoadFailed = false;
                LoadedFromBackup = false;
                _loadError = null;
                _loadErrorIsParse = false;

                if (!File.Exists(path))
                {
                    // A new install, or no deck yet: an empty config, and Save is free to create the file.
                    Current = new Config();
                    Raise();
                    return;
                }

                bool parseFailed = false;
                if (TryReadText(path, out var json, out var error))
                {
                    var parsed = TryParse(json, out var parseError);
                    if (parsed != null)
                    {
                        Current = Normalize(parsed);
                        WriteBackupIfChanged(json);
                        Raise();
                        return;
                    }
                    error = parseError;
                    parseFailed = true;
                }

                LoadFailed = true;
                _loadError = error;
                _loadErrorIsParse = parseFailed;
                DiagnosticLog.Error(
                    $"deck.json could not be read — it will NOT be overwritten; edits this session go to {PendingFileName}",
                    error ?? new IOException("unknown read failure"));
                // Said in a Windows notification too: Load runs in the window's ctor, and decks that do not
                // show up with nothing on screen to say why look like the feature broke.
                if (TryLoadBackup(out var backup))
                {
                    Current = backup;
                    LoadedFromBackup = true;
                    int count = backup.Decks.Count;
                    Announce(S.DeckUnreadableTitle, S.DeckUnreadableBackup(n: S.Num(count), pending: PendingFileName, count: count));
                }
                else
                {
                    Current = new Config();
                    Announce(S.DeckUnreadableTitle, S.DeckUnreadableNoBackup);
                }
                Raise();
            }
        }

        /// <param name="overwriteUnreadableFile">Only a deliberate user choice may pass true (the page's "Replace the file").</param>
        public static void Save(Config incoming, bool overwriteUnreadableFile = false)
        {
            lock (_lock)
            {
                // The edit takes effect in this session either way, as in RemapService and TecladoService.
                Current = Normalize(incoming);
                try
                {
                    var json = JsonSerializer.Serialize(Current, WriteOptions);
                    if (LoadFailed && !overwriteUnreadableFile)
                    {
                        // Quarantine: writing back what we hold would delete everything the unreadable file still has.
                        if (Current.Decks.Count > 0)
                        {
                            FileHelper.WriteAllTextAtomic(SiblingPath(PendingFileName), json);
                            DiagnosticLog.Warn($"Deck: deck.json is unreadable, so the change was written to {PendingFileName} instead.");
                        }
                        else
                        {
                            DiagnosticLog.Warn("Deck: change NOT written — deck.json is unreadable and the list is empty. Live for this session only.");
                        }
                    }
                    else
                    {
                        FileHelper.WriteAllTextAtomic(GetPath(), json);
                        WriteBackupIfChanged(json);
                        if (LoadFailed)
                        {
                            LoadFailed = false;
                            LoadedFromBackup = false;
                            _loadError = null;
                            _loadErrorIsParse = false;
                            DiagnosticLog.Info("deck.json overwritten on explicit request — load-failure quarantine cleared.");
                        }
                    }
                }
                catch (Exception ex)
                {
                    DiagnosticLog.Error("deck.json save failed", ex);
                }
                Raise();
            }
        }

        public static void SetEnabled(bool enabled)
        {
            Config next;
            lock (_lock)
            {
                next = Clone(Current);
                next.Enabled = enabled;
            }
            Save(next);
        }

        /// <summary>
        /// The config as the page receives it (camelCase, nulls left out), the quarantine's state, and what
        /// each macro a button names is in the library (absent until the first list load).
        /// </summary>
        public static object StatePayload()
        {
            lock (_lock)
            {
                Dictionary<string, object>? macros = null;
                if (_libraryKnown)
                {
                    macros = new Dictionary<string, object>(StringComparer.Ordinal);
                    foreach (var name in MacrosNamed(Current))
                        macros[name] = new { found = _library.Contains(name) };
                }
                return new
                {
                    config = JsonSerializer.SerializeToElement(Current, WriteOptions),
                    loadFailed = LoadFailed,
                    loadedFromBackup = LoadedFromBackup,
                    loadFailureDetail = LoadFailureDetail,
                    pendingFile = PendingFileName,
                    macros,
                };
            }
        }

        /// <summary>Raised after the library changed in a way the buttons' report shows (the page's state is stale).</summary>
        public static event System.Action? MacrosChanged;

        /// <summary>
        /// The macro library changed (ProfileController, after every list load: a save, an import, the disk
        /// watcher). A button whose macro came back is found again; one whose macro left shows as missing.
        /// Raised only when a name the buttons use changed sides, so a save of an unrelated macro is quiet.
        /// </summary>
        public static void LibraryChanged(IEnumerable<(string Name, string? Emoji, DateTime? Updated)> entries)
        {
            bool raise;
            lock (_lock)
            {
                var next = new HashSet<string>(StringComparer.Ordinal);
                var emoji = new Dictionary<string, string>(StringComparer.Ordinal);
                var dated = new List<(string Name, DateTime Updated)>();
                foreach (var (name, e, updated) in entries)
                {
                    if (!next.Add(name)) continue;
                    if (!string.IsNullOrWhiteSpace(e)) emoji[name] = e.Trim();
                    dated.Add((name, updated ?? DateTime.MinValue));
                }
                _recent = dated.OrderByDescending(d => d.Updated).ThenBy(d => d.Name, StringComparer.CurrentCultureIgnoreCase).Select(d => d.Name).ToList();
                var named = MacrosNamed(Current);
                // A name the buttons use came or went, or its emoji changed (the deck draws it).
                raise = !_libraryKnown || named.Any(n => _library.Contains(n) != next.Contains(n)
                    || !string.Equals(_emoji.GetValueOrDefault(n), emoji.GetValueOrDefault(n), StringComparison.Ordinal));
                _library = next;
                _emoji = emoji;
                _libraryKnown = true;
            }
            if (!raise) return;
            try { MacrosChanged?.Invoke(); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: a MacrosChanged handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        /// <summary>Is the macro in the library? True until the library is first known, so nothing shows missing at startup.</summary>
        public static bool IsMacroFound(string name)
        {
            lock (_lock) return !_libraryKnown || _library.Contains(name);
        }

        /// <summary>The macro's own emoji (the library's), or null.</summary>
        public static string? MacroEmoji(string name)
        {
            lock (_lock) return _emoji.GetValueOrDefault(name);
        }

        /// <summary>A deck dragged to a new place on screen (DeckWindow): kept, and the page told.</summary>
        public static void SetPlace(string deckId, Place place)
        {
            Config next;
            lock (_lock)
            {
                next = Clone(Current);
                var deck = next.Decks.FirstOrDefault(d => d.Id == deckId);
                if (deck == null) return;
                deck.Place = place;
            }
            Save(next);
            try { EditedOnScreen?.Invoke(); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: an EditedOnScreen handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        // ── Fase 6: edits made on the decks themselves (the edit mode, the button's menu, a file dropped) ──

        /// <summary>
        /// An edit made on screen: applied to a copy of the deck, saved (the windows follow Changed), and the page told.
        /// False when the deck is gone or nothing changed.
        /// </summary>
        public static bool EditDeck(string deckId, Func<Deck, bool> change)
        {
            Config next;
            lock (_lock)
            {
                next = Clone(Current);
                var deck = next.Decks.FirstOrDefault(d => d.Id == deckId);
                if (deck == null || !change(deck)) return false;
            }
            Save(next);
            try { EditedOnScreen?.Invoke(); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: an EditedOnScreen handler failed: {ex.GetType().Name}: {ex.Message}"); }
            return true;
        }

        /// <summary>The buttons of a page (folder null) or of a folder of a deck — the list itself, to change in an edit; null when there is no such place.</summary>
        public static List<Tile>? TilesAt(Deck deck, string? folder, int page) =>
            folder != null ? deck.Folders.FirstOrDefault(f => f.Id == folder)?.Tiles
            : page >= 0 && page < deck.Pages.Count ? deck.Pages[page].Tiles : null;

        /// <summary>Puts a button in a place (replacing the one there), or clears the place (null). A folder's first place is its Back.</summary>
        public static bool SetTile(string deckId, string? folder, int page, int slot, Tile? tile) => EditDeck(deckId, deck =>
        {
            var tiles = TilesAt(deck, folder, page);
            if (tiles == null || slot < 0 || slot >= MaxSlots || (folder != null && slot == 0)) return false;
            int removed = tiles.RemoveAll(t => t.Slot == slot);
            if (tile == null) return removed > 0;
            tile.Slot = slot;
            tiles.Add(tile);
            tiles.Sort((a, b) => a.Slot.CompareTo(b.Slot));
            return true;
        });

        /// <summary>Changes the button in a place (its action, its icon, its colour); false when the place is empty.</summary>
        public static bool ChangeTile(string deckId, string? folder, int page, int slot, System.Action<Tile> change) => EditDeck(deckId, deck =>
        {
            var tile = TilesAt(deck, folder, page)?.FirstOrDefault(t => t.Slot == slot);
            if (tile == null) return false;
            change(tile);
            return true;
        });

        /// <summary>A button moved to another place of its grid; a button there takes the place it left.</summary>
        public static bool MoveTile(string deckId, string? folder, int page, int from, int to) => EditDeck(deckId, deck =>
        {
            var tiles = TilesAt(deck, folder, page);
            int slots = deck.Grid.Cols * deck.Grid.Rows;
            if (tiles == null || from == to || to < 0 || to >= slots || (folder != null && (to == 0 || from == 0))) return false;
            var moving = tiles.FirstOrDefault(t => t.Slot == from);
            if (moving == null) return false;
            var there = tiles.FirstOrDefault(t => t.Slot == to);
            if (there != null) there.Slot = from;
            moving.Slot = to;
            tiles.Sort((a, b) => a.Slot.CompareTo(b.Slot));
            return true;
        });

        /// <summary>A button moved from a page to the first free place of another page. False when that page has none.</summary>
        public static bool MoveTileToPage(string deckId, int page, int slot, int toPage) => EditDeck(deckId, deck =>
        {
            if (page == toPage || page < 0 || toPage < 0 || page >= deck.Pages.Count || toPage >= deck.Pages.Count) return false;
            var from = deck.Pages[page].Tiles;
            var moving = from.FirstOrDefault(t => t.Slot == slot);
            if (moving == null) return false;
            int free = FreeSlot(deck, null, toPage);
            if (free < 0) return false;
            from.Remove(moving);
            moving.Slot = free;
            deck.Pages[toPage].Tiles.Add(moving);
            deck.Pages[toPage].Tiles.Sort((a, b) => a.Slot.CompareTo(b.Slot));
            return true;
        });

        /// <summary>The first free place a grid shows, from <paramref name="after"/> on (round); -1 when every place is taken.</summary>
        public static int FreeSlot(Deck deck, string? folder, int page, int after = -1)
        {
            var tiles = TilesAt(deck, folder, page);
            if (tiles == null) return -1;
            int slots = deck.Grid.Cols * deck.Grid.Rows;
            var taken = new HashSet<int>(tiles.Select(t => t.Slot));
            for (int i = 1; i <= slots; i++)
            {
                int slot = (after + i) % slots;
                if (slot < 0) slot += slots;
                if (!taken.Contains(slot) && !(folder != null && slot == 0)) return slot;
            }
            return -1;
        }

        /// <summary>A copy of a button in the first free place after it: that place, or -1 when there is none.</summary>
        public static int DuplicateTile(string deckId, string? folder, int page, int slot)
        {
            int at = -1;
            EditDeck(deckId, deck =>
            {
                var tiles = TilesAt(deck, folder, page);
                var tile = tiles?.FirstOrDefault(t => t.Slot == slot);
                if (tiles == null || tile == null) return false;
                at = FreeSlot(deck, folder, page, slot);
                if (at < 0) return false;
                var copy = JsonSerializer.Deserialize<Tile>(JsonSerializer.Serialize(tile, WriteOptions), ReadOptions)!;
                copy.Slot = at;
                tiles.Add(copy);
                tiles.Sort((a, b) => a.Slot.CompareTo(b.Slot));
                return true;
            });
            return at;
        }

        /// <summary>The grid's columns and rows (the edit mode's corner). Buttons past a smaller grid are kept, out of sight.</summary>
        public static bool SetGrid(string deckId, int cols, int rows) => EditDeck(deckId, deck =>
        {
            cols = Math.Clamp(cols, 1, MaxGrid);
            rows = Math.Clamp(rows, 1, MaxGrid);
            if (deck.Grid.Cols == cols && deck.Grid.Rows == rows) return false;
            deck.Grid.Cols = cols;
            deck.Grid.Rows = rows;
            return true;
        });

        /// <summary>A new folder in a deck, named as the deck's next one ("Pasta", "Pasta 2"); its id, or null when the deck has as many as it can hold.</summary>
        public static string? AddFolder(Deck deck, string baseName)
        {
            if (deck.Folders.Count >= MaxFolders) return null;
            var names = new HashSet<string>(deck.Folders.Select(f => f.Name), StringComparer.CurrentCultureIgnoreCase);
            string name = baseName;
            for (int n = 2; names.Contains(name); n++) name = $"{baseName} {n}";
            var ids = new HashSet<string>(deck.Folders.Select(f => f.Id), StringComparer.Ordinal);
            string id;
            do { id = "f-" + Guid.NewGuid().ToString("N")[..10]; } while (ids.Contains(id));
            deck.Folders.Add(new Folder { Id = id, Name = name });
            return id;
        }

        /// <summary>The library's macros, the most recently changed first (the button's menu offers the first twelve).</summary>
        public static List<string> RecentMacros(int count)
        {
            lock (_lock) return _recent.Take(count).ToList();
        }

        /// <summary>
        /// The first macro name of a series the library does not have yet ("Geral 1", "Geral 2"…): what "Record here"
        /// creates. Macros are files, so a name that differs only in case is taken too.
        /// </summary>
        public static string FreeMacroName(Func<int, string> nameOf)
        {
            lock (_lock)
            {
                var taken = new HashSet<string>(_library, StringComparer.OrdinalIgnoreCase);
                for (int n = 1; n < 100000; n++)
                {
                    string name = nameOf(n);
                    if (!taken.Contains(name)) return name;
                }
                return nameOf(100000);
            }
        }

        /// <summary>
        /// A deck's name as the start of a macro's name: a macro is a file, so what a file name cannot hold becomes a
        /// space, and the ends lose the spaces and dots Windows drops. "Deck" when nothing is left.
        /// </summary>
        public static string MacroSafe(string name)
        {
            var bad = System.IO.Path.GetInvalidFileNameChars();
            var chars = (name ?? "").Select(c => Array.IndexOf(bad, c) >= 0 ? ' ' : c).ToArray();
            string safe = string.Join(" ", new string(chars).Split(' ', StringSplitOptions.RemoveEmptyEntries)).Trim(' ', '.');
            if (safe.Length > 60) safe = safe[..60].TrimEnd(' ', '.');
            return safe.Length > 0 ? safe : "Deck";
        }

        // ── Fase 7: decks that come from outside — a .trdeck, the example ──

        /// <summary>A deck copied whole (nothing shared with the one it came from).</summary>
        public static Deck CloneDeck(Deck deck) =>
            JsonSerializer.Deserialize<Deck>(JsonSerializer.Serialize(deck, WriteOptions), ReadOptions) ?? new Deck();

        /// <summary>The buttons of a deck: its pages' and its folders'.</summary>
        public static IEnumerable<Tile> TilesOf(Deck deck)
        {
            foreach (var page in deck.Pages) foreach (var t in page.Tiles) yield return t;
            foreach (var folder in deck.Folders) foreach (var t in folder.Tiles) yield return t;
        }

        /// <summary>The pictures (Deck\images) a deck shows: its own icon's and its buttons'.</summary>
        public static IEnumerable<string> ImagesOf(Deck deck)
        {
            if (deck.Icon is { Kind: "image", Path: { Length: > 0 } own }) yield return own;
            foreach (var t in TilesOf(deck))
                if (t.Icon is { Kind: "image", Path: { Length: > 0 } path }) yield return path;
        }

        /// <summary>A config as deck.json writes it (a .trdeck's deck.json too).</summary>
        public static string ToJson(Config config) => JsonSerializer.Serialize(config, WriteOptions);

        /// <summary>A config read from text (a .trdeck's deck.json), or null when it is not one.</summary>
        public static Config? FromJsonText(string json)
        {
            try { return JsonSerializer.Deserialize<Config>(json, ReadOptions); }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Deck: a deck.json could not be read: {ex.GetType().Name}: {ex.Message}");
                return null;
            }
        }

        /// <summary>A deck that came in: its id and name as kept, and whether its hotkey stayed behind (taken here).</summary>
        public sealed record Added(string Id, string Name, bool HotkeyDropped);

        /// <summary>
        /// Decks from outside (an imported .trdeck, the example) added after the others, in one save. Each gets ids of
        /// its own (its pages' and folders' too, a Folder button following its folder), a name no other deck has
        /// ("Geral 2"), its hotkey only when <paramref name="hotkeyFree"/> says no one has it, and its pictures kept
        /// through <paramref name="keepImage"/> (a file name in Deck\images, or null: the button falls back to its
        /// default icon). Past <see cref="MaxDecks"/>, the rest are counted in <paramref name="left"/>.
        /// </summary>
        public static List<Added> AddDecks(IEnumerable<Deck> incoming, Func<string, string?>? keepImage, Func<string, bool> hotkeyFree, out int left)
        {
            var added = new List<Added>();
            left = 0;
            Config next;
            lock (_lock)
            {
                next = Clone(Current);
                var hotkeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (var source in incoming)
                {
                    if (next.Decks.Count >= MaxDecks) { left++; continue; }
                    var d = CloneDeck(source);
                    d.Id = NewId("d-", next.Decks.Select(x => x.Id));
                    var pageIds = new List<string>();
                    foreach (var p in d.Pages) { p.Id = NewId("p-", pageIds); pageIds.Add(p.Id); }
                    var folderIds = new Dictionary<string, string>(StringComparer.Ordinal);
                    foreach (var f in d.Folders)
                    {
                        string id = NewId("f-", folderIds.Values);
                        folderIds[f.Id] = id;
                        f.Id = id;
                    }
                    foreach (var t in TilesOf(d))
                    {
                        if (t.Action.Kind == "folder")
                        {
                            if (t.Action.Folder != null && folderIds.TryGetValue(t.Action.Folder, out var moved)) t.Action.Folder = moved;
                            else t.Action = new Action { Kind = "none" };
                        }
                        if (t.Icon is { Kind: "image" } icon) t.Icon = KeepIcon(icon, keepImage);
                    }
                    if (d.Icon is { Kind: "image" } own) d.Icon = KeepIcon(own, keepImage);
                    d.Name = FreeName(d.Name.Length > 0 ? d.Name : "Deck", next.Decks.Select(x => x.Name));
                    bool dropped = false;
                    if (d.Hotkey != null)
                    {
                        if (hotkeys.Contains(d.Hotkey) || !hotkeyFree(d.Hotkey)) { d.Hotkey = null; dropped = true; }
                        else hotkeys.Add(d.Hotkey);
                    }
                    if (d.Mode == "fixed") Nudge(d, next.Decks);
                    next.Decks.Add(d);
                    added.Add(new Added(d.Id, d.Name, dropped));
                }
            }
            if (added.Count == 0) return added;
            Save(next);
            try { EditedOnScreen?.Invoke(); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: an EditedOnScreen handler failed: {ex.GetType().Name}: {ex.Message}"); }
            return added;
        }

        /// <summary>
        /// A deck that comes in where a fixed deck already is (the same monitor, anchor and offset — a file imported
        /// back, the example added twice) lands 32 DIP further in, as cascaded windows do, so both show.
        /// </summary>
        private static void Nudge(Deck d, List<Deck> others)
        {
            const double Step = 32;
            bool Taken() => others.Any(o => o.Mode == "fixed" && o.Place.Anchor == d.Place.Anchor
                && string.Equals(o.Place.Monitor ?? "", d.Place.Monitor ?? "", StringComparison.OrdinalIgnoreCase)
                && Math.Abs(o.Place.Dx - d.Place.Dx) < Step / 2 && Math.Abs(o.Place.Dy - d.Place.Dy) < Step / 2);
            double sx = d.Place.Anchor.Contains("right") ? -Step : Step;
            double sy = d.Place.Anchor.StartsWith("bottom") ? -Step : Step;
            for (int i = 0; i < 12 && Taken(); i++)
            {
                d.Place.Dx = Offset(d.Place.Dx + sx);
                d.Place.Dy = Offset(d.Place.Dy + sy);
            }
        }

        private static Icon? KeepIcon(Icon icon, Func<string, string?>? keepImage)
        {
            string? kept = icon.Path != null && keepImage != null ? keepImage(icon.Path) : null;
            return kept != null ? new Icon { Kind = "image", Path = kept } : null;
        }

        private static string NewId(string prefix, IEnumerable<string> taken)
        {
            var used = new HashSet<string>(taken, StringComparer.Ordinal);
            string id;
            do { id = prefix + Guid.NewGuid().ToString("N")[..10]; } while (used.Contains(id));
            return id;
        }

        /// <summary>A deck's name no other deck has: "Geral", then "Geral 2", "Geral 3"… (the page's freeName).</summary>
        private static string FreeName(string name, IEnumerable<string> taken)
        {
            var used = new HashSet<string>(taken, StringComparer.CurrentCultureIgnoreCase);
            name = Clip(name, MaxNameLength - 3);
            if (!used.Contains(name)) return name;
            for (int n = 2; ; n++)
            {
                string candidate = $"{name} {n}";
                if (!used.Contains(candidate)) return candidate;
            }
        }

        /// <summary>
        /// The example deck, "Media and system" in the app's language: the media keys, the volume, three Windows
        /// shortcuts (the clipboard's history, a cut of the screen, the files), the calculator, and TR3's Stop all.
        /// Large buttons, so the labels fit; at the middle of the right edge, out of the way of the corners.
        /// </summary>
        public static Deck ExampleDeck()
        {
            static Icon Lucide(string name) => new() { Kind = "lucide", Name = name, Svg = DeckIcons.Svg.TryGetValue(name, out var svg) ? svg : null };
            static Tile Keys(int slot, string combo, string? label = null, string? icon = null) =>
                new() { Slot = slot, Label = label, Icon = icon != null ? Lucide(icon) : null, Action = new Action { Kind = "keys", Combo = combo } };
            return new Deck
            {
                Name = S.DeckExampleName,
                On = true,
                Mode = "fixed",
                Grid = new Grid { Cols = 4, Rows = 3, Size = "l" },
                Place = new Place { Anchor = "right", Dx = -24, Dy = 0 },
                Look = new Look { RestOpacity = 100, Header = true },
                Pages =
                {
                    new Page
                    {
                        Tiles =
                        {
                            Keys(0, "MediaPrevTrack"), Keys(1, "MediaPlayPause"), Keys(2, "MediaNextTrack"), Keys(3, "MediaStop"),
                            Keys(4, "VolumeDown"), Keys(5, "VolumeMute"), Keys(6, "VolumeUp"),
                            Keys(7, "Win+V", S.DeckExampleClipboard, "clipboard"),
                            Keys(8, "Win+Shift+S", S.DeckExampleSnip, "scissors"),
                            Keys(9, "Win+E", S.DeckExampleFiles, "folder-open"),
                            new Tile { Slot = 10, Label = S.DeckExampleCalculator, Icon = Lucide("calculator"), Action = new Action { Kind = "open", Target = "calc.exe" } },
                            new Tile { Slot = 11, Action = new Action { Kind = "tr3", Command = "stopAll" } },
                        },
                    },
                },
            };
        }

        /// <summary>A macro renamed in the library: every button that runs it follows. True when the config changed (and was saved).</summary>
        public static bool RenameMacro(string oldName, string newName)
        {
            if (string.IsNullOrEmpty(oldName) || string.IsNullOrEmpty(newName) || oldName == newName) return false;
            Config next;
            lock (_lock)
            {
                // The library is renaming this macro: the name moves in the report's list now, so the buttons
                // never show it missing between the rename and the list's next load (which then finds no
                // change and stays quiet). Both callers rename before that load: the watcher's ahead of its
                // debounced reload, the app's ahead of its refresh.
                if (_library.Remove(oldName)) _library.Add(newName);
                if (_emoji.Remove(oldName, out var e)) _emoji[newName] = e;
                bool changed = false;
                foreach (var tile in AllTiles(Current))
                {
                    if (tile.Action.Kind != "macro" || !string.Equals(tile.Action.Macro, oldName, StringComparison.Ordinal)) continue;
                    tile.Action.Macro = newName;
                    changed = true;
                }
                if (!changed) return false;
                next = Current;
            }
            Save(next);
            return true;
        }

        /// <summary>The library macros the buttons run, each once, in the order the decks name them.</summary>
        public static List<string> MacrosNamed(Config config)
        {
            var names = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var tile in AllTiles(config))
                if (tile.Action.Kind == "macro" && !string.IsNullOrEmpty(tile.Action.Macro) && seen.Add(tile.Action.Macro)) names.Add(tile.Action.Macro);
            return names;
        }

        private static IEnumerable<Tile> AllTiles(Config config)
        {
            foreach (var deck in config.Decks)
            {
                foreach (var page in deck.Pages) foreach (var t in page.Tiles) yield return t;
                foreach (var folder in deck.Folders) foreach (var t in folder.Tiles) yield return t;
            }
        }

        private static Config Clone(Config config) =>
            JsonSerializer.Deserialize<Config>(JsonSerializer.Serialize(config, WriteOptions), ReadOptions) ?? new Config();

        /// <summary>A config the page sent, read with the same names the file uses.</summary>
        public static Config? FromJson(JsonElement element)
        {
            try { return element.Deserialize<Config>(ReadOptions); }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"Deck: config from the page could not be read: {ex.GetType().Name}: {ex.Message}");
                return null;
            }
        }

        // ── Normalize: the config as the engine keeps it ──────────────────────────────────────────

        private static readonly Regex HexColor = new("^#[0-9a-f]{6}$", RegexOptions.CultureInvariant);
        private static readonly Regex LucideName = new("^[a-z0-9]+(-[a-z0-9]+)*$", RegexOptions.CultureInvariant);
        // A drawing, nothing else: the page renders the icon by its name, and the window draws this SVG.
        private static readonly Regex SvgDanger = new(@"<\s*(script|foreignObject|iframe|object|embed)|\son[a-z]+\s*=|javascript:|data:text/html", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        /// <summary>
        /// The config as the engine keeps it: known kinds only, sizes inside their bounds, unique ids and
        /// slots, a folder button pointing to a folder that exists. Nothing is invented: a part that does not
        /// hold together is dropped (a button's action goes back to none, a tile out of the 8×8 grid goes).
        /// </summary>
        public static Config Normalize(Config? raw)
        {
            var config = new Config
            {
                Version = SchemaVersion,
                Enabled = raw?.Enabled ?? true,
                ShowInCaptures = raw?.ShowInCaptures ?? false,
                BusyPress = Pick(raw?.BusyPress, BusyPresses, "swap"),
                ToggleAllHotkey = Combo(raw?.ToggleAllHotkey),
            };
            if (raw?.Decks == null) return config;
            var ids = new HashSet<string>(StringComparer.Ordinal);
            foreach (var d in raw.Decks)
            {
                if (d == null || config.Decks.Count >= MaxDecks) continue;
                var deck = new Deck
                {
                    Id = FreeId(d.Id, ids, "d-"),
                    Name = Clip((d.Name ?? "").Trim(), MaxNameLength),
                    Icon = NormalizeIcon(d.Icon),
                    On = d.On,
                    Mode = Pick(d.Mode, new[] { "fixed", "summon" }, "fixed"),
                    Hotkey = Combo(d.Hotkey),
                    ShowWhen = NormalizeShowWhen(d.ShowWhen),
                    Summon = new Summon
                    {
                        At = Pick(d.Summon?.At, new[] { "cursor", "center" }, "cursor"),
                        Hold = d.Summon?.Hold ?? false,
                        KeysOnly = d.Summon?.KeysOnly ?? false,
                        CloseAfterPick = d.Summon?.CloseAfterPick ?? true,
                    },
                    Grid = new Grid
                    {
                        Cols = Math.Clamp(d.Grid?.Cols ?? 5, 1, MaxGrid),
                        Rows = Math.Clamp(d.Grid?.Rows ?? 3, 1, MaxGrid),
                        Size = Pick(d.Grid?.Size, Sizes, "m"),
                    },
                    Place = new Place
                    {
                        Monitor = ClipOrNull(d.Place?.Monitor?.Trim(), 256),
                        Anchor = Pick(d.Place?.Anchor, Anchors, "bottom-right"),
                        Dx = Offset(d.Place?.Dx ?? -24),
                        Dy = Offset(d.Place?.Dy ?? -24),
                    },
                    Look = new Look
                    {
                        RestOpacity = NearestOpacity(d.Look?.RestOpacity ?? 100),
                        Collapse = d.Look?.Collapse ?? false,
                        EdgeHide = d.Look?.EdgeHide ?? false,
                        Locked = d.Look?.Locked ?? false,
                        Header = d.Look?.Header ?? true,
                    },
                };
                if (deck.Name.Length == 0) deck.Name = FreeDeckName(config.Decks);

                // Folders first: a Folder button keeps its action only when its folder is here.
                var folderIds = new HashSet<string>(StringComparer.Ordinal);
                var folders = new List<(Folder clean, List<Tile>? raw)>();
                foreach (var f in d.Folders ?? new List<Folder>())
                {
                    if (f == null || folders.Count >= MaxFolders) continue;
                    var clean = new Folder { Id = FreeId(f.Id, folderIds, "f-"), Name = Clip((f.Name ?? "").Trim(), MaxLabelLength) };
                    folders.Add((clean, f.Tiles));
                }
                foreach (var (clean, rawTiles) in folders)
                {
                    clean.Tiles = NormalizeTiles(rawTiles, folderIds, insideFolder: true);
                    deck.Folders.Add(clean);
                }

                var pageIds = new HashSet<string>(StringComparer.Ordinal);
                foreach (var p in d.Pages ?? new List<Page>())
                {
                    if (p == null || deck.Pages.Count >= MaxPages) continue;
                    deck.Pages.Add(new Page { Id = FreeId(p.Id, pageIds, "p-"), Tiles = NormalizeTiles(p.Tiles, folderIds, insideFolder: false) });
                }
                // A deck always has a page to show, even an empty one.
                if (deck.Pages.Count == 0) deck.Pages.Add(new Page { Id = FreeId(null, pageIds, "p-") });
                config.Decks.Add(deck);
            }
            return config;
        }

        private static List<Tile> NormalizeTiles(List<Tile>? raw, HashSet<string> folderIds, bool insideFolder)
        {
            var result = new List<Tile>();
            if (raw == null) return result;
            var slots = new HashSet<int>();
            foreach (var t in raw)
            {
                // The first tile a slot names wins it; a slot off the 8×8 grid has nowhere to be.
                if (t == null || t.Slot < 0 || t.Slot >= MaxSlots || !slots.Add(t.Slot)) continue;
                var color = (t.Color ?? "").Trim().ToLowerInvariant();
                result.Add(new Tile
                {
                    Slot = t.Slot,
                    Label = ClipOrNull(t.Label?.Trim(), MaxLabelLength),
                    Color = HexColor.IsMatch(color) ? color : null,
                    Icon = NormalizeIcon(t.Icon),
                    Action = NormalizeAction(t.Action, folderIds, insideFolder),
                });
            }
            return result.OrderBy(t => t.Slot).ToList();
        }

        private static Action NormalizeAction(Action? a, HashSet<string> folderIds, bool insideFolder)
        {
            var kind = (a?.Kind ?? "none").Trim();
            switch (kind)
            {
                case "macro":
                {
                    var macro = (a!.Macro ?? "").Trim();
                    // An empty name is a button still being set up: kept, it runs nothing until it names one.
                    return new Action { Kind = kind, Macro = macro.Length == 0 || macro.Length > MaxMacroNameLength ? null : macro };
                }
                case "keys":
                    return new Action { Kind = kind, Combo = Combo(a!.Combo) };
                case "text":
                {
                    var text = a!.Text ?? "";
                    if (text.Length > MaxTextLength) text = text[..MaxTextLength];
                    return new Action { Kind = kind, Text = text, Send = Pick(a.Send, new[] { "type", "paste" }, "type") };
                }
                case "open":
                {
                    var target = (a!.Target ?? "").Trim();
                    if (target.Length > MaxTargetLength) return new Action();
                    return new Action
                    {
                        Kind = kind,
                        Target = target.Length == 0 ? null : target,
                        Args = ClipOrNull(a.Args?.Trim(), MaxArgsLength),
                        Focus = a.Focus == true ? true : null,
                    };
                }
                case "folder":
                    // A folder opens from the deck's pages only: one inside another would need a way back up two levels.
                    return !insideFolder && a!.Folder != null && folderIds.Contains(a.Folder) ? new Action { Kind = kind, Folder = a.Folder } : new Action();
                case "tr3":
                {
                    var command = Commands.FirstOrDefault(c => string.Equals(c, a!.Command?.Trim(), StringComparison.OrdinalIgnoreCase));
                    return command == null ? new Action() : new Action { Kind = kind, Command = command };
                }
                default:
                    return new Action();
            }
        }

        private static Icon? NormalizeIcon(Icon? i)
        {
            if (i == null) return null;
            switch ((i.Kind ?? "").Trim())
            {
                case "lucide":
                {
                    var name = (i.Name ?? "").Trim().ToLowerInvariant();
                    var svg = (i.Svg ?? "").Trim();
                    bool svgOk = svg.Length is > 0 and <= MaxSvgLength && svg.StartsWith("<svg", StringComparison.Ordinal) && !SvgDanger.IsMatch(svg);
                    if (!LucideName.IsMatch(name) || name.Length > 64) return null;
                    return new Icon { Kind = "lucide", Name = name, Svg = svgOk ? svg : null };
                }
                case "emoji":
                {
                    var value = (i.Value ?? "").Trim();
                    return value.Length is > 0 and <= MaxEmojiLength ? new Icon { Kind = "emoji", Value = value } : null;
                }
                case "app":
                {
                    var path = (i.Path ?? "").Trim();
                    return path.Length is > 0 and <= MaxPathLength ? new Icon { Kind = "app", Path = path } : null;
                }
                case "image":
                {
                    // A name inside Deck\images, never a path: a file elsewhere is copied there first.
                    var file = System.IO.Path.GetFileName((i.Path ?? "").Trim());
                    return file.Length is > 0 and <= 128 && file.IndexOfAny(System.IO.Path.GetInvalidFileNameChars()) < 0 ? new Icon { Kind = "image", Path = file } : null;
                }
                default:
                    return null;
            }
        }

        private static ShowWhen NormalizeShowWhen(ShowWhen? s)
        {
            var apps = (s?.Apps ?? new List<string>())
                .Select(e => System.IO.Path.GetFileName((e ?? "").Trim()))
                .Where(e => e.Length > 0)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(MaxApps)
                .ToList();
            var kind = Pick(s?.Kind, new[] { "always", "apps" }, "always");
            // "Only with these apps in front" with no app would never show: back to always.
            if (kind == "apps" && apps.Count == 0) kind = "always";
            return new ShowWhen { Kind = kind, Apps = apps };
        }

        private static string Pick(string? value, IEnumerable<string> allowed, string fallback)
        {
            var v = (value ?? "").Trim();
            return allowed.FirstOrDefault(a => string.Equals(a, v, StringComparison.OrdinalIgnoreCase)) ?? fallback;
        }

        private static string? Combo(string? combo)
        {
            var c = (combo ?? "").Trim();
            return c.Length is > 0 and <= MaxComboLength ? c : null;
        }

        private static string Clip(string s, int max) => s.Length > max ? s[..max] : s;
        private static string? ClipOrNull(string? s, int max) => string.IsNullOrEmpty(s) ? null : Clip(s, max);

        private static double Offset(double v) => double.IsFinite(v) ? Math.Clamp(Math.Round(v, 1), -MaxOffset, MaxOffset) : 0;

        private static int NearestOpacity(int v) => RestOpacities.OrderBy(o => Math.Abs(o - v)).ThenByDescending(o => o).First();

        private static string FreeId(string? id, HashSet<string> taken, string prefix)
        {
            var clean = (id ?? "").Trim();
            if (clean.Length == 0 || clean.Length > 64 || taken.Contains(clean)) clean = prefix + Guid.NewGuid().ToString("N")[..10];
            taken.Add(clean);
            return clean;
        }

        // "Deck", then "Deck 2", "Deck 3"… for a deck that came without a name.
        private static string FreeDeckName(List<Deck> decks)
        {
            bool Taken(string n) => decks.Any(d => string.Equals(d.Name, n, StringComparison.OrdinalIgnoreCase));
            if (!Taken("Deck")) return "Deck";
            for (int i = 2; ; i++) if (!Taken($"Deck {i}")) return $"Deck {i}";
        }

        // ── The file ──────────────────────────────────────────────────────────────────────────────

        private static string FailureDetail(Exception? ex, bool isParse) =>
            ex == null ? S.DeckDetailUnknown
            : isParse ? S.DeckDetailParse(ex.Message)
            : S.DeckDetailRead(S.Reason(ex));

        // A Windows notification, the one surface this service reaches on its own (the window's ctor,
        // before WebView2). Its button opens the Deck page. Never lets a failure break a load.
        private static void Announce(string title, string text)
        {
            try { WindowsNotices.Show(title, text, null, (S.DeckOpen, "deck-open")); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck notification failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        private static void Raise()
        {
            // The hook's tables of the decks' hotkeys, compiled here (off the hook thread) and swapped whole.
            try
            {
                var (toggles, summons) = HotkeyTables(Current);
                InputHookManager.SetDeckHotkeys(toggles);
                InputHookManager.SetDeckSummons(summons);
            }
            catch (Exception ex) { DiagnosticLog.Error("Deck: compiling the hotkeys failed", ex); }
            try { Changed?.Invoke(); }
            catch (Exception ex) { DiagnosticLog.Warn($"Deck: a Changed handler failed: {ex.GetType().Name}: {ex.Message}"); }
        }

        /// <summary>
        /// The hook's two tables. Combo → command for the dispatcher: "DECK_ALL" for the one that shows and hides every
        /// deck, "DECK::id" for a fixed deck's own. Combo → the summoned deck it calls (the hook calls it itself, Fase 4).
        /// The first to name a combo keeps it, across both.
        /// </summary>
        private static (IReadOnlyDictionary<string, string> Toggles, IReadOnlyDictionary<string, InputHookManager.DeckSummonKey> Summons) HotkeyTables(Config config)
        {
            var toggles = new Dictionary<string, string>(StringComparer.Ordinal);
            var summons = new Dictionary<string, InputHookManager.DeckSummonKey>(StringComparer.Ordinal);
            if (!config.Enabled) return (toggles, summons);
            var taken = new HashSet<string>(StringComparer.Ordinal);
            if (config.ToggleAllHotkey != null && taken.Add(config.ToggleAllHotkey)) toggles[config.ToggleAllHotkey] = "DECK_ALL";
            foreach (var deck in config.Decks)
            {
                if (!deck.On || deck.Hotkey == null || !taken.Add(deck.Hotkey)) continue;
                if (deck.Mode == "summon") summons[deck.Hotkey] = new InputHookManager.DeckSummonKey(deck.Id, deck.Summon.Hold);
                else toggles[deck.Hotkey] = "DECK::" + deck.Id;
            }
            return (toggles, summons);
        }

        private static bool TryReadText(string path, out string text, out Exception? error, int attempts = ReadRetryAttempts)
        {
            text = "";
            error = null;
            for (int attempt = 0; attempt < attempts; attempt++)
            {
                try
                {
                    using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                    using var reader = new StreamReader(stream, detectEncodingFromByteOrderMarks: true);
                    text = reader.ReadToEnd();
                    return true;
                }
                catch (Exception ex)
                {
                    error = ex;
                    if (attempt < attempts - 1) Thread.Sleep(ReadRetryDelayMs);
                }
            }
            return false;
        }

        private static Config? TryParse(string json, out Exception? error)
        {
            error = null;
            try { return JsonSerializer.Deserialize<Config>(json, ReadOptions) ?? new Config(); }
            catch (Exception ex) { error = ex; return null; }
        }

        private static bool TryLoadBackup(out Config config)
        {
            config = new Config();
            try
            {
                var backupPath = SiblingPath(BackupFileName);
                if (!File.Exists(backupPath) || !TryReadText(backupPath, out var text, out _)) return false;
                var parsed = TryParse(text, out _);
                if (parsed == null) return false;
                config = Normalize(parsed);
                DiagnosticLog.Info($"Deck recovered from {BackupFileName}: {config.Decks.Count} decks.");
                return true;
            }
            catch { return false; }
        }

        // Compares first: the folder is often cloud-synced, and rewriting the same bytes is an upload for nothing.
        private static void WriteBackupIfChanged(string json)
        {
            try
            {
                var backupPath = SiblingPath(BackupFileName);
                if (File.Exists(backupPath)
                    && TryReadText(backupPath, out var existing, out _, attempts: 1)
                    && string.Equals(existing, json, StringComparison.Ordinal))
                {
                    return;
                }
                FileHelper.WriteAllTextAtomic(backupPath, json);
            }
            catch (Exception ex)
            {
                DiagnosticLog.Warn($"deck backup write failed: {ex.GetType().Name}: {ex.Message}");
            }
        }
    }
}
