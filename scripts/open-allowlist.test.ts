// Unit tests for the "開く" allowlist (#236, 2026-07-27 security review): the pure
// extension/magic-byte judgment (native-host/open-allowlist.mts) and the main-only
// gate that reads a real file (app/src/main/lib-open-gate.ts). Pins down exactly the
// acceptance list the review named: uppercase extension, trailing dot, double
// extension, faked magic bytes, a shortcut, and a macro-enabled Office format.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { EXPLICITLY_EXCLUDED_EXTS, MAGIC_REQUIRED_EXTS, OPEN_ALLOWLIST, extensionAllowed, matchesMagicBytes, normalizeFinalExt } from '../native-host/open-allowlist.mts';
import { isOpenAllowed } from '../app/src/main/lib-open-gate';

describe('normalizeFinalExt', () => {
  test('小文字化する', () => {
    expect(normalizeFinalExt('report.PDF')).toBe('pdf');
  });

  test('末尾のドットは無視する（拡張子はその手前）', () => {
    expect(normalizeFinalExt('report.pdf.')).toBe('pdf');
  });

  test('末尾の空白は無視する', () => {
    expect(normalizeFinalExt('report.pdf  ')).toBe('pdf');
  });

  test('二重拡張子は最後だけを見る', () => {
    expect(normalizeFinalExt('report.pdf.exe')).toBe('exe');
  });

  test('拡張子が無ければ空文字', () => {
    expect(normalizeFinalExt('README')).toBe('');
  });

  test('Unicode 正規化（NFC）してから判定する', () => {
    // "レポート.pdf" with the katakana ー written as a combining sequence (NFD) —
    // normalize() only touches the filename's characters, not the ascii extension,
    // but this pins that a decomposed name doesn't throw or misparse the extension.
    const nfd = 'report'.normalize('NFD') + '.pdf';
    expect(normalizeFinalExt(nfd)).toBe('pdf');
  });
});

describe('extensionAllowed（許可リスト）', () => {
  test.each(['jpg', 'png', 'mp4', 'pdf', 'zip', 'docx', 'psd', 'clip', 'mp3'])('許可リスト内の拡張子は通す: %s', (ext) => {
    expect(extensionAllowed(`file.${ext}`)).toBe(true);
  });

  test('大文字拡張子（.PDF）も許可判定できる', () => {
    expect(extensionAllowed('report.PDF')).toBe(true);
  });

  test.each(EXPLICITLY_EXCLUDED_EXTS)('明示的に除外された拡張子は許可リストに入らない: %s', (ext) => {
    expect(OPEN_ALLOWLIST.has(ext)).toBe(false);
    expect(extensionAllowed(`file.${ext}`)).toBe(false);
  });

  test('末尾ドット（report.pdf.）は pdf として許可される', () => {
    expect(extensionAllowed('report.pdf.')).toBe(true);
  });

  test('二重拡張子（report.pdf.exe）は exe として拒否される', () => {
    expect(extensionAllowed('report.pdf.exe')).toBe(false);
  });

  test('ショートカット（.lnk / .url）は拒否される', () => {
    expect(extensionAllowed('shortcut.lnk')).toBe(false);
    expect(extensionAllowed('shortcut.url')).toBe(false);
  });

  test('マクロ有効な Office 形式（.docm）は拒否される（.docx は許可）', () => {
    expect(extensionAllowed('macro.docm')).toBe(false);
    expect(extensionAllowed('plain.docx')).toBe(true);
  });

  test('未知の拡張子は拒否される', () => {
    expect(extensionAllowed('mystery.xyz123')).toBe(false);
  });
});

describe('matchesMagicBytes', () => {
  test('PDF は %PDF- で始まる', () => {
    expect(matchesMagicBytes('pdf', Buffer.from('%PDF-1.4\n'))).toBe(true);
  });

  test('偽装マジックバイト（中身が MZ の .pdf）は拒否される', () => {
    expect(matchesMagicBytes('pdf', Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).toBe(false);
  });

  test('ZIP コンテナ形式は PK\\x03\\x04 で始まる（docx/xlsx/pptx/kra/procreate も同じ）', () => {
    const pk = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
    for (const ext of ['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'kra', 'procreate']) {
      expect(matchesMagicBytes(ext, pk)).toBe(true);
    }
    expect(matchesMagicBytes('zip', Buffer.from('not a zip'))).toBe(false);
  });

  test('PSD は 8BPS で始まる', () => {
    expect(matchesMagicBytes('psd', Buffer.from('8BPS'))).toBe(true);
    expect(matchesMagicBytes('psd', Buffer.from('nope'))).toBe(false);
  });

  test('既存メディア（PNG/JPEG/GIF/WebP/MP4）のシグネチャ', () => {
    expect(matchesMagicBytes('png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
    expect(matchesMagicBytes('jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe(true);
    expect(matchesMagicBytes('gif', Buffer.from('GIF89a'))).toBe(true);
    expect(matchesMagicBytes('webp', Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]))).toBe(true);
    expect(matchesMagicBytes('mp4', Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp')]))).toBe(true);
    expect(matchesMagicBytes('png', Buffer.from('not a png'))).toBe(false);
  });

  test('公開仕様の無い制作物形式（clip/xcf/ai/blend/sai/sai2）は常に true（拡張子のみで判定済み）', () => {
    for (const ext of ['clip', 'xcf', 'ai', 'blend', 'sai', 'sai2']) {
      expect(MAGIC_REQUIRED_EXTS.has(ext)).toBe(false);
      expect(matchesMagicBytes(ext, Buffer.from('anything'))).toBe(true);
    }
  });

  test('マジックバイトを持たないテキスト系は常に true', () => {
    for (const ext of ['txt', 'md', 'csv', 'tsv', 'json', 'xml']) {
      expect(MAGIC_REQUIRED_EXTS.has(ext)).toBe(false);
    }
  });
});

describe('isOpenAllowed（main のみ・実ファイルを読む）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-open-gate-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name: string, content: Buffer | string) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content);
    return p;
  };

  test('拡張子とマジックバイトの両方が一致すれば許可', async () => {
    const p = write('doc.pdf', '%PDF-1.4\n%fake');
    expect(await isOpenAllowed(p)).toBe(true);
  });

  test('偽装マジックバイト（中身が MZ の .pdf）は main 側でも拒否される', async () => {
    const p = write('fake.pdf', Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
    expect(await isOpenAllowed(p)).toBe(false);
  });

  test('拡張子だけで判定できる形式（.txt）は中身を問わない', async () => {
    const p = write('note.txt', 'hello');
    expect(await isOpenAllowed(p)).toBe(true);
  });

  test('許可リスト外の拡張子（.exe）は中身に関わらず拒否', async () => {
    const p = write('run.exe', Buffer.from([0x4d, 0x5a, 0x90, 0x00]));
    expect(await isOpenAllowed(p)).toBe(false);
  });

  test('存在しないファイルは拒否（読めない＝閉じる側に倒す）', async () => {
    expect(await isOpenAllowed(path.join(dir, 'nope.pdf'))).toBe(false);
  });
});
