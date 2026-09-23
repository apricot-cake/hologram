import { defineConfig } from '@playwright/test';

// 画面フロー、Electron のプロセス検証、拡張機能のブラウザ検証を同じランナーで実行する。
export default defineConfig({
  testDir: './e2e',
  // 1つずつ。各ケースは実際のElectronを起動し、サンドボックスは互いに隔離され
  // ているものの、複数を同時に走らせるマシンではタイミングに敏感な半分
  // （ポインタ入力、最初の描画）が負荷依存になってしまう＝しかも複数の
  // ウィンドウが一度に画面に出てしまう。
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  // Playwrightの既定30秒はこの層には際どい: 1ケースはElectronのコールド
  // スタート（約2秒）に加えて、最初のカードが描画されるまでのアプリ自身の
  // 索引構築がかかる。
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // 緩く始めて許容誤差が何を隠しているか知らないままにするのではなく、
      // 厳しく始めて動くと分かったものだけをマスクする。
      maxDiffPixels: 0,
      // 撮影前にCSSのトランジション/アニメーションを終了状態で固定する。
      animations: 'disabled',
    },
  },
  projects: [
    // 毎回のCIで走らせるのは、利用不能を防ぐ主要導線だけにする。画面の幾何や
    // 個別の回帰ケースは flow-regression へ分け、通常のUI変更で赤くしない。
    { name: 'flow', testDir: './e2e/flows', testMatch: '**/core-journeys.spec.ts' },
    { name: 'flow-regression', testDir: './e2e/flows', testIgnore: '**/core-journeys.spec.ts' },
    { name: 'harness', testDir: './e2e/harness', timeout: 120_000, fullyParallel: true },
    // 拡張機能も、保存の入口と更新後の復旧だけを継続的に検証する。ホストページ
    // ごとの幾何・ちらつき調査は extension-regression で任意に実行する。
    { name: 'extension', testDir: './e2e/extension', testMatch: '**/core-save.spec.ts', timeout: 240_000, fullyParallel: true },
    { name: 'extension-regression', testDir: './e2e/extension', testIgnore: '**/core-save.spec.ts', timeout: 240_000, fullyParallel: true },
    { name: 'visual', testDir: './e2e/visual' },
  ],
});
