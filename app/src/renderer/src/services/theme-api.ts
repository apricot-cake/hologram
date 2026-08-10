// テーマのランタイム API――apply/get/set/resolve。React の外観セクション
// （設定 → 外観）が動かすモジュール。App.tsx / settings-ipc の import 経由で
// app.js に束ねられる。読み込み後は生きた設定状態を持つ: 'auto' の間は
// OS のテーマ変化に追従し、IPC 経由で一度だけ config.json と整合させる。
//
// 描画前の FOUC 対策パス――最初の描画より前に [data-theme] を設定する――は
// 別の小さな独立スクリプト（services/theme.ts → theme.js、<head> で
// 読み込まれる。index.html の読み込み順コメント参照）。それは app.js より
// 前に走る必要があるので、独自のビルドのままにしている。このモジュールは
// 読み込み時に同じ初期設定値を導き直すので、2つは一致する。
//
// テーマのモデル: 保存するのは設定値（auto/light/dark）で、適用される値
// （light/dark）はそこから解決される――'auto' は prefers-color-scheme
// 経由で OS を追いかける。

const KEY = 'hologram-theme';
let mql: MediaQueryList | null = null;
try {
  mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
} catch (_e) {
  mql = null;
}
let pref = 'auto'; // auto | light | dark

function cleanPref(t: string): string {
  return t === 'light' || t === 'dark' ? t : 'auto';
}
function systemDark() {
  return !!(mql && mql.matches);
}
function resolvePref(p: string): string {
  p = cleanPref(p);
  return p === 'auto' ? (systemDark() ? 'dark' : 'light') : p;
}

// ウィンドウ操作ボタンはアプリ側の描画（shell/WindowControls.tsx）なので、
// ここで OS が描く帯にテーマを映したり、2つを揃えるためにモーダル状態を
// 追跡したりする必要は一切無い――ボタンはページのピクセルで、モーダルの
// スクリムは他の何とも同じようにそれを覆う。このモジュールはテーマの
// 設定だけを持つ状態に戻っている。

export function apply(p: string): string {
  pref = cleanPref(p);
  if (resolvePref(pref) === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  return pref;
}
export function get(): string {
  return pref;
}
export function set(p: string, persist?: boolean): string {
  apply(p);
  try {
    localStorage.setItem(KEY, pref);
  } catch (_e) {
    /* 握りつぶす */
  }
  if (persist !== false && window.hologram && window.hologram.setPref) {
    try {
      window.hologram.setPref('theme', pref);
    } catch (_e) {
      /* 握りつぶす */
    }
  }
  return pref;
}
export function resolve(): string {
  return resolvePref(pref);
}

// 初期化（最初の import 時、app.js の評価中に一度だけ走る）。描画前の
// 起動処理が使ったのと同じ元から初期設定値を導き直す――main が config の
// theme を ?theme= として渡す。無ければ localStorage のキャッシュへ、
// それも無ければ 'auto' へフォールバックする――それから適用する（起動時の
// [data-theme] パスと何度実行しても同じ。起動処理がもう触らないタイトル
// バーのオーバーレイもここで設定する）。preload の window.hologram はどの
// ページスクリプトが走るよりも前に存在するので、config の整合には準備完了
// を待つゲートは要らない。
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
apply(initial || 'auto');
try {
  localStorage.setItem(KEY, pref);
} catch (_e) {
  /* 握りつぶす */
}

// 'auto' の間は、生きた OS のテーマ変化に追従する。
if (mql) {
  const onSys = function () {
    if (pref === 'auto') apply('auto');
  };
  if (mql.addEventListener) mql.addEventListener('change', onSys);
  else if (mql.addListener) mql.addListener(onSys);
}

// config.json と一度だけ整合させる。旧来の DOMContentLoaded 待ちは、
// 旧来の #themeSelect の配線のためだけに存在していた（削除済み: React の
// 外観セクションがコントロールを持つ）。
if (window.hologram && window.hologram.getPrefs) {
  window.hologram
    .getPrefs()
    .then(function (p) {
      if (!p || !p.theme) return;
      if (cleanPref(p.theme) !== pref) set(p.theme, false);
      try {
        localStorage.setItem(KEY, cleanPref(p.theme));
      } catch (_e) {
        /* 握りつぶす */
      }
    })
    .catch(function () {
      /* 握りつぶす */
    });
}
