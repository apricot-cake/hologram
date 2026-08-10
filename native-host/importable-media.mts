'use strict';

// ローカル取り込みが、任意の取り込みファイル（assetClass:'file'、#236＝汎用のカード、
// ギャラリーは無く、代わりに OS 自身の既定のアプリで "開く"）ではなくメディア
// （assetClass:'media'。カード・ギャラリー・ビューアの一式が付く）として扱う拡張子。
// app/src/main/lib-local-intake.ts から切り出した（あちらは元の名前でこれらを再 export
// し続けるので、あちらの呼び出し側は何も変えなくてよい）。狙いは、このモジュールと、
// これを必要とする "開く" の許可リスト（open-allowlist.mts）を、Electron と
// better-sqlite3 から切り離しておくこと。レンダラーは自分の UI にラベルを付けるのに
// 両方を必要とする。post-key.mts や tag-normalize.mts が app/src/main の下ではなく
// ここに在るのと同じ理由だ。
export const IMPORTABLE_IMG = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'svg'];
export const IMPORTABLE_VID = ['mp4', 'webm', 'mov', 'm4v'];
export const IMPORTABLE_MEDIA = IMPORTABLE_IMG.concat(IMPORTABLE_VID);
