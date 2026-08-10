// 生成ファイル — 編集しないこと。
//
// scripts/gen-extension-tokens.cts が書いている。デザイントークンの色の
// 半分は CSS カスタムプロパティ（tokens.generated.css）として届けられ、
// テーマの切り替えはすでに画面上にある UI にも届く。このファイルが存在
// するのは、カスタムプロパティとしては読めない値のためだけ — Web
// Animations は `duration` に var() ではなくミリ秒の数値を取り、ツール
// バーのバッジはブラウザが解決済みの色文字列から描画する。
//
// tokens.ts から別名でエクスポートし、`motion` / `actionBadge` として
// 再エクスポートしている: Vite はインポートされたモジュールしかバンドル
// しないので、2つが同じシンボルをエクスポートすると、ビルドのたびに
// どちらを落としたか警告する。
export const generatedMotion = {
  durationBase: 180, // --hologram-duration-base
  durationFast: 120, // --hologram-duration-fast
  easeOut: 'cubic-bezier(0, 0, 0.2, 1)', // --hologram-ease-out
  easeIn: 'cubic-bezier(0.4, 0, 1, 1)', // --hologram-ease-in
} as const;

// ツールバーアイコンの警告バッジ（#269）。ライト側の行のみ — service
// worker にはブラウザがどちらの配色を着ているか尋ねる手段が無いので、
// 2つ目の値を渡す分岐が存在しない。ピルは不透明で自前のインクを持つので、
// その裏でツールバーが何をしていようとコントラストには一切関係しない。
export const generatedActionBadge = {
  background: '#e7000b', // --hologram-danger
  text: '#ffffff', // --hologram-on-danger
} as const;
