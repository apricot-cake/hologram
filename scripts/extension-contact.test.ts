// #71: ブリッジが照会・保存のたびに touch する印。拡張機能が一度でも話しかけてきたことを
// アプリが知る唯一の合図でもある（empty/EmptyState.tsx の導入案内の側か、普通の firstRun
// の側か）。ここで見るのは印のパスそのもの (paths.mts) と touch (bridge.mts)。いつ呼ぶかを
// 決める振り分けの輪を端から端まで動かすのは、本物の native messaging の E2E 一式
// (scripts/lib-native-host-e2e.cts) だけで、ここではない。

import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';

let configDir: string;
let extensionContactPath: any;
let touchExtensionContact: any;

beforeAll(async () => {
  configDir = process.env.HOLOGRAM_CONFIG_DIR as string;
  fs.mkdirSync(configDir, { recursive: true });
  ({ extensionContactPath } = await import('../native-host/paths.mts'));
  ({ touchExtensionContact } = await import('../native-host/bridge.mts'));
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
    expect(raw).not.toMatch(/[a-p]{32}/); // 万一漏れ込んだ場合の Chrome 拡張機能の id
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
