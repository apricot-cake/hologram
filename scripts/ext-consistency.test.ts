// 生成された manifest と、それを前提に書かれたコードの突合ガード（#130）。
//
// WXT 移行（#198）と extractor 登録簿（#212）で、manifest は手書きではなく
// wxt.config.ts ＋ 各サイトモジュールから**生成**されるようになった。だから
// 「manifest の match とコードの対応表を手で揃える」類のズレは構造的に消えている
// （登録簿そのものの不変条件は extractor-registry.test.ts が見る）。それでも
// **生成物とそれを前提に書かれたコード**の間には、型でも lint でも捕まらず、実機で
// 動かして初めて分かる約束が残っている:
//
//   1. 生成された match / host_permissions が、登録簿の宣言そのままか
//      （生成の途中で落ちても、拡張は「そのサイトで静かに何もしない」だけになる）
//   2. manifest が名指しするファイルと、コードが名指しして注入するファイルが
//      出力に実在するか（`files: ['capture.js']` は文字列＝リネームで無言に壊れる）
//   3. manifest の commands と、それを待ち受けるコードのコマンド名が一致するか
//   4. `key` から決まる拡張IDが、それを許可する側（Native Messaging の
//      allowed_origins を組む e2e ハーネス）の想定と一致するか
//   5. `__MSG_*` と getMessage のキーが、実在する文言か（i18n-parity.test.ts は
//      「日英テーブル同士」を見るだけで、「使う側との突合」がここにしか無い）
//
// 読むのはビルド出力。古い出力を読まないよう、`npm test` は走り出す前に必要なら
// build:ext を回す（scripts/vitest.global-setup.ts）。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_HOST_PERMISSIONS, RESIDENT_MATCHES } from '../extension/utils/extractor/index.ts';
import { MESSAGES } from '../extension/utils/i18n.ts';

const ROOT = path.join(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(EXT, '.output', 'chrome-mv3');

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
const backgroundSrc = fs.readFileSync(path.join(EXT, 'utils', 'background.ts'), 'utf8');

// 拡張のソース全部（生成物は除く）。走査対象を1箇所で決める。
function extensionSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (['node_modules', '.output', '.wxt'].includes(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (entry.name.endsWith('.ts') && !entry.name.startsWith('tokens.generated')) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  walk(EXT);
  return files;
}

const SOURCES = extensionSources().map((file) => fs.readFileSync(file, 'utf8'));

// === 呼び出しからキーを拾う ==================================================

// `<callee>(` から対応する `)` までの引数テキスト。文字列の中の括弧は数えない。
// リテラル1つを決め打ちで取らずに引数の範囲を返すのは、キーを三項演算子で選ぶ書き方
// （i18n.ts の partialSaveText / saveFailureText）を1つの呼び出しとして拾うため。
function callArgs(src: string, callee: RegExp): string[] {
  const args: string[] = [];
  for (const match of src.matchAll(callee)) {
    let depth = 1;
    let quote = '';
    let i = (match.index ?? 0) + match[0].length;
    const start = i;
    for (; i < src.length && depth > 0; i++) {
      const ch = src[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = '';
      } else if (ch === "'" || ch === '"' || ch === '`') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth--;
    }
    args.push(src.slice(start, i - 1));
  }
  return args;
}

const literalsIn = (text: string): string[] => [...text.matchAll(/'([^'\\]*)'|"([^"\\]*)"/g)].map((m) => m[1] ?? m[2]);

// 比較の相手はキーではなく判定値（`getMessage(reason === 'protected' ? 'a' : 'b')`
// の 'protected'）＝先に落としてから拾う。残るのは三項演算子のどの枝に置かれた
// キーも含む「キー位置のリテラル」だけになる。
const withoutComparisons = (text: string): string => text.replace(/[\w$.]+\s*[!=]==?\s*('[^']*'|"[^"]*")/g, '').replace(/('[^']*'|"[^"]*")\s*[!=]==?\s*[\w$.]+/g, '');

// 引数のキー位置に現れた文字列リテラルを、その呼び出しが使うキーとして集める。
function keysPassedTo(callee: RegExp): Set<string> {
  const keys = new Set<string>();
  for (const src of SOURCES) {
    for (const args of callArgs(src, callee)) {
      for (const literal of literalsIn(withoutComparisons(args))) keys.add(literal);
    }
  }
  return keys;
}

// === 1. 生成された manifest ↔ extractor 登録簿 ===============================

describe('生成された manifest は登録簿の宣言どおり', () => {
  test('常駐コンテンツスクリプトの matches は RESIDENT_MATCHES と一致する', () => {
    // 集合で比べる＝WXT は match を並べ替えて出力するので、順序は仕様ではない。
    const matches = manifest.content_scripts.flatMap((script: any) => script.matches);
    expect([...matches].sort()).toEqual([...RESIDENT_MATCHES].sort());
  });

  test('host_permissions は API_HOST_PERMISSIONS と一致する', () => {
    expect([...manifest.host_permissions].sort()).toEqual([...API_HOST_PERMISSIONS].sort());
  });
});

// === 2. 名指しされたファイルが出力に実在する =================================

describe('manifest とコードが名指しするファイルは出力に在る', () => {
  test('manifest が指すバンドル・ページ・画像が全部在る', () => {
    // manifest 内の「ファイルに見える文字列」を全部拾う＝将来 manifest に増えた
    // ファイル参照も、この一覧を書き換えずに検査対象へ入る。
    const referenced = [...JSON.stringify(manifest).matchAll(/"([\w./-]+\.(?:js|html|css|png|json))"/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(5);
    expect(referenced.filter((file) => !fs.existsSync(path.join(OUT, file)))).toEqual([]);
  });

  test('background が注入するファイル名が出力に在る', () => {
    // activeTab で流し込む capture エントリは manifest に載らない＝WXT の出力
    // ファイル名を文字列で名指ししている。リネームすると Alt+S だけが静かに死ぬ。
    const injected = callArgs(backgroundSrc, /executeScript\(/g).flatMap((args) => {
      const files = args.match(/files:\s*\[([^\]]*)\]/);
      return files ? literalsIn(files[1]) : [];
    });
    expect(injected).not.toEqual([]);
    expect(injected.filter((file) => !fs.existsSync(path.join(OUT, file)))).toEqual([]);
  });

  test('default_locale の _locales が出力に在る', () => {
    expect(fs.existsSync(path.join(OUT, '_locales', manifest.default_locale, 'messages.json'))).toBe(true);
  });
});

// === 3. commands ↔ 待ち受け ==================================================

describe('manifest の commands は待ち受けと一致する', () => {
  test('宣言したコマンドだけを、全部待ち受けている', () => {
    // 宣言だけあって待ち受けが無いショートカットは、押しても何も起きない。逆に
    // 待ち受けだけあって宣言が無いコマンドは、Chrome が二度と配らない。
    const handled = new Set([...backgroundSrc.matchAll(/command\s*[!=]==\s*'([^']+)'/g)].map((m) => m[1]));
    expect(handled.size).toBeGreaterThan(0);
    expect([...handled].sort()).toEqual(Object.keys(manifest.commands).sort());
  });
});

// === 4. key から決まる拡張ID ================================================

// Chrome の拡張ID＝公開鍵(DER)の SHA-256 の先頭16バイトを、ニブルごとに a-p へ
// 写したもの。`key` を manifest に固定してあるのは、この ID を開発機でも配布物でも
// 同じにするため（native-host の allowed_origins がこの ID を許可する）。
function extensionIdFrom(key: string): string {
  const digest = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  return [...digest.subarray(0, 16)].flatMap((byte) => [byte >> 4, byte & 0xf]).reduce((id, nibble) => id + String.fromCharCode(97 + nibble), '');
}

describe('拡張の固定ID', () => {
  test('key が manifest に載っている', () => {
    // 落ちると ID がインストールごとに変わる＝native-host が origin を拒否し、
    // 保存が「設定が一致していません」で全部失敗する。
    expect(typeof manifest.key).toBe('string');
  });

  test('key から決まる ID を、それを許可する側も同じ値で持っている', () => {
    const expected = extensionIdFrom(manifest.key);
    // ID の綴りを持っているのは e2e ハーネス（一時 Native Messaging ホストの
    // allowed_origins を組む側）。ID 形（a-p の32文字）の文字列リテラルを
    // scripts/ から拾って突き合わせる＝どのファイルが持っているかを列挙しない。
    const declared: string[] = [];
    for (const file of fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.cts'))) {
      const src = fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
      for (const match of src.matchAll(/'([a-p]{32})'/g)) declared.push(`${file}: ${match[1]}`);
    }
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((entry) => !entry.endsWith(expected))).toEqual([]);
  });
});

// === 5. 文言キーの突合 ======================================================

const locales = Object.fromEntries(['en', 'ja'].map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(EXT, 'public', '_locales', lang, 'messages.json'), 'utf8'))]));

describe('_locales（Chrome i18n）と使う側の突合', () => {
  // 使う側は2経路だけ: 生成された manifest の `__MSG_*__` と、拡張ページの
  // chrome.i18n.getMessage。options ページはキーを変数で渡す（setText(id, key)）
  // ので、その第2引数も同じ「使った」として拾う。
  const fromManifest = new Set([...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]));
  const fromCode = new Set([...keysPassedTo(/chrome\.i18n\.getMessage\(/g), ...SOURCES.flatMap((src) => [...src.matchAll(/setText\(\s*'[^']*'\s*,\s*'([^']+)'\s*\)/g)].map((m) => m[1]))]);
  const used = new Set([...fromManifest, ...fromCode]);

  test('走査が空振りしていない', () => {
    // キーが1つも拾えていない状態でも下の2本は緑になる＝走査の当たりを先に見る。
    expect(fromManifest.size).toBeGreaterThan(0);
    expect(fromCode.size).toBeGreaterThan(0);
  });

  test.each(['en', 'ja'])('%s に、使われているキーが全部在る', (lang) => {
    expect([...used].filter((key) => !(key in locales[lang])).sort()).toEqual([]);
  });

  test('どの言語にも、使われないキーは無い', () => {
    for (const lang of ['en', 'ja']) {
      expect(
        Object.keys(locales[lang])
          .filter((key) => !used.has(key))
          .sort(),
      ).toEqual([]);
    }
  });
});

describe('コンテンツスクリプトの文言テーブル（utils/i18n.ts）と使う側の突合', () => {
  // _locales はコンテンツスクリプトから確実に読めないので、ページ内 UI の文言は
  // utils/i18n.ts のテーブルに埋め込んである（そのファイル冒頭が理由）。
  // 参照は `getMessage(...)` か、その別名 `t(...)`（drag / overlay / bulk-capture が
  // 分割代入で付ける名前）の2つ＝3つ目の別名を作ったらここへ足す。
  const used = new Set([...keysPassedTo(/(?<![\w$.])getMessage\(/g), ...keysPassedTo(/(?<![\w$.])t\(/g)]);

  test('走査が空振りしていない', () => {
    expect(used.size).toBeGreaterThan(20);
  });

  test.each(['ja', 'en'])('%s に、使われているキーが全部在る', (lang) => {
    const table: Record<string, string> = MESSAGES[lang as 'ja' | 'en'];
    expect([...used].filter((key) => !(key in table)).sort()).toEqual([]);
  });

  test('使われないキーは無い', () => {
    for (const lang of ['ja', 'en'] as const) {
      expect(
        Object.keys(MESSAGES[lang])
          .filter((key) => !used.has(key))
          .sort(),
      ).toEqual([]);
    }
  });
});
