import { createRoot } from 'react-dom/client';
import '../app/log.ts';
import { initI18n } from '../_shared/i18n.ts';
import { ErrorBoundary } from '../app/ErrorBoundary.tsx';
import { PinApp } from './PinApp.tsx';

// ピン留めウィンドウ自身の React のルートを載せる＝app/root.tsx と同じ形（ルートは1つ。
// initI18n を通してから進む＝最初の描画の中で t() が同期になる）。あのモジュールの
// log.ts と ErrorBoundary.tsx は枝分かれさせず直接使い回す。どちらもメインウィンドウの
// DOM について何も前提を置いていないため。
let mounted = false;
function mount() {
  if (mounted) return;
  mounted = true;
  const root = document.createElement('div');
  root.id = 'hologramPinRoot';
  document.body.appendChild(root);
  createRoot(root).render(
    <ErrorBoundary>
      <PinApp />
    </ErrorBoundary>,
  );
}

initI18n().then((api) => {
  // app/root.tsx と同じことを、同じ理由でする（#1057）。ピン留めウィンドウは自分自身の
  // ドキュメントなので、pin.html に静的に書かれた lang は、このウィンドウ自身が正すべき
  // 申告になる。
  if (api) document.documentElement.lang = api.resolved;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
});
