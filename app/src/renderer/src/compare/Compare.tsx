import { useRef } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { XIcon } from 'lucide-react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { Button } from '@/components/ui/button';
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { t } from '../_shared/i18n.ts';
import { PLATE } from '../image-tab/plate.ts';
import { MAX_SCALE, MIN_SCALE } from '../services/image-zoom.ts';
import { close, type CompareItem, type CompareState } from '../services/compare.ts';

// 比較表示（#82）＝選択した2〜4件の投稿を並べ、それぞれ独立にズームできる。ライトボックス
// と同じく shadcn の Dialog に乗る（Esc・背景の押下・フォーカスのトラップと戻しはすべて
// Dialog のもの）。ここが描くのはペインのグリッドと、明示的な閉じる操作だけ。中央のカード型
// の DialogContent の既定ではなく、lightbox/Lightbox.tsx と同じ画面いっぱいの
// Portal/Backdrop/Popup の組み立てにしている＝グリッドには小さなダイアログの箱ではなく
// ビューポート全体が要るため。

// ペイン1枚。ズームと移動は react-zoom-pan-pinch 自身のホイール・ピンチ・ダブルクリックの
// 既定に任せて、それぞれ独立に効く。ここで image-tab/ImageTab.tsx の Zoomable を使わないのは
// 意図してのこと。あの台のカーソルを軸にした拡大の段は、登録された単一のコントローラー
//（services/image-zoom.ts）を通して動かしていて、ちょうど1枚の画像表示のスライドだけを
// 相手にする作り＝独立にズームする4つのペインに同時に応える手立てが無い。#82 の採択済み
// 設計が約束しているのは「v1 ではズームを画像ごとに独立させる」ことだけ。単一の
// コントローラーの段を4つ複製する代わりに、ここでライブラリ自身のインスタンスごとの既定に
// 頼るのは、その設計が実装に委ねている部分。
function ComparePane({ item }: { item: CompareItem }) {
  return (
    <div data-slot="compare-pane" className="relative min-h-0 min-w-0 overflow-hidden rounded-lg border bg-black/40">
      {item.video ? (
        <video data-slot="compare-media" className="h-full w-full object-contain" src={item.src} controls playsInline preload="metadata" />
      ) : (
        <TransformWrapper minScale={MIN_SCALE} maxScale={MAX_SCALE} centerOnInit disablePadding>
          <TransformComponent wrapperStyle={{ width: '100%', height: '100%' }} contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <img data-slot="compare-media" className="max-h-full max-w-full cursor-grab object-contain active:cursor-grabbing" src={item.src} alt={item.alt} decoding="async" draggable={false} />
          </TransformComponent>
        </TransformWrapper>
      )}
    </div>
  );
}

// 配置は #82 の採択済み設計に従う。2枚なら横に並べ、3〜4枚なら 2x2 のグリッドに置く
//（3枚目までなら4つ目のセルはただ空くだけ＝埋め草は描かないし、3枚専用の並べ方も作らない）。
function paneGridClass(count: number): string {
  return count <= 2 ? 'grid-cols-2 grid-rows-1' : 'grid-cols-2 grid-rows-2';
}

export function Compare({ state }: { state: CompareState }) {
  const { items, open } = state;
  // 閉じるアニメーションの間、最後のコマを保持する＝Lightbox.tsx と同じ規則。close() が
  // `open` を倒すのと同じ書き込みでストアの items を消してしまうため。
  const lastRef = useRef<CompareItem[]>([]);
  if (items.length) lastRef.current = items;
  const shown = items.length ? items : lastRef.current;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      {shown.length > 0 && (
        <DialogPortal>
          <DialogOverlay data-slot="compare-overlay" className="z-[11000] bg-black/80" />
          <DialogPrimitive.Popup className="fixed inset-6 z-[11000] flex flex-col outline-none duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <DialogTitle className="sr-only">{t('compareTitle')}</DialogTitle>
            <div data-slot="compare-grid" className={`grid flex-1 gap-2 ${paneGridClass(shown.length)}`}>
              {shown.map((item, i) => (
                <ComparePane key={i} item={item} />
              ))}
            </div>
            <DialogPrimitive.Close data-slot="compare-close" render={<Button variant="ghost" size="icon-sm" className={`absolute top-2 right-2 ${PLATE}`} />}>
              <XIcon />
              <span className="sr-only">{t('compareClose')}</span>
            </DialogPrimitive.Close>
          </DialogPrimitive.Popup>
        </DialogPortal>
      )}
    </Dialog>
  );
}
