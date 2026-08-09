'use strict';

// 索引のジョブの種別とは何か、そしてキューがそれについて下す2つの判断（#834、親は #98）。
//「このジョブをこのレコードに対して走らせるべきか」（planRecord）と「その入力を作れるか」
//（resolveInput）。
//
// #834 が作るのは器だけ。ジョブが何を計算するか＝色（#48）、OCR・テキスト抽出（#49）、
// AI タグ（#50）、画像検索の埋め込み（#51）＝と、種別ごとの maxSegments の既定値は、それぞれの
// Issue に属する。ここには、そのどれが何を作るのかを知っているものは1つも無い。
//
// #98 の 2026-08-02 のコメントが決着させた2つの規則。どちらも下に落とし込んである。
//
//   1. 対象の集合を assetClass で切らない。ジョブの種別は必要な入力を宣言し（inputKind）、
//      キューはその入力を作れるところなら、どこでもそれを走らせる。#236 の2段の表示は見せ方の
//      区別であって、索引の区別ではない＝取り込んだファイルは、内容抽出の例外ではなく主役。
//   2. オプトインのゲートが掛かるのは requiresModel であって、キューではない。パーサはモデル
//      ではない。PDF のテキスト抽出を AI のオプトイン待ちにすると、モデルが一切触らないものに
//      ついて同意を強いることになり、同意の趣旨が裏返る（同コメントの §1-2）。
//
// このモジュールは自前のラスタライザを持たないし、今後も持たない（#98 §2）。静止画のラスタは
// サムネイルのキャッシュか元画像から来るし、PDF のページのそれは #740 の描画の仕組みから来る
// ことになる。resolveInput はそれらを注入された依存として受け取る。それがこのモジュールを
// Electron に依存させず、そのまま単体テストできる状態に保ってもいる。

/** ジョブの種別が求められる入力の形。#98 §1 は v1 をこの2つに定めている。 */
export type IndexInputKind = 'rasterImage' | 'sourceBytes';

/**
 * `rasterImage` がどこから来るか。#98 の3項: 視覚のジョブはサムネイルのキャッシュを読み、OCR は
 * 元画像を読む。3つ目の値（'pageRender'）は #740 が PDF のページ向けに足すもの＝resolveInput の
 * 分岐が1つ増えるだけ。この口を機能の中に埋め込まずここで定義しているのは、まさにそのため。
 */
export type RasterSource = 'thumbCache' | 'original';

/** #833 の assetRef の約束事。派生の行が、レコードのどのファイルについてのものか。 */
export type IndexAssetRole = 'image' | 'video' | 'file';

export interface IndexAsset {
  /** 'image' | 'video' | 'file' | `media[<seq>]`＝derived_progress.assetRef に入る。 */
  ref: string;
  /** レコードに保存されているとおりの、ライブラリからの相対のファイル名。 */
  file: string;
  role: IndexAssetRole;
}

/** 立案が読む posts の行の一部。判断にこれ以外は要らない。 */
export interface IndexRecord {
  captureId: string;
  assetClass: string;
  trashedAt: string | null;
  image?: string | null;
  video?: string | null;
  file?: string | null;
  media?: Array<{ seq: number; file: string | null }>;
}

export interface IndexProgressRow {
  indexedSegments: number;
  totalSegments: number;
}

/** ジョブの種別が返す報告。キューが共有の進捗の行を書けるように。 */
export interface IndexJobResult {
  indexedSegments: number;
  totalSegments: number;
  /** derived_progress に押す。モデルを使わなかったジョブでは両方 null。 */
  modelId?: string | null;
  modelRev?: string | null;
}

export interface IndexJobKind {
  /** 安定した id＝derived_progress.jobKind の値そのものなので、改名より長く残る。 */
  id: string;
  inputKind: IndexInputKind;
  /**
   * この種別がモデルを読み込むかどうか。#830 のオプトインがゲートを掛ける唯一の対象
   * （#98 §1-2）。true なら、AI の機能が有効になるまで何もキューに入らない。
   */
  requiresModel: boolean;
  /** rasterImage のときだけ。既定は 'thumbCache'（#98 の3項が既定に据えた安い経路）。 */
  rasterSource?: RasterSource;
  /** rasterSource:'thumbCache' のときだけ＝キャッシュに求める短い辺の長さ。 */
  rasterWidth?: number;
  /**
   * この種別が1つのアセットについて、止まるまでにいくつのセグメントをやるか（OCR の「先頭 N
   * ページ」）。残りは indexedSegments < totalSegments のまま残り、自動で再試行はしない＝残りを
   * 求めるのは利用者の操作（#98 §4。paperless-ngx の PAPERLESS_OCR_PAGES が同じ形）。
   */
  maxSegments: number;
  /** このバイト数を超える入力は、そもそも作らない。 */
  maxInputBytes: number;
  /** この種別はこのアセットを欲しがるか。（拡張子と役割の判定＝I/O は無い。） */
  accepts(asset: IndexAsset): boolean;
  run(input: ResolvedInput, ctx: IndexJobContext): Promise<IndexJobResult>;
}

export interface IndexJobContext {
  record: IndexRecord;
  asset: IndexAsset;
  /** このアセットについて既に済んだセグメント数＝再開したジョブは 0 ではなくここから始まる。 */
  fromSegment: number;
}

// 書庫はどの種別についても、アセットの段できっぱり除外する（#98 §1 の "索引しないもの"）。
// zip/7z/rar/tar を展開する背景の掃き寄せは、zip 爆弾とパストラバーサルに、自動で無人の入口を
// 差し出すことになる。#236 が「開く」を許可リストの裏に置いたのも同じ理由。種別ごとの accepts()
// ではなくここでやるので、将来の種別が忘れることはない。
const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.cbz', '.cbr']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

export function isArchiveName(name: string): boolean {
  return ARCHIVE_EXTS.has(extOf(name));
}

/**
 * レコードが指す、索引できるファイルの全部を #833 の assetRef の語彙で表したもの。media[] の
 * エントリは単数のものより後に来るので、レコード自身の主画像が必ず最初に訪れられる。
 */
export function assetsOfRecord(record: IndexRecord): IndexAsset[] {
  const assets: IndexAsset[] = [];
  if (record.image) assets.push({ ref: 'image', file: record.image, role: 'image' });
  if (record.video) assets.push({ ref: 'video', file: record.video, role: 'video' });
  if (record.file) assets.push({ ref: 'file', file: record.file, role: 'file' });
  for (const m of record.media || []) {
    if (m?.file) assets.push({ ref: `media[${m.seq}]`, file: m.file, role: 'image' });
  }
  return assets;
}

export type IndexSkipReason =
  /** ゴミ箱の中＝#98 §1 はこれを除外する。レコードはまだ戻ってくるかもしれない。 */
  | 'trashed'
  /** #830 のオプトインが切れている状態での requiresModel:true。 */
  | 'ai-disabled'
  | 'archive'
  /** どの種別もこのアセットを欲しがらない（役割か拡張子が合わない）。 */
  | 'unaccepted'
  /** indexedSegments >= totalSegments＝やることが残っていない。 */
  | 'complete'
  /** 種別の maxSegments で止まった。続きは明示的な要求があるときだけ。 */
  | 'capped';

export interface IndexCandidate {
  record: IndexRecord;
  asset: IndexAsset;
  jobKind: string;
  /** 再開した実行がどこから拾い直すか（derived_progress.indexedSegments）。 */
  fromSegment: number;
}

export interface IndexSkip extends IndexCandidate {
  reason: IndexSkipReason;
}

export interface IndexPlanEnv {
  /** #830 の旗。立案のたびに読み、キャッシュしない＝切り替えれば立案し直す。 */
  aiEnabled: boolean;
  progressOf(captureId: string, assetRef: string, jobKind: string): IndexProgressRow | undefined;
  /** 利用者が「このファイルの残りも索引する」と求めた場合＝'capped' を通す。 */
  includeCapped?: boolean;
}

/**
 * 判断の表。1つのレコード × 登録済みの種別 → 何を走らせるか。
 *
 * 意図して純粋で I/O を持たない＝これは "入力を作れるレコードだけ実行する" のうち、行だけから
 * 決められる半分であり、単体テストで固定する価値があるのもこちらの半分。もう半分（ファイルが
 * 無い・空・大きすぎる）はファイルシステムが要るので resolveInput にあり、あちらも同じ種類の
 * 拒否を報告する。
 */
export function planRecord(record: IndexRecord, kinds: readonly IndexJobKind[], env: IndexPlanEnv): { run: IndexCandidate[]; skipped: IndexSkip[] } {
  const run: IndexCandidate[] = [];
  const skipped: IndexSkip[] = [];
  const assets = assetsOfRecord(record);

  for (const kind of kinds) {
    for (const asset of assets) {
      const progress = env.progressOf(record.captureId, asset.ref, kind.id);
      const candidate: IndexCandidate = { record, asset, jobKind: kind.id, fromSegment: progress?.indexedSegments ?? 0 };
      const reason = skipReason(record, asset, kind, progress, env);
      if (reason) skipped.push({ ...candidate, reason });
      else run.push(candidate);
    }
  }
  return { run, skipped };
}

function skipReason(record: IndexRecord, asset: IndexAsset, kind: IndexJobKind, progress: IndexProgressRow | undefined, env: IndexPlanEnv): IndexSkipReason | null {
  if (record.trashedAt) return 'trashed';
  if (kind.requiresModel && !env.aiEnabled) return 'ai-disabled';
  if (isArchiveName(asset.file)) return 'archive';
  if (!kind.accepts(asset)) return 'unaccepted';
  if (progress) {
    if (progress.totalSegments > 0 && progress.indexedSegments >= progress.totalSegments) return 'complete';
    // 中断されたのではなく上限で止まっている。埋め戻しのたびにこれをキューへ入れ直すと、
    // やらないと決め直すことに予算を丸ごと使ってしまう。中断された実行（indexedSegments が
    // 上限にも総数にも届いていない）はここを素通りして再開する。2つ目の進捗のストアを持たずに
    // 埋め戻しを再開可能にしているのがそれ。
    if (progress.indexedSegments >= kind.maxSegments && !env.includeCapped) return 'capped';
  }
  return null;
}

export interface ResolvedInput {
  kind: IndexInputKind;
  /** 単一の部分しかないものは 0。#740 が入れば PDF のページ番号。 */
  segment: number;
  bytes: Buffer;
  /** バイト列の出所の絶対パス＝ログと来歴のため。 */
  source: string;
}

export type ResolveFailure =
  /** もうライブラリに無いか、保存先フォルダの外へ出てしまう名前。 */
  | 'missing'
  | 'empty'
  | 'too-large'
  /** ラスタの供給元が復号できなかった（壊れているか、誰も読めない形式）。 */
  | 'undecodable';

export type ResolveResult = { ok: true; input: ResolvedInput } | { ok: false; reason: ResolveFailure };

export interface ResolveInputDeps {
  /** ライブラリからの相対の名前に対する絶対パス。フォルダの外へ出てしまうなら null。 */
  resolveInFolder(name: string): string | null;
  stat(absPath: string): Promise<{ size: number } | null>;
  readFile(absPath: string): Promise<Buffer>;
  /** 短い辺を `width` へ縮小した JPEG のバイト列、または null。lib-thumbnails.ts のキャッシュ。 */
  thumbnail(absPath: string, width: number): Promise<Buffer | null>;
}

/** thumbCache のラスタの短い辺の既定＝グリッド自身が要求する最大のタイル。 */
const DEFAULT_RASTER_WIDTH = 512;

/**
 * 1つのアセットについてジョブの種別の入力を作る。作れなければ、その理由を言う。大きさと空か
 * どうかの確認は、読み込みより前に stat に対して行うので、大きすぎるファイルが、拒否されるため
 * だけにメモリへ引き込まれることはない（#98 §4 の入力サイズの上限）。
 */
export async function resolveInput(candidate: IndexCandidate, kind: IndexJobKind, deps: ResolveInputDeps): Promise<ResolveResult> {
  const absPath = deps.resolveInFolder(candidate.asset.file);
  if (!absPath) return { ok: false, reason: 'missing' };
  const st = await deps.stat(absPath);
  if (!st) return { ok: false, reason: 'missing' };
  if (st.size === 0) return { ok: false, reason: 'empty' };
  if (st.size > kind.maxInputBytes) return { ok: false, reason: 'too-large' };

  const segment = candidate.fromSegment;
  if (kind.inputKind === 'rasterImage' && (kind.rasterSource ?? 'thumbCache') === 'thumbCache') {
    const bytes = await deps.thumbnail(absPath, kind.rasterWidth ?? DEFAULT_RASTER_WIDTH);
    if (!bytes || bytes.length === 0) return { ok: false, reason: 'undecodable' };
    return { ok: true, input: { kind: kind.inputKind, segment, bytes, source: absPath } };
  }
  // 'sourceBytes' と、rasterSource:'original' のときの 'rasterImage'（OCR）は同じ読み込み＝
  // 違うのはジョブがそれで何をするかであって、どこから来るかではない。入力の段でこれを分けても、
  // 裏に振る舞いの無い区別になる。
  const bytes = await deps.readFile(absPath);
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, input: { kind: kind.inputKind, segment, bytes, source: absPath } };
}

/** 候補の重複を取り除くキー＝(レコード, アセット, 種別) につきジョブは1つ。 */
export function candidateKey(c: IndexCandidate): string {
  return `${c.record.captureId} ${c.asset.ref} ${c.jobKind}`;
}
