// アプリが持つ3つの i18n 文言表のそろい方を見張る:
//   1) app/src/renderer/src/services/i18n.ts＝MESSAGES.ja / MESSAGES.en (表示側の文言)
//   2) extension/public/_locales/{ja,en}/messages.json＝Chrome i18n (拡張機能の文言)
//   3) extension/utils/i18n.ts＝MESSAGES.ja / MESSAGES.en (ページ内 UI の文言。
//      content script は _locales を確実には読めないので埋め込んである)
// 片方の言語にしかキーを足さずに忘れると、実行時に「黙って」壊れる(引き当てが
// 退避するか、生のキーが漏れて出る)＝ずれたまま出荷される。ここで落として捕まえる。
// キーそのものに加えて、値の形(レンダラーは postCount(n) のような関数値を持つ)と、
// 文字列の値が持つ置換スロット($n / $NAME$)が両言語でそろっているかも見る。

import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { MESSAGES as extensionMessages } from '../extension/utils/i18n.ts';

const repo = path.join(import.meta.dirname, '..');

// 置換スロット: レンダラーは $1/$2…、拡張機能の書式は名前付きの $PLACEHOLDER$ も許す。
// キーごとに、順序を問わない集合として比べる。
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

// --- 1) レンダラーの MESSAGES（モジュールの中に閉じ込められている → ソースを切り出して読む）
// i18n.ts は本物の ES モジュール(名前付きエクスポート `hologramI18n`)だが、MESSAGES
// 自身はモジュールスコープに留まる。ここでは ja/en を並べて見たいのに hologramI18n は
// 1つのロケールへ解決してしまう＝import() ではなくソースを読む。要るのは
// `const MESSAGES = {...}` の宣言だけで、その後ろに続く hologramI18n の async IIFE は
// 要らない(window/navigator を要求するうえ `export` で始まるので、構文の上でも間接
// eval に渡せない)。切り出し位置のすぐ上に残る `import { hologramIpc } from './ipc.ts'`
// も同じ理由で間接 eval に渡せないが、この断片では使っていない。だから切り出し位置を
// 広げるのではなく、import 行を落とすだけにする。
function loadRendererMessages() {
  const fullSrc = stripTypeScriptTypes(fs.readFileSync(path.join(repo, 'app', 'src', 'renderer', 'src', 'services', 'i18n.ts'), 'utf8'), { mode: 'strip' });
  const cut = fullSrc.search(/^export const hologramI18n = /m);
  expect(cut, 'i18n.ts に `export const hologramI18n = ` が無い＝この切り出し位置を直すこと').not.toBe(-1);

  const src = fullSrc.slice(0, cut).replace(/^import .*;$/gm, '');
  const HOOK = /const MESSAGES\s*=\s*\{/;
  expect(HOOK.test(src), 'i18n.ts に `const MESSAGES = {` が無い＝この HOOK を直すこと').toBe(true);

  // biome-ignore lint/security/noGlobalEval: モジュールの中に閉じ込められた MESSAGES を読むための、意図した間接 eval
  // biome-ignore lint/complexity/noCommaOperator: (0, eval) は間接 eval の定型そのもの
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

// --- 3) 拡張機能に埋め込んだページ内 UI の表（モジュールからそのまま import できる）
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
