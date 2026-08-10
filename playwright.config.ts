import { defineConfig } from '@playwright/test';

// PlaywrightはElectron E2E層（#14）を動かす＝実際のポインタ入力で実際のアプリを
// 操作し、実際のピクセルを比較する唯一の層。Vitest（scripts/*.test.ts）と
// app-harnessの集計スクリプト（scripts/run-app-tests.cts）の隣にある3つ目の
// ランナーで、スナップショットの基準を持つのはこれだけだから。docs/testing.mdに
// その分担がある。
//
// プロジェクトが2つあるのは、スイートの半分しかどこでも動かせないから:
//   flow   — ユーザーフロー。マシンに依存しないので、app-tests.ymlは他の実際の
//            Electron層と並べてWindowsランナーでこれを走らせる。
//   visual — toHaveScreenshotの基準。決定によりローカル限定（#14、2026-07-29）:
//            基準は開発機で取ってコミットするもので、CIはこのプロジェクトを
//            決して走らせない。理由はe2e/README.mdにある。
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
    { name: 'flow', testDir: './e2e/flows' },
    { name: 'visual', testDir: './e2e/visual' },
  ],
});
