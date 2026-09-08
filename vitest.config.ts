import path from 'node:path';
import { type Plugin, transformWithOxc } from 'vite';
import { defineConfig } from 'vitest/config';

// Viteの「これはJS/TSソースだ」という判定は.ts/.mtsはカバーするが.ctsは
// カバーしない。だから.ctsのimportは型注釈を残したままパーサーへ届き、最初の
// `interface`で死ぬ。native-host/は意図的に.ctsで書かれている（CommonJS、
// Nodeの型剥がしでビルドせず動く＝native-host/tsconfig.json参照）。そのための
// スイートはそれらのモジュールを直接importするので、ランタイムのファイルを
// リネームするのではなく、変換にこの拡張子を教える。
const ctsAsTypeScript = (): Plugin => ({
  name: 'hologram:cts-as-typescript',
  async transform(code, id) {
    if (!id.endsWith('.cts')) return null;
    const { code: js, map } = await transformWithOxc(code, id, { lang: 'ts' });
    return { code: js, map };
  },
});

// 実装に隣接する単体テストと tests/integration の結合テストを自動検出する。
// 実プロセスを起動する検証は e2e/ に分ける。
export default defineConfig({
  plugins: [ctsAsTypeScript()],
  test: {
    include: ['app/**/*.test.ts', 'extension/**/*.test.ts', 'native-host/**/*.test.ts', 'scripts/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    // ビルド済みの Chrome 拡張機能を読むテストは、通常テストから分ける。
    // `npm run test:extension` がテスト専用出力を作ってから実行する。
    exclude: ['**/*.extension-bundle.test.ts', '**/node_modules/**'],
    // Nodeが既定。ブラウザ側の拡張機能コードを試す4つのスイートは、ファイル
    // ごとに`@vitest-environment jsdom`のdocblockでjsdomを選ぶ。
    environment: 'node',
    // テストファイルごとにconfigディレクトリをサンドボックス化する
    // （docs/開発ガイド.md「デスクトップアプリを起動する」＝テストに実際のconfig
    // ディレクトリを絶対に見せない）。
    setupFiles: [path.resolve(__dirname, 'tests/helpers/vitest.setup.ts')],
  },
});
