'use strict';

// #236 の 2026-07-27 のセキュリティレビューのコメントを、機械に守らせたもの。"開く" が
// shell.openPath に渡してよい拡張子はどれか、そのうち、信頼する前に先頭のバイト列が
// 既知の署名と一致していなければならないのはどれか（取り込みの後にディスク上でファイルを
// 差し替えられるので、意味のある確認は取り込み時ではなく "開く" が押された瞬間に走る。
// app/src/main/lib-open-gate.ts を参照）。
//
// lib-local-intake.ts と違い、Electron と better-sqlite3 から切り離してあるのは意図して
// そうしている。レンダラーも extensionAllowed() を必要とする。収蔵ファイルのカードの
// "開く"/"フォルダで表示" ボタンにラベルを付けるためだ（records.ts）＝post-key.mts や
// tag-normalize.mts が app/src/main の下ではなくここに在るのと同じ理由。このモジュール
// 自身はファイルシステムに一切触らない。matchesMagicBytes は既に手元に在るバイト列を
// 受け取るので、このファイルの他と同じく純粋なままだ。

import { IMPORTABLE_MEDIA } from './importable-media.mts';

const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'm4a', 'ogg'];
const DOCUMENT_EXTS = ['pdf', 'txt', 'md', 'rtf', 'csv', 'tsv', 'json', 'xml', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub'];
const ARCHIVE_EXTS = ['zip', '7z', 'rar', 'tar', 'gz'];
const CREATIVE_EXTS = ['psd', 'clip', 'kra', 'xcf', 'ai', 'blend', 'sai', 'sai2', 'procreate'];

// 最初の許可リスト（#236 の 2026-08-02 のコメント、§3）。閉じた世界だ。ここに無い拡張子は
// 拒む。それだけ＝下の EXPLICITLY_EXCLUDED_EXTS を extensionAllowed は参照しない。あれは
// 回帰テストが、許可リストの沈黙に頼る代わりに、除外した拡張子それぞれの名を挙げられる
// ようにするためだけに在る。
export const OPEN_ALLOWLIST = new Set<string>([...IMPORTABLE_MEDIA, ...AUDIO_EXTS, ...DOCUMENT_EXTS, ...ARCHIVE_EXTS, ...CREATIVE_EXTS]);

// 2026-07-27 のセキュリティレビューが、"開く" が決して届いてはいけない形式として名を
// 挙げたもの。ここで能動的に遮っているものは何も無い（許可リストが名を挙げないことで
// 既に遮っている）。それでも自前の一覧として持つのは、回帰テストが、無いことに頼らず、
// 一つひとつを名指しで外に留まると表明できるようにするためだ。
export const EXPLICITLY_EXCLUDED_EXTS = [
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'pif',
  'ps1',
  'psm1',
  'js',
  'jse',
  'vbs',
  'vbe',
  'wsf',
  'wsh',
  'hta',
  'reg',
  'lnk',
  'url',
  'scf',
  'inf',
  'cpl',
  'chm',
  'jar',
  'apk',
  // マクロを有効にできる Office の形式＝既定で除外する（2026-07-27 のレビュー）。
  // 上の素の docx/xlsx/pptx/xlsx とは別物だ。
  'docm',
  'xlsm',
  'pptm',
  'xlsb',
];

const ZIP_CONTAINER_EXTS = new Set(['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'kra', 'procreate']);

// 2026-07-27 のレビューが、拡張子そのものに加えて署名の一致も要ると名を挙げた拡張子
// すべて。OPEN_ALLOWLIST のそれ以外は拡張子だけで判断する＝ここに載らないメディア
// （webm/mov/m4v/bmp/tiff/svg）、音声、rtf、そして公開仕様の無い制作物の形式
// （clip/xcf/ai/blend/sai/sai2）。レビュー自身の文面のとおり（"マジックバイトを持たない
// テキスト系…と、公開仕様の無い制作物形式は拡張子のみで判定する"）。
export const MAGIC_REQUIRED_EXTS = new Set<string>(['pdf', ...ZIP_CONTAINER_EXTS, '7z', 'rar', 'gz', 'psd', 'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'mp4']);

/**
 * 判断が対象にする最終的な拡張子。小文字化し、Unicode で正規化し（NFC）、分割の前に
 * 末尾の空白とドットを落とす。だから "report.pdf."（末尾のドット）は拡張子なしではなく
 * pdf と読まれる。そして二重の拡張子（"report.pdf.exe"）は必ず最後の区切りだけを読む
 * （2026-07-27 のレビュー: "二重拡張子を正規化した最終名で判定する"）。
 */
export function normalizeFinalExt(rawName: string): string {
  let s = String(rawName || '').normalize('NFC');
  s = s.replace(/[.\s]+$/, '');
  const base = s.split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i < 0 ? '' : base.slice(i + 1).toLowerCase();
}

/**
 * 拡張子だけの判断＝速く、ファイル I/O は無い。レンダラーの "開く"/"フォルダで表示" の
 * ボタンのラベルが自分で判断するのに使うもの（records.ts）。押された時点の実際の関門は、
 * MAGIC_REQUIRED_EXTS については matchesMagicBytes も要求する
 * （app/src/main/lib-open-gate.ts の isOpenAllowed。あちらはファイルを読む）。
 */
export function extensionAllowed(name: string): boolean {
  return OPEN_ALLOWLIST.has(normalizeFinalExt(name));
}

const PK = [0x50, 0x4b, 0x03, 0x04];

// Buffer ではなく Uint8Array。このモジュールはレンダラーからも import される（右クリック
// メニューのボタンのラベルの判断）。あちらには Buffer の型が存在しない（その tsconfig に
// @types/node が無い）。実行時に lib-open-gate.ts が渡すのは本物の Buffer だが、Node の
// Buffer は Uint8Array そのものだ。
function startsWithBytes(buf: Uint8Array, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}
// Buffer.toString('latin1') ではなく charCode の1バイトずつの比較＝上の startsWithBytes
// と同じ、Buffer を使わない理由づけによる（素の Uint8Array には復号する
// `.toString(encoding)` のオーバーロードが無い）。
function asciiAt(buf: Uint8Array, text: string, offset = 0): boolean {
  if (buf.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) if (buf[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

/**
 * `head`（ファイルの先頭のバイト列＝下のどの署名にも数十バイトあれば十分）は、`ext` が
 * 持つはずのものと一致するか。意味を持つのは MAGIC_REQUIRED_EXTS についてだけだ。その
 * 集合の外の ext には、ここに定義された署名が無い。だからそういう ext でここに来る
 * 呼び出し側は、拡張子の関門を飛ばした呼び出し側だ（isOpenAllowed は必ず先に
 * MAGIC_REQUIRED_EXTS.has(ext) を確かめる）。
 */
export function matchesMagicBytes(ext: string, head: Uint8Array): boolean {
  if (ext === 'pdf') return asciiAt(head, '%PDF-');
  if (ZIP_CONTAINER_EXTS.has(ext)) return startsWithBytes(head, PK);
  if (ext === '7z') return startsWithBytes(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  // RAR の v1.5-4.0 の署名と v5 の署名は、この6バイトの接頭辞を共有する。
  if (ext === 'rar') return startsWithBytes(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]);
  if (ext === 'gz') return startsWithBytes(head, [0x1f, 0x8b]);
  if (ext === 'psd') return asciiAt(head, '8BPS');
  if (ext === 'png') return startsWithBytes(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif') return startsWithBytes(head, [0xff, 0xd8, 0xff]);
  if (ext === 'gif') return asciiAt(head, 'GIF87a') || asciiAt(head, 'GIF89a');
  if (ext === 'webp') return asciiAt(head, 'RIFF') && asciiAt(head, 'WEBP', 8);
  // ISO base media file format（mp4 と avif の両方）＝4バイトのサイズ、続いて 'ftyp'。
  if (ext === 'avif' || ext === 'mp4') return asciiAt(head, 'ftyp', 4);
  return true;
}
