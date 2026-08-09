// hologramIpc（services/ipc.ts。preload のブリッジの上に置いた P4 の IPC→サービスの
// 継ぎ目）とテーマのランタイム（services/theme-api.ts）に対する薄いラッパー。
// app/src/main/index.ts と app/src/preload/index.ts には手を入れない＝コンポーネントが
// 話す相手は、素の設定画面が使っていたのとまったく同じ IPC。ただし他のレンダラーの
// サービスが今どれも通っているのと同じ継ぎ目を経由するだけ。

import { get as themeGet, set as themeSet } from '../services/theme-api.ts';
import { get as uiFontGet, apply as uiFontApply, set as uiFontSet } from '../services/ui-font-api.ts';
import { hologramIpc } from '../services/ipc.ts';
import type { AppPrefs } from '../../../main/ipc-payloads.ts';

// AppPrefs ではなく Partial にしてある: 素の dev サーバーでの代替は {} で解決するし、
// ここの呼び出し側はどれも、欠けているメンバーを「未設定」として扱っている。
export const getPrefs = (): Promise<Partial<AppPrefs>> => (hologramIpc.getPrefs ? hologramIpc.getPrefs() : Promise.resolve({}));
export const setPref = (key: string, value: unknown) => (hologramIpc.setPref ? hologramIpc.setPref(key, value) : Promise.resolve());
export const getAppInfo = () => (hologramIpc.getAppInfo ? hologramIpc.getAppInfo() : Promise.resolve(null));
export const openExternal = (url: string) => hologramIpc.openExternal(url);

// テーマのランタイムは services/theme-api.ts にある（[data-theme] を当て、setPref で
// 永続化し、localStorage に控えを持ち、OS に追従する）。読むのも動かすのもそのモジュール
// 越しにする＝アプリ全体の足並みが揃う。
export const theme = {
  get: themeGet,
  set: (v: string) => {
    themeSet(v);
  },
};

// #137: uiFont はプレビューと確定を分ける＝フォントのコンボボックスは打鍵ごとにその場で
// 当てる（プレビュー・未確定・services/ui-font-api.ts の apply()）が、config.json へ書くのは
// 利用者が値を決めた時だけ（確定・そのモジュールの set()）。
export const uiFont = {
  get: uiFontGet,
  preview: (v: string) => {
    uiFontApply(v);
  },
  commit: (v: string) => {
    uiFontSet(v);
  },
};
