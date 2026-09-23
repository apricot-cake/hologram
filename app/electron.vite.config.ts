import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// レンダラーの CSP が main（app/src/main/renderer-csp.ts）にあるのは、それを配る
// のが main だから。Vite を CSP の外へ通す必要があるのは dev だけなので、nonce は
// 2か所に書かずあちらから読む。
import { DEV_CSP_NONCE } from './src/main/renderer-csp.ts';

const r = (...segs: string[]) => path.resolve(__dirname, ...segs);

// CJS の 'use-sync-external-store' の shim（@base-ui/react と @base-ui/utils の
// 推移的依存）は、バンドル出力に require("react") をそのまま残し＝external が
// グローバルへ写されるのは ESM の import のときだけ＝読み込み時に例外を投げる。
// React 18 以降はこのフックを自前で持つので、両方の import 指定子を1行の ESM
// 再エクスポートへ向ける。
// 配列形式なのは順序が効くから（より限定的な shim/index.js が shim より前に要る）。
const RESOLVE_ALIAS = [
  { find: 'use-sync-external-store/shim/with-selector.js', replacement: r('src/renderer/src/_shared/use-sync-external-store-with-selector-shim.ts') },
  { find: 'use-sync-external-store/shim/with-selector', replacement: r('src/renderer/src/_shared/use-sync-external-store-with-selector-shim.ts') },
  { find: 'use-sync-external-store/shim/index.js', replacement: r('src/renderer/src/_shared/use-sync-external-store-shim.ts') },
  { find: 'use-sync-external-store/shim', replacement: r('src/renderer/src/_shared/use-sync-external-store-shim.ts') },
  // shadcn/ui 標準の import エイリアス＝tsconfig.web.json の paths にも同じものがある。
  { find: '@', replacement: r('src/renderer/src') },
];

export default defineConfig(() => ({
  main: {
    // better-sqlite3（ネイティブアドオン）・kysely・electron-log・yauzl・yazl
    // などはバンドルせず external のまま（実行時に node_modules から require する）。
    // ネイティブアドオンには必須で、残りは揃えるために同じにしている。
    //
    // koffi を名指ししているのは、externalizeDepsPlugin が external にするのが
    // `dependencies` だけで、koffi は意図して devDependency にしてあるから＝
    // HOLOGRAM_START_INACTIVE の検証経路でしか読み込まれないので、出荷するアプリ
    // からは外れていなければならない。バンドルすると壊れる（ネイティブアドオンな
    // ので）うえ、開発専用の依存を dist へ引きずり込む。
    plugins: [externalizeDepsPlugin({ include: ['koffi'] })],
    build: {
      outDir: process.env.HOLOGRAM_APP_BUILD_OUT ? path.join(process.env.HOLOGRAM_APP_BUILD_OUT, 'main') : undefined,
      lib: { entry: { index: r('src/main/index.ts') } },
    },
  },
  preload: {
    // electron-log は preload の出力へ必ずバンドルする（実行時に require させな
    // い）＝サンドボックス下の preload スクリプトが require() できるのは Electron
    // の小さな許可リストだけで、node_modules の任意の npm パッケージは読めない
    // （実機で確認済み＝external にすると "module not found: electron-log/preload"
    // を投げ、preload スクリプトごと読み込みに失敗した）。'electron' 自体は
    // external のまま（electron-vite が main/preload では無条件に external として
    // 扱う）。
    plugins: [externalizeDepsPlugin({ exclude: ['electron-log'] })],
    build: {
      outDir: process.env.HOLOGRAM_APP_BUILD_OUT ? path.join(process.env.HOLOGRAM_APP_BUILD_OUT, 'preload') : undefined,
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: RESOLVE_ALIAS },
    build: {
      outDir: process.env.HOLOGRAM_APP_BUILD_OUT ? path.join(process.env.HOLOGRAM_APP_BUILD_OUT, 'renderer') : undefined,
      rollupOptions: {
        input: { index: r('src/renderer/index.html') },
      },
    },
    // dev 専用＝Vite が出すタグすべてに nonce を付け、Fast Refresh のプリアンブル
    // （インラインの module スクリプト）をパッケージ版と同じ CSP の下で走らせる。
    // 理由は renderer-csp.ts にある。`apply: "serve"` でビルドからは外れる＝
    // ビルドではポリシーが nonce を持たず、必要とするものも無い。
    plugins: [react(), tailwindcss(), { name: 'hologram:dev-csp-nonce', apply: 'serve', config: () => ({ html: { cspNonce: DEV_CSP_NONCE } }) }],
  },
}));
