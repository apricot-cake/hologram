import { createRoot } from 'react-dom/client';
import './log.ts';
import { initI18n } from '../_shared/i18n.ts';
import { App } from './App.tsx';
import { ErrorBoundary } from './ErrorBoundary.tsx';

// 統一された単一の React ルートを載せる（最終形 B の DoD）。body に足したホストの div が
// App を持ち、App の子はその場に描かれるか、固定のオーバーレイとして描かれる（静的な
// コンテナへ portal するものはもう無い＝#621）。レンダラー全体で createRoot() は1つ。
// 以前はコンポーネントごとに自分の createRoot() を呼んでいて、何度かに分けてこの1つの
// 下へ移した（App.tsx を参照）。載せる処理は initI18n() を待ってから走らせる。App の中で
// t() を同期に呼べるようにするため（検索欄のプレースホルダと、今後のツールバーや設定の
// 文言に必要）。オーバーレイやモデルを押し出すコンポーネントは、この待ちのわずかな遅れの
// 影響を受けない＝自分のブリッジが内容を持って初めて描かれ、載る時に
// useSyncExternalStore で今のモデルを引くため。何度実行しても同じ（mounted の番人）ので、
// 読み込み直しても安全。
let mounted = false;
function mount() {
  if (mounted) return;
  mounted = true;
  const root = document.createElement('div');
  root.id = 'hologramAppRoot';
  document.body.appendChild(root);
  // ルートが1つということは、描画時のエラーを1つ拾い損ねただけでウィンドウ全体が空に
  // なるということ。だから境界はそのすぐ下に置く（#324＝ErrorBoundary.tsx を参照）。
  createRoot(root).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
}

initI18n().then((api) => {
  // document が名乗る言語は、index.html を書いた時の言語ではなく実際に解決した言語で
  // なければならない（#1057、WCAG 2.2 SC 3.1.1 Language of Page）。これが決めるのは、
  // スクリーンリーダーがどの声を使うか、ja と zh で食い違う漢字にフォントがどのグリフを
  // 選ぶか、Chrome がこのウィンドウの翻訳を持ちかけるか。テキストはまだ何も描かれて
  // いない＝下の載せる処理も同じ promise を待っている＝ので、これは訂正ではなく
  // document が最初に行う申告になる。
  //
  // initI18n() の中ではなくここに置く理由: tests/integration/clipboard-intake.test.ts と
  // drop-import.test.ts が Vitest の node 環境であれを呼んでいて、そこには書き込む
  // document が無い。document を持つモジュールはルートのほう。
  if (api) document.documentElement.lang = api.resolved;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
});
