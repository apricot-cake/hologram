// 状態ベースの「今、一時的なポップアップが開いているか」の登録簿。
//
// レンダラーの命令形の Esc／解除の連鎖（inspector-builder.ts の
// handleEscDismissDetail）は、開いているポップアップに道を譲らなければ
// ならない。それにより最初の Esc はポップアップだけを閉じ、その裏の
// インスペクタは閉じない。再設計のゼロ許容規則は、これを判断するために
// DOM を `[data-slot="select-content"]` で探ることを禁じている――信号は
// 代わりにコンポーネントの状態から来る必要がある。
//
// 登録元: components/ui/select.tsx の Select Root ラッパー（マウントされた
// すべての Select）と、インスペクタのインラインタグ欄
// （inspector/TagField.tsx）。その Combobox ポップアップはインスペクタの
// 「上」に座るので、その Esc も勝ち取らなければならない。
//
// _shared ではなく他のレンダラー状態ブリッジ（qf-pop.ts、bulk-tag.ts、…）
// と一緒に住んでいる: 読み取り側はレンダラーのコードで、全体（レンダラーの
// サービス＋コンポーネント）は同じ JS の領域にある1つのモジュールグラフ
// なので、このモジュールはどこに置いても実行時には単一の共有シングルトン
// になる。
//
// インスタンスごとの symbol でキー付けしている（単純なカウンタではない）
// ので、開いたままアンマウントされたインスタンス――Root ラッパーの
// アンマウント時のクリーンアップ経由――を、後のすべての Esc を飲み込んで
// しまう幻の「開いている」状態を漏らさずに取り除ける。
const openSelects = new Set<symbol>();

export function setSelectOpen(id: symbol, open: boolean): void {
  if (open) openSelects.add(id);
  else openSelects.delete(id);
}

export function isAnySelectOpen(): boolean {
  return openSelects.size > 0;
}
