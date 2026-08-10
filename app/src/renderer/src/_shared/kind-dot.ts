// 種別（タグの種別）の色の点。絞り込みバーの値の一覧と、種別のコンテキストメニューが
// 共有する。種別の色はアプリの領域の話であって ui-kit の装飾ではない＝2つの色相は
// danbooru のタグ分類の慣習（copyright/work は紫、character は緑）に従っており、画像の
// booru から来た利用者にはそのまま読める。
//
// コンポーネントではなくクラス文字列を返す補助にしてある: 呼び出し側は2か所とも span を
// 自前の何か（Tooltip・メニューの行）で包むので、必要なのは調子だけ。それ以外の種別には
// 形だけ与えて塗りは与えない＝色を割り当てていない点は、色相を当て推量せずに空の輪として
// 描く。
const TINT: Record<string, string> = {
  work: 'bg-[var(--tint-purple-bd)]',
  character: 'bg-[var(--tint-green-bd)]',
};

export function kindDotClass(kind: string | undefined): string {
  return `size-2 shrink-0 rounded-full ${TINT[kind ?? ''] ?? 'border border-border'}`;
}
