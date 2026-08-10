'use strict';

/* 描画前のテーマ起動処理: 最初の描画より前に [data-theme] を設定し、
   フラッシュが起きないようにする。単独でビルドされ（build-theme-boot.mjs、
   Vite lib IIFE → public/theme.js）、アプリのモジュールエントリ（<body> の
   末尾で読み込まれるので描画前には走れない――index.html の読み込み順
   コメント参照）より「前」に <head> で読み込まれる。外部ファイルなのは
   ページの CSP が `script-src 'self'` だから。ブラウザは実行時に .ts の
   型を剥がせないので、このファイルだけ electron-vite の通常のレンダラー
   バンドルの外で、独自の小さなビルド手順（build-theme-boot.mjs）を必要と
   する。

   FOUC 対策のみ: 設定値を解決し（main が config の theme を ?theme= として
   渡す。無ければ localStorage のキャッシュへ、それも無ければ 'auto' へ）、
   属性を設定する、それだけ。window にグローバルは何も公開しない。生きた
   テーマのランタイム――React の外観セクションが動かす apply/get/set/
   resolve の API、OS 変化への追従、config.json との整合――は
   services/theme-api.ts にあり、通常のレンダラーバンドルの一部。 */
(function () {
  const KEY = 'hologram-theme';
  function cleanPref(t: string): string {
    return t === 'light' || t === 'dark' ? t : 'auto';
  }
  function systemDark(): boolean {
    try {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (_e) {
      return false;
    }
  }

  // できるだけ早く適用する（<head> のパース中に走る→フラッシュ無し）。
  let initial: string | null = null;
  try {
    initial = new URLSearchParams(location.search).get('theme');
  } catch (_e) {
    /* 握りつぶす */
  }
  if (!initial) {
    try {
      initial = localStorage.getItem(KEY);
    } catch (_e) {
      /* 握りつぶす */
    }
  }
  const pref = cleanPref(initial || 'auto');
  const dark = pref === 'auto' ? systemDark() : pref === 'dark';
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  try {
    localStorage.setItem(KEY, pref);
  } catch (_e) {
    /* 握りつぶす */
  }
})();

// ナビゲーションの堅牢化: ウィンドウへファイルがドロップされると、そうで
// なければトップフレームが file://… へ遷移してしまい、それはこの同じ
// preload を引き継ぎ、破壊的な IPC（clearAll/importComplete/…）を呼び
// うる。#234 が、このガードの「上に」ドロップでインポートする操作
// （DropOverlay.tsx、app/App.tsx）を足した。ガードの「代わり」ではない
// ――あのオーバーレイは、OS のファイルドラッグがウィンドウ上にある間だけ
// 表示される要素スコープの受け手で、自分の preventDefault() を呼ぶ。この
// ウィンドウレベルのガードはその下で武装したままで、オーバーレイ（や、
// フォルダの並べ替え、query-builder のピルのような、同じく要素スコープで
// 自分のバブルフェーズハンドラですでに preventDefault() を呼んでいる
// アプリ自身の内部ドラッグ＆ドロップ）が扱わなかったどこであれ、ドロップ
// されたファイルを今も無害化しているのはこれ。app.js のランタイムではなく
// 描画前の起動処理にあるのは、ウィンドウへドロップされうるようになる前に
// ――DropOverlay 自身のリスナーがまだ存在するより前にすら――武装させる
// ため。
(function () {
  const stop = function (e: Event) {
    e.preventDefault();
  };
  window.addEventListener('dragover', stop, false);
  window.addEventListener('drop', stop, false);
})();
