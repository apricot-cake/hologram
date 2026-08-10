// ピン留めウィンドウの入口（#79）＝app/index.tsx と対をなすが、バンドルはずっと小さい。
// orchestrator は無く、グリッド・サイドバー・設定も無く、PinApp.tsx が実際に使う部品
// （ImageTab と ViewerToolbar、そしてそれらが閉じ込めるサービス）だけがある。Rollup は
// electron.vite.config.ts の rollupOptions.input の入口ごとに別々のモジュールグラフを
// 与えるので、ここに何が載るかを決めるのは app/index.tsx ではなくこのファイルの import。
import '../globals.css';
import './root.tsx';
