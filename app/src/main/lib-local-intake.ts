'use strict';

// ローカルの画像・動画から作るレコードの唯一の定義。ブラウザ拡張以外の入口が共有する。
//
// 入口と、それぞれが供給するもの:
//   * ファイルダイアログ（`import-images`、ipc-transfer.ts）＝パス、`drag-`/'drag'
//   * クリップボード（`import-clipboard`、#85）             ＝バイト列、`clip-`/'clipboard'
//   * ウィンドウへのドラッグ＆ドロップ（#234）               ＝パス、`drag-`/'drag'
// 違うのはピクセルの出所と3つの欄の値だけ。レコードのそれ以外＝url:null、各種の時刻、mediaType、
// ファイルの着地先、行を書く前にカードの寸法を測ること＝は同じで、ここで1回だけ述べる。
//
// #84 の設計コメントはこの補助を「サイドカーの組み立て」と説明しているが、それはサイドカーがまだ
// ライブラリの保管庫だった頃に書かれたため。サイドカーはもう無い（#299/#300/#302）。レコードは
// 共有の書き手（lib-db-record-writer.ts）を通してそのまま DB へ入り、保存先フォルダに着地するのは
// メディアのファイルだけ。あのコメントの残り＝欄の値、captureId の接頭辞、入口ごとの `source`＝が、
// このモジュールの実装するもの。
//
// `url` は null のままにする。`kind` は保存せず、問い合わせの層がレコードに url があるかどうかから
// 導く。だから url を入れたローカル取り込みの画像は、自分を SNS の投稿として見せてしまう
// （そして postKey で本物と同じ組にまとまる）。#85 が「クリップボードの text/html から URL を
// 引き出す」をやめ、#234 がドロップについて同じことをやめたのはそのため＝#85 の 2026-07-16 の
// コメントを参照。
//
// lib-card-dims.ts と同じく Electron に依存しない（fs / path と better-sqlite3 だけ）ので、素の
// node で単体テストできる。

import fs from 'node:fs';
import path from 'node:path';

import { fillCardDims } from './lib-card-dims.ts';
import { fillMediaDims } from './lib-media-dims.ts';
import { makeTagResolver, preparePostStmts, writePost } from './lib-db-record-writer.ts';
import { IMPORTABLE_IMG, IMPORTABLE_VID, IMPORTABLE_MEDIA } from '../../../native-host/importable-media.mts';
import { itemDirectoryAbsolute, itemFileRelative } from '../../../native-host/item-storage.mts';
import type Database from 'better-sqlite3';
import type { PostRecordInput } from '../../../native-host/post-record.mts';

// ローカル取り込みで許可する拡張子。すべての入口が同じ一覧を使う。
export { IMPORTABLE_IMG, IMPORTABLE_VID, IMPORTABLE_MEDIA };

/**
 * ローカルから取り込んだものの captureId。`<接頭辞>-<stamp>-<4桁の連番>`。`stamp` はバッチ単位
 * （1回のダイアログでの選択など）なので、1つのバッチの id はまとまって
 * 並ぶ。その中の順序は `seq` が決める。
 */
export function localCaptureId(prefix: string, stamp: number, seq: number): string {
  return `${prefix}-${stamp}-${String(seq).padStart(4, '0')}`;
}

export interface LocalRecordArgs {
  captureId: string;
  /** 保存先フォルダからの相対パス（`items/<captureId>/<captureId>.<ext>`）。 */
  file: string;
  /** 小文字、ドット無し。画像か動画かを決める。 */
  ext: string;
  /** `'drag'` / `'clipboard'`＝モジュールのコメントを参照。 */
  source: string;
  /** カードのタイトルとして出る。元のベース名か、生成したラベル。 */
  title: string | null;
  /**
   * レコードの `date`（グリッドが並べ替えと絞り込みに使う軸）。ファイルの mtime があればそれ。
   * 無ければ省き、その場合は今の時刻に落ち着く＝クリップボードには持ち込むべき元の日付が
   * 無い（#85）。
   */
  date?: string | null;
  /** テストがキャプチャの時刻を固定できるよう注入する。 */
  now?: string;
}

/**
 * ローカルのファイルがなるレコード。importLocalFile から切り出してあるので、バッチの入口
 * （ダイアログからの取り込み）は多数を組み立てて1回のトランザクションで書けるし、1件ずつの入口
 * （クリップボード）は下の補助を丸ごと使える。
 *
 * IMPORTABLE_MEDIA 外の拡張子は受け付けない。
 */
export function buildLocalRecord(args: LocalRecordArgs): PostRecordInput {
  const ext = args.ext.toLowerCase();
  if (!IMPORTABLE_MEDIA.includes(ext)) throw new Error(`Unsupported local media extension: ${ext || '(none)'}`);
  const nowIso = args.now || new Date().toISOString();
  const isVid = IMPORTABLE_VID.includes(ext);
  return {
    captureId: args.captureId,
    source: args.source,
    // url は決して入れない＝モジュールのコメントを参照。
    url: null,
    platform: null,
    title: args.title,
    text: null,
    displayName: null,
    screenName: null,
    mediaType: isVid ? 'video' : 'image',
    capturedAt: nowIso,
    date: args.date || nowIso,
    updatedAt: nowIso,
    media: [],
    tags: [],
    hashtags: [],
    image: isVid ? null : args.file,
    video: isVid ? args.file : null,
  };
}

export interface ImportLocalFileArgs extends Omit<LocalRecordArgs, 'captureId' | 'file'> {
  folder: string;
  sqlite: Database.Database;
  /** captureId の接頭辞＝`clip` / `drag`。 */
  idPrefix: string;
  /** 既に手元にあるピクセル（クリップボードは PNG のバッファを渡す）。 */
  bytes?: Buffer;
  /** コピーして持ち込むファイル（ダイアログ・ドロップ）。`bytes` があれば無視する。 */
  srcPath?: string;
  stamp?: number;
  seq?: number;
}

/**
 * ローカルの画像・動画1つをライブラリへ着地させる。ファイル自体は保存先フォルダへ、レコードは DB へ
 * 書く。中途半端に
 * 終えるのではなく拒否する＝行を書くのはファイルがディスクに載ってからなので、失敗した取り込みが
 * 何も指さないレコードを残すことはない（逆、レコードの無いファイルは孤児の回収の担当）。
 */
export async function importLocalFile(args: ImportLocalFileArgs): Promise<{ captureId: string; file: string }> {
  if (!args.bytes && !args.srcPath) throw new Error('importLocalFile: neither bytes nor srcPath');
  const captureId = localCaptureId(args.idPrefix, args.stamp ?? Date.now(), args.seq ?? 0);
  const fileName = args.ext ? `${captureId}.${args.ext}` : captureId;
  const file = itemFileRelative(captureId, fileName);
  // 対象外のファイルでは保存先ディレクトリすら作らない。
  const rec = buildLocalRecord({ captureId, file, ext: args.ext, source: args.source, title: args.title, date: args.date, now: args.now });
  const itemDir = itemDirectoryAbsolute(args.folder, captureId);
  const dest = path.join(itemDir, fileName);
  await fs.promises.mkdir(itemDir, { recursive: true });
  if (args.bytes) await fs.promises.writeFile(dest, args.bytes);
  else await fs.promises.copyFile(args.srcPath as string, dest);

  const stmts = preparePostStmts(args.sqlite);
  const resolveTagId = makeTagResolver(args.sqlite);
  args.sqlite.exec('BEGIN');
  try {
    writePost(stmts, resolveTagId, fillMediaDims(args.folder, fillCardDims(args.folder, rec)));
    args.sqlite.exec('COMMIT');
  } catch (err) {
    args.sqlite.exec('ROLLBACK');
    // 行は着地しなかったので、それが名指ししたはずのファイルも着地させない。
    try {
      await fs.promises.rm(itemDir, { recursive: true, force: true });
    } catch {
      /* 片付けるものが無い */
    }
    throw err;
  }
  return { captureId, file };
}
