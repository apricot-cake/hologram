'use strict';

// メインプロセスの書き込みのための、唯一の tmp+rename プリミティブ（#229）。
//
// 永続的な書き込みはすべてここを通る: バイト列を隣接する tmp ファイルへ置き、
// それを対象へリネームする。rename() はファイルシステム内でアトミックなので、
// 読み手——ネイティブホスト、バックアップの復元、強制終了後の次回起動——が
// 見るのは常に完全な旧ファイルか完全な新ファイルのどちらかで、切り詰められた
// 途中の状態を見ることは無い。素の書き込みこそが、強制終了で config.json を
// 切り詰めライブラリを1つ失わせた原因（index.ts の readConfig のコメント、
// 2026-06-23 のインシデント）。
//
// このモジュールが無かった頃は、同じ5行が呼び出し箇所ごとに書き直され、
// コードではなくコメント（「lib-index のスナップショット書き込みと同じ形」）で
// 歩調を合わせていて、既にずれていた: 失敗後に tmp ファイルを消していたのは
// バックアップのループだけ、fsync していたのは writeConfig だけ。掃除は今や
// 1つの方針になった——失敗した書き込みは決して tmp ファイルを残さない——
// そして fsync は呼び出し元が口に出して選ぶ唯一のオプション。
//
// 形が2つあるのは、呼び出し元がバイト列を作る方法が2通りあるから:
//   writeFileAtomicSync            呼び出し元が既にペイロード全体を持っている。
//   commitFileAtomic(Sync)         呼び出し元が tmp ファイル自体を埋める
//                                  （上限付きのストリーム展開、copyFile +
//                                  utimes）場合で、必要なのは命名、コミット、
//                                  掃除だけ。
//
// 対象のディレクトリは存在していなければならない: どの呼び出し箇所も既に
// 書き込みループの外で一度自分のディレクトリを作っており、ディレクトリを
// 勝手に作り出すヘルパーは、パスの打ち間違いを黙って成功させてしまう。
//
// Electron に依存しない（node の組み込みのみ）ので、テストスイートがこれを
// 直接動かせる。

import fs from 'node:fs';

type AtomicWriteOptions = {
  // 対象パスに付け足して tmp ファイルの名前にする。何か別のものが走査する
  // ディレクトリへ書く呼び出し元は、そこで成果物と分かるようにこれを上書き
  // する（バックアップミラーの '.tmp-<epoch>'、ZIP インポータの
  // '.tmp-import'）。何であれ、走査側がスキップする tmp パターン——
  // lib-migrate.ts の TMP_RE、lib-archive.ts の isTransientName、
  // lib-db-integrity.ts、index.ts のバックアップ収集処理——と一致し続ける
  // 必要がある。
  tmpSuffix?: string;
  // リネームの前に tmp ファイルを fsync し、リネーム後の電源断が、まだ
  // 書かれていないデータを指すディレクトリエントリを残さないようにする。
  // 書き込みごとにディスクの往復1回分のコストがかかる。既定では何に対しても
  // 有効ではなく、config.json だけ有効。あのファイルを失うと保存フォルダ自体を
  // 失うため。
  fsync?: boolean;
};

const DEFAULT_TMP_SUFFIX = '.tmp';

function tmpPathFor(file: string, opts: AtomicWriteOptions): string {
  return `${file}${opts.tmpSuffix ?? DEFAULT_TMP_SUFFIX}`;
}

// tmp のパスに対して `fill` を実行し、それを `file` へコミットする。`fill` や
// リネームが投げるものは、そのまま変更せずに伝播する——これが加えるのは、
// そうなった時に tmp ファイルが既に消えていることだけ。
async function commitFileAtomic(file: string, fill: (tmpPath: string) => Promise<void>, opts: AtomicWriteOptions = {}): Promise<void> {
  const tmp = tmpPathFor(file, opts);
  try {
    await fill(tmp);
    await fs.promises.rename(tmp, file);
  } catch (err) {
    try {
      await fs.promises.unlink(tmp);
    } catch {
      /* 掃除するものは無い（fill がそれを作るところまで到達しなかった） */
    }
    throw err;
  }
}

// 同期版の commitFileAtomic。契約は同じ。
function commitFileAtomicSync(file: string, fill: (tmpPath: string) => void, opts: AtomicWriteOptions = {}): void {
  const tmp = tmpPathFor(file, opts);
  try {
    fill(tmp);
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* 掃除するものは無い（fill がそれを作るところまで到達しなかった） */
    }
    throw err;
  }
}

// `data` を `file` へアトミックに書く。文字列は UTF-8 として書かれる（ここの
// どの呼び出し元も使っていたエンコーディング）。Buffer はそのまま書かれる。
function writeFileAtomicSync(file: string, data: string | NodeJS.ArrayBufferView, opts: AtomicWriteOptions = {}): void {
  commitFileAtomicSync(
    file,
    (tmp) => {
      // flush:true は close の前に fd を fsync する（Node >= 21.0 / 20.10）。
      // これは writeConfig がかつて手で書き下していた openSync + writeSync +
      // fsyncSync + closeSync の一連の動きに相当する。
      fs.writeFileSync(tmp, data, { encoding: 'utf8', flush: opts.fsync === true });
    },
    opts,
  );
}

export { commitFileAtomic, commitFileAtomicSync, writeFileAtomicSync };
export type { AtomicWriteOptions };
