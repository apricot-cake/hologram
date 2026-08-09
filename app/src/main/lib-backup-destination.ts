'use strict';

// バックアップ先のアダプタ（#233）。
//
// lib-backup.ts のエンジンはバックアップに何を含めるべきかを決め、宛先はバイトがどうやってそこへ
// 至るかを決める。#233 がこの2つを分けたのは、2つ目の宛先の種別＝OAuth 越しに届くクラウドの
// アカウント＝が、エンジンの2つ目の複製ではなく、このインターフェースの新しい実装になるように
// （"先行すると宛先アダプタを二度組むことになる"）。
//
// この4つの操作は、素のフォルダと個人向けクラウドドライブの API の両方が備えているものの共通部分
// であり、エンジンが実際に必要とする4つでもある。既にあるものを列挙する、ファイルを置く、ファイルを
// 移す（ゴミ箱への出し入れ＝アップロードし直すことは決してない）、ファイルを消す。パスは宛先の
// ルートからの相対で、区切りは常に '/' なので、同じ相対の名前がフォルダのエントリとクラウドの
// オブジェクトの両方を指せる。
//
// 5つ目の対＝宛先の同一性を読む・書く＝は #176 の要求。宛先は自分がどのライブラリのものかを記録し、
// それが今開いているライブラリと一致しなければエンジンは実行を断る。これが無いと、A の宛先を
// 設定したままライブラリ B を開いたとき、「元が持たなくなったものを消す」という規則が、A の
// バックアップを B の中身まで刈り込んでしまう。restic も同じことをしている（そのリポジトリの設定は、
// "regardless of local or remote" にリポジトリを同定する一意の id を持つ）。
//
// v1 が配るのはローカルフォルダのアダプタだけ。OAuth のアダプタは #233 の後の段。OAuth の
// クライアントの登録は、このコードが利用者の代わりにやれることではないので、ここにクラウドの種別が
// もう在るふりをするものは無い。

import fs from 'node:fs';
import path from 'node:path';

import { commitFileAtomic } from './lib-atomic.ts';

/** `list()` がファイルごとに報告するもの＝書き換わるファイルの変化に気づくのに足りるだけ。 */
export interface DestinationEntry {
  size: number;
  mtimeMs: number;
}

/** これが誰のバックアップかを、宛先のルートに記録したもの。 */
export interface DestinationIdentity {
  libraryId: string;
  lastRunAt: string | null;
}

export interface BackupDestination {
  /** ログと状態のための判別子。v1 の値は 'local-folder' だけ。 */
  readonly kind: string;
  /** バックアップの在り処。利用者が読むメッセージのため。 */
  readonly location: string;
  /** 宛先のルート以下のすべてのファイル。'/' 区切りの相対パスをキーにする。 */
  list(): Promise<Map<string, DestinationEntry>>;
  /** `srcFile` をコピーして入れ、`rel` にあるものを置き換える。 */
  put(rel: string, srcFile: string, mtimeMs?: number | null): Promise<void>;
  /** 既にあるエントリを、バイトを2度動かさずに移す。 */
  move(fromRel: string, toRel: string): Promise<void>;
  remove(rel: string): Promise<void>;
  /** 宛先が一度も所有を宣言されていない（か、読めない）ときは null。 */
  readIdentity(): Promise<DestinationIdentity | null>;
  writeIdentity(identity: DestinationIdentity): Promise<void>;
}

// バックアップは、利用者が選んだフォルダの下の名前の付いたサブフォルダへ入る。その直下へは決して
// 入れない。選ばれるフォルダは大抵、既にあるドライブのルートか、利用者自身のファイルの入った
// ドキュメントのフォルダで、エンジンは自分の知らないエントリを消すため。
const BACKUP_SUBDIR = 'Hologram-backup';

// 宛先自身の帳簿。そのルートに置く。意図して list() では報告しない。エンジンはライブラリが
// 持たない宛先のエントリを消すが、これは設計上ライブラリ側に対応するものを持たないため。
const IDENTITY_FILE = '.hologram-backup.json';

/** エンジン自身の書き込みが、コピーの途中で残す tmp の残り物。 */
const TMP_RE = /\.tmp(-\d+)?$/i;

function backupRoot(dir: string): string {
  return path.join(dir, BACKUP_SUBDIR);
}

function createLocalFolderDestination(dir: string): BackupDestination {
  const root = backupRoot(dir);
  const abs = (rel: string) => path.join(root, ...rel.split('/'));

  async function walk(sub: string, into: Map<string, DestinationEntry>): Promise<void> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(sub ? path.join(root, ...sub.split('/')) : root, { withFileTypes: true });
    } catch {
      return; // まだ作られていないか、読めない＝空として扱う
    }
    for (const e of entries) {
      if (TMP_RE.test(e.name)) continue;
      if (!sub && e.name === IDENTITY_FILE) continue;
      const rel = sub ? `${sub}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(rel, into);
        continue;
      }
      if (!e.isFile()) continue;
      try {
        const st = await fs.promises.stat(abs(rel));
        into.set(rel, { size: st.size, mtimeMs: st.mtimeMs });
      } catch {
        /* readdir と stat の間に消えた */
      }
    }
  }

  return {
    kind: 'local-folder',
    location: root,
    async list() {
      const out = new Map<string, DestinationEntry>();
      await walk('', out);
      return out;
    },
    async put(rel, srcFile, mtimeMs) {
      const dest = abs(rel);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await commitFileAtomic(
        dest,
        async (tmp) => {
          await fs.promises.copyFile(srcFile, tmp);
          // 元の mtime を持ち越す（utimes が設定できるミリ秒へ切り捨てる）。宛先を元の場所へ
          // 復元したとき、ライブラリ自身の時刻が保たれるように。
          if (typeof mtimeMs === 'number') {
            try {
              const t = new Date(Math.floor(mtimeMs));
              await fs.promises.utimes(tmp, t, t);
            } catch {
              /* できる範囲で */
            }
          }
        },
        { tmpSuffix: `.tmp-${Date.now()}` },
      );
    },
    async move(fromRel, toRel) {
      const to = abs(toRel);
      await fs.promises.mkdir(path.dirname(to), { recursive: true });
      await fs.promises.rename(abs(fromRel), to);
    },
    async remove(rel) {
      await fs.promises.unlink(abs(rel));
    },
    async readIdentity() {
      try {
        const parsed = JSON.parse(await fs.promises.readFile(path.join(root, IDENTITY_FILE), 'utf8'));
        const libraryId = parsed?.libraryId;
        // 意味の取れないファイルは、食い違いではなく「誰のものでもない」と読む。1バイトの破損を
        // 理由に以後のすべての実行を断る方が、その宛先をもう一度引き受けるより大きな失敗になる。
        if (typeof libraryId !== 'string' || !libraryId) return null;
        return { libraryId, lastRunAt: typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : null };
      } catch {
        return null;
      }
    },
    async writeIdentity(identity) {
      await fs.promises.mkdir(root, { recursive: true });
      await commitFileAtomic(path.join(root, IDENTITY_FILE), (tmp) => fs.promises.writeFile(tmp, `${JSON.stringify(identity, null, 2)}\n`), { tmpSuffix: `.tmp-${Date.now()}` });
    },
  };
}

export { BACKUP_SUBDIR, IDENTITY_FILE, TMP_RE, backupRoot, createLocalFolderDestination };
