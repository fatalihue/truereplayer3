// Builds the page once per language (plan .claude/planos/idiomas-tr3-2026-11-02.md, §3.3): dist/en-US
// and dist/pt-BR, side by side, what the app ships and navigates to. The two builds run at the same
// time — each is a Vite process with its own TR_LANG — so the second language costs little wall time.
//
// Then the check the plan asks of every slice: each build carries the text of its own language only.
// For every key whose two languages differ, a build that holds the other language's text fails —
// unless that text is still written in frontend/src itself, by a screen not yet moved to the catalog
// (those are counted, and reach zero when the last screen moves).
//
//   node tools/build-idiomas.mjs        dist/en-US and dist/pt-BR (npm run build)
//   node tools/build-idiomas.mjs qps    dist/qps, the pseudo-localized page the tests sweep; never shipped
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const front = path.join(here, '..');
const dist = path.join(front, 'dist');
const qps = process.argv[2] === 'qps';
const idiomas = qps ? ['qps'] : ['en-US', 'pt-BR'];

// A build leaves only its own folder: the shared dist goes before the shipping pair is made, so nothing
// of an older layout (dist/index.html, dist/assets) or a stale qps rides along into wwwroot.
if (!qps) fs.rmSync(dist, { recursive: true, force: true });

const vite = path.join(front, 'node_modules', 'vite', 'bin', 'vite.js');
const construir = (lang) => new Promise((resolve) => {
  const p = spawn(process.execPath, [vite, 'build'], { cwd: front, env: { ...process.env, TR_LANG: lang } });
  let saida = '';
  p.stdout.on('data', (d) => { saida += d; });
  p.stderr.on('data', (d) => { saida += d; });
  p.on('close', (status) => resolve({ lang, status, saida }));
});
const t0 = Date.now();
const resultados = await Promise.all(idiomas.map(construir));
let falhou = false;
for (const r of resultados) {
  console.log(`\n── ${r.lang} ──\n${r.saida.trim()}`);
  if (r.status !== 0) { console.error(`[build-idiomas] ${r.lang}: vite build saiu com ${r.status}`); falhou = true; }
}
if (falhou) process.exit(1);
console.log(`\n[build-idiomas] ${idiomas.join(' e ')} em ${((Date.now() - t0) / 1000).toFixed(1)} s`);
if (qps) process.exit(0);

// ── Each build holds its own language only.
const { catalogo, formasDe } = await import(pathToFileURL(path.join(front, '..', 'tools', 'i18n-lib.mjs')).href);
const [en, pt] = [await catalogo('en-US'), await catalogo('pt-BR')];
const lerBuild = (lang) => {
  const dir = path.join(dist, lang);
  const arquivos = [];
  const andar = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) andar(p); else if (/\.(js|html)$/.test(e.name)) arquivos.push(p); } };
  andar(dir);
  return arquivos.map((a) => fs.readFileSync(a, 'utf8')).join('\n');
};
const fonte = [];
const andarFonte = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) andarFonte(p); else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.g.ts')) fonte.push(fs.readFileSync(p, 'utf8')); } };
andarFonte(path.join(front, 'src'));
// As JSX shows it: an entity is its character, and a text broken over lines is one line.
const noCodigo = fonte.join('\n').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const textoEn = lerBuild('en-US');
const textoPt = lerBuild('pt-BR');
// The fixed pieces of a text, between its blanks, as a build writes them in a string literal; short
// ones ("Off", "s") could be anything else's and are not searched.
const pedacos = (t) => t.split(/\{\{[^}]*\}\}/).map((p) => p.trim()).filter((p) => p.length >= 8);
const naoAcha = (alvo, p) => !alvo.includes(p) && !alvo.includes(JSON.stringify(p).slice(1, -1));
const problemas = [];
const aindaNoCodigo = new Set();
for (const [chave, e] of en.entradas) {
  const p = pt.entradas.get(chave);
  const fe = formasDe(e), fp = formasDe(p);
  for (let i = 0; i < fe.length; i++) {
    if (fe[i] === fp[i]) continue;
    for (const pedaco of pedacos(fe[i])) {
      if (fp.some((x) => x.includes(pedaco)) || naoAcha(textoPt, pedaco)) continue;
      if (noCodigo.includes(pedaco)) aindaNoCodigo.add(pedaco); else problemas.push(`dist/pt-BR tem o inglês de ${chave}: "${pedaco}"`);
    }
    for (const pedaco of pedacos(fp[i])) {
      if (fe.some((x) => x.includes(pedaco)) || naoAcha(textoEn, pedaco)) continue;
      if (noCodigo.includes(pedaco)) aindaNoCodigo.add(pedaco); else problemas.push(`dist/en-US tem o português de ${chave}: "${pedaco}"`);
    }
  }
}
if (problemas.length) {
  console.error(`[build-idiomas] um build tem o texto do outro idioma:\n  ${[...new Set(problemas)].join('\n  ')}`);
  process.exit(1);
}
console.log(`[build-idiomas] cada build tem só o texto dele (${en.entradas.size} chaves conferidas; ${aindaNoCodigo.size} textos do catálogo ainda escritos em telas que não passaram por ele)`);
