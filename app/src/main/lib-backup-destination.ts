'use strict';

// バックアップ先のアダプタ（#233）。
//
// lib-backup.ts のエンジンはバックアップに何を含めるべきかを決め、宛先はバイトがどうやってそこへ
// 至るかを決める。Google Drive はエンジンの複製ではなく、このインターフェースの実装になる。
//
// この4つの操作は、Google Drive API が備え、エンジンが実際に必要とするもの。既にあるものを列挙する、ファイルを置く、ファイルを
// 移す（ゴミ箱への出し入れ＝アップロードし直すことは決してない）、ファイルを消す。パスは宛先の
// ルートからの相対で、区切りは常に '/'。
//
// 5つ目の対＝宛先の同一性を読む・書く＝は #176 の要求。宛先は自分がどのライブラリのものかを記録し、
// それが今開いているライブラリと一致しなければエンジンは実行を断る。これが無いと、A の宛先を
// 設定したままライブラリ B を開いたとき、「元が持たなくなったものを消す」という規則が、A の
// バックアップを B の中身まで刈り込んでしまう。restic も同じことをしている（そのリポジトリの設定は、
// "regardless of local or remote" にリポジトリを同定する一意の id を持つ）。
//

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
  /** ログと状態のための判別子。 */
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

// Google Drive のルート直下に作るアプリ専用フォルダ。
const BACKUP_SUBDIR = 'Hologram-backup';

// 宛先自身の帳簿。そのルートに置く。意図して list() では報告しない。エンジンはライブラリが
// 持たない宛先のエントリを消すが、これは設計上ライブラリ側に対応するものを持たないため。
const IDENTITY_FILE = '.hologram-backup.json';

/** エンジン自身の書き込みが、コピーの途中で残す tmp の残り物。 */
const TMP_RE = /\.tmp(-\d+)?$/i;

export { BACKUP_SUBDIR, IDENTITY_FILE, TMP_RE };
