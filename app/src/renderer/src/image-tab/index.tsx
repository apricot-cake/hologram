import { useEffect, useState } from 'react';
import { hologramImageTabSource } from '../services/image-tab.ts';
import { get as confirmGet } from '../services/confirm.ts';
import { isOpen as lightboxIsOpen } from '../services/lightbox.ts';
import { isOpen as settingsIsOpen } from '../services/settings.ts';
import { ImageTab } from './ImageTab.tsx';

// React が持つ画像タブの詳細表示。タブのオブジェクト（type:'image'）とその recs/idx を
// 持っているのは viewer.js のほう。このコンポーネントはモデルを押し込まれるのではなく、
// services/image-tab.ts から自分で引く＝旧来の render(model) による押し込み（viewer が
// 8か所ほどから呼んでいた）から切り替えたもので、2つのグリッドのソースと同じ形。ズームと
// パン（react-zoom-pan-pinch）、前後の描画、画像タブが表示中の時の ←/→ キーは、今も
// このコンポーネントが持つ。

// useSyncExternalStore は使わない。get() は通知のたびに新しいオブジェクトを作り直すので
//（グリッドのソースと同じ）、React の「キャッシュしたスナップショット」の破れ検査に
// 引っかかる＝素の subscribe → setState の effect（GridMount の sync() と同じ形）なら
// それを避けられる。
export function ImageTabHost() {
  const [model, setModel] = useState(() => hologramImageTabSource.get());
  useEffect(() => {
    const sync = () => setModel(hologramImageTabSource.get());
    const unsub = hologramImageTabSource.subscribe(sync);
    sync(); // この effect が走る前に変わったものを拾う
    return unsub;
  }, []);
  // 台自身のコンテナ。以前は AppShell の中の静的な `#imageTabView` の div で、2つの CSS
  // 規則（`#imageTabView{display:none}` と `body.image-tab-active #imageTabView`）で
  // 切り替え、3つ目の規則で内容の列を隠していた＝body のクラスが「モデルがある」と
  //「閲覧用の枠が消える」を繋ぐ配線だった。今はモデルを持っているコンポーネント自身が
  // コンテナを描き、シェルは同じ述語（services/image-tab.ts の isActive）から内容の列を
  // 隠す＝React での判断が1つになり、競うクラスは無い（P2⑫ / #153 ⑥）。
  return model ? (
    <div data-slot="image-tab-view" className="flex min-h-0 min-w-0 flex-1">
      {/* key={model.tabId}（#80）: ある画像タブから別の画像タブへ直接切り替えても（どちらも
          すでに自分の画像表示を出している）、このホスト自体は外れない＝変わるのは `model` の
          同一性だけ。だからこの key が無いと React は同じ ImageTab のインスタンスを使い回し、
          オーバーレイの切り替え状態（services/image-overlay.ts）が古いタブの絵から新しい
          タブの絵へ漏れる。key があれば必ず載せ直され、その effect が image-overlay.ts の
          reset() を呼ぶ。 */}
      <ImageTab key={model.tabId} model={model} />
    </div>
  ) : null;
}

// 画像タブが表示中の間、←/→ でそのまとまりの画像を送る。入力中・オーバーレイ・
// ライトボックスには譲る（表示側の防ぎをそのまま写している）。
document.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const model = hologramImageTabSource.get();
  if (!model || !model.onIndexChange || model.items.length < 2) return;
  const t = e.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (lightboxIsOpen()) return;
  if (settingsIsOpen()) return;
  if (confirmGet()) return;
  const n = model.items.length;
  const d = e.key === 'ArrowLeft' ? -1 : 1;
  model.onIndexChange((Math.max(0, Math.min(model.idx, n - 1)) + d + n) % n);
});
