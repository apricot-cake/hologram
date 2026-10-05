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
//      出力に在るか（`files: ['bulk.js']` は文字列＝改名すると黙って壊れる）
//   3. manifest の commands が、コードが待ち受けるコマンド名と一致するか
//   4. `key` から決まる拡張機能の ID が、それを許可する側（Native Messaging の
//      allowed_origins を組み立てる e2e ハーネス）の期待する値と一致するか
//   5. `__MSG_*` と getMessage のキーが、実在する文言に対応しているか
//      （i18n-parity.test.ts が見るのは「二言語の表どうし」だけ＝
//      「実際に使われているもの」との突合はここにしかない）
//
// これはテスト専用の Chrome ビルド出力を読む。`npm run test:ext` が
// 現在のソースから出力を作ってから、このスイートを実行する。

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { API_HOST_PERMISSIONS, RESIDENT_MATCHES } from '../../extension/utils/extractor/index.ts';
import { MESSAGES } from '../../extension/utils/i18n.ts';

const ROOT = path.join(import.meta.dirname, '../..');
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

// 第1引数の値だけを読む。条件式や、第2引数以降の置換文字列はキーではない。
function messageKeys(args: string): string[] {
  const text = args.trim();
  let depth = 0;
  let conditional = 0;
  let question = -1;
  for (const match of text.matchAll(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`|[()[\]{}?:,]/g)) {
    const token = match[0];
    const index = match.index;
    if ('([{'.includes(token)) depth++;
    else if (')]}'.includes(token)) {
      depth--;
      if (depth === 0 && text[0] === '(' && index === text.length - 1) return messageKeys(text.slice(1, -1));
    } else if (depth === 0) {
      if (token === ',' && conditional === 0) return messageKeys(text.slice(0, index));
      if (token === '?' && text[index + 1] !== '.' && text[index + 1] !== '?' && text[index - 1] !== '?') {
        if (conditional++ === 0) question = index;
      } else if (token === ':' && conditional > 0 && --conditional === 0) {
        return [...messageKeys(text.slice(question + 1, index)), ...messageKeys(text.slice(index + 1))];
      }
    }
  }
  return /^(?:'[^'\\]*'|"[^"\\]*")$/.test(text) ? literalsIn(text) : [];
}

// 引数のキーの位置に現れる文字列リテラルを、その呼び出しが使うキーとして集める。
function keysPassedTo(callee: RegExp): Set<string> {
  const keys = new Set<string>();
  for (const src of SOURCES) {
    for (const args of callArgs(src, callee)) {
      for (const literal of messageKeys(args)) keys.add(literal);
    }
  }
  return keys;
}

describe('翻訳キーの抽出', () => {
  test('URL を判定する条件式は翻訳キーに含めない', () => {
    expect(messageKeys("location.pathname.startsWith('/i/history') ? 'bulkIntroSaved' : 'bulkIntro'")).toEqual(['bulkIntroSaved', 'bulkIntro']);
  });

  test('入れ子の条件分岐は両方の値を拾い、置換文字列は除く', () => {
    expect(messageKeys("reason === 'protected' ? 'protectedMessage' : (reason === 'ageRestricted' ? 'ageMessage' : 'defaultMessage'), ['replacement']")).toEqual(['protectedMessage', 'ageMessage', 'defaultMessage']);
    expect(messageKeys("'message', ['replacement']")).toEqual(['message']);
  });
});

// === 1. 生成された manifest → extractor の登録簿 ================================

describe('生成された manifest は登録簿の宣言どおり', () => {
  test('設定はアイコンのポップアップに集約し、独立ページを出力しない', () => {
    expect(manifest.action?.default_popup).toBe('popup.html');
    expect(manifest.options_ui).toBeUndefined();
    expect(manifest.options_page).toBeUndefined();
    expect(fs.existsSync(path.join(OUT, 'options.html'))).toBe(false);
  });
  test('常駐コンテンツスクリプトの matches は RESIDENT_MATCHES と一致する', () => {
    // 生成の順は仕様のうちではないので、集合として比べる。
    const matches = manifest.content_scripts.flatMap((script: any) => script.matches);
    expect([...matches].sort()).toEqual([...RESIDENT_MATCHES].sort());
  });

  test('host_permissions は API 通信と常駐スクリプトのホストだけを重複なく許可する', () => {
    const expected = [...new Set([...API_HOST_PERMISSIONS, ...RESIDENT_MATCHES])];
    expect([...manifest.host_permissions].sort()).toEqual(expected.sort());
    expect(manifest.host_permissions).toHaveLength(expected.length);
    expect(manifest.host_permissions.every((pattern: string) => pattern.startsWith('https://'))).toBe(true);
  });

  test('更新後の再注入は全常駐サイトのホスト権限で実行でき、手動保存の activeTab を維持する', () => {
    const residentHosts = new Set(RESIDENT_MATCHES);
    expect(residentHosts).toEqual(new Set(['https://x.com/*', 'https://twitter.com/*', 'https://bsky.app/*', 'https://www.pixiv.net/*', 'https://pixiv.net/*']));
    for (const host of residentHosts) expect(manifest.host_permissions).toContain(host);
    expect(manifest.host_permissions).toHaveLength(6);
    expect(manifest.permissions).toContain('activeTab');
    expect(manifest.permissions).toContain('alarms');
    expect(manifest.permissions).not.toContain('tabs');
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

  // bulk.js は manifest にそもそも載らない。background が
  // chrome.scripting.executeScript 経由で必ず名前を指定して注入するので、両端をつないで
  // いるのは、この文字列がそのファイル名と一致することだけ。WXT は manifest に載らない
  // スクリプトを、エントリポイント名のまま出力のルートへ出す。
  test('background が名指しする bulk.js が出力に在る', () => {
    expect(backgroundSrc).toContain("files: ['bulk.js']");
    expect(fs.existsSync(path.join(OUT, 'bulk.js'))).toBe(true);
    expect(fs.statSync(path.join(OUT, 'bulk.js')).size).toBeGreaterThan(0);
  });

  // read-meta.js も bulk.js と同じ入れ方（background の右クリック保存が
  // chrome.scripting.executeScript にファイル名を渡す）＝同じ防ぎ、同じ理由。
  test('background が名指しする read-meta.js が出力に在る', () => {
    expect(backgroundSrc).toContain("files: ['read-meta.js']");
    expect(fs.existsSync(path.join(OUT, 'read-meta.js'))).toBe(true);
    expect(fs.statSync(path.join(OUT, 'read-meta.js')).size).toBeGreaterThan(0);
  });

  // 開発用と日常用は同じリリースバンドルを読む。既定は実ライブラリ用 host で、
  // 開発用プロファイルだけが storage.local の明示設定で隔離 host を選ぶ。
  test('共有バンドルは両方の Native Host とプロファイル設定を持つ', () => {
    const worker = fs.readFileSync(path.join(OUT, 'background.js'), 'utf8');
    expect(worker).toContain('com.hologram.host');
    expect(worker).toContain('com.hologram.host.dev');
    expect(worker).toContain('nativeHost.profile.v1');
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
    expect([...handled].sort()).toEqual(Object.keys(manifest.commands ?? {}).sort());
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

const LOCALES = ['en', 'ja'] as const;
const EMBEDDED_LOCALES = ['en', 'ja'] as const;
const locales = Object.fromEntries(LOCALES.map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(EXT, 'public', '_locales', lang, 'messages.json'), 'utf8'))]));

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

  test.each(LOCALES)('%s に、使われているキーが全部在る', (lang) => {
    expect([...used].filter((key) => !(key in locales[lang])).sort()).toEqual([]);
  });

  test('どの言語にも、使われないキーは無い', () => {
    for (const lang of LOCALES) {
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
  const used = new Set([...keysPassedTo(/(?<![\w$.])getMessage\(/g), ...keysPassedTo(/(?<![\w$.])t\(/g), ...keysPassedTo(/\bthis\.t\(/g)]);

  test('走査が空振りしていない', () => {
    expect(used.size).toBeGreaterThan(20);
  });

  test.each(EMBEDDED_LOCALES)('%s に、使われているキーが全部在る', (lang) => {
    const table: Record<string, string> = MESSAGES[lang];
    expect([...used].filter((key) => !(key in table)).sort()).toEqual([]);
  });

  test('使われないキーは無い', () => {
    for (const lang of EMBEDDED_LOCALES) {
      expect(
        Object.keys(MESSAGES[lang])
          .filter((key) => !used.has(key))
          .sort(),
      ).toEqual([]);
    }
  });
});
