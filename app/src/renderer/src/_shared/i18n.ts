// レンダラーの既存の i18n へのブリッジ。`hologramI18n`（renderer/i18n.ts から）は
// { lang, resolved, getMessage } に解決する。コンポーネントはアプリの他の部分とまったく
// 同じメッセージのキーを使い回す＝文字列を二重に持たない。描画の前に initI18n() を一度
// 呼ぶこと。そうすればコンポーネントの中で t() が同期になる。
// 設定・ツールバー・検索ボックスで共有する（3つ目の利用者が現れるまではコンポーネント
// ごとに重複していた＝BACKLOG の「share i18n.js」）。
import { hologramI18n, type HologramI18nApi } from '../services/i18n.ts';

let api: HologramI18nApi | null = null;

export async function initI18n(): Promise<HologramI18nApi | null> {
  try {
    api = await hologramI18n;
  } catch {
    api = null; // i18n が使えない＝t() は生のキーへ退避する
  }
  return api;
}

export function t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string {
  if (!api) return key;
  return api.getMessage(key, subs);
}

export function lang(): string {
  return api ? api.lang : 'auto';
}
