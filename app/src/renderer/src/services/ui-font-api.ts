// UI のフォントの実行時の扱い＝利用者が画面のフォントを上書きできるようにする（設定 →
// 外観、#137）。既定である空文字列なら、組み込みの --font-sans の並びには手を触れない
// （design-tokens.css と globals.css の @theme の複製。両方のファイルの #654 のコメントに
// 従い、互いに同一に保っている）。
//
// 上書きの適用は、どちらのスタイルシートも書き換えない＝<html> にインラインの
// `--font-sans` を設定する。カスケードは、詳細度に関わらず、セレクタに基づくどの規則
// （スタイルシートの :root も含む）よりインラインを優先する＝だから使う側の両方
// （design-tokens.css の var(--font-sans) を直接読む側と、globals.css の Tailwind の
// `font-sans` ユーティリティ）が1回の書き込みを拾い、#654 が守っている2つの複製の並びには
// 手が触れない。
//
// 前に足す先の並びは、上書きを一度も適用する前に getComputedStyle から1回だけ読み戻し、
// 以降の変更ではそれを使い回す＝だから2回目にフォントを変えても、最初のものの前にもう1つ
// 積むのではなく、同じ元の並びの前にある独自のフォントを置き換える。
//
// services/theme-api.ts を手本にしているが、あちらの描画前の起動の走査は無い。フォントの
// 差し替えは文字を組み直すが、明暗の対比を反転させるわけではない＝だからテーマと違って
// 最初の描画より前に着く必要が無く、このモジュールが読み込まれた時点で適用する。他の、
// 描画のちらつきに関わらない設定（inspectorWidth、gridSize、…）と同じ。

const KEY = 'hologram-ui-font';
let family = '';
let cachedDefaultStack: string | null = null;

function defaultStack(): string {
  if (cachedDefaultStack === null) {
    try {
      cachedDefaultStack = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
    } catch (_e) {
      cachedDefaultStack = 'sans-serif';
    }
  }
  return cachedDefaultStack;
}

// font-family の並びに入れる <family-name> を1つ、引用符で囲んで escape する（CSS Syntax:
// 引用符で囲んだ文字列の中では、リテラルの逆斜線と二重引用符を逆斜線で escape する）。
// BACKSLASH と DQUOTE は、リテラルのエスケープ列として書かず文字コードから組み立てている＝
// このファイルは、途中でリテラルの逆斜線を壊すシェルのパイプラインを通して生成されるので、
// escape をする側自身が、逆斜線を要らずに書けている必要がある。
const BACKSLASH = String.fromCharCode(92);
const DQUOTE = String.fromCharCode(34);
export function quoteFamily(name: string): string {
  const escaped = name
    .split(BACKSLASH)
    .join(BACKSLASH + BACKSLASH)
    .split(DQUOTE)
    .join(BACKSLASH + DQUOTE);
  return DQUOTE + escaped + DQUOTE;
}

export function apply(name: string): string {
  family = typeof name === 'string' ? name.trim() : '';
  if (family) document.documentElement.style.setProperty('--font-sans', `${quoteFamily(family)}, ${defaultStack()}`);
  else document.documentElement.style.removeProperty('--font-sans');
  return family;
}
export function get(): string {
  return family;
}
export function set(name: string, persist?: boolean): string {
  apply(name);
  try {
    localStorage.setItem(KEY, family);
  } catch (_e) {
    /* 無視する */
  }
  if (persist !== false && window.hologram && window.hologram.setPref) {
    try {
      window.hologram.setPref('uiFontFamily', family);
    } catch (_e) {
      /* 無視する */
    }
  }
  return family;
}

// 初期化。localStorage のキャッシュをすぐ適用し（読み込み直しても既定へ戻るちらつきが
// 出ない）、そのあと config.json と1回だけ突き合わせる＝theme-api.ts の起動と同じ形。
let initial = '';
try {
  initial = localStorage.getItem(KEY) || '';
} catch (_e) {
  /* 無視する */
}
apply(initial);

if (window.hologram && window.hologram.getPrefs) {
  window.hologram
    .getPrefs()
    .then(function (p) {
      const v = typeof p?.uiFontFamily === 'string' ? p.uiFontFamily : '';
      if (v !== family) set(v, false);
      try {
        localStorage.setItem(KEY, v);
      } catch (_e) {
        /* 無視する */
      }
    })
    .catch(function () {
      /* 無視する */
    });
}
