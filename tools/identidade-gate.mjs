// The identity gate (plan truereplayer3-paralelo-2026-10-30.md, decision 3).
//
// Fails the build when "TrueReplayer" builds a path or names the app outside the identity. A path
// that slipped through would write into TrueReplayer 2's data; a forgotten visible name would say
// "TrueReplayer" on a TrueReplayer 3 screen.
//   node tools/identidade-gate.mjs cs    -> Source/**/*.cs except AppIdentity.cs (MSBuild runs it before compiling)
//   node tools/identidade-gate.mjs dist  -> frontend/dist, what ships (npm run build runs it after vite)
//
// What the two apps share keeps the family name and is listed below: the browser extension, its
// pipe, the macro file format, and the namespace and file names in the code.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2];

// A whole line that is a using or namespace directive.
const ALLOWED_CS_LINE = [/^\s*(using|namespace)\s+TrueReplayer\b/];
// Each occurrence passes when the text from it on matches one of these.
const ALLOWED_CS = [
  /^TrueReplayer\.[A-Za-z]/,                 // namespace, type or file: TrueReplayer.Helpers, TrueReplayer.NativeHost.exe
  /^TrueReplayerBridge\b/,                   // the extension's pipe (decision 6)
  /^TrueReplayer extension\b/,               // the browser extension, the same for both apps
  /^TrueReplayer macros \(\*\.trprofile\)/,  // the file type, the same for both apps
  /^TrueReplayer macro export\b/,            // "isn't a valid TrueReplayer macro export": the file format too
];
const ALLOWED_DIST = [
  /^TrueReplayer [23]\b/,                    // APP_NAME and TR2_NAME (frontend/src/appIdentity.ts)
  /^TrueReplayer3\b/,                        // APP_FOLDER: this app's own folder name
  /^TrueReplayer extension\b/,
  /^TrueReplayer-releases\/manual\.html/,    // today's manual, TrueReplayer 2's, until 3 has its own
];
// ...or when the text right before it matches one of these.
const ALLOWED_DIST_BEFORE = [
  /extensão do $/,                           // "a extensão do TrueReplayer"
  /Requires $/, /Requer o? ?$/,              // "Requires TrueReplayer 2.48.0 or newer": a macro's minimum version
];

const failures = [];

// Drops /* … */ and a trailing // when they are not inside a string (counts the quotes before them).
const evenQuotes = (s) => ((s.match(/(?<!\\)"/g) || []).length % 2) === 0;
function stripComments(line, state) {
  let out = '';
  for (let i = 0; i < line.length; i++) {
    if (state.block) {
      if (line.startsWith('*/', i)) { state.block = false; i++; }
      continue;
    }
    if (line.startsWith('/*', i) && evenQuotes(out)) { state.block = true; i++; continue; }
    if (line.startsWith('//', i) && evenQuotes(out)) break;
    out += line[i];
  }
  return out;
}

function walk(dir, keep, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, keep, files);
    else if (keep(e.name)) files.push(p);
  }
  return files;
}

function scanCs() {
  const files = walk(path.join(repo, 'Source'), (n) => n.endsWith('.cs') && n !== 'AppIdentity.cs');
  for (const file of files) {
    const state = { block: false };
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((original, n) => {
      const line = stripComments(original, state);
      if (!line.includes('TrueReplayer') || ALLOWED_CS_LINE.some((r) => r.test(line))) return;
      for (let i = line.indexOf('TrueReplayer'); i !== -1; i = line.indexOf('TrueReplayer', i + 1)) {
        if (ALLOWED_CS.some((r) => r.test(line.slice(i)))) continue;
        failures.push(`${path.relative(repo, file)}:${n + 1}: ${original.trim()}`);
        break;
      }
    });
  }
  return files.length;
}

function scanDist() {
  const root = path.join(repo, 'frontend', 'dist');
  if (!fs.existsSync(root)) { console.error(`identity gate: ${root} does not exist; run vite build first`); process.exit(2); }
  const files = walk(root, (n) => /\.(js|html|css)$/.test(n));
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (let i = text.indexOf('TrueReplayer'); i !== -1; i = text.indexOf('TrueReplayer', i + 1)) {
      if (ALLOWED_DIST.some((r) => r.test(text.slice(i, i + 60)))) continue;
      if (ALLOWED_DIST_BEFORE.some((r) => r.test(text.slice(Math.max(0, i - 20), i)))) continue;
      failures.push(`${path.relative(repo, file)}: …${text.slice(Math.max(0, i - 40), i + 50).replace(/\s+/g, ' ')}…`);
    }
  }
  return files.length;
}

let seen;
if (mode === 'cs') seen = scanCs();
else if (mode === 'dist') seen = scanDist();
else { console.error('usage: node tools/identidade-gate.mjs cs|dist'); process.exit(2); }

if (failures.length) {
  console.error(`identity gate (${mode}): "TrueReplayer" outside the identity in ${failures.length} place(s). Use AppIdentity (C#) or appIdentity.ts (page):`);
  for (const f of failures) console.error('  ' + f);
  process.exit(1);
}
console.log(`identity gate (${mode}): ok, ${seen} files.`);
