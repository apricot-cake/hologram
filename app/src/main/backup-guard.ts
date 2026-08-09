'use strict';

// 増分ミラー向けの、剪定の安全性を守る番人（2026-06-23 のライブラリ消失
// インシデントの後に追加）。剪定は src に無いミラーファイルを削除する——利用者が
// 本当に投稿を削除した時は正しいが、config が誤った／空のフォルダを指していて
// src が空か激減している時は破滅的（それこそがライブラリを消し去った失敗と
// まったく同じもの）。その場合ミラーは唯一生き残っているコピーであり、剪定は
// それを消してしまう。この判断は純粋関数として切り出してあるので、Electron を
// 起動せずに単体テストできる。

// src が前回の健全な実行のこの割合を下回ったら剪定をスキップする。
const PRUNE_SHRINK_RATIO = 0.5;

// ミラーの剪定をスキップすべきかどうかを決める。
//   srcCount  — 元のライブラリに現在あるファイル数
//   destCount — ミラーに現在あるファイル数（0 なら壊すものが無い）
//   baseline  — 信頼できた前回の実行の src の件数（スキップをまたいで持ち越す）
// { skip, reason } を返す。reason は 'empty' | 'shrink' | null。
function pruneDecision({ srcCount, destCount, baseline }) {
  const src = Number(srcCount) || 0;
  const dest = Number(destCount) || 0;
  const base = Number(baseline) || 0;
  if (dest === 0) return { skip: false, reason: null }; // ミラーが空——剪定で失うものは何も無い
  if (src === 0) return { skip: true, reason: 'empty' }; // src が丸ごと消えた
  if (base > 0 && src < base * PRUNE_SHRINK_RATIO) return { skip: true, reason: 'shrink' };
  return { skip: false, reason: null };
}

// 「次の」実行のために持ち越す基準値: スキップしなかった時だけこの実行の件数を
// 信頼する。そうすれば1回の空／部分的なブレが、その後しきい値を毒することはない。
function nextBaseline(skipped, srcCount, baseline) {
  return skipped ? Number(baseline) || 0 : Number(srcCount) || 0;
}

export { pruneDecision, nextBaseline, PRUNE_SHRINK_RATIO };
