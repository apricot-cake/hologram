import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'open-dev-profile.cts'), 'utf8');

describe('開発用Chromeプロファイルの CDP 起動', () => {
  test('CDP の接続先をローカル固定で定めている', () => {
    expect(source).toMatch(/const CDP_ADDRESS = '127\.0\.0\.1';/);
    expect(source).toMatch(/const CDP_PORT = 9223;/);
  });

  test('CDP は明示的に許可した場合だけ専用プロファイルと同時に起動する', () => {
    expect(source).toContain("const CDP_ENABLED = process.env.HOLOGRAM_EXTENSION_UNSAFE_CDP === '1'");
    expect(source).toContain('--user-data-dir=$' + '{PROFILE}');
    expect(source).toContain('...(CDP_ENABLED ? [`--remote-debugging-address=$' + '{CDP_ADDRESS}`, `--remote-debugging-port=$' + '{CDP_PORT}`] : [])');
  });

  test('背面でも描画とタイマーを維持する', () => {
    expect(source).toContain('--disable-backgrounding-occluded-windows');
    expect(source).toContain('--disable-background-timer-throttling');
    expect(source).toContain('--disable-renderer-backgrounding');
  });

  test('起動成功を CDP の応答で確認する', () => {
    expect(source).toContain('await cdpReady(CDP_URL)');
    expect(source).toContain('await waitFor(`開発用Chromeの CDP が $' + '{CDP_ADDRESS}:$' + '{CDP_PORT} で応答すること`');
  });

  test('日常用と同じリリースビルドを読み込み、開発用 Native Host を選ぶ', () => {
    expect(source).toContain("path.join(ROOT, 'extension', '.output', 'chrome-mv3')");
    expect(source).toContain('await configureDevelopmentExtension(OUTPUT, CDP_URL)');
  });
});
