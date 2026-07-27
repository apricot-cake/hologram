// アプリが持つ i18n 文字列テーブル2つのパリティガード:
//   1) app/src/renderer/src/services/i18n.ts — MESSAGES.ja / MESSAGES.en（ビューアの文言）
//   2) extension/public/_locales/{ja,en}/messages.json — Chrome i18n（拡張の文言）
// 片方の言語にだけキーを足して忘れると実行時に「黙って」壊れる（引き当てがフォールバック
// するか生キーが出る）ので、ずれたまま出荷される。ここで落として気付けるようにする。
// キーだけでなく値の「形」（renderer は postCount(n) のような関数値もある）と、文字列値が
// 持つ置換スロット（$n / $NAME$）が両言語で揃っているかも見る。

import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const repo = path.join(import.meta.dirname, '..');

// 置換スロット: renderer は $1/$2…、拡張の形式は名前つき $PLACEHOLDER$ も許す。
// キーごとに順序非依存の集合として比べる。
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

// --- 1) renderer の MESSAGES（モジュール内に閉じている → ソースを切り出して読む）
// i18n.ts は real ES module（named export `hologramI18n`）だが、MESSAGES 自体はモジュール
// スコープのまま（ここでは ja/en を並べて見たいのに対し、hologramI18n はロケール1つに解決
// してしまう）＝import() ではなくソースを読む。必要なのは `const MESSAGES = {...}` の宣言
// だけで、その後ろに続く hologramI18n の async IIFE は要らない（window/navigator を要求し、
// `export` で始まるので indirect eval には構文的にも渡せない）。切り落とした直上に残る
// `import { hologramIpc } from './ipc.ts'` も同じ理由で indirect eval には渡せないが、この
// 断片では未使用なので、切り出し位置を広げるのではなく import 行を落とす。
function loadRendererMessages() {
  const fullSrc = stripTypeScriptTypes(fs.readFileSync(path.join(repo, 'app', 'src', 'renderer', 'src', 'services', 'i18n.ts'), 'utf8'), { mode: 'strip' });
  const cut = fullSrc.search(/^export const hologramI18n = /m);
  expect(cut, 'i18n.ts に `export const hologramI18n = ` が無い＝この切り出し位置を直すこと').not.toBe(-1);

  const src = fullSrc.slice(0, cut).replace(/^import .*;$/gm, '');
  const HOOK = /const MESSAGES\s*=\s*\{/;
  expect(HOOK.test(src), 'i18n.ts に `const MESSAGES = {` が無い＝この HOOK を直すこと').toBe(true);

  // biome-ignore lint/security/noGlobalEval: モジュール内に閉じた MESSAGES を読むための意図的な indirect eval
  // biome-ignore lint/complexity/noCommaOperator: (0, eval) が indirect eval のイディオムそのもの
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
