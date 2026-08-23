// 生成された manifest と、それを前提に書かれたコードを突き合わせる番人 (#130)。
//
// WXT と extractor の登録簿 (#212) により、manifest はもう手書きではない。
// wxt.config.ts と各サイトモジュールから生成される。だから「manifest の match と
// コードの対応表を手で同期させ続ける」という類のずれは構造的に無くなった（登録簿
// 自身の不変条件は extractor-registry.test.ts が見ている）。それでも、型でも lint
// でも捕まらず、実機で走らせて初めて表に出る約束が、生成物とそれを前提に書かれた
// コードの間には残る:
//
//   1. 生成された match / host_permissions が登録簿の宣言と厳密に一致するか
//      （生成が途中で黙って壊れると、拡張機能はそのサイトで「黙って何もしない」だけになる）
//   2. manifest が名指しするファイルと、コードが名指しして注入するファイルが、実際に
//      出力に在るか（`files: ['capture.js']` は文字列＝改名すると黙って壊れる）
//   3. manifest の commands が、コードが待ち受けるコマンド名と一致するか
//   4. `key` から決まる拡張機能の ID が、それを許可する側（Native Messaging の
//      allowed_origins を組み立てる e2e ハーネス）の期待する値と一致するか
//   5. `__MSG_*` と getMessage のキーが、実在する文言に対応しているか
//      （i18n-parity.test.ts が見るのは「日本語と英語の表どうし」だけ＝
//      「実際に使われているもの」との突合はここにしかない）
//
// これはテスト専用の Chrome ビルド出力を読む。`npm run test:extension` が
// 現在のソースから出力を作ってから、このスイートを実行する。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_HOST_PERMISSIONS, RESIDENT_MATCHES } from '../extension/utils/extractor/index.ts';
import { MESSAGES } from '../extension/utils/i18n.ts';

const ROOT = path.join(import.meta.dirname, '..');
const EXT = path.join(ROOT, 'extension');
const OUT = path.join(EXT, '.output', 'chrome-mv3-test');

const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
const backgroundSrc = fs.readFileSync(path.join(EXT, 'utils', 'background.ts'), 'utf8');

// 拡張機能のソース全部（生成物は除く）。走査の対象を1か所で決める。
function extensionSources(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        // .wxt は WXT が生成する型の面。定義済みの i18n キー (@@bidi_dir など) と
        // メッセージキーを全部名指ししているので、ここを走査すると生成器の語彙を
        // 「この拡張機能が使うキー」として読んでしまう。
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

// === 呼び出しからキーを拾う =====================================================

// `<callee>(` から対応する `)` までの引数テキスト。文字列の中の括弧は数えない。
// 単一のリテラルを決め打ちせず引数の範囲ごと返すので、キーを三項演算子で選ぶ
// 呼び出し (i18n.ts の partialSaveText / saveFailureText) も1つの呼び出しとして拾える。
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

// 比較の相手はキーではなく、試している値（`getMessage(reason === 'protected' ? 'a' : 'b')`
// の 'protected'）＝先に落としてから拾う。残るのは「キーの位置にあるリテラル」だけで、
// キーが三項のどちらの枝に在っても拾える。
const withoutComparisons = (text: string): string => text.replace(/[\w$.]+\s*[!=]==?\s*('[^']*'|"[^"]*")/g, '').replace(/('[^']*'|"[^"]*")\s*[!=]==?\s*[\w$.]+/g, '');

// 引数のキーの位置に現れる文字列リテラルを、その呼び出しが使うキーとして集める。
function keysPassedTo(callee: RegExp): Set<string> {
  const keys = new Set<string>();
  for (const src of SOURCES) {
    for (const args of callArgs(src, callee)) {
      for (const literal of literalsIn(withoutComparisons(args))) keys.add(literal);
    }
  }
  return keys;
}

// === 1. 生成された manifest → extractor の登録簿 ================================

describe('生成された manifest は登録簿の宣言どおり', () => {
  test('常駐コンテンツスクリプトの matches は RESIDENT_MATCHES と一致する', () => {
    // 生成の順は仕様のうちではないので、集合として比べる。
    const matches = manifest.content_scripts.flatMap((script: any) => script.matches);
    expect([...matches].sort()).toEqual([...RESIDENT_MATCHES].sort());
  });

  test('host_permissions は API_HOST_PERMISSIONS と一致する', () => {
    expect([...manifest.host_permissions].sort()).toEqual([...API_HOST_PERMISSIONS].sort());
  });
});

// === 2. 名指しされたファイルが出力に実在する ====================================

describe('manifest とコードが名指しするファイルは出力に在る', () => {
  test('manifest が指すバンドル・ページ・画像が全部在る', () => {
    // manifest の中の「ファイルに見える文字列」を全部拾う＝将来 manifest に足された
    // ファイル参照も、この一覧を編集せずにこの検査へ入る。
    const referenced = [...JSON.stringify(manifest).matchAll(/"([\w./-]+\.(?:js|html|css|png|json))"/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(5);
    expect(referenced.filter((file) => !fs.existsSync(path.join(OUT, file)))).toEqual([]);
  });

  // capture.js は manifest にそもそも載らない。background が
  // chrome.scripting.executeScript 経由で必ず名前を指定して注入するので、両端をつないで
  // いるのは、この文字列がそのファイル名と一致することだけ。WXT は manifest に載らない
  // スクリプトを、エントリポイント名のまま出力のルートへ出す。
  test('background が名指しする capture.js が出力に在る', () => {
    expect(backgroundSrc).toContain("files: ['capture.js']");
    expect(fs.existsSync(path.join(OUT, 'capture.js'))).toBe(true);
    expect(fs.statSync(path.join(OUT, 'capture.js')).size).toBeGreaterThan(0);
  });

  // #239: read-meta.js も capture.js と同じ入れ方（background の doSaveBookmark が
  // chrome.scripting.executeScript にファイル名を渡す）＝同じ防ぎ、同じ理由。
  test('background が名指しする read-meta.js が出力に在る', () => {
    expect(backgroundSrc).toContain("files: ['read-meta.js']");
    expect(fs.existsSync(path.join(OUT, 'read-meta.js'))).toBe(true);
    expect(fs.statSync(path.join(OUT, 'read-meta.js')).size).toBeGreaterThan(0);
  });

  // build コマンドのバンドルは本物の native messaging ホストを呼ばなければならず、開発用のものを
  // 抱えていてはいけない (#732)。開発用ホストはサンドボックスの設定ディレクトリを
  // 指すので、その名前を持った release は利用者から見えない場所へ保存してしまう。
  // 加えて拡張機能の E2E ハーネスは、このバンドルの中の release 名を書き換えることで
  // 自分を隔離する。書き換える名前がちょうど1つだけある間しか、それは効かない。
  test('テスト用バンドルは本物のネイティブホスト名だけを持つ', () => {
    const worker = fs.readFileSync(path.join(OUT, 'background.js'), 'utf8');
    expect(worker).toContain('com.hologram.host');
    expect(worker).not.toContain('com.hologram.host.dev');
  });

  test('default_locale の _locales が出力に在る', () => {
    expect(fs.existsSync(path.join(OUT, '_locales', manifest.default_locale, 'messages.json'))).toBe(true);
  });
});

// === 3. commands → 待ち受け =====================================================

describe('manifest の commands は待ち受けと一致する', () => {
  test('宣言したコマンドだけを、全部待ち受けている', () => {
    // 宣言だけあって待ち受けの無いショートカットは、押しても何も起きない。逆に、
    // 待ち受けているのに宣言の無いコマンドは、Chrome が二度と届けてくれないもの。
    const handled = new Set([...backgroundSrc.matchAll(/command\s*[!=]==\s*'([^']+)'/g)].map((m) => m[1]));
    expect(handled.size).toBeGreaterThan(0);
    expect([...handled].sort()).toEqual(Object.keys(manifest.commands).sort());
  });
});

// === 4. key から決まる拡張機能の ID =============================================

// Chrome の拡張機能 ID ＝ 公開鍵 (DER) の SHA-256 の先頭 16 バイトを、ニブルごとに
// a-p へ写したもの。この ID が開発機でも配布ビルドでも同じであるよう、`key` を
// manifest に固定してある（native-host の allowed_origins はこの ID を許可する）。
function extensionIdFrom(key: string): string {
  const digest = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  return [...digest.subarray(0, 16)].flatMap((byte) => [byte >> 4, byte & 0xf]).reduce((id, nibble) => id + String.fromCharCode(97 + nibble), '');
}

describe('拡張の固定ID', () => {
  test('key が manifest に載っている', () => {
    // これが壊れると ID がインストールごとに変わる＝native-host はオリジンを弾き、
    // 保存は全部「設定が合っていない」で失敗する。
    expect(typeof manifest.key).toBe('string');
  });

  test('key から決まる ID を、それを許可する側も同じ値で持っている', () => {
    const expected = extensionIdFrom(manifest.key);
    // ID の綴りを持っているのは e2e ハーネス（一時的な Native Messaging ホストの
    // allowed_origins を組み立てる側）。scripts/ から ID の形をした文字列リテラル
    // (a-p が 32 文字) を拾って突き合わせる＝どのファイルが持つかを列挙しない。
    const declared: string[] = [];
    for (const file of fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.cts'))) {
      const src = fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
      for (const match of src.matchAll(/'([a-p]{32})'/g)) declared.push(`${file}: ${match[1]}`);
    }
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((entry) => !entry.endsWith(expected))).toEqual([]);
  });
});

// === 5. 文言キーの突合 ==========================================================

const locales = Object.fromEntries(['en', 'ja'].map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(EXT, 'public', '_locales', lang, 'messages.json'), 'utf8'))]));

describe('_locales（Chrome i18n）と使う側の突合', () => {
  // 使う側の経路は2つだけ。生成された manifest の `__MSG_*__` と、拡張機能ページの
  // chrome.i18n.getMessage。オプションページはキーを変数で渡す (setText(id, key)) ので、
  // その第2引数も同じように「使用」として拾う。
  const fromManifest = new Set([...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]));
  const fromCode = new Set([...keysPassedTo(/chrome\.i18n\.getMessage\(/g), ...SOURCES.flatMap((src) => [...src.matchAll(/setText\(\s*'[^']*'\s*,\s*'([^']+)'\s*\)/g)].map((m) => m[1]))]);
  const used = new Set([...fromManifest, ...fromCode]);

  test('走査が空振りしていない', () => {
    // 拾えたキーがゼロでも、下の2つのテストは通ってしまう＝先に走査が当たっていることを確かめる。
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
  // コンテンツスクリプトからは _locales を確実に読めないので、ページ内の UI 文言は
  // 代わりに utils/i18n.ts の表へ埋め込んである（理由はそのファイルの冒頭）。参照は
  // 2つの名前からしか来ない。`getMessage(...)` か、その別名の `t(...)`（drag /
  // overlay / bulk-capture が分割代入で付ける名前）＝3つ目の別名を作ったら、ここにも足す。
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
