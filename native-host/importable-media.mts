'use strict';

// ローカル取り込みで受け付ける画像・動画の拡張子。
// app/src/main/lib-local-intake.ts から切り出した（あちらは元の名前でこれらを再 export
// し続けるので、あちらの呼び出し側は何も変えなくてよい）。狙いは、このモジュールと、
// Electron と Native Messaging host から共有し、受け付ける範囲を一箇所に保つ。
export const IMPORTABLE_IMG = ['jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif', 'avif', 'bmp', 'tiff', 'svg'];
export const IMPORTABLE_VID = ['mp4', 'webm', 'mov', 'm4v'];
export const IMPORTABLE_MEDIA = IMPORTABLE_IMG.concat(IMPORTABLE_VID);
