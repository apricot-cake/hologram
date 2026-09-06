// 「ライブラリの最初の読み込みがまだ終わっていない」と「ライブラリ（または今の絞り込みや
// 検索）が本当に0件だ」を区別する＝ライブラリの2つのグリッド（投稿／投稿者）は、以前どちらも
// 同じ信号（postGroups/posterGroups が空になること）へ畳んでいた。そのせいで、中身のある
// ライブラリを起動するたびに一瞬「ライブラリが空です」の初回の文言が出ていた（#682）。
// services/trash-view.ts は同じ問題を、ゴミ箱について自前の `loaded` の真偽値で既に解いて
// いる。ここでは、同じ `allPosts` のキャッシュ（post-grid-builder.ts）を共有する2つの
// グリッドについて、その形を写す。
//
// #71: 初回のライブラリもまた2つに分かれる＝拡張機能が Native Messaging ブリッジと一度も
// 話していない（導入の案内を出す）か、話したうえでライブラリがまだ空なだけ（通常の
// firstRun/posterFirstRun の文言）か。共有の 'extensionGuide' の変種1つが両方のモードを
// 覆う。案内は拡張機能の導入についてのもので、投稿か投稿者かの話ではないから、2回言うことが
// 何も無い。
//
// empty/EmptyState.tsx に埋め込まず、素の関数にしてある。このリポジトリの `npm test`
// （vitest.config.ts）が拾うのは scripts/**/*.test.ts だけで＝レンダラーの .tsx には JSX を
// 描く仕掛けが無い＝そもそもテストで押さえるには、判断を素の .ts のモジュールに置くしかない。
export function libraryEmptyVariant(input: {
  mode: string; // browseMode
  libraryLoaded: boolean;
  // postGroups は、renderPosts() が一度も走っていなければ undefined、走って群が0件だった
  // 時は明示的な null、それ以外は配列（services/grid.ts）。
  postGroups: unknown[] | null | undefined;
  // posterGroups に null の番兵は無い＝renderPosters() が一度でも走れば必ず配列で、それ
  // より前は undefined（services/poster-grid-builder.ts）。
  posterGroups: unknown[] | undefined;
  allPostsCount: number;
  allUsersCount: number;
  query: string;
  // #71: ブリッジが接触の印に一度でも触れたか（App.tsx が起動時に取る
  // get-extension-contact）。下の「そうでなければ firstRun になる」分岐でしか読まない＝
  // 中身のあるライブラリや絞り込み中のライブラリが、これを見ることはない。
  extensionContacted: boolean;
}): HologramEmptyVariant | null {
  // 最初の読み込みが実際に着く前に「空だ」と言ってはいけない＝読み込み中のグリッドと、
  // 読み込みを終えて空だったグリッドは別の状態だ。今はどちらも postGroups/posterGroups が
  // 「空」に見えるとしても。
  if (!input.libraryLoaded) return null;
  if (input.mode === 'trash') return null;
  if (input.mode === 'posts') {
    if (input.postGroups === null) {
      if (input.allPostsCount !== 0 || input.query.trim()) return 'filtered';
      return input.extensionContacted ? 'firstRun' : 'extensionGuide';
    }
    return null;
  }
  if (input.posterGroups !== undefined && input.posterGroups.length === 0) {
    if (input.allUsersCount !== 0 || input.query.trim()) return 'filtered';
    return input.extensionContacted ? 'posterFirstRun' : 'extensionGuide';
  }
  return null;
}
