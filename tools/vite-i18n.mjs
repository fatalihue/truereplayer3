// The page's text, one language per build (plan .claude/planos/idiomas-tr3-2026-11-02.md, §3.3).
//
// Every t('area.key', { blanks }) and tn('area.group') in frontend/src is replaced, at compile time and
// before the React Compiler sees the file, by the text of the build's language: a string, a template
// literal, or for a plural the ternary of the language's rule. Nothing of the catalog reaches the page
// at run time — no table, no lookup, no key — so each build carries the text of its own language only,
// and the opening chunk pays nothing for the other one. The language is TR_LANG (en-US, pt-BR, or qps,
// the pseudo-localized build the tests sweep); changing it means loading the other build.
//
// A key that does not exist, a blank left out or added, a key that is not a literal: a build error at
// the call. tools/gen-i18n.mjs has already checked the catalog itself by then.
//
// Until every screen is in the catalog, the old pairs tt('English', 'Português') of useTt() are picked
// here too, by the same language (slice I1): a build never carries the other language, and the qps
// build keeps them unmarked, so its sweep still finds them.
import path from 'node:path';
import { RAIZ, DIR, catalogo, codigoTexto, lacunas, regraPlural, ts } from './i18n-lib.mjs';

const FONTES = path.join(RAIZ, 'frontend', 'src').replace(/\\/g, '/').toLowerCase() + '/';
// The module that exports t() and tn(): frontend/src/i18n.ts, imported as './i18n', '../i18n'…
const DO_I18N = /^(\.\.?\/)+i18n(\.ts)?$/;
const HTML_LANG = { 'en-US': 'en-US', 'pt-BR': 'pt-BR', qps: 'qps-ploc' };

/** @param {{ lang: 'en-US' | 'pt-BR' | 'qps' }} opts */
export default function i18n({ lang }) {
  if (!(lang in HTML_LANG)) throw new Error(`TR_LANG=${lang}: o idioma é en-US, pt-BR ou qps`);
  const regra = lang === 'pt-BR' ? 'pt-BR' : 'en-US';
  let cat;
  const carregar = async () => { cat = await catalogo(lang); };

  return {
    name: 'tr-i18n',
    enforce: 'pre',
    config: () => ({ define: { __TR_LANG__: JSON.stringify(lang) } }),
    buildStart: carregar,
    transformIndexHtml: (html) => html.replace(/<html lang="[^"]*">/, `<html lang="${HTML_LANG[lang]}">`),

    configureServer(server) {
      // An edited catalog reloads the page in the dev server.
      server.watcher.add(DIR);
      server.watcher.on('change', async (arquivo) => {
        if (!path.resolve(arquivo).startsWith(DIR) || !arquivo.endsWith('.ts')) return;
        try { await carregar(); } catch (e) { server.config.logger.error(`[i18n] ${e.message}`); return; }
        server.moduleGraph.invalidateAll();
        server.ws.send({ type: 'full-reload' });
      });
    },

    async transform(code, id) {
      const arquivo = id.split('?')[0];
      if (!arquivo.toLowerCase().startsWith(FONTES) || !/\.tsx?$/.test(arquivo)) return null;
      // The old pairs, tt('English', 'Português') from useTt(), until their screen moves to the catalog:
      // the build's language picks one at compile time too, so a build never carries the other.
      const comPares = /\btt\(|\bt = useTt\(\)/.test(code);
      if (!comPares && !/\bi18n['"]/.test(code)) return null;
      if (!cat) await carregar();
      const sf = ts.createSourceFile(arquivo, code, ts.ScriptTarget.Latest, true, arquivo.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

      // The names t and tn go by in this file (an import may rename them).
      const nomes = new Map();
      for (const st of sf.statements) {
        if (!ts.isImportDeclaration(st) || !DO_I18N.test(st.moduleSpecifier.text)) continue;
        const nb = st.importClause?.namedBindings;
        if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) {
          const original = (el.propertyName ?? el.name).text;
          if (original === 't' || original === 'tn') nomes.set(el.name.text, original);
        }
      }
      // Two pages name the pair function t (const t = useTt()); there t(a, b) with a text that is not a key
      // is a pair, not the catalog.
      const parT = !nomes.has('t') && /\bt = useTt\(\)/.test(code);
      const ehPar = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.arguments.length === 2
        && (n.expression.text === 'tt' || (parT && n.expression.text === 't'));
      if (!nomes.size && !comPares) return null;

      const erro = (node, msg) => {
        const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        this.error({ message: `[i18n] ${msg}`, id: arquivo, loc: { file: arquivo, line: line + 1, column: character } });
      };
      const ehChamada = (n) => ehPar(n) || (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && nomes.has(n.expression.text));
      // The outermost t()/tn() calls inside a node, not the node itself.
      const chamadasEm = (raiz) => {
        const achadas = [];
        const visitar = (n) => { if (ehChamada(n)) achadas.push(n); else ts.forEachChild(n, visitar); };
        ts.forEachChild(raiz, visitar);
        return achadas;
      };
      // The source of a node with the calls inside it already replaced (t('a', { n: t('b') })).
      const fonte = (n) => {
        // A blank whose whole value is a call: t('a', { x: t('b') }).
        if (ehChamada(n)) return gerar(n);
        const ini = n.getStart(sf);
        let out = code.slice(ini, n.end);
        for (const c of chamadasEm(n).sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
          out = out.slice(0, c.getStart(sf) - ini) + gerar(c) + out.slice(c.end - ini);
        }
        return out;
      };
      const simples = (n) => ts.isIdentifier(n) || ts.isNumericLiteral(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)
        || n.kind === ts.SyntaxKind.ThisKeyword || (ts.isPropertyAccessExpression(n) && !n.questionDotToken && simples(n.expression));

      const gerar = (call) => {
        // A pair keeps its own text, unmarked even in qps: it is not in the catalog yet.
        if (ehPar(call)) return `(${fonte(call.arguments[lang === 'pt-BR' ? 1 : 0])})`;
        const funcao = nomes.get(call.expression.text);
        const [chaveNo, argsNo, ...sobra] = call.arguments;
        if (!chaveNo || !(ts.isStringLiteral(chaveNo) || ts.isNoSubstitutionTemplateLiteral(chaveNo))) {
          erro(call, `${funcao}(): a chave tem de ser um texto literal (um ${call.expression.text} local que esconde o do catálogo? renomeie-o)`);
        }
        const chave = chaveNo.text;
        if (sobra.length) erro(call, `${funcao}('${chave}'): argumentos demais`);

        if (funcao === 'tn') {
          if (argsNo) erro(call, `tn('${chave}'): não recebe lacunas`);
          const g = cat.grupos.get(chave);
          if (!g || !g.textos.length) erro(chaveNo, `tn('${chave}'): não é um grupo de textos`);
          const pares = g.textos.map((k) => {
            const e = cat.entradas.get(`${chave}.${k}`);
            if (lacunas(e.texto).length) erro(chaveNo, `tn('${chave}'): ${k} tem lacunas`);
            return `${JSON.stringify(k)}:${JSON.stringify(e.texto)}`;
          });
          return `({${pares.join(',')}})`;
        }

        const e = cat.entradas.get(chave);
        if (!e) erro(chaveNo, `t('${chave}'): a chave não existe no catálogo (i18n/en-US)`);
        // The blanks given: name → source, and whether each is cheap to read twice.
        const dados = new Map();
        if (argsNo) {
          if (!ts.isObjectLiteralExpression(argsNo)) erro(argsNo, `t('${chave}'): as lacunas vão num objeto literal`);
          for (const p of argsNo.properties) {
            if (ts.isShorthandPropertyAssignment(p)) dados.set(p.name.text, { src: p.name.text, simples: true });
            else if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name))) {
              dados.set(p.name.text, { src: fonte(p.initializer), simples: simples(p.initializer) });
            } else erro(p, `t('${chave}'): só propriedades simples nas lacunas`);
          }
        }
        const formas = e.tipo === 'texto' ? { texto: e.texto } : e.formas;
        const usadas = new Set(Object.values(formas).flatMap(lacunas));
        const precisa = new Set(usadas);
        if (e.tipo === 'plural') precisa.add('count');
        for (const n of precisa) if (!dados.has(n)) erro(argsNo ?? call, `t('${chave}'): falta a lacuna ${n}`);
        for (const n of dados.keys()) if (!precisa.has(n)) erro(argsNo, `t('${chave}'): a lacuna ${n} não existe no texto`);

        // A blank read more than once (a plural's count, a {{name}} twice in one form) that is not a
        // plain name goes through a parameter, so it runs once.
        const repetida = (n) => (e.tipo === 'plural' && n === 'count') || Object.values(formas).some((f) => lacunas(f).filter((x) => x === n).length > 1);
        const viaParametro = [...dados].filter(([n, d]) => !d.simples && repetida(n));
        const valores = Object.fromEntries([...dados].map(([n, d]) => [n, viaParametro.some(([m]) => m === n) ? `__${n}` : `(${d.src})`]));
        const expr = e.tipo === 'texto'
          ? codigoTexto(e.texto, valores)
          : regraPlural(regra, valores.count, Object.fromEntries(Object.entries(e.formas).map(([f, t]) => [f, codigoTexto(t, valores)])));
        // Keep the line count, so the dev server's stack traces still point at the right line.
        const linhas = '\n'.repeat((code.slice(call.getStart(sf), call.end).match(/\n/g) || []).length);
        if (!viaParametro.length) return linhas ? `(${expr}${linhas})` : expr;
        return `((${viaParametro.map(([n]) => `__${n}`).join(',')})=>${expr})(${viaParametro.map(([, d]) => d.src).join(',')}${linhas})`;
      };

      const chamadas = chamadasEm(sf);
      if (!chamadas.length) return null;
      let out = code;
      for (const c of chamadas.sort((a, b) => b.getStart(sf) - a.getStart(sf))) {
        out = out.slice(0, c.getStart(sf)) + gerar(c) + out.slice(c.end);
      }
      return { code: out, map: null };
    },
  };
}
