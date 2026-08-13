import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const source = fs.readFileSync(path.join(__dirname, 'open-dev-profile.cts'), 'utf8');

describe('開発用Chromeプロファイルの CDP 起動', () => {
  test('CDP の接続先をローカル固定で定めている', () => {
    expect(source).toMatch(/const CDP_ADDRESS = '127\.0\.0\.1';/);
    expect(source).toMatch(/const CDP_PORT = 9223;/);
  });

  test('専用プロファイルと同時に CDP を起動する', () => {
    expect(source).toContain('--user-data-dir=$' + '{PROFILE}');
    expect(source).toContain('--remote-debugging-address=$' + '{CDP_ADDRESS}');
    expect(source).toContain('--remote-debugging-port=$' + '{CDP_PORT}');
  });

  test('起動成功を CDP の応答で確認する', () => {
    expect(source).toContain("path: '/json/version'");
    expect(source).toContain('await waitFor(`開発用Chromeの CDP が $' + '{CDP_ADDRESS}:$' + '{CDP_PORT} で応答すること`');
  });
});
