using System;
using System.Collections.Generic;
using System.Linq;

namespace TrueReplayer.Services
{
    /// <summary>
    /// What a deck's menus hold (branch deck; plan .claude/planos/deck-2026-11-19.md, Fase 6). The button's menu:
    /// Record here, a macro of the library (the twelve changed last, and All macros… on the Deck page), Keys…, Text…
    /// and Open… (on the page, where they are typed), a folder, a TR3 command, the icon (from the list, a program, a cut
    /// of the screen, a picture), the colour, duplicate, delete, and the way to the page and to the edit mode. An empty
    /// place's menu is the same without what needs a button. The deck's own (its header): edit it on screen, open it
    /// in TR3, hide it for now. What is done here goes to deck.json at once (DeckService); what needs the app — a
    /// recording, the page, a file dialog, the capture — goes to it (DeckHost.Request).
    /// </summary>
    internal static class DeckMenus
    {
        /// <summary>The folders' 24 colours (FOLDER_COLORS in the page's themes.ts): a button's colour is one of them.</summary>
        public static readonly string[] Colors =
        {
            "#f43f5e", "#ff6b6b", "#fb923c", "#f59e0b", "#d4a020", "#ffd93d", "#84cc16", "#9a9a3e",
            "#22c55e", "#6bcb77", "#4dd0a0", "#14b8a6", "#06b6d4", "#60cdff", "#42a5f5", "#3b82f6",
            "#5d5fd1", "#a78bfa", "#c084fc", "#e879f9", "#ef5da8", "#f472b6", "#b3814e", "#7a8599",
        };

        private static readonly string[] Commands = { "record", "stopAll", "clicker", "teclado", "remaps", "automations", "shortcuts", "show" };

        private static string CommandLabel(string command) => command switch
        {
            "record" => S.DeckCommandRecord,
            "stopAll" => S.DeckCommandStopAll,
            "clicker" => S.DeckCommandClicker,
            "teclado" => S.DeckCommandTeclado,
            "remaps" => S.DeckCommandRemaps,
            "automations" => S.DeckCommandAutomations,
            "shortcuts" => S.DeckCommandShortcuts,
            _ => S.DeckCommandShow,
        };

        /// <summary>The menu of a place of what the deck shows: its button's, or an empty place's.</summary>
        public static List<DeckMenu.Item> ForTile(DeckWindow window, int slot, DeckService.Tile? tile, bool editing)
        {
            string id = window.Id;
            string? folder = window.FolderOpen;
            int page = Math.Max(0, window.Page);
            var action = tile?.Action;
            var items = new List<DeckMenu.Item>();

            // The button's action: changed where there is a button, a new button where there is none.
            void Set(DeckService.Action a)
            {
                if (tile != null) DeckService.ChangeTile(id, folder, page, slot, t => t.Action = a);
                else DeckService.SetTile(id, folder, page, slot, new DeckService.Tile { Action = a });
            }
            void ToPage(string? focus) => DeckHost.Request(new DeckHost.DeckRequest("page", id, folder, page, slot, focus));

            // A Folder button opens its folder here, for its own buttons.
            if (action?.Kind == "folder" && action.Folder is { } openId && folder == null && window.Deck.Folders.Any(f => f.Id == openId))
            {
                items.Add(new DeckMenu.Item { Label = S.DeckMenuOpenFolder, Run = () => window.ShowFolder(openId) });
                items.Add(DeckMenu.Item.Sep());
            }

            items.Add(new DeckMenu.Item { Label = S.DeckMenuRecordHere, Run = () => DeckHost.Request(new DeckHost.DeckRequest("record", id, folder, page, slot)) });
            items.Add(new DeckMenu.Item
            {
                Label = S.DeckMenuMacro,
                Submenu = () =>
                {
                    var macros = DeckService.RecentMacros(12);
                    var list = macros.Select(name => new DeckMenu.Item
                    {
                        Label = name,
                        Checked = action?.Kind == "macro" && action.Macro == name,
                        Run = () => Set(new DeckService.Action { Kind = "macro", Macro = name }),
                    }).ToList();
                    if (list.Count == 0) list.Add(new DeckMenu.Item { Label = S.DeckMenuNoMacros, Disabled = true });
                    list.Add(DeckMenu.Item.Sep());
                    list.Add(new DeckMenu.Item { Label = S.DeckMenuAllMacros, Run = () => { if (action?.Kind != "macro") Set(new DeckService.Action { Kind = "macro" }); ToPage("macro"); } });
                    return list;
                },
            });
            items.Add(new DeckMenu.Item { Label = S.DeckMenuKeys, Run = () => { if (action?.Kind != "keys") Set(new DeckService.Action { Kind = "keys" }); ToPage("keys"); } });
            items.Add(new DeckMenu.Item { Label = S.DeckMenuText, Run = () => { if (action?.Kind != "text") Set(new DeckService.Action { Kind = "text", Text = "", Send = "type" }); ToPage("text"); } });
            items.Add(new DeckMenu.Item { Label = S.DeckMenuOpen, Run = () => { if (action?.Kind != "open") Set(new DeckService.Action { Kind = "open" }); ToPage("open"); } });
            // A folder opens from the pages only: one inside another would need a way back up two levels.
            if (folder == null) items.Add(new DeckMenu.Item { Label = S.DeckMenuFolder, Run = () => NewFolderButton(window, page, slot) });
            items.Add(new DeckMenu.Item
            {
                Label = S.DeckMenuCommand,
                Submenu = () => Commands.Select(c => new DeckMenu.Item
                {
                    Label = CommandLabel(c),
                    Checked = action?.Kind == "tr3" && action.Command == c,
                    Run = () => Set(new DeckService.Action { Kind = "tr3", Command = c }),
                }).ToList(),
            });

            if (tile != null)
            {
                items.Add(DeckMenu.Item.Sep());
                items.Add(new DeckMenu.Item
                {
                    Label = S.DeckMenuIcon,
                    Submenu = () => new List<DeckMenu.Item>
                    {
                        new() { Label = S.DeckMenuIconList, Run = () => ToPage("icon") },
                        new() { Label = S.DeckMenuIconApp, Run = () => DeckHost.Request(new DeckHost.DeckRequest("iconApp", id, folder, page, slot)) },
                        new() { Label = S.DeckMenuIconCapture, Run = () => DeckHost.Request(new DeckHost.DeckRequest("iconCapture", id, folder, page, slot)) },
                        new() { Label = S.DeckMenuIconPicture, Run = () => DeckHost.Request(new DeckHost.DeckRequest("iconPicture", id, folder, page, slot)) },
                        DeckMenu.Item.Sep(),
                        new() { Label = S.DeckMenuIconDefault, Disabled = tile.Icon == null, Run = () => DeckService.ChangeTile(id, folder, page, slot, t => t.Icon = null) },
                    },
                });
                items.Add(new DeckMenu.Item
                {
                    Label = S.DeckMenuColor,
                    Submenu = () => new List<DeckMenu.Item>
                    {
                        new() { Swatches = Colors, SwatchOn = tile.Color, Pick = c => DeckService.ChangeTile(id, folder, page, slot, t => t.Color = c) },
                        new() { Label = S.DeckMenuNoColor, Disabled = tile.Color == null, Run = () => DeckService.ChangeTile(id, folder, page, slot, t => t.Color = null) },
                    },
                });
                items.Add(DeckMenu.Item.Sep());
                items.Add(new DeckMenu.Item { Label = S.DeckMenuDuplicate, Run = () => { if (DeckService.DuplicateTile(id, folder, page, slot) < 0) window.Flash(slot, S.DeckTipNoRoom); } });
                items.Add(new DeckMenu.Item { Label = S.DeckMenuDelete, Danger = true, Run = () => DeckService.SetTile(id, folder, page, slot, null) });
            }

            items.Add(DeckMenu.Item.Sep());
            items.Add(new DeckMenu.Item { Label = S.DeckMenuEditInTr3, Run = () => ToPage(null) });
            if (!editing && !window.IsSummonDeck) items.Add(new DeckMenu.Item { Label = S.DeckMenuEditOnScreen, Run = () => DeckHost.Edit(id) });
            return items;
        }

        /// <summary>The deck's own menu (its header): the edit mode, the page, hide it for now.</summary>
        public static List<DeckMenu.Item> ForDeck(DeckWindow window, bool editing)
        {
            string id = window.Id;
            var items = new List<DeckMenu.Item>();
            if (editing) items.Add(new DeckMenu.Item { Label = S.DeckMenuDoneEditing, Run = () => DeckHost.Edit(null) });
            else if (!window.IsSummonDeck) items.Add(new DeckMenu.Item { Label = S.DeckMenuEditOnScreen, Run = () => DeckHost.Edit(id) });
            items.Add(new DeckMenu.Item { Label = S.DeckMenuOpenInTr3, Run = () => DeckHost.Request(new DeckHost.DeckRequest("page", id, null, Math.Max(0, window.Page), -1)) });
            if (!window.IsSummonDeck && !editing) items.Add(new DeckMenu.Item { Label = S.DeckMenuHide, Run = () => DeckHost.Toggle(id) });
            return items;
        }

        /// <summary>A Folder button: a new folder of the deck ("Pasta", "Pasta 2"…), opened from this place.</summary>
        private static void NewFolderButton(DeckWindow window, int page, int slot)
        {
            bool full = false;
            bool done = DeckService.EditDeck(window.Id, deck =>
            {
                var tiles = DeckService.TilesAt(deck, null, page);
                if (tiles == null) return false;
                var tile = tiles.FirstOrDefault(t => t.Slot == slot);
                // Already a folder's button (Fase 8): it keeps its folder, and no other one is made out of sight.
                if (tile?.Action is { Kind: "folder", Folder: { } open } && deck.Folders.Any(f => f.Id == open)) return false;
                var folderId = DeckService.AddFolder(deck, S.DeckMenuFolderName);
                if (folderId == null) { full = true; return false; }
                if (tile == null)
                {
                    tile = new DeckService.Tile { Slot = slot };
                    tiles.Add(tile);
                    tiles.Sort((a, b) => a.Slot.CompareTo(b.Slot));
                }
                tile.Action = new DeckService.Action { Kind = "folder", Folder = folderId };
                return true;
            });
            if (!done && full) window.Flash(slot, S.DeckTipFoldersFull(max: S.Num(DeckService.MaxFolders)));
        }
    }
}
