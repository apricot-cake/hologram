// 保存フォルダの下にある素のファイル名から asset:// の URL を組む関数＝以前は
// orchestrator.ts の閉包の中（「画像の供給元」の節）のインラインの const だった。#777 で
// 切り出したのは、タグ分割のレビュー画面もこれを必要とし、しかも純粋（閉じ込めた状態を
// 持たない）だから＝2つ目の複製は、同じ1行のリテラルな分岐にしかならない。orchestrator.ts は
// 既存の呼び出し側のために、自分の `fileSrc` の名前で再 export する（records-builder.ts などは
// これを依存経由で注入される）＝両方が届く実装は、このモジュールの1つだけ。
export function fileSrc(file: string, w?: number): string {
  return file ? 'asset://img/' + encodeURIComponent(file) + (w ? '?w=' + w : '') : '';
}

// fileSrc の素の形（`?w=` の無い形）の逆＝組み上がった asset:// の URL から、ライブラリの
// ファイル名を取り出す。呼び出し側はピン留めのツールバーの入り口（#79）だけ。画像タブが渡す
// のは出来上がった src の文字列だけで（services/image-tab.ts）、PinItem が必要とする素の
// ファイル名は渡さないため。
export function fileOfSrc(src: string): string {
  const m = /^asset:\/\/img\/([^?]+)/.exec(src);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return '';
  }
}
