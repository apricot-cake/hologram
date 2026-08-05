'use strict';

// The parts of #50 that are only TRUE STATEMENTS about the real app, driven by
// scripts/test-app-ai-tags.cts. Same arrangement as ml-smoke.ts, for the same
// reason: nativeImage is Electron's decoder, and a standalone script that
// imports the same module would be measuring something else.
//
// Two claims are checked here, and neither can be checked in Vitest:
//
//   1. Which byte order nativeImage.toBitmap() hands back. Electron documents
//      it as platform-dependent, so lib-ai-tags-job.ts measures it with a
//      known-colour probe; this reports both the probe's verdict AND the raw
//      bytes of an independent image, so the harness can check the verdict
//      against evidence rather than against itself.
//   2. That decode -> resize -> letterbox produces the tensor the model was
//      trained on, through the real image stack rather than a hand-made bitmap.
//
// Reachable only from the HOLOGRAM_SMOKE branch of index.ts.

import { nativeImage } from 'electron';

import fs from 'node:fs';

import { AI_TAGS_JOB_ID, detectBitmapChannelOrder, preprocessToTensor, registerAiTagsJob, tagImageBytes } from './lib-ai-tags-job.ts';
import { TAGGER_INPUT_SIZE } from './lib-ai-tags.ts';
import { registeredIndexJobKinds } from './lib-index-queue.ts';

// 1x1 opaque PURE BLUE. Independent of the probe's red: if the reported order
// is right, blue's 255 sits at the byte red's 255 did NOT.
const BLUE_1X1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/5ncLrgAAAABJRU5ErkJggg==', 'base64');
// 2x1: left half pure red, right half pure blue. Wide enough that after the
// long edge is scaled to 448 the two halves are hundreds of pixels of flat
// colour, so a sample taken away from the seam is unaffected by resampling.
const RED_BLUE_2X1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGP4z8AAQv8BD/kD/YURmXYAAAAASUVORK5CYII=', 'base64');

export interface AiTagsSmokeReport {
  /** What lib-ai-tags-job.ts's probe concluded. */
  channelOrder: string;
  /** Raw toBitmap() bytes of an opaque blue pixel — the evidence, not the conclusion. */
  bluePixel: number[];
  /** [B, G, R] sampled from the left (red) and right (blue) halves, plus a corner of the padding. */
  leftHalf: number[];
  rightHalf: number[];
  corner: number[];
  tensorLength: number;
  /** The registered job kind's declaration, and whether it wants an asset with no model on disk. */
  jobKind: { id: string; requiresModel: boolean; maxSegments: number; acceptsWithoutModel: boolean } | null;
}

export interface AiTagsModelSmokeReport {
  image: string;
  /** Length of the graph's output — must equal the label file's row count. */
  scoreCount: number;
  /** Candidates above threshold, strongest first. */
  tags: Array<{ name: string; category: number; score: number }>;
  ratings: Array<{ name: string; score: number }>;
  /** Highest score anywhere in the output. Above 1 would mean an activation is missing. */
  maxScore: number;
  minScore: number;
  ms: number;
}

/**
 * Real inference over the REAL production path, for
 * scripts/test-ai-tags-model.cts. Needs the model on disk, so it is never part
 * of the offline harness.
 *
 * Sequential rather than concurrent: the second image is also what shows the
 * session is being reused rather than rebuilt (`ms` collapses).
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
  // A 2x1 source becomes 448x224 centred at top = 112, so row 224 is inside the
  // picture and row 0 is padding.
  //
  // Registered here because the smoke build never starts the index queue (which
  // is what registers it in a real session); re-registering an id replaces it,
  // so this is safe either way.
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
