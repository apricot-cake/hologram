'use strict';

// What an index job kind IS, and the two decisions the queue makes about one
// (#834, parent #98): "should this job run on this record?" (planRecord) and
// "can its input be produced?" (resolveInput).
//
// #834 builds the vessel only. What a job COMPUTES — colour (#48), OCR / text
// extraction (#49), AI tags (#50), visual-search embeddings (#51) — and the
// default value of each kind's maxSegments belong to those Issues; nothing here
// knows what any of them produce.
//
// The two rules #98's 2026-08-02 comment settled, both encoded below:
//
//   1. The target set is NOT cut by assetClass. A job kind declares the input it
//      needs (inputKind) and the queue runs it wherever that input can be
//      produced. #236's two display tiers are a PRESENTATION distinction, not an
//      indexing one — a collected file is the main subject of content
//      extraction, not an exception to it.
//   2. The opt-in gate hangs on requiresModel, not on the queue. A parser is not
//      a model: making PDF text extraction wait for the AI opt-in would force
//      consent for something no model touches, which inverts the point of the
//      consent (§1-2 of that comment).
//
// This module has no ラスタライザ of its own and never will (#98 §2): a still
// image's raster comes from the thumbnail cache or the original, and a PDF page's
// will come from #740's rendering facility. resolveInput takes those as injected
// dependencies, which is also what keeps this module Electron-free and directly
// unit-testable.

/** The input shapes a job kind can ask for. #98 §1 fixes v1 at these two. */
export type IndexInputKind = 'rasterImage' | 'sourceBytes';

/**
 * Where a `rasterImage` comes from. #98's 3項: visual jobs read the thumbnail
 * cache, OCR reads the original. A third value ('pageRender') is what #740 adds
 * for PDF pages — one branch in resolveInput, which is the whole reason the口
 * is defined here rather than inlined into a feature.
 */
export type RasterSource = 'thumbCache' | 'original';

/** #833's assetRef convention: which file of a record a derived row is about. */
export type IndexAssetRole = 'image' | 'video' | 'file';

export interface IndexAsset {
  /** 'image' | 'video' | 'file' | `media[<seq>]` — goes into derived_progress.assetRef. */
  ref: string;
  /** The library-relative filename, as stored on the record. */
  file: string;
  role: IndexAssetRole;
}

/** The slice of a posts row the planner reads. Nothing else is needed to decide. */
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

/** What a job kind reports back, so the queue can write the shared progress row. */
export interface IndexJobResult {
  indexedSegments: number;
  totalSegments: number;
  /** Stamped onto derived_progress; both null for a job that used no model. */
  modelId?: string | null;
  modelRev?: string | null;
}

export interface IndexJobKind {
  /** Stable id — it is the derived_progress.jobKind value, so it outlives a rename. */
  id: string;
  inputKind: IndexInputKind;
  /**
   * Whether this kind loads a model. The ONLY thing #830's opt-in gates
   * (#98 §1-2): true = nothing is queued until AI features are enabled.
   */
  requiresModel: boolean;
  /** rasterImage only. Defaults to 'thumbCache' (the cheap path #98's 3項 makes the default). */
  rasterSource?: RasterSource;
  /** rasterSource:'thumbCache' only — the short edge to ask the cache for. */
  rasterWidth?: number;
  /**
   * How many segments of ONE asset this kind will do before stopping (OCR's "first
   * N pages"). The remainder stays as indexedSegments < totalSegments and is NOT
   * retried automatically — a user action asks for the rest (#98 §4; paperless-ngx's
   * PAPERLESS_OCR_PAGES is the same shape).
   */
  maxSegments: number;
  /** Inputs above this many bytes are not produced at all. */
  maxInputBytes: number;
  /** Does this kind want this asset? (extension/role test — no I/O.) */
  accepts(asset: IndexAsset): boolean;
  run(input: ResolvedInput, ctx: IndexJobContext): Promise<IndexJobResult>;
}

export interface IndexJobContext {
  record: IndexRecord;
  asset: IndexAsset;
  /** Segments already done for this asset — a resumed job starts here, not at 0. */
  fromSegment: number;
}

// Archives are excluded outright, at the asset level, for every kind (#98 §1's
// "索引しないもの"): a background sweep that unpacks zip/7z/rar/tar hands zip
// bombs and path traversal an automatic, unattended entry point. #236 gated
// "open" behind an allow-list for the same reason. Doing it here rather than in
// each kind's accepts() means a future kind cannot forget.
const ARCHIVE_EXTS = new Set(['.zip', '.7z', '.rar', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.cbz', '.cbr']);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

export function isArchiveName(name: string): boolean {
  return ARCHIVE_EXTS.has(extOf(name));
}

/**
 * Every indexable file a record points at, in #833's assetRef vocabulary.
 * media[] entries come after the singular ones so a record's own primary image
 * is always visited first.
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
  /** In the trash — #98 §1 excludes these; the record may still come back. */
  | 'trashed'
  /** requiresModel:true while the #830 opt-in is off. */
  | 'ai-disabled'
  | 'archive'
  /** No kind wants this asset (wrong role or extension). */
  | 'unaccepted'
  /** indexedSegments >= totalSegments — nothing left to do. */
  | 'complete'
  /** Stopped at the kind's maxSegments; only an explicit request continues it. */
  | 'capped';

export interface IndexCandidate {
  record: IndexRecord;
  asset: IndexAsset;
  jobKind: string;
  /** Where a resumed run picks up (derived_progress.indexedSegments). */
  fromSegment: number;
}

export interface IndexSkip extends IndexCandidate {
  reason: IndexSkipReason;
}

export interface IndexPlanEnv {
  /** #830's flag. Read per plan, not cached — toggling it re-plans. */
  aiEnabled: boolean;
  progressOf(captureId: string, assetRef: string, jobKind: string): IndexProgressRow | undefined;
  /** The user asking for "index the rest of this file" — lets 'capped' through. */
  includeCapped?: boolean;
}

/**
 * The decision table: one record × the registered kinds → what to run.
 *
 * Pure and I/O-free on purpose — this is the half of "入力を作れるレコードだけ実行
 * する" that can be decided from the row alone, and it is the half worth pinning in
 * unit tests. The other half (missing/empty/oversize files) needs the filesystem
 * and lives in resolveInput, which reports the same kind of refusal.
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
    // Held at the cap rather than interrupted: re-queueing this on every backfill
    // would spend the whole budget re-deciding not to do it. An interrupted run
    // (indexedSegments below BOTH the cap and the total) falls through and resumes,
    // which is what makes the backfill resumable without a second progress store.
    if (progress.indexedSegments >= kind.maxSegments && !env.includeCapped) return 'capped';
  }
  return null;
}

export interface ResolvedInput {
  kind: IndexInputKind;
  /** 0 for anything single-part; a PDF page number once #740 lands. */
  segment: number;
  bytes: Buffer;
  /** The absolute path the bytes came from — for logging and provenance. */
  source: string;
}

export type ResolveFailure =
  /** Not in the library any more, or a name that would escape the save folder. */
  | 'missing'
  | 'empty'
  | 'too-large'
  /** The raster provider could not decode it (corrupt, or a format nothing reads). */
  | 'undecodable';

export type ResolveResult = { ok: true; input: ResolvedInput } | { ok: false; reason: ResolveFailure };

export interface ResolveInputDeps {
  /** Absolute path for a library-relative name, or null if it would escape the folder. */
  resolveInFolder(name: string): string | null;
  stat(absPath: string): Promise<{ size: number } | null>;
  readFile(absPath: string): Promise<Buffer>;
  /** JPEG bytes downscaled to short edge `width`, or null. lib-thumbnails.ts's cache. */
  thumbnail(absPath: string, width: number): Promise<Buffer | null>;
}

/** Default short edge for a thumbCache raster — the grid's own largest tile request. */
const DEFAULT_RASTER_WIDTH = 512;

/**
 * Produces a job kind's input for one asset, or says why it could not. The size
 * and emptiness checks happen against the stat, BEFORE any read, so an oversized
 * file is never pulled into memory just to be rejected (#98 §4's input-size cap).
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
  // 'sourceBytes', and 'rasterImage' at rasterSource:'original' (OCR), are the
  // same read — the difference is what the job does with it, not where it comes
  // from. Splitting them at the input level would be a distinction with no
  // behaviour behind it.
  const bytes = await deps.readFile(absPath);
  if (bytes.length === 0) return { ok: false, reason: 'empty' };
  return { ok: true, input: { kind: kind.inputKind, segment, bytes, source: absPath } };
}

/** The key a candidate is deduplicated by — one job per (record, asset, kind). */
export function candidateKey(c: IndexCandidate): string {
  return `${c.record.captureId} ${c.asset.ref} ${c.jobKind}`;
}
