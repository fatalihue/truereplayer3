// Deck (branch deck, Fase 5): the lucide icons the button's picker offers, by group. A chunk of its own,
// brought when the picker first opens: a button keeps the SVG the picker drew (deckIconSvg), which the
// native window draws and the page shows as a mask, so nothing else needs this list to show an icon.
import {
  AlarmClock, AppWindow, ArrowDown, ArrowLeft, ArrowRight, ArrowRightLeft, ArrowUp, AtSign, Axe, BatteryFull, Bell, BellOff, Bluetooth,
  Bold, Bomb, Book, Bookmark, Calculator, Calendar, Camera, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, Clipboard,
  Clock, Code, Coins, Command, Compass, Copy, CornerDownLeft, Cpu, Crosshair, Crown, Dice5, Download, Eraser, ExternalLink, FastForward,
  File as FileIcon, FileText, Film, Flag, Flame, Folder, FolderOpen, Footprints, Gamepad2, Gem, Ghost, Globe, HardDrive, Hash, Headphones, Heart,
  House, Image as ImageIcon, Italic, Keyboard, Laptop, LayoutGrid, List, ListChecks, Lock, LockOpen, LogIn, LogOut, Mail, Map as MapIcon, Maximize, MessageCircle,
  MessageSquare, Mic, MicOff, Minimize, Minus, Monitor, Moon, Mouse, MousePointerClick, Move, Music, Pause, Pencil, Phone, Pickaxe, Pin,
  Play, Plus, Power, Printer, Quote, Radio, Redo2, RefreshCw, Repeat, Rewind, Rocket, RotateCw, Save, ScreenShare, Scissors, Search,
  Send, Settings, Shield, ShoppingCart, Shuffle, SkipBack, SkipForward, Skull, Smile, Sparkles, Square, Star, Sun, Sword, Swords, Tag,
  Target, Terminal, ThumbsUp, Timer, Trash2, TriangleAlert, Trophy, Tv, Type, Undo2, Upload, Video, Volume1, Volume2, VolumeX,
  WandSparkles, Wifi, X, Zap, type LucideIcon,
} from 'lucide-react';

export type IconGroupId = 'media' | 'system' | 'files' | 'games' | 'arrows' | 'edit';

/** The groups, each with its icons by their lucide names (what deck.json keeps beside the SVG). */
export const ICON_GROUPS: { id: IconGroupId; icons: [string, LucideIcon][] }[] = [
  {
    id: 'media',
    icons: [
      ['play', Play], ['pause', Pause], ['square', Square], ['skip-back', SkipBack], ['skip-forward', SkipForward], ['rewind', Rewind],
      ['fast-forward', FastForward], ['repeat', Repeat], ['shuffle', Shuffle], ['volume-2', Volume2], ['volume-1', Volume1], ['volume-x', VolumeX],
      ['mic', Mic], ['mic-off', MicOff], ['music', Music], ['headphones', Headphones], ['radio', Radio], ['video', Video], ['camera', Camera],
      ['film', Film], ['image', ImageIcon], ['tv', Tv], ['screen-share', ScreenShare],
    ],
  },
  {
    id: 'system',
    icons: [
      ['power', Power], ['lock', Lock], ['lock-open', LockOpen], ['settings', Settings], ['sun', Sun], ['moon', Moon], ['wifi', Wifi],
      ['bluetooth', Bluetooth], ['battery-full', BatteryFull], ['monitor', Monitor], ['laptop', Laptop], ['keyboard', Keyboard], ['mouse', Mouse],
      ['mouse-pointer-click', MousePointerClick], ['printer', Printer], ['cpu', Cpu], ['hard-drive', HardDrive], ['terminal', Terminal],
      ['app-window', AppWindow], ['layout-grid', LayoutGrid], ['maximize', Maximize], ['minimize', Minimize], ['refresh-cw', RefreshCw],
      ['command', Command], ['zap', Zap], ['bell', Bell], ['bell-off', BellOff], ['search', Search],
    ],
  },
  {
    id: 'files',
    icons: [
      ['folder', Folder], ['folder-open', FolderOpen], ['file', FileIcon], ['file-text', FileText], ['save', Save], ['download', Download],
      ['upload', Upload], ['trash-2', Trash2], ['clipboard', Clipboard], ['copy', Copy], ['scissors', Scissors], ['globe', Globe], ['mail', Mail],
      ['send', Send], ['calendar', Calendar], ['calculator', Calculator], ['message-square', MessageSquare], ['message-circle', MessageCircle],
      ['phone', Phone], ['shopping-cart', ShoppingCart], ['book', Book], ['bookmark', Bookmark], ['code', Code], ['external-link', ExternalLink],
    ],
  },
  {
    id: 'games',
    icons: [
      ['gamepad-2', Gamepad2], ['swords', Swords], ['sword', Sword], ['shield', Shield], ['crosshair', Crosshair], ['target', Target],
      ['trophy', Trophy], ['flame', Flame], ['heart', Heart], ['star', Star], ['crown', Crown], ['gem', Gem], ['coins', Coins], ['skull', Skull],
      ['dice-5', Dice5], ['ghost', Ghost], ['rocket', Rocket], ['bomb', Bomb], ['wand-sparkles', WandSparkles], ['axe', Axe],
      ['pickaxe', Pickaxe], ['footprints', Footprints], ['map', MapIcon], ['compass', Compass],
    ],
  },
  {
    id: 'arrows',
    icons: [
      ['arrow-up', ArrowUp], ['arrow-down', ArrowDown], ['arrow-left', ArrowLeft], ['arrow-right', ArrowRight], ['chevron-up', ChevronUp],
      ['chevron-down', ChevronDown], ['chevron-left', ChevronLeft], ['chevron-right', ChevronRight], ['undo-2', Undo2], ['redo-2', Redo2],
      ['rotate-cw', RotateCw], ['move', Move], ['corner-down-left', CornerDownLeft], ['arrow-right-left', ArrowRightLeft], ['log-in', LogIn],
      ['log-out', LogOut], ['house', House],
    ],
  },
  {
    id: 'edit',
    icons: [
      ['type', Type], ['pencil', Pencil], ['eraser', Eraser], ['bold', Bold], ['italic', Italic], ['list', List], ['list-checks', ListChecks],
      ['check', Check], ['x', X], ['plus', Plus], ['minus', Minus], ['hash', Hash], ['at-sign', AtSign], ['quote', Quote], ['smile', Smile],
      ['thumbs-up', ThumbsUp], ['sparkles', Sparkles], ['clock', Clock], ['timer', Timer], ['alarm-clock', AlarmClock], ['flag', Flag],
      ['tag', Tag], ['pin', Pin], ['circle', Circle], ['triangle-alert', TriangleAlert],
    ],
  },
];

/**
 * The SVG deck.json keeps for an icon drawn here: the shape gen-deck-icons.mjs writes for the native
 * window (24×24, stroke="currentColor"), from the paths the icon drew in the picker.
 */
export function deckIconSvg(svg: SVGSVGElement): string {
  const body = Array.from(svg.children).map(child => child.outerHTML).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}
