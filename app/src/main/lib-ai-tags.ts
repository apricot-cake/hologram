'use strict';

// Everything about the tag model (#50) that is arithmetic rather than I/O:
// reading its label file, shaping an image into the tensor it wants, and
// turning its 10,861 raw scores back into candidate tags.
//
// Electron-free and side-effect-free on purpose. The two things that CANNOT be
// decided here — how a JPEG becomes pixels, and how a graph is run — are the
// two things this Issue's design says must not be reinvented (nativeImage and
// the #831 runtime respectively); lib-ai-tags-job.ts joins them to this.
//
// The arithmetic is not ours to choose: it reproduces the model author's own
// reference implementation (the `SmilingWolf/wd-tagger` Space), because the
// weights were trained against exactly that preprocessing. Where this file
// deviates it says so and says why.

/** Side of the square tensor the graph declares: input `input` is [batch, 448, 448, 3]. */
export const TAGGER_INPUT_SIZE = 448;

/**
 * The reference implementation's own defaults. Deliberately NOT a setting
 * (2026-07-11): a number the user cannot interpret is not a control, it is a
 * dial that makes the feature feel broken at both ends. Tuning these against a
 * real library is #50 §10's remaining measurement, and it moves these constants.
 */
export const TAGGER_THRESHOLDS = { general: 0.35, character: 0.85 } as const;

/** selected_tags.csv's `category` column. */
export const TAG_CATEGORY = { general: 0, copyright: 3, character: 4, rating: 9 } as const;

export interface TagVocabulary {
  /** Display-normalised names, in graph output order. */
  names: string[];
  /** selected_tags.csv's category column, same order. */
  categories: number[];
}

export interface AiTagCandidate {
  name: string;
  category: number;
  score: number;
}

export interface TaggerOutput {
  /** Above threshold, strongest first. Ratings are NOT in here. */
  tags: AiTagCandidate[];
  /** Every rating label with its score — recorded, never shown (2026-07-11). */
  ratings: AiTagCandidate[];
}

// Tags that are drawings of a face rather than words. The reference
// implementation keeps their underscores for the obvious reason: `^_^` with the
// underscore replaced is not the same tag, it is a shrug.
const KAOMOJI = new Set(['0_0', '(o)_(o)', '+_+', '+_-', '._.', '<o>_<o>', '<|>_<|>', '=_=', '>_<', '3_3', '6_9', '>_o', '@_@', '^_^', 'o_o', 'u_u', 'x_x', '|_|', '||_||']);

/** `hair_ornament` -> `hair ornament`, but `^_^` -> `^_^`. */
export function normalizeTagName(raw: string): string {
  return KAOMOJI.has(raw) ? raw : raw.replace(/_/g, ' ');
}

/**
 * One line of RFC 4180 CSV. Written out rather than split(',') because the
 * label file really does contain a quoted field with doubled quotes inside it
 * (`don't_say_""lazy""`), and a naive split would shift that row's category and
 * silently mislabel a tag.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (line[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      fields.push(field);
      field = '';
    } else field += c;
  }
  fields.push(field);
  return fields;
}

/**
 * Reads selected_tags.csv into graph-output order.
 *
 * Row order IS the output order — index i of the graph's 10,861 scores is row i
 * of this file. That is why the file is pinned and hashed alongside the weights
 * (lib-model-registry.ts): a file from a different revision would not fail, it
 * would rename every tag.
 */
export function parseSelectedTags(csv: string): TagVocabulary {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) throw new Error('selected_tags.csv is empty');
  const header = parseCsvLine(lines[0]);
  const nameCol = header.indexOf('name');
  const categoryCol = header.indexOf('category');
  if (nameCol < 0 || categoryCol < 0) throw new Error('selected_tags.csv has no name/category columns');

  const names: string[] = [];
  const categories: number[] = [];
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    names.push(normalizeTagName(fields[nameCol]));
    categories.push(Number(fields[categoryCol]));
  }
  return { names, categories };
}

/** How nativeImage hands back raw pixels. Platform-dependent, so it is measured, not assumed. */
export type BitmapChannelOrder = 'rgba' | 'bgra';

/**
 * The size to scale an image to before letterboxing: long edge exactly `size`,
 * aspect preserved, never zero.
 *
 * The reference implementation pads first and resizes the square afterwards.
 * Doing it the other way round is the same picture — the only difference is
 * that bicubic no longer blends a hairline of the white border into the outer
 * pixels — and it is the difference between allocating 448x448 and allocating
 * the square of a 512-short-edge thumbnail, which for a tall image is hundreds
 * of megabytes.
 */
export function fitLongEdge(width: number, height: number, size = TAGGER_INPUT_SIZE): { width: number; height: number } {
  const scale = size / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Centre a decoded bitmap on a white square and emit the graph's tensor:
 * NHWC [1, size, size, 3], BGR, 0-255, unnormalised.
 *
 * All four of those are the model's requirements rather than conventions —
 * getting any of them wrong produces plausible-looking scores for the wrong
 * picture, which is exactly the failure a standard image processor would have
 * given us silently (#50 §0-2).
 */
export function letterboxToTaggerInput(bitmap: Uint8Array, width: number, height: number, order: BitmapChannelOrder, size = TAGGER_INPUT_SIZE): Float32Array {
  if (width > size || height > size) throw new Error(`bitmap ${width}x${height} does not fit in ${size}x${size}`);
  if (bitmap.length < width * height * 4) throw new Error(`bitmap is ${bitmap.length} bytes, expected ${width * height * 4}`);

  const out = new Float32Array(size * size * 3).fill(255); // the padding IS white, not black
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  const [bIn, gIn, rIn] = order === 'bgra' ? [0, 1, 2] : [2, 1, 0];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = ((top + y) * size + (left + x)) * 3;
      // Composite over white rather than dropping alpha. A thumbnail-cache JPEG
      // is already opaque so this is the identity there, but the function is
      // also what an RGBA source would go through, and the reference
      // implementation composites over white before anything else.
      const a = bitmap[s + 3] / 255;
      out[d] = bitmap[s + bIn] * a + 255 * (1 - a);
      out[d + 1] = bitmap[s + gIn] * a + 255 * (1 - a);
      out[d + 2] = bitmap[s + rIn] * a + 255 * (1 - a);
    }
  }
  return out;
}

/**
 * Raw graph output -> candidates.
 *
 * No activation function is applied. The sigmoid is inside the ONNX graph, so
 * these numbers are already per-tag probabilities — which is also why the
 * transformers.js image-classification pipeline could not be used: it applies a
 * softmax across all 10,861 classes unconditionally, and this is a multi-label
 * model where the classes are independent.
 */
export function decodeTaggerOutput(scores: ArrayLike<number>, vocab: TagVocabulary, thresholds = TAGGER_THRESHOLDS): TaggerOutput {
  if (scores.length !== vocab.names.length) {
    throw new Error(`model produced ${scores.length} scores but the label file has ${vocab.names.length} rows`);
  }
  const tags: AiTagCandidate[] = [];
  const ratings: AiTagCandidate[] = [];
  for (let i = 0; i < scores.length; i++) {
    const category = vocab.categories[i];
    const candidate = { name: vocab.names[i], category, score: scores[i] };
    if (category === TAG_CATEGORY.rating) {
      ratings.push(candidate);
      continue;
    }
    // copyright shares the character threshold: both are proper nouns, where a
    // near-miss is a wrong claim about what a picture depicts rather than a
    // vague one. (This revision's vocabulary happens to contain no copyright
    // rows at all — 8106 general, 2751 character, 4 rating — so the branch is
    // here for the schema's sake, not for this model's output.)
    const threshold = category === TAG_CATEGORY.general ? thresholds.general : thresholds.character;
    if (candidate.score >= threshold) tags.push(candidate);
  }
  tags.sort((a, b) => b.score - a.score);
  ratings.sort((a, b) => b.score - a.score);
  return { tags, ratings };
}
