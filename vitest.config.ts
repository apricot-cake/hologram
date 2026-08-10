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

// 純粋な単体テストランナー。登録はグロブベース: scripts/*.test.tsはどれも
// 自動的に拾われる＝同期を保つべき手作業のスイート一覧は無い（2026-07-02の
// 監査は、旧集計スクリプトのTESTS配列が手書きだったせいで、未登録のまま何週間も
// 赤くなっていたスイートを見つけた）。
//
// app/electron.vite.config.tsではなく別のconfigにする: あちらのdefault export
// はelectron-viteのmain/preload/rendererの三つ組で、Vitestは消費できない。
// あちらから必要なものもここには無い＝スイートはレンダラーのサービス
// モジュール（素の.ts、JSXなし、'@'エイリアスなし）と拡張機能のutilsをimport
// するので、reactもtailwindのプラグインもエイリアス表も関与しない。
//
// 意図的にここでは動かさない。除外する正当な理由はこの2つだけ:
//   - ネットワークが要る: scripts/test-metadata.cts、test-select-posts.cts、
//     test-watch-verify.cts（capture-flowのCLI群。docs/testing.md参照）、
//     test-ml-runtime.cts（huggingface.coからsmokeモデルを1回取得する）
//   - Electronが要る: scripts/test-app-*.cts → node scripts/run-app-tests.cts
// どちらのグループも旧来の`test-*.cts`という名前を保っているので、下のinclude
// グロブが誤って届くことはない。
export default defineConfig({
  plugins: [ctsAsTypeScript()],
  test: {
    include: ['scripts/**/*.test.ts'],
    // Nodeが既定。ブラウザ側の拡張機能コードを試す4つのスイートは、ファイル
    // ごとに`@vitest-environment jsdom`のdocblockでjsdomを選ぶ。
    environment: 'node',
    // テストファイルごとにconfigディレクトリをサンドボックス化する
    // （docs/build.md「検証ルール（隔離4段構え）」＝テストに実際のconfig
    // ディレクトリを絶対に見せない）。
    setupFiles: [path.resolve(__dirname, 'scripts/vitest.setup.ts')],
    // 出力が古いときは拡張機能をビルドする。これにより
    // extension/.output/chrome-mv3を読むスイート（jsdomのバンドルスイートと
    // manifestの整合性ガード）が、ソースより古いバンドルを決してテストしない
    // ようにする（#130）。ファイルごとではなく実行ごとに1回＝そのファイルの
    // ヘッダーを参照。
    globalSetup: [path.resolve(__dirname, 'scripts/vitest.global-setup.ts')],
  },
});
