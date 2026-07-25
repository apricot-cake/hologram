'use strict';
// Parity guard for the app's TWO i18n string tables:
//   1) app/renderer/i18n.ts — MESSAGES.ja / MESSAGES.en (viewer strings)
//   2) extension/public/_locales/{ja,en}/messages.json — Chrome i18n (extension strings)
// A key added to one language and forgotten in the other fails SILENTLY at
// runtime (the lookup falls back or shows the raw key), so drift ships unnoticed —
// this test fails instead. Also checks that per-key value SHAPES agree: string vs
// function (renderer values may be functions like postCount(n)), and that string
// values carry the same $n / $NAME$ substitution slots in both languages.
//
// Run: node scripts/test-i18n-parity.cts   (exit 1 on drift)

const fs = require('node:fs');
const path = require('node:path');
const stripTS = require('./strip-ts.cts');

let failed = 0;
const fail = (msg) => {
  console.error('FAIL', msg);
  failed++;
};

function diffKeys(name, a, b) {
  const aKeys = new Set(Object.keys(a));
  const bKeys = new Set(Object.keys(b));
  for (const k of aKeys) if (!bKeys.has(k)) fail(`${name}: "${k}" exists in ja but is missing in en`);
  for (const k of bKeys) if (!aKeys.has(k)) fail(`${name}: "${k}" exists in en but is missing in ja`);
}

// Substitution slots: renderer uses $1/$2…, the extension format also allows
// named $PLACEHOLDER$ tokens. Order-insensitive set compare per key.
const subsOf = (s) => (String(s).match(/\$[A-Za-z_]+\$|\$\d/g) || []).sort().join(',');

function diffValues(name, a, b) {
  for (const k of Object.keys(a)) {
    if (!(k in b)) continue; // key drift already reported by diffKeys
    const av = a[k];
    const bv = b[k];
    if (typeof av !== typeof bv) {
      fail(`${name}: "${k}" value shape differs (ja: ${typeof av} / en: ${typeof bv})`);
      continue;
    }
    if (typeof av === 'string' && subsOf(av) !== subsOf(bv)) {
      fail(`${name}: "${k}" substitution mismatch (ja: ${subsOf(av) || 'none'} / en: ${subsOf(bv) || 'none'})`);
    }
  }
}

// ---- 1) renderer MESSAGES (module-private → expose via a guarded source patch).
// i18n.ts is a real ES module now (named export `hologramI18n`), but MESSAGES itself
// stays module-scope (both ja/en tables are needed side by side here, whereas
// hologramI18n only resolves to ONE locale) — so this still reads the source rather
// than import()-ing. Simpler than before the conversion, though: we only need the
// `const MESSAGES = {...}` declaration, not the hologramI18n async IIFE that follows
// it (which needs window/navigator + is now invalid syntax for indirect eval anyway,
// since it starts with the `export` keyword) — slice it off before eval, dropping
// the window/navigator shims entirely. The `import { hologramIpc } from './ipc.ts'`
// line that now sits just above the cut is ALSO invalid indirect-eval
// syntax (import declarations are Module-only, same restriction as export) — it's
// dead weight in this slice anyway (MESSAGES never references hologramIpc), so strip
// any import lines before eval rather than widen the cut point.
{
  const fullSrc = stripTS(fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer', 'i18n.ts'), 'utf8'));
  const EXPORT_LINE = /^export const hologramI18n = /m;
  const cut = fullSrc.search(EXPORT_LINE);
  if (cut === -1) {
    fail("renderer/i18n.ts: expected `export const hologramI18n = ` not found — update this test's cut point");
  } else {
    const src = fullSrc.slice(0, cut).replace(/^import .*;$/gm, '');
    const HOOK = /const MESSAGES\s*=\s*\{/;
    if (!HOOK.test(src)) {
      fail("renderer/i18n.ts: expected `const MESSAGES = {` not found — update this test's HOOK");
    } else {
      // biome-ignore lint/security/noGlobalEval: intentional indirect eval to read the module-private MESSAGES table (same pattern as test-search-unit used before its own conversion)
      // biome-ignore lint/style/noCommaOperator: (0, eval) IS the indirect-eval idiom
      (0, eval)(src.replace(HOOK, 'const MESSAGES = globalThis.__hologramMessages = {'));
      const M = (globalThis as any).__hologramMessages;
      if (!M || !M.ja || !M.en) {
        fail('renderer/i18n.ts: MESSAGES.ja / MESSAGES.en not captured');
      } else {
        diffKeys('renderer', M.ja, M.en);
        diffValues('renderer', M.ja, M.en);
        console.log(`renderer: ja=${Object.keys(M.ja).length} en=${Object.keys(M.en).length} keys checked`);
      }
    }
  }
}

// ---- 2) extension _locales (plain Chrome i18n JSON)
{
  const read = (lang) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'extension', 'public', '_locales', lang, 'messages.json'), 'utf8'));
  const ja = read('ja');
  const en = read('en');
  diffKeys('extension', ja, en);
  const msgs = (t: any) => Object.fromEntries(Object.entries(t).map(([k, v]: [string, any]) => [k, v && v.message]));
  diffValues('extension', msgs(ja), msgs(en));
  console.log(`extension: ja=${Object.keys(ja).length} en=${Object.keys(en).length} keys checked`);
}

if (failed) {
  console.error(`FAIL test-i18n-parity: ${failed} drift(s) — add the missing side (or fix the substitution slots) so both languages ship the same surface.`);
  process.exit(1);
}
console.log('PASS test-i18n-parity: renderer + extension tables are key/shape/substitution aligned');
