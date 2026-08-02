'use strict';

// #236's 2026-07-27 security-review comment, machine-enforced: which
// extensions "開く" may hand to shell.openPath, and which of those also need
// their leading bytes to match a known signature before they're trusted (a
// file can be swapped on disk after collection, so the check that matters
// runs at the moment "開く" is clicked — see app/src/main/lib-open-gate.ts —
// not at import time).
//
// Electron- and better-sqlite3-free (unlike lib-local-intake.ts) on purpose:
// the renderer needs extensionAllowed() too, to label the collected-item
// card's "開く"/"フォルダで表示" button (records.ts) — the same reason
// post-key.mts/tag-normalize.mts live here rather than under app/src/main.
// This module never touches the filesystem itself; matchesMagicBytes takes
// bytes already in hand, so it stays pure like the rest of this file.

import { IMPORTABLE_MEDIA } from './importable-media.mts';

const AUDIO_EXTS = ['mp3', 'wav', 'flac', 'm4a', 'ogg'];
const DOCUMENT_EXTS = ['pdf', 'txt', 'md', 'rtf', 'csv', 'tsv', 'json', 'xml', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub'];
const ARCHIVE_EXTS = ['zip', '7z', 'rar', 'tar', 'gz'];
const CREATIVE_EXTS = ['psd', 'clip', 'kra', 'xcf', 'ai', 'blend', 'sai', 'sai2', 'procreate'];

// The initial allowlist (#236 2026-08-02 comment, §3). Closed-world: an
// extension absent here is refused, full stop — EXPLICITLY_EXCLUDED_EXTS below
// is not consulted by extensionAllowed, it exists only so the regression tests
// can name each excluded extension instead of trusting the allowlist's silence.
export const OPEN_ALLOWLIST = new Set<string>([...IMPORTABLE_MEDIA, ...AUDIO_EXTS, ...DOCUMENT_EXTS, ...ARCHIVE_EXTS, ...CREATIVE_EXTS]);

// Named by the 2026-07-27 security review as formats "開く" must never reach,
// even though nothing here actively blocks them (the allowlist already does,
// by never naming them) — kept as its own list so a regression test can
// assert each one BY NAME stays out, rather than trusting an absence.
export const EXPLICITLY_EXCLUDED_EXTS = [
  'exe',
  'msi',
  'bat',
  'cmd',
  'com',
  'scr',
  'pif',
  'ps1',
  'psm1',
  'js',
  'jse',
  'vbs',
  'vbe',
  'wsf',
  'wsh',
  'hta',
  'reg',
  'lnk',
  'url',
  'scf',
  'inf',
  'cpl',
  'chm',
  'jar',
  'apk',
  // Office macro-enabled formats — excluded by default (2026-07-27 review),
  // distinct from the plain docx/xlsx/pptx/xlsx above.
  'docm',
  'xlsm',
  'pptm',
  'xlsb',
];

const ZIP_CONTAINER_EXTS = new Set(['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'kra', 'procreate']);

// Every extension the 2026-07-27 review named as needing a signature match on
// top of the extension itself. Everything else in OPEN_ALLOWLIST is judged on
// extension alone — unlisted media (webm/mov/m4v/bmp/tiff/svg), audio, rtf,
// and the no-public-spec creative formats (clip/xcf/ai/blend/sai/sai2) per the
// review's own text ("マジックバイトを持たないテキスト系…と、公開仕様の無い
// 制作物形式は拡張子のみで判定する").
export const MAGIC_REQUIRED_EXTS = new Set<string>(['pdf', ...ZIP_CONTAINER_EXTS, '7z', 'rar', 'gz', 'psd', 'png', 'jpg', 'jpeg', 'jfif', 'gif', 'webp', 'avif', 'mp4']);

/**
 * The final extension a judgment acts on: lower-cased, Unicode-normalized
 * (NFC), with trailing whitespace/dots stripped BEFORE the split — so
 * "report.pdf." (a trailing dot) still reads as pdf rather than as
 * no-extension — and a double extension ("report.pdf.exe") reads as its LAST
 * segment only (2026-07-27 review: "二重拡張子を正規化した最終名で判定する").
 */
export function normalizeFinalExt(rawName: string): string {
  let s = String(rawName || '').normalize('NFC');
  s = s.replace(/[.\s]+$/, '');
  const base = s.split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i < 0 ? '' : base.slice(i + 1).toLowerCase();
}

/**
 * Extension-only judgment — fast, no file I/O. What the renderer's "開く" /
 * "フォルダで表示" button label decides itself with (records.ts); the actual
 * gate at click time also requires matchesMagicBytes for MAGIC_REQUIRED_EXTS
 * (app/src/main/lib-open-gate.ts's isOpenAllowed, which reads the file).
 */
export function extensionAllowed(name: string): boolean {
  return OPEN_ALLOWLIST.has(normalizeFinalExt(name));
}

const PK = [0x50, 0x4b, 0x03, 0x04];

// Uint8Array, not Buffer: this module is imported by the renderer too (the
// context menu's button-label judgment), and Buffer's TYPE doesn't exist
// there (no @types/node in that tsconfig) even though a real Buffer — Node's
// Buffer IS a Uint8Array — is what lib-open-gate.ts hands in at runtime.
function startsWithBytes(buf: Uint8Array, sig: number[]): boolean {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}
// Byte-by-byte charCode comparison rather than Buffer.toString('latin1') —
// same Buffer-free reasoning as startsWithBytes above (a plain Uint8Array has
// no decoding `.toString(encoding)` overload).
function asciiAt(buf: Uint8Array, text: string, offset = 0): boolean {
  if (buf.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) if (buf[offset + i] !== text.charCodeAt(i)) return false;
  return true;
}

/**
 * Does `head` (the file's leading bytes — a few dozen is plenty for every
 * signature below) match what `ext` is supposed to carry? Only meaningful for
 * MAGIC_REQUIRED_EXTS — an ext outside that set has no defined signature here,
 * so a caller reaching this for one is a caller that skipped the ext gate
 * (isOpenAllowed always checks MAGIC_REQUIRED_EXTS.has(ext) first).
 */
export function matchesMagicBytes(ext: string, head: Uint8Array): boolean {
  if (ext === 'pdf') return asciiAt(head, '%PDF-');
  if (ZIP_CONTAINER_EXTS.has(ext)) return startsWithBytes(head, PK);
  if (ext === '7z') return startsWithBytes(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);
  // Both the v1.5-4.0 and v5 RAR signatures share this 6-byte prefix.
  if (ext === 'rar') return startsWithBytes(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]);
  if (ext === 'gz') return startsWithBytes(head, [0x1f, 0x8b]);
  if (ext === 'psd') return asciiAt(head, '8BPS');
  if (ext === 'png') return startsWithBytes(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (ext === 'jpg' || ext === 'jpeg' || ext === 'jfif') return startsWithBytes(head, [0xff, 0xd8, 0xff]);
  if (ext === 'gif') return asciiAt(head, 'GIF87a') || asciiAt(head, 'GIF89a');
  if (ext === 'webp') return asciiAt(head, 'RIFF') && asciiAt(head, 'WEBP', 8);
  // ISO base media file format (both mp4 and avif): a 4-byte size then 'ftyp'.
  if (ext === 'avif' || ext === 'mp4') return asciiAt(head, 'ftyp', 4);
  return true;
}
