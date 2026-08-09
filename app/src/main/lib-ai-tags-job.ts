'use strict';

// #50 の取込キューのジョブ種別: lib-ai-tags.ts の計算処理を、#98 が既に作った
// 3つの設備に繋ぐだけの部品で、それ自身は何も足さない。
//
//   入力     <- 取込キューのサムネイルキャッシュのラスタ（#834 / lib-index-jobs.ts）
//   計算     <- 推論の子プロセスの素のセッション経路（#831 / lib-ml-runtime.ts）
//   出力     <- derived.db。hologram.db では決してない（#833 / lib-derived-db.ts）
//   ゲート   <- requiresModel: true、つまり #830 のオプトイン。ここでは再確認しない
//
// このファイルの中でタグを書くものは何も無い。ここが保存する候補は提案 UI が
// 読み、利用者がそのうちの1つを採用した時にだけ、手で入力したタグが通るのと
// 同じタグ書き込み経路を通って、本物のタグになる——#98 の透明性の規則であり、
// この機能をライブラリを変えずに丸ごと取り除ける理由でもある。

import { nativeImage } from 'electron';
import log from 'electron-log/main';
import fs from 'node:fs';
import path from 'node:path';

import { decodeTaggerOutput, fitLongEdge, letterboxToTaggerInput, parseSelectedTags, TAGGER_INPUT_SIZE, type BitmapChannelOrder, type TaggerOutput, type TagVocabulary } from './lib-ai-tags.ts';
import { clearAiTagOutput, ensureDerivedDb, writeAiTags } from './lib-derived-db.ts';
import { registerIndexJobKind, requestBackfill } from './lib-index-queue.ts';
import type { IndexAsset, IndexJobContext, IndexJobResult, ResolvedInput } from './lib-index-jobs.ts';
import { modelsRoot, runMlSession } from './lib-ml-runtime.ts';
import { getModelStatus } from './lib-model-manager.ts';
import { findModelEntry, modelDirFor } from './lib-model-registry.ts';
import { configDir } from './native-host.ts';
import { isViewerImageName } from './library-files.ts';

/** derived_progress.jobKind——このモジュールをどう改名しても変わらない。 */
export const AI_TAGS_JOB_ID = 'ai-tags';
export const AI_TAGS_MODEL_ID = 'SmilingWolf/wd-vit-tagger-v3';

const GRAPH_FILE = 'model.onnx';
const LABEL_FILE = 'selected_tags.csv';
const GRAPH_INPUT = 'input';
const GRAPH_OUTPUT = 'output';
// 「原本」がこれより大きい静止画は、サムネイルが一切作られないので、タグ付け
// されることもない。太っ腹な値にしてある: 重要なコストはデコードで、その
// デコードはこちらのものではなくサムネイルキャッシュのもの。
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

function entry() {
  const e = findModelEntry(AI_TAGS_MODEL_ID);
  if (!e) throw new Error(`${AI_TAGS_MODEL_ID} is not in the model registry`);
  return e;
}

function modelDir(): string {
  return modelDirFor(entry(), modelsRoot());
}

// --- チャネル順 ---
//
// #50 の設計は、nativeImage.toBitmap() のバイト順を仮定ではなく固定して
// 計測することを求める。Electron がこれをプラットフォーム依存と文書化して
// いるため。起動時に計測することは、定数を固定するより厳密に強い: 意見の
// 異なるプラットフォーム（や Electron のリリース）が現れても、赤と青が
// 入れ替わった画像に対して自信満々のスコアを出す——見た目の症状の無い
// 失敗——のではなく、単に対応できる。
//
// プローブは 1x1 の不透明な純粋赤 PNG。赤は、1バイトで2つの候補順を区別
// できる唯一の色: RGBA は 255 を最初に置き、BGRA は3番目に置く。
// scripts/test-app-ai-tags.cts は、独立して読んだ同じ画像に対してプローブの
// 判定を確認する。
const RED_1X1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');

let channelOrder: BitmapChannelOrder | null = null;

export function detectBitmapChannelOrder(): BitmapChannelOrder {
  if (channelOrder) return channelOrder;
  const bytes = nativeImage.createFromBuffer(RED_1X1_PNG).toBitmap();
  if (bytes.length < 4) throw new Error('the channel-order probe did not decode');
  // 「どちらが大きいか」ではなく厳密な一致: きれいな 255 もきれいな 0 も
  // 生まなかったデコードは、チャネル順の問題ではなく壊れたデコーダであり、
  // 推測すればそれを埋もれさせてしまう。
  if (bytes[0] === 255 && bytes[2] === 0) channelOrder = 'rgba';
  else if (bytes[2] === 255 && bytes[0] === 0) channelOrder = 'bgra';
  else throw new Error(`the channel-order probe decoded to [${bytes[0]}, ${bytes[1]}, ${bytes[2]}, ${bytes[3]}], which is neither RGBA nor BGRA red`);
  log.info('[ai-tags] bitmap channel order', { order: channelOrder });
  return channelOrder;
}

// --- 前処理 ---

/**
 * エンコード済み画像のバイト列 -> グラフの入力テンソル。本番ではこれは常に
 * サムネイルキャッシュの JPEG。ハーネスは PNG を与える。
 *
 * どちらの段階も意図して「よそから借りたもの」: nativeImage は、グリッドが
 * 既に使っているデコーダ兼リサンプラなので、タグ付けされる画像は利用者が
 * 見ている画像そのもの。#50 はこのために sharp を持ち込むことを却下した
 * ——アプリが既にやっている仕事のために、3つ目のネイティブ依存を足すことに
 * なるため。
 */
export function preprocessToTensor(bytes: Buffer): { data: Float32Array; dims: number[] } {
  const decoded = nativeImage.createFromBuffer(bytes);
  const size = decoded.getSize();
  if (!size.width || !size.height) throw new Error('nativeImage could not decode the thumbnail');
  const fit = fitLongEdge(size.width, size.height, TAGGER_INPUT_SIZE);
  const scaled = decoded.resize({ width: fit.width, height: fit.height, quality: 'best' });
  const actual = scaled.getSize();
  const data = letterboxToTaggerInput(scaled.toBitmap(), actual.width, actual.height, detectBitmapChannelOrder(), TAGGER_INPUT_SIZE);
  return { data, dims: [1, TAGGER_INPUT_SIZE, TAGGER_INPUT_SIZE, 3] };
}

// --- 語彙 ---
//
// 一度読んだらプロセスの寿命の間ずっと保持する: 10,861 個の短い文字列で、
// このファイルはグラフのリビジョンにハッシュが固定されているので足元で
// 変わることがない。モデルが削除された時に捨てるので、再ダウンロードすれば
// 読み直される。

let vocabulary: TagVocabulary | null = null;

function loadVocabulary(): TagVocabulary {
  if (vocabulary) return vocabulary;
  vocabulary = parseSelectedTags(fs.readFileSync(path.join(modelDir(), LABEL_FILE), 'utf8'));
  return vocabulary;
}

// --- モデルの可用性 ---
//
// accepts() はディスクに触れずに答えなければならない（キューは走査ごと・
// 種別ごと・アセットごとにこれを1回呼ぶ）ので、答えはキャッシュされ、それを
// 変えうるイベント——ダウンロードの完了と削除——によって更新される。
//
// run() で失敗させるのではなく accepts() で拒むことは、「候補ではない」と
// 「常に失敗する候補」の違い: キューは失敗した実行に進捗行を書かないので、
// 後者だと遡及処理のたびにライブラリ全体を再計画し、まったく先へ進めなく
// なる。

let modelPresent = false;

/**
 * タグ付け器がディスク上にあるかを読み直す。使えるようになったなら true を
 * 返す。呼び出し元にとって、ライブラリ全体の再計画が必要になった合図。
 */
export function refreshAiTagsModelState(): boolean {
  let present = false;
  try {
    present = getModelStatus(AI_TAGS_MODEL_ID).state === 'complete';
  } catch {
    present = false; // レジストリのエントリが無い、models の root が無い——どちらにせよ使えない
  }
  const becameAvailable = present && !modelPresent;
  if (!present) vocabulary = null;
  modelPresent = present;
  return becameAvailable;
}

/**
 * モデルが現れる・消えることへの反応のすべてを、ダウンロードや削除の後に
 * ipc-model.ts が呼ぶ1回の呼び出しにまとめたもの。
 *
 * モデルを削除することは「一時停止」ではない: #50 は、候補もそれと一緒に
 * 消えると言っている。モデルこそがこの機能のスイッチであり——それと歩調を
 * 合わせ続けるべき2つ目の on/off 設定は存在しない。
 */
export function onAiTagsModelChanged(): void {
  const becameAvailable = refreshAiTagsModelState();
  if (becameAvailable) {
    // モデルが無い間にスキップされたレコードは（設計上）痕跡を残さないので、
    // 全体を走査し直すことでしか再び見つけられない。
    requestBackfill({ full: true });
    return;
  }
  if (!modelPresent) {
    try {
      clearAiTagOutput(ensureDerivedDb(configDir()).sqlite, AI_TAGS_JOB_ID);
    } catch (err) {
      log.warn('[ai-tags] could not clear candidates after the model was removed', { error: (err as Error)?.message });
    }
  }
}

// --- ジョブ種別 ---

function accepts(asset: IndexAsset): boolean {
  return modelPresent && asset.role === 'image' && isViewerImageName(asset.file);
}

/**
 * 画像1枚分の推論: バイト列を入れて候補を出す。何も保存しない。
 *
 * run() とは分けてあり、受け入れチェック（scripts/test-ai-tags-model.cts）が
 * それの「コピー」ではなく「本物の」経路を動かせるようにしている——前処理こそが
 * モデルの作者のリファレンスと突き合わせて確認する価値のある部分で、それを
 * 再実装したチェックは何も証明しない。
 */
export async function tagImageBytes(bytes: Buffer, opts: { skipGate?: boolean } = {}): Promise<TaggerOutput & { scoreCount: number }> {
  const vocab = loadVocabulary();
  const { data, dims } = preprocessToTensor(bytes);
  const out = await runMlSession({
    modelDir: modelDir(),
    modelFile: GRAPH_FILE,
    feeds: { [GRAPH_INPUT]: { type: 'float32', dims, data } },
    skipGate: opts.skipGate,
  });
  const scores = out[GRAPH_OUTPUT]?.data;
  if (!scores) throw new Error(`the graph produced no '${GRAPH_OUTPUT}' tensor`);
  return { ...decodeTaggerOutput(scores, vocab), scoreCount: scores.length };
}

async function run(input: ResolvedInput, ctx: IndexJobContext): Promise<IndexJobResult> {
  const e = entry();
  const { tags, ratings } = await tagImageBytes(input.bytes);
  writeAiTags(ensureDerivedDb(configDir()).sqlite, {
    captureId: ctx.record.captureId,
    assetRef: ctx.asset.ref,
    segment: input.segment,
    modelId: e.id,
    modelRev: e.rev,
    tags,
    ratings: ratings.map((r) => ({ rating: r.name, score: r.score })),
  });
  return { indexedSegments: 1, totalSegments: 1, modelId: e.id, modelRev: e.rev };
}

/** 種別を登録し、モデルがここにあるかどうかを最初に読む。 */
export function registerAiTagsJob(): void {
  refreshAiTagsModelState();
  registerIndexJobKind({
    id: AI_TAGS_JOB_ID,
    inputKind: 'rasterImage',
    // どちらもキューの既定値（'thumbCache'、512）のままにし、わざわざ書き直さない:
    // グリッド自身のキャッシュに乗ることこそが要点であり、独自の幅を指定すると、
    // 利用者が既に見たタイルまで2回デコードされることになる。
    requiresModel: true,
    maxSegments: 1, // 静止画はセグメント1つ。「残り」というものが無い
    maxInputBytes: MAX_INPUT_BYTES,
    accepts,
    run,
  });
}
