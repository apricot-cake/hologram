'use strict';

// #50's index job kind: the piece that joins lib-ai-tags.ts's arithmetic to the
// three facilities #98 already built, and adds nothing of its own.
//
//   input   <- the index queue's thumbnail-cache raster (#834 / lib-index-jobs.ts)
//   compute <- the inference child's bare-session口 (#831 / lib-ml-runtime.ts)
//   output  <- derived.db, never hologram.db (#833 / lib-derived-db.ts)
//   gate    <- requiresModel: true, i.e. #830's opt-in, which is NOT re-checked here
//
// Nothing in this file writes a tag. The candidates it stores are read by the
// suggestion UI and become real tags only when the user adopts one, through the
// same tag-writing path a typed tag goes through — #98's transparency rule, and
// the reason this feature can be removed entirely without the library changing.

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

/** derived_progress.jobKind — stable across any rename of this module. */
export const AI_TAGS_JOB_ID = 'ai-tags';
export const AI_TAGS_MODEL_ID = 'SmilingWolf/wd-vit-tagger-v3';

const GRAPH_FILE = 'model.onnx';
const LABEL_FILE = 'selected_tags.csv';
const GRAPH_INPUT = 'input';
const GRAPH_OUTPUT = 'output';
// A still image whose ORIGINAL is bigger than this never gets a thumbnail made
// for it, so it never gets tagged either. Generous: the cost that matters is
// the decode, and the decode is the thumbnail cache's, not ours.
const MAX_INPUT_BYTES = 64 * 1024 * 1024;

function entry() {
  const e = findModelEntry(AI_TAGS_MODEL_ID);
  if (!e) throw new Error(`${AI_TAGS_MODEL_ID} is not in the model registry`);
  return e;
}

function modelDir(): string {
  return modelDirFor(entry(), modelsRoot());
}

// --- Channel order ---
//
// #50's design asks for the byte order of nativeImage.toBitmap() to be pinned
// rather than assumed, because Electron documents it as platform-dependent.
// Measuring it at startup is strictly stronger than pinning a constant: a
// platform (or an Electron release) that disagrees is then simply handled,
// instead of producing confident scores for an image whose red and blue are
// swapped — a failure with no visible symptom.
//
// The probe is a 1x1 opaque PURE RED PNG. Red is the one colour that tells the
// two candidate orders apart in a single byte: RGBA puts 255 first, BGRA puts
// it third. scripts/test-app-ai-tags.cts checks the probe's verdict against the
// same image read independently.
const RED_1X1_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==', 'base64');

let channelOrder: BitmapChannelOrder | null = null;

export function detectBitmapChannelOrder(): BitmapChannelOrder {
  if (channelOrder) return channelOrder;
  const bytes = nativeImage.createFromBuffer(RED_1X1_PNG).toBitmap();
  if (bytes.length < 4) throw new Error('the channel-order probe did not decode');
  // Exact equality, not "whichever is larger": a decode that produced neither a
  // clean 255 nor a clean 0 is not a channel-order question, it is a broken
  // decoder, and guessing would bury that.
  if (bytes[0] === 255 && bytes[2] === 0) channelOrder = 'rgba';
  else if (bytes[2] === 255 && bytes[0] === 0) channelOrder = 'bgra';
  else throw new Error(`the channel-order probe decoded to [${bytes[0]}, ${bytes[1]}, ${bytes[2]}, ${bytes[3]}], which is neither RGBA nor BGRA red`);
  log.info('[ai-tags] bitmap channel order', { order: channelOrder });
  return channelOrder;
}

// --- Preprocessing ---

/**
 * Encoded image bytes -> the graph's input tensor. In production these are
 * always the thumbnail cache's JPEG; the harness feeds it a PNG.
 *
 * Both steps are deliberately someone else's: nativeImage is the decoder and
 * resampler the grid already uses, so a tagged picture is exactly the picture
 * the user sees. #50 rejected pulling in sharp for this — a third native
 * dependency to do a job the app already does.
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

// --- Vocabulary ---
//
// Held for the life of the process once read: 10,861 short strings, and the
// file cannot change under us because its hash is pinned to the graph's
// revision. Dropped when the model is deleted so a re-download re-reads it.

let vocabulary: TagVocabulary | null = null;

function loadVocabulary(): TagVocabulary {
  if (vocabulary) return vocabulary;
  vocabulary = parseSelectedTags(fs.readFileSync(path.join(modelDir(), LABEL_FILE), 'utf8'));
  return vocabulary;
}

// --- Model availability ---
//
// accepts() has to answer without touching the disk (the queue calls it once
// per asset per kind, per scan), so the answer is cached and refreshed by the
// events that can change it: a finished download and a deletion.
//
// Refusing in accepts() rather than failing in run() is the difference between
// "not a candidate" and "a candidate that always fails": the queue writes no
// progress row for a failed run, so the latter would re-plan the whole library
// on every backfill and get nowhere.

let modelPresent = false;

/**
 * Re-reads whether the tagger is on disk. Returns true if it became available,
 * which is the caller's cue that the whole library needs re-planning.
 */
export function refreshAiTagsModelState(): boolean {
  let present = false;
  try {
    present = getModelStatus(AI_TAGS_MODEL_ID).state === 'complete';
  } catch {
    present = false; // no registry entry, no models root — either way, not usable
  }
  const becameAvailable = present && !modelPresent;
  if (!present) vocabulary = null;
  modelPresent = present;
  return becameAvailable;
}

/**
 * The whole reaction to the model appearing or disappearing, in one call for
 * ipc-model.ts to make after a download or a delete.
 *
 * Deleting the model is not "pause": #50 says the candidates go away with it.
 * The model IS the feature's switch — there is no second on/off setting to keep
 * in agreement with it.
 */
export function onAiTagsModelChanged(): void {
  const becameAvailable = refreshAiTagsModelState();
  if (becameAvailable) {
    // Records skipped while the model was missing left no trace (by design), so
    // only a full walk can find them again.
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

// --- The job kind ---

function accepts(asset: IndexAsset): boolean {
  return modelPresent && asset.role === 'image' && isViewerImageName(asset.file);
}

/**
 * One image's worth of inference: bytes in, candidates out, nothing stored.
 *
 * Separate from run() so the acceptance check can drive the REAL path rather
 * than a copy of it (scripts/test-ai-tags-model.cts) — the preprocessing is the
 * part worth checking against the model author's reference, and a check that
 * reimplements it proves nothing.
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

/** Registers the kind and takes the first reading of whether the model is here. */
export function registerAiTagsJob(): void {
  refreshAiTagsModelState();
  registerIndexJobKind({
    id: AI_TAGS_JOB_ID,
    inputKind: 'rasterImage',
    // Both left at the queue's defaults ('thumbCache', 512) rather than restated:
    // riding the grid's own cache is the point, and a width of our own would
    // make every tile the user has already seen get decoded a second time.
    requiresModel: true,
    maxSegments: 1, // a still image is one segment; there is no "rest of it"
    maxInputBytes: MAX_INPUT_BYTES,
    accepts,
    run,
  });
}
