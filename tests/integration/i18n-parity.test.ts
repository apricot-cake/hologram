import IntlMessageFormat from 'intl-messageformat';
import ja from '../../app/src/renderer/src/services/locales/ja.ts';
import en from '../../app/src/renderer/src/services/locales/en.ts';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';
import { MESSAGES as extensionMessages } from '../../extension/utils/i18n.ts';

const repo = path.join(import.meta.dirname, '../..');
const APP_LOCALES = ['ja', 'en'] as const;
const CHROME_LOCALES = ['ja', 'en'] as const;

// 拡張機能の置換スロットは $1 と $PLACEHOLDER$。
// キーごとに、順序を問わない集合として比べる。
const subsOf = (s: unknown) => (String(s).match(/\$[A-Za-z_]+\$|\$\d/g) || []).sort().join(',');

const missingFrom = (a: object, b: object) => Object.keys(a).filter((k) => !(k in b));

const subsDrift = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys(a)
    .filter((k) => k in b && typeof a[k] === 'string' && subsOf(a[k]) !== subsOf(b[k]))
    .map((k) => `${k} (ja: ${subsOf(a[k]) || 'none'} / en: ${subsOf(b[k]) || 'none'})`);

describe('アプリのICU翻訳リソース', () => {
  function slots(ast: ReturnType<IntlMessageFormat['getAst']>): string[] {
    const result = new Set<string>();
    for (const element of ast) {
      if ('options' in element) {
        for (const branch of Object.values(element.options)) for (const key of slots(branch.value)) result.add(key);
      } else if (element.type !== 0 && 'value' in element) result.add(element.value);
    }
    return [...result].sort();
  }
  test('日本語と英語の翻訳キーが一致する', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ja).sort());
  });
  test('全メッセージのICU構文が有効で、差し込み項目が日本語と一致する', () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      const english = new IntlMessageFormat(en[key], 'en', undefined, { ignoreTag: true });
      const japanese = new IntlMessageFormat(ja[key], 'ja', undefined, { ignoreTag: true });
      expect(slots(english.getAst()), key).toEqual(slots(japanese.getAst()));
    }
  });
});

// --- 3) 拡張機能に埋め込んだページ内 UI の表（モジュールからそのまま import できる）
describe('拡張の埋め込み MESSAGES（utils/i18n.ts）', () => {
  const ja = extensionMessages.ja;
  test.each(APP_LOCALES.filter((locale) => locale !== 'ja'))('%s のキー・置換スロットが ja と一致する', (locale) => {
    const table = extensionMessages[locale];
    expect(missingFrom(ja, table)).toEqual([]);
    expect(missingFrom(table, ja)).toEqual([]);
    expect(subsDrift(ja, table)).toEqual([]);
  });
});

describe('拡張の _locales（Chrome i18n JSON）', () => {
  const read = (lang: string) => JSON.parse(fs.readFileSync(path.join(repo, 'extension', 'public', '_locales', lang, 'messages.json'), 'utf8'));
  const ja = read('ja');
  const messages = (t: Record<string, any>) => Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v?.message]));

  test.each(CHROME_LOCALES.filter((locale) => locale !== 'ja'))('%s のキー・置換スロットが ja と一致する', (locale) => {
    const table = read(locale);
    expect(missingFrom(ja, table)).toEqual([]);
    expect(missingFrom(table, ja)).toEqual([]);
    expect(subsDrift(messages(ja), messages(table))).toEqual([]);
  });
});
