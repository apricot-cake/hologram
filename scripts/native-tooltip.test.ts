import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from 'vitest';

test('アプリと拡張機能の JSX にブラウザ標準チップを戻さない', () => {
  const found: string[] = [];
  for (const root of ['app/src/renderer', 'extension/entrypoints', 'extension/utils']) {
    for (const file of fs
      .readdirSync(root, { recursive: true })
      .map(String)
      .filter((file) => file.endsWith('.tsx'))) {
      const filename = path.join(root, file);
      const source = fs.readFileSync(filename, 'utf8');
      for (const match of source.matchAll(/\btitle\s*=/g)) {
        const preceding = source.slice(0, match.index);
        const tag = [...preceding.matchAll(/<([A-Za-z][\w.]*)\b/g)].at(-1)?.[1];
        // 見出し／読み上げ用の独自プロパティは DOM の title にはならない。
        if (!['Section', 'Action'].includes(tag || '')) found.push(`${filename}:${preceding.split('\n').length}`);
      }
    }
  }
  expect(found).toEqual([]);
});
