// #71: the marker the bridge touches on every check/save, and the ONLY signal
// the app has that the extension has ever talked to it (empty/EmptyState.tsx's
// install-guide variant vs. the ordinary firstRun one). Covers the marker path
// itself (paths.cts) and the touch (bridge.cts) — the dispatch loop that decides
// WHEN to call it is exercised end-to-end only by the real native-messaging E2E
// suite (scripts/lib-native-host-e2e.cts), not here.

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

let configDir: string;
let extensionContactPath: any;
let touchExtensionContact: any;

beforeAll(async () => {
  configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  fs.mkdirSync(configDir, { recursive: true });
  ({ extensionContactPath } = await import('../native-host/paths.cts'));
  ({ touchExtensionContact } = await import('../native-host/bridge.cts'));
});

describe('拡張コンタクトのマーカー（#71）', () => {
  test('コンタクト前はファイルが無い', () => {
    fs.rmSync(extensionContactPath(), { force: true });
    expect(fs.existsSync(extensionContactPath())).toBe(false);
  });

  test('touch するとファイルができる', () => {
    touchExtensionContact();
    expect(fs.existsSync(extensionContactPath())).toBe(true);
  });

  test('中身は時刻の文字列のみ（拡張ID・URL等は書かない）', () => {
    const raw = fs.readFileSync(extensionContactPath(), 'utf8');
    expect(Number.isNaN(Date.parse(raw))).toBe(false);
    expect(raw).not.toMatch(/[a-p]{32}/); // a Chrome extension id, if one leaked in
  });

  test('configDir が無くても throw しない（mkdir から自前でやる）', () => {
    const nested = path.join(configDir, 'fresh-subdir-for-this-test');
    fs.rmSync(nested, { recursive: true, force: true });
    const prevEnv = process.env.HOLOGRAM_CONFIG_DIR;
    process.env.HOLOGRAM_CONFIG_DIR = nested;
    try {
      expect(() => touchExtensionContact()).not.toThrow();
    } finally {
      process.env.HOLOGRAM_CONFIG_DIR = prevEnv;
    }
  });
});
