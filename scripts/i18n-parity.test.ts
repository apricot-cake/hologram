// Parity guard for the app's 3 i18n string tables:
//   1) app/src/renderer/src/services/i18n.ts — MESSAGES.ja / MESSAGES.en (viewer copy)
//   2) extension/public/_locales/{ja,en}/messages.json — Chrome i18n (extension copy)
//   3) extension/utils/i18n.ts — MESSAGES.ja / MESSAGES.en (in-page UI copy.
//      Content scripts can't reliably read _locales, so it's embedded)
// If a key is added to only one language and forgotten, it breaks "silently" at
// runtime (the lookup either falls back or a raw key leaks out), so the drift ships
// as-is. Fail here so it gets caught. Besides the keys themselves, also check that
// the "shape" of the values (renderer has function values like postCount(n)) and the
// substitution slots ($n / $NAME$) held by string values line up across both languages.

import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { MESSAGES as extensionMessages } from '../extension/utils/i18n.ts';

const repo = path.join(import.meta.dirname, '..');

// Substitution slots: renderer uses $1/$2…, the extension's format also allows named
// $PLACEHOLDER$. Compare as an order-independent set per key.
const subsOf = (s: unknown) => (String(s).match(/\$[A-Za-z_]+\$|\$\d/g) || []).sort().join(',');

const missingFrom = (a: object, b: object) => Object.keys(a).filter((k) => !(k in b));

const shapeDrift = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a)
    .filter((k) => k in b && typeof a[k] !== typeof b[k])
    .map((k) => `${k} (ja: ${typeof a[k]} / en: ${typeof b[k]})`);

const subsDrift = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a)
    .filter((k) => k in b && typeof a[k] === 'string' && subsOf(a[k]) !== subsOf(b[k]))
    .map((k) => `${k} (ja: ${subsOf(a[k]) || 'none'} / en: ${subsOf(b[k]) || 'none'})`);

// --- 1) renderer's MESSAGES (closed over inside the module → extract the source and read it)
// i18n.ts is a real ES module (named export `hologramI18n`), but MESSAGES itself stays
// module-scoped (we want to see ja/en side by side here, whereas hologramI18n resolves
// to a single locale) = read the source rather than import(). All we need is the
// `const MESSAGES = {...}` declaration; the async IIFE for hologramI18n that follows it
// isn't needed (it requires window/navigator, and starts with `export`, so it can't
// even syntactically be passed to indirect eval). The `import { hologramIpc } from
// './ipc.ts'` left just above the cut point can't be passed to indirect eval for the
// same reason either, but it's unused in this fragment, so rather than widening the
// cut point, just drop the import line.
function loadRendererMessages() {
  const fullSrc = stripTypeScriptTypes(fs.readFileSync(path.join(repo, 'app', 'src', 'renderer', 'src', 'services', 'i18n.ts'), 'utf8'), { mode: 'strip' });
  const cut = fullSrc.search(/^export const hologramI18n = /m);
  expect(cut, 'i18n.ts に `export const hologramI18n = ` が無い＝この切り出し位置を直すこと').not.toBe(-1);

  const src = fullSrc.slice(0, cut).replace(/^import .*;$/gm, '');
  const HOOK = /const MESSAGES\s*=\s*\{/;
  expect(HOOK.test(src), 'i18n.ts に `const MESSAGES = {` が無い＝この HOOK を直すこと').toBe(true);

  // biome-ignore lint/security/noGlobalEval: intentional indirect eval to read MESSAGES closed over inside the module
  // biome-ignore lint/complexity/noCommaOperator: (0, eval) is the indirect eval idiom itself
  (0, eval)(src.replace(HOOK, 'const MESSAGES = globalThis.__hologramMessages = {'));
  const M = (globalThis as any).__hologramMessages;
  expect(M?.ja && M?.en, 'MESSAGES.ja / MESSAGES.en を取り出せていない').toBeTruthy();
  return M as { ja: Record<string, unknown>; en: Record<string, unknown> };
}

describe('renderer の MESSAGES', () => {
  const { ja, en } = loadRendererMessages();

  test('ja にあって en に無いキーは無い', () => {
    expect(missingFrom(ja, en)).toEqual([]);
  });

  test('en にあって ja に無いキーは無い', () => {
    expect(missingFrom(en, ja)).toEqual([]);
  });

  test('値の形（文字列 / 関数）が両言語で一致する', () => {
    expect(shapeDrift(ja, en)).toEqual([]);
  });

  test('置換スロットが両言語で一致する', () => {
    expect(subsDrift(ja, en)).toEqual([]);
  });
});

// --- 3) the extension's embedded in-page UI table (can be imported straight from the module)
describe('拡張の埋め込み MESSAGES（utils/i18n.ts）', () => {
  const { ja, en } = extensionMessages;

  test('ja にあって en に無いキーは無い', () => {
    expect(missingFrom(ja, en)).toEqual([]);
  });

  test('en にあって ja に無いキーは無い', () => {
    expect(missingFrom(en, ja)).toEqual([]);
  });

  test('置換スロットが両言語で一致する', () => {
    expect(subsDrift(ja, en)).toEqual([]);
  });
});

describe('拡張の _locales（Chrome i18n JSON）', () => {
  const read = (lang: string) => JSON.parse(fs.readFileSync(path.join(repo, 'extension', 'public', '_locales', lang, 'messages.json'), 'utf8'));
  const ja = read('ja');
  const en = read('en');
  const messages = (t: Record<string, any>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v?.message]));

  test('ja にあって en に無いキーは無い', () => {
    expect(missingFrom(ja, en)).toEqual([]);
  });

  test('en にあって ja に無いキーは無い', () => {
    expect(missingFrom(en, ja)).toEqual([]);
  });

  test('置換スロットが両言語で一致する', () => {
    expect(subsDrift(messages(ja), messages(en))).toEqual([]);
  });
});
