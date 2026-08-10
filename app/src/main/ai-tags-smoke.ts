'use strict';

// #50 のうち、本物のアプリについての「真の言明」でしかない部分。
// scripts/test-app-ai-tags.cts が駆動する。ml-smoke.ts と同じ配置、理由も
// 同じ: nativeImage は Electron のデコーダで、同じモジュールを import する
// 独立したスクリプトは、別の何かを計測してしまう。
//
// ここで確認する主張は2つで、どちらも Vitest では確認できない:
//
//   1. nativeImage.toBitmap() が返すバイト順がどちらか。Electron はこれを
//      プラットフォーム依存だと文書化しているので、lib-ai-tags-job.ts は
//      既知の色のプローブでそれを計測する。ここでは、そのプローブの判定と、
//      独立した画像の生バイト列の両方を報告する。ハーネスが判定を自分自身
//      ではなく証拠と突き合わせて確認できるように。
//   2. デコード→リサイズ→レターボックスが、手作りのビットマップではなく
//      実際の画像スタックを通して、モデルが学習された時のテンソルを
//      生成すること。
//
// index.ts の HOLOGRAM_SMOKE 分岐からのみ到達できる。

import { nativeImage } from 'electron';

import fs from 'node:fs';

import { AI_TAGS_JOB_ID, detectBitmapChannelOrder, preprocessToTensor, registerAiTagsJob, tagImageBytes } from './lib-ai-tags-job.ts';
import { TAGGER_INPUT_SIZE } from './lib-ai-tags.ts';
import { registeredIndexJobKinds } from './lib-index-queue.ts';

// 1x1 の不透明な純粋青。プローブが使う赤とは独立: 報告された順序が正しければ、
// 青の 255 は赤の 255 が「無かった」バイト位置に来る。
const BLUE_1X1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==', 'base64');
// 2x1: 左半分が純粋な赤、右半分が純粋な青。長辺を448へ拡大した後、両半分が
// 数百ピクセルの単色になるだけの幅があるので、継ぎ目から離れた場所の
// サンプルはリサンプリングの影響を受けない。
const RED_BLUE_2X1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8AAQv8BD/kD/YURmXYAAAAASUVORK5CYII=', 'base64');

export interface AiTagsSmokeReport {
  /** lib-ai-tags-job.ts のプローブが下した結論。 */
  channelOrder: string;
  /** 不透明な青ピクセルの、toBitmap() が返す生バイト列——結論ではなく証拠。 */
  bluePixel: number[];
  /** 左（赤）・右（青）の各半分と、パディングの隅からサンプルした [B, G, R]。 */
  leftHalf: number[];
  rightHalf: number[];
  corner: number[];
  tensorLength: number;
  /** 登録されたジョブ種別の宣言と、ディスクにモデルが無いアセットを望むかどうか。 */
  jobKind: { id: string; requiresModel: boolean; maxSegments: number; acceptsWithoutModel: boolean } | null;
}

export interface AiTagsModelSmokeReport {
  image: string;
  /** グラフの出力の長さ——ラベルファイルの行数と一致していなければならない。 */
  scoreCount: number;
  /** しきい値を超えた候補、強い順。 */
  tags: Array<{ name: string; category: number; score: number }>;
  ratings: Array<{ name: string; score: number }>;
  /** 出力全体の中で最も高いスコア。1 を超えていたら活性化関数が欠けている印。 */
  maxScore: number;
  minScore: number;
  ms: number;
}

/**
 * scripts/test-ai-tags-model.cts のための、本物の本番経路上での実際の推論。
 * ディスク上にモデルが必要なので、オフラインのハーネスには決して含まれない。
 *
 * 並行ではなく順次実行する: 2枚目の画像は、セッションが作り直されるのではなく
 * 再利用されていることを示すものでもある（`ms` が縮む）。
 */
export async function runAiTagsModelSmoke(imagePaths: string[]): Promise<AiTagsModelSmokeReport[]> {
  const reports: AiTagsModelSmokeReport[] = [];
  for (const imagePath of imagePaths) {
    const t0 = Date.now();
    const out = await tagImageBytes(fs.readFileSync(imagePath));
    const all = [...out.tags, ...out.ratings].map((t) => t.score);
    reports.push({
      image: imagePath,
      scoreCount: out.scoreCount,
      tags: out.tags.slice(0, 40),
      ratings: out.ratings.map((r) => ({ name: r.name, score: r.score })),
      maxScore: all.length ? Math.max(...all) : 0,
      minScore: all.length ? Math.min(...all) : 0,
      ms: Date.now() - t0,
    });
  }
  return reports;
}

function pixel(data: Float32Array, x: number, y: number): number[] {
  const i = (y * TAGGER_INPUT_SIZE + x) * 3;
  return [Math.round(data[i]), Math.round(data[i + 1]), Math.round(data[i + 2])];
}

export function runAiTagsSmoke(): AiTagsSmokeReport {
  const { data } = preprocessToTensor(RED_BLUE_2X1_PNG);
  // 2x1 の元画像は 448x224 になり、top = 112 で中央寄せされる。だから行224は
  // 画像の内側で、行0はパディング。
  //
  // ここで登録するのは、スモークビルドが（本物のセッションでは登録処理を担う）
  // 取込キューを一切起動しないため。同じ id を再登録すれば置き換わるので、
  // どちらにせよ安全。
  registerAiTagsJob();
  const kind = registeredIndexJobKinds().find((k) => k.id === AI_TAGS_JOB_ID) ?? null;
  return {
    channelOrder: detectBitmapChannelOrder(),
    bluePixel: Array.from(nativeImage.createFromBuffer(BLUE_1X1_PNG).toBitmap().subarray(0, 4)),
    leftHalf: pixel(data, 100, 224),
    rightHalf: pixel(data, 348, 224),
    corner: pixel(data, 0, 0),
    tensorLength: data.length,
    jobKind: kind ? { id: kind.id, requiresModel: kind.requiresModel, maxSegments: kind.maxSegments, acceptsWithoutModel: kind.accepts({ ref: 'image', file: 'a.png', role: 'image' }) } : null,
  };
}
