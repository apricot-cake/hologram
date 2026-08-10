// #581 の再発防止。バナーは必ず選択枠の前面に描かれ、それを決めるのは1か所だけ。
// どちらの画面も共有 ShadowRoot の中の position:fixed な兄弟で、自前の重なり順を持たない
// （transform/opacity などが重なりの文脈を作っていない）＝これより前は DOM への挿入順だけ
// が上に描く側を決めていた。capture.ts はたまたまバナーの直後に highlight を挿入するので、
// ビューポートを埋める投稿 (#325) では枠の縁がバナーの文字を突き抜けて描かれていた。
//
// 描画したものではなく components.css の文字列を見る検査にしてある。jsdom はレイアウトも
// 描画もしない（重なりの文脈が無く、adoptedStyleSheets の解決が getComputedStyle まで
// 届かない）ので、ブラウザ相当の検証がここで読めるものは、このファイルが直に書いている
// こと以上には何も無い。
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const CSS = fs.readFileSync(path.join(import.meta.dirname, '..', 'extension', 'utils', 'components.css'), 'utf8');

// 生の CSS テキストから、数値のカスタムプロパティの値を取り出す。どちらの名前もファイル
// 全体で一意なので（宣言はそれぞれちょうど1つ）、単純な部分文字列の検索で足りる＝ファイルに
// ある2つの `:host` ブロックのどちらが宣言しているかを、先に切り分ける必要はない。
function customPropertyValue(name: string): number {
  const marker = name + ':';
  const at = CSS.indexOf(marker);
  if (at === -1) throw new Error('components.css にカスタムプロパティの宣言が無い: ' + name);
  const rest = CSS.slice(at + marker.length);
  const match = rest.match(/^\s*(\d+)/);
  if (!match) throw new Error('カスタムプロパティに数値の値が無い: ' + name);
  return Number(match[1]);
}

// `selector` の規則が `needle` を含むかどうか。セレクタ自身の開き波括弧と閉じ波括弧を
// 見つけて調べる（これらの規則はどれも入れ子にならないので、直後の最初の `}` が規則の終わり）。
function ruleContains(selector: string, needle: string): boolean {
  const selectorAt = CSS.indexOf(selector + ' {');
  if (selectorAt === -1) throw new Error('components.css にセレクタが無い: ' + selector);
  const braceStart = CSS.indexOf('{', selectorAt);
  const braceEnd = CSS.indexOf('}', braceStart);
  return CSS.slice(braceStart, braceEnd).includes(needle);
}

describe('#581 スタッキングは一箇所（components.css）が決める', () => {
  test(':host の --z-locate と --z-explain: explain の方が大きい（前面）', () => {
    expect(customPropertyValue('--z-explain')).toBeGreaterThan(customPropertyValue('--z-locate'));
  });

  test('バナー / ドロップゾーン（.surface）は --z-explain を使う', () => {
    expect(ruleContains('.surface', 'z-index: var(--z-explain)')).toBe(true);
  });

  test('選択枠（.highlight）は --z-locate を使う（.surface より低い）', () => {
    expect(ruleContains('.highlight', 'z-index: var(--z-locate)')).toBe(true);
  });

  // どちらの名前も、アプリのデザイントークンの名前空間と衝突してはいけない。これらは
  // アプリの globals.css から生成される色や動きではなく、`--hologram-` の接頭辞を付けると
  // extension-tokens.test.ts の「参照されている --hologram-* はすべて生成された集合にある」
  // という防ぎが、これらのせいで落ちる。
  test('--z-* は --hologram-* 名前空間と衝突しない（トークン生成の対象外）', () => {
    expect(CSS.includes('--hologram-z-')).toBe(false);
  });
});
