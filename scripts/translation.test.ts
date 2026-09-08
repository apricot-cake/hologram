import { describe, expect, test } from 'vitest';
import { createTranslator, type Translate } from '../app/src/renderer/src/services/translation.ts';

describe('i18next によるアプリの翻訳', () => {
  test('英語の件数は数値に応じて単数・複数を選ぶ', async () => {
    const t = await createTranslator('en');
    expect(t('deletedN', { count: 0 })).toBe('0 posts deleted');
    expect(t('deletedN', { count: 1 })).toBe('1 post deleted');
    expect(t('deletedN', { count: 2 })).toBe('2 posts deleted');
    expect(t('imagesCount', { count: 1 })).toBe('1 image');
    expect(t('confirmSkip')).toBe("Don't ask again");
    expect(t('trashDeleteConfirm', { count: 1 })).toBe('Permanently delete 1 item?');
  });

  test('省略表記を保ち、単数形の判定には元の数値を使う', async () => {
    const t = await createTranslator('en');
    expect(t('posterPosts', { count: 1, formattedCount: '1' })).toBe('1 post');
    expect(t('posterPosts', { count: 12000, formattedCount: '12.0K' })).toBe('12.0K posts');
    expect(t('pollVotes', { count: 1, formattedCount: '1' })).toBe('1 vote');
  });

  test('差し込んだタグ名を再び置換したり HTML エスケープしたりしない', async () => {
    const t = await createTranslator('en');
    const name = 'title $2 {{postCount}} {name} $t(nested) <a>&';
    expect(t('tagMgmtRenameCollisionDesc', { name, postCount: 1, posterCount: 2 })).toBe(`A tag named "${name}" already exists (posts: 1, users: 2). Merge into it, or keep this as a separate tag?`);
  });

  test('日本語の件数を表示し、別の言語の初期化に影響されない', async () => {
    const ja = await createTranslator('ja');
    const before = ja('deletedN', { count: 1 });
    const en = await createTranslator('en');
    expect(before).toContain('1');
    expect(before).not.toBe(en('deletedN', { count: 1 }));
    expect(ja('deletedN', { count: 1 })).toBe(before);
    expect(ja('deletedN', { count: 2 })).toBe(before.replace('1', '2'));
  });
});

// 型検査でも翻訳キーと複数形の count の契約を確認する。
function checkTranslationTypes(t: Translate) {
  // @ts-expect-error リソースにないキー
  t('missingTranslationKey');
  // @ts-expect-error 複数形の判定に文字列を渡さない
  t('deletedN', { count: '1' });
}
void checkTranslationTypes;
