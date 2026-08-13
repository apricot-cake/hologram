import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// サンドボックスの慣習（docs/開発ガイド.md「デスクトップアプリを起動する」）: テストに
// 実際のconfigディレクトリを絶対に見せない。
// テストファイルごとに一時ディレクトリを1つ＝setupファイルはそのファイルの
// importより前に、ファイルごとに1回だけ走るので、モジュール読み込み時に
// HOLOGRAM_CONFIG_DIRを読むスイートもそれを見られる。ファイルごとにする
// のは（旧集計スクリプトは全スイートで1つのディレクトリを共有していた）、
// Vitestがファイルを並列に走らせるため、2つのスイートが同じconfigディレクトリ
// へ書き込むと競合してしまうから。
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'hologram-tests-'));
process.env.HOLOGRAM_CONFIG_DIR = sandbox;

afterAll(() => {
  try {
    fs.rmSync(sandbox, { recursive: true, force: true });
  } catch {
    /* できる範囲の後片付け */
  }
});
