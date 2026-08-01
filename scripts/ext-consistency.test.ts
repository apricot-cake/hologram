// A guard that cross-checks the generated manifest against the code that's written assuming it (#130).
//
// With the WXT migration (#198) and the extractor registry (#212), the manifest
// is no longer hand-written; it's **generated** from wxt.config.ts plus each
// site module. So the kind of drift where "the manifest's match and the code's
// correspondence table need to be kept in sync by hand" has structurally gone
// away (the registry's own invariants are covered by
// extractor-registry.test.ts). Even so, some promises remain between **the
// generated artifact and the code written assuming it** that neither the type
// system nor lint can catch — they only surface when actually run on a real
// device:
//
//   1. Whether the generated match / host_permissions exactly match the registry's declarations
//      (if generation silently breaks partway through, the extension just
//      "silently does nothing" on that site)
//   2. Whether files that the manifest names, and files that the code names and injects,
//      actually exist in the output (`files: ['capture.js']` is a string = a rename breaks it silently)
//   3. Whether the manifest's commands match the command names the code listens for
//   4. Whether the extension ID derived from `key` matches what the side that
//      allows it (the e2e harness that assembles Native Messaging's
//      allowed_origins) expects
//   5. Whether the `__MSG_*` and getMessage keys correspond to text that
//      actually exists (i18n-parity.test.ts only checks "the Japanese and
//      English tables against each other" — the check against "what's actually used" only lives here)
//
// This reads the build output. So it doesn't read stale output, `npm test`
// runs build:ext before starting if needed (scripts/vitest.global-setup.ts).

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

// All of the extension's source (excluding generated artifacts). Decides the scan target in one place.
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

// === picking keys out of calls ==================================================

// The argument text from `<callee>(` to its matching `)`. Parentheses inside a
// string aren't counted. This returns the argument's whole range rather than
// hard-coding a single literal, so it can pick up a call that selects its key
// with a ternary (i18n.ts's partialSaveText / saveFailureText) as one call.
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

// What's compared against isn't a key, it's the value being tested (the
// 'protected' in `getMessage(reason === 'protected' ? 'a' : 'b')`) = drop it
// first, then pick up. What's left is only "literals in the key position",
// including whichever ternary branch a key sits in.
const withoutComparisons = (text: string): string => text.replace(/[\w$.]+\s*[!=]==?\s*('[^']*'|"[^"]*")/g, '').replace(/('[^']*'|"[^"]*")\s*[!=]==?\s*[\w$.]+/g, '');

// Collects string literals appearing in an argument's key position as keys that call uses.
function keysPassedTo(callee: RegExp): Set<string> {
  const keys = new Set<string>();
  for (const src of SOURCES) {
    for (const args of callArgs(src, callee)) {
      for (const literal of literalsIn(withoutComparisons(args))) keys.add(literal);
    }
  }
  return keys;
}

// === 1. generated manifest <-> extractor registry ===============================

describe('生成された manifest は登録簿の宣言どおり', () => {
  test('常駐コンテンツスクリプトの matches は RESIDENT_MATCHES と一致する', () => {
    // Compared as sets = WXT re-orders match when it outputs, so order isn't part of the spec.
    const matches = manifest.content_scripts.flatMap((script: any) => script.matches);
    expect([...matches].sort()).toEqual([...RESIDENT_MATCHES].sort());
  });

  test('host_permissions は API_HOST_PERMISSIONS と一致する', () => {
    expect([...manifest.host_permissions].sort()).toEqual([...API_HOST_PERMISSIONS].sort());
  });
});

// === 2. files that are named actually exist in the output =================================

describe('manifest とコードが名指しするファイルは出力に在る', () => {
  test('manifest が指すバンドル・ページ・画像が全部在る', () => {
    // Picks up every "string that looks like a file" in the manifest = any file
    // reference added to the manifest in the future also enters this check without editing this list.
    const referenced = [...JSON.stringify(manifest).matchAll(/"([\w./-]+\.(?:js|html|css|png|json))"/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(5);
    expect(referenced.filter((file) => !fs.existsSync(path.join(OUT, file)))).toEqual([]);
  });

  test('background が注入するファイル名が出力に在る', () => {
    // The capture entry injected via activeTab isn't listed in the manifest =
    // it names WXT's output file name as a string. A rename kills only Alt+S, silently.
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

// === 3. commands <-> listeners ==================================================

describe('manifest の commands は待ち受けと一致する', () => {
  test('宣言したコマンドだけを、全部待ち受けている', () => {
    // A shortcut that's declared but has no listener does nothing when pressed.
    // Conversely, a command that's listened for but never declared is one Chrome will never deliver again.
    const handled = new Set([...backgroundSrc.matchAll(/command\s*[!=]==\s*'([^']+)'/g)].map((m) => m[1]));
    expect(handled.size).toBeGreaterThan(0);
    expect([...handled].sort()).toEqual(Object.keys(manifest.commands).sort());
  });
});

// === 4. extension ID derived from key ================================================

// Chrome's extension ID = the first 16 bytes of the public key (DER)'s SHA-256,
// with each nibble mapped to a-p. `key` is pinned in the manifest so this ID
// stays the same on both the dev machine and distributed builds (native-host's
// allowed_origins allows this ID).
function extensionIdFrom(key: string): string {
  const digest = crypto.createHash('sha256').update(Buffer.from(key, 'base64')).digest();
  return [...digest.subarray(0, 16)].flatMap((byte) => [byte >> 4, byte & 0xf]).reduce((id, nibble) => id + String.fromCharCode(97 + nibble), '');
}

describe('拡張の固定ID', () => {
  test('key が manifest に載っている', () => {
    // If this breaks, the ID changes per install = native-host rejects the
    // origin, and every save fails with "settings don't match".
    expect(typeof manifest.key).toBe('string');
  });

  test('key から決まる ID を、それを許可する側も同じ値で持っている', () => {
    const expected = extensionIdFrom(manifest.key);
    // The e2e harness (the side that assembles the temporary Native Messaging
    // host's allowed_origins) is what holds the ID's spelling. Pick up string
    // literals shaped like an ID (32 characters of a-p) from scripts/ and
    // cross-check them = doesn't enumerate which file holds it.
    const declared: string[] = [];
    for (const file of fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.cts'))) {
      const src = fs.readFileSync(path.join(ROOT, 'scripts', file), 'utf8');
      for (const match of src.matchAll(/'([a-p]{32})'/g)) declared.push(`${file}: ${match[1]}`);
    }
    expect(declared.length).toBeGreaterThan(0);
    expect(declared.filter((entry) => !entry.endsWith(expected))).toEqual([]);
  });
});

// === 5. cross-checking text keys ======================================================

const locales = Object.fromEntries(['en', 'ja'].map((lang) => [lang, JSON.parse(fs.readFileSync(path.join(EXT, 'public', '_locales', lang, 'messages.json'), 'utf8'))]));

describe('_locales（Chrome i18n）と使う側の突合', () => {
  // The user side has only two paths: the generated manifest's `__MSG_*__`, and
  // the extension pages' chrome.i18n.getMessage. Since the options page passes
  // the key as a variable (setText(id, key)), its second argument is also picked up as a "use" the same way.
  const fromManifest = new Set([...JSON.stringify(manifest).matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]));
  const fromCode = new Set([...keysPassedTo(/chrome\.i18n\.getMessage\(/g), ...SOURCES.flatMap((src) => [...src.matchAll(/setText\(\s*'[^']*'\s*,\s*'([^']+)'\s*\)/g)].map((m) => m[1]))]);
  const used = new Set([...fromManifest, ...fromCode]);

  test('走査が空振りしていない', () => {
    // Even with zero keys picked up, the two tests below would still pass = check the scan actually hit something first.
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
  // Since _locales can't be reliably read from a content script, the in-page UI
  // text is embedded in utils/i18n.ts's table instead (see the reason at the top
  // of that file). References come through only two names: `getMessage(...)`, or
  // its alias `t(...)` (the name drag / overlay / bulk-capture give it via
  // destructuring) = if a third alias is ever created, add it here too.
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
