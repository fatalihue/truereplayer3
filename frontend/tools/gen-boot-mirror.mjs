// Generates the theme boot mirror inside frontend/index.html from frontend/src/themes.ts.
//
// WHY THIS EXISTS
// index.html paints the saved theme before any bundle exists, so it runs as a classic inline
// script and CANNOT import the module. The palettes therefore have to be duplicated into it —
// and until now that copy was maintained by hand, with the word "GENERATED" in its comment as an
// aspiration rather than a fact. Nothing regenerated it, nothing checked it, and nothing tied the
// two files together in a commit. The failure mode is silent by construction: a stale mirror
// costs one frame of the wrong colour, which nobody notices until it is a whole palette. This
// project has already paid that bill once — a version gate in this block read `=== 1` while the
// stored config had moved to v5, so the entire mirror was dead code and every launch painted the
// default theme regardless of what the user had picked.
//
// WRITES ONLY WHEN THE CONTENT DIFFERS
// A build that rewrites a tracked file on every run dirties `git status`, and a clean tree is the
// normal state in this repo. So the generator compares first and touches the file only when it is
// actually stale — the common case leaves no trace, and the rare one prints what changed.
//
// Usage:  node tools/gen-boot-mirror.mjs           (generate; exit 1 only on real failure)
//         node tools/gen-boot-mirror.mjs --check   (never write; exit 1 if stale — for CI)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(here, '..', 'index.html');
const themesPath = path.join(here, '..', 'src', 'themes.ts');

// Node imports the .ts directly (type stripping). themes.ts has no imports of its own, so there
// is nothing to resolve — if this ever throws, the build SHOULD fail rather than ship a stale
// mirror silently, which is the whole point of the file.
const { themes, DEFAULT_THEME_ID, DEFAULT_UI_SETTINGS, REMOVED_THEME_FALLBACKS, THEME_COLOR_KEYS, UI_NUMBER_BOUNDS } =
  await import(pathToFileURL(themesPath).href);

const BEGIN = '    <!-- BEGIN GENERATED THEME BOOT MIRROR — edit tools/gen-boot-mirror.mjs, not this -->';
const END = '    <!-- END GENERATED THEME BOOT MIRROR -->';

const q = (s) => `'${String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const obj = (o) => `{${Object.entries(o).map(([k, v]) => `${q(k)}:${q(v)}`).join(',')}}`;

const presets = themes.map((t) => `          ${q(t.id)}:${obj(t.colors)}`).join(',\n');
const colorKeys = `[${THEME_COLOR_KEYS.map(q).join(',')}]`;
const ui = DEFAULT_UI_SETTINGS;

const block = `${BEGIN}
    <script>
      // Paint the saved theme BEFORE React loads, so launching never flashes the wrong
      // canvas (most visible on the light presets: a dark boot then a white app).
      //
      // GENERATED from frontend/src/themes.ts — this file cannot import the module (it runs as a
      // classic inline script before any bundle exists), so the palettes, the removed-id remap
      // and the defaults below are a copy kept in sync by the build. A stale entry here only
      // costs one frame of the wrong colour, never a crash: an unknown id falls back to the
      // default preset.
      (function() {
        var presets = {
${presets}
        };
        // Ids retired by the theme curation → their surviving relative, mirroring
        // REMOVED_THEME_FALLBACKS so the splash agrees with the migration that runs
        // moments later in loadThemeConfig.
        var moved = ${obj(REMOVED_THEME_FALLBACKS)};
        var saved = null;
        try { saved = localStorage.getItem('truereplay-theme'); } catch(e) {}
        // The colour keys the app knows. Everything below iterates THIS, never the keys of a
        // record that came out of localStorage — the same rule loadCustomPresets follows.
        var KEYS = ${colorKeys};
        // The user's own presets, which live in a SECOND storage key. Reading only the 37
        // built-ins meant a custom base resolved to null and every launch painted the default
        // dark palette before React swapped to the user's light theme — the exact flash this
        // block exists to prevent.
        var customs = {};
        try {
          var rawCustom = localStorage.getItem('truereplay-custom-presets');
          if (rawCustom) {
            var list = JSON.parse(rawCustom);
            if (list && list.length) {
              for (var ci = 0; ci < list.length; ci++) {
                var entry = list[ci];
                if (entry && entry.id && entry.colors) customs[entry.id] = entry.colors;
              }
            }
          }
        } catch(e) {}
        // Custom FIRST, then built-in, then the retired-id remap — the precedence
        // resolveThemeColors documents as "user wins".
        var resolve = function(id) { return customs[id] || presets[id] || presets[moved[id]] || null; };
        var colors = presets[${q(DEFAULT_THEME_ID)}];
        var DEF = { fontSize: ${ui.fontSize}, borderRadius: ${ui.borderRadius}, rowHeight: ${ui.rowHeight}, zoom: ${ui.zoom} };
        var ui = { fontSize: DEF.fontSize, borderRadius: DEF.borderRadius, rowHeight: DEF.rowHeight, zoom: DEF.zoom };
        // UI_NUMBER_BOUNDS: the range each number is accepted in, the table the sanitiser reads.
        var BOUNDS = ${JSON.stringify(UI_NUMBER_BOUNDS)};
        if (saved) {
          try {
            var cfg = JSON.parse(saved);
            // loadThemeConfig takes a stored config only with a version (any, not just v1 — this
            // gate once read "=== 1" and the whole block was dead) AND a base id; otherwise it
            // starts from the defaults, overrides and uiSettings included. The mirror used to
            // check that for the base colour alone, so a config missing either painted its
            // overrides and sizes for a frame before React painted the defaults.
            if (cfg && cfg.version >= 1 && cfg.baseThemeId) {
              // "Match Windows theme" is resolved HERE too, or the mirror paints the preset from
              // the LAST session whenever the OS theme changed while the app was closed — the exact
              // flash this whole block exists to prevent, arriving through the one door it did not
              // watch. Same resolution loadThemeConfig makes (themes.ts), so the pre-React paint and
              // React's first paint agree. colorOverrides are skipped in that case, as they are
              // there: they belong to the preset being left.
              var wantId = null;
              if (cfg.uiSettings && cfg.uiSettings.matchSystemTheme && window.matchMedia) {
                wantId = window.matchMedia('(prefers-color-scheme: light)').matches
                  ? cfg.uiSettings.lightPresetId : cfg.uiSettings.darkPresetId;
                if (wantId && !resolve(wantId)) wantId = null;
              }
              var followed = wantId && cfg.baseThemeId !== wantId;
              // The base may be null (an orphaned id); the overrides still apply on top of the
              // default, which is what resolveThemeColors does.
              var src = resolve(wantId || cfg.baseThemeId) || colors;
              colors = {};
              for (var ki = 0; ki < KEYS.length; ki++) { var kk = KEYS[ki]; if (src[kk]) colors[kk] = src[kk]; }
              if (cfg.colorOverrides && !followed) {
                for (var kj = 0; kj < KEYS.length; kj++) { var ko = KEYS[kj]; if (cfg.colorOverrides[ko]) colors[ko] = cfg.colorOverrides[ko]; }
              }
              if (cfg.uiSettings) {
                // The loader's order: stored values over the defaults, then its migrations, then its
                // sanitiser. v4 to v5 is the one migration that touches a painted number (a zoom still
                // at the old default 95 becomes the new one); without it an upgraded install booted
                // at 95 % and snapped to 90 %. Out of range, or not a number, is the default — a
                // stored zoom of 0 used to blank the page until React loaded.
                for (var nf in BOUNDS) { if (cfg.uiSettings[nf] !== undefined) ui[nf] = cfg.uiSettings[nf]; }
                if (cfg.version < 5 && ui.zoom === 95) ui.zoom = DEF.zoom;
                for (var nb in BOUNDS) {
                  var nv = ui[nb];
                  if (typeof nv !== 'number' || !isFinite(nv) || nv < BOUNDS[nb][0] || nv > BOUNDS[nb][1]) ui[nb] = DEF[nb];
                }
              }
            }
          } catch(e) {
            // Pre-v1 format: the value is a bare theme id string.
            var legacy = resolve(saved);
            if (legacy) colors = legacy;
          }
        }
        var s = document.documentElement.style;
        for (var k3 in colors) s.setProperty('--color-' + k3, colors[k3]);
        s.setProperty('--ui-font-size', ui.fontSize / 16 + 'rem');
        s.setProperty('--ui-border-radius', ui.borderRadius / 16 + 'rem');
        s.setProperty('--ui-row-height', ui.rowHeight / 16 + 'rem');
        // The scale too, or the first frame paints at 100 % and snaps to the user's scale the moment
        // applyThemeConfig runs. The new shell scales by rem (themes.ts, setScaleMode): the zoom
        // becomes the root font size, and nothing is zoomed.
        s.setProperty('--ui-zoom', 1);
        s.fontSize = (16 * ui.zoom / 100) + 'px';
        s.background = colors['bg-base'];
      })();
    </script>
${END}`;

const html = fs.readFileSync(htmlPath, 'utf8');
const eol = html.includes('\r\n') ? '\r\n' : '\n';
const norm = html.replace(/\r\n/g, '\n');

const start = norm.indexOf(BEGIN);
const stop = norm.indexOf(END);
let next;
if (start >= 0 && stop > start) {
  next = norm.slice(0, start) + block + norm.slice(stop + END.length);
} else if (start >= 0 || stop >= 0) {
  // Exactly one marker survived — someone deleted the other, or a reformat/re-encode mangled the
  // em dash inside it. Falling through to the first-run branch here was the bug: it anchors on the
  // `<script>` INSIDE the orphaned block, so the surviving BEGIN is kept and the emitted block
  // adds a second one, leaving two BEGIN markers while printing "regenerated" as if all were well.
  // A half-marked file is unrecoverable without guessing, so say so and stop.
  console.error('[boot-mirror] index.html has only one of the two markers — refusing to guess where the generated block ends.');
  console.error('             Restore the pair (or delete the whole block) and run again.');
  process.exit(1);
} else {
  // First run: adopt the existing hand-written <script> block that sits before the <style> tag.
  const s0 = norm.indexOf('    <script>');
  const s1 = norm.indexOf('</script>', s0);
  if (s0 < 0 || s1 < 0) {
    console.error('[boot-mirror] Could not find the inline boot <script> in index.html — refusing to guess.');
    process.exit(1);
  }
  next = norm.slice(0, s0) + block + norm.slice(s1 + '</script>'.length);
}

if (next === norm) {
  console.log('[boot-mirror] up to date (%d presets)', themes.length);
  process.exit(0);
}
if (process.argv.includes('--check')) {
  console.error('[boot-mirror] STALE — index.html does not match themes.ts. Run: npm run mirror');
  process.exit(1);
}
fs.writeFileSync(htmlPath, eol === '\r\n' ? next.replace(/\n/g, '\r\n') : next, 'utf8');
console.log('[boot-mirror] regenerated from themes.ts (%d presets)', themes.length);
