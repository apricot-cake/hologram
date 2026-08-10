import { useRef } from 'react';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog';
import { close, type LightboxItem, type LightboxState } from '../services/lightbox.ts';
import { t } from '../_shared/i18n.ts';

// 単一画像のクイックビュー（のぞき見）のオーバーレイ。#143 でライトボックスは1件だけに
// 縮んだ＝ギャラリーの本格的なページ送りは今や画像表示にある＝ので、ここが描くのは
// services/lightbox.ts が持つ1件（サムネイルを拡大したもの）と動画の再生だけ。前後の
// ナビゲーションもカウンタも無い。#154 がその形を確定させた＝これはギャラリーのビューアで
// はなくクイックビューなので、ここに項目の間を歩くものは無い。
//
// #62: 他のどのオーバーレイとも同じく shadcn の Dialog に載る。ライトボックスとして特別
// なのは絵だけ＝シェルの重なりと切り抜きから出るポータル、スクリム、Esc、外側の押下、
// フォーカス（閉じ込めと復帰）はどれも Dialog のもので、これより前はここで手作りしていた
// （あるいは無かった＝フォーカスの管理は一切なかった）。自前として残っているのはメディア
// そのもの＝寸法、デコード、そして絵をクリックすると閉じるが動画のコントロールをクリック
// しても閉じないという規則。
//
// レイアウトは shadcn の DialogContent の箱ではなく全面の Popup にしてある＝のぞき見は面も
// 余白も閉じるボタンも描かず、スクリムの濃さも自前のものが要る。だから中央寄せカードの
// プリセットのクラスを十いくつも上書きするのではなく、Portal/Backdrop/Popup を直に組む。
//
// ポインタの経路: Popup はビューポート全体に広がるが（メディアが中央に来るのはそのため）
// pointer-events-none なので、空いた場所への押下は Backdrop に着き、Dialog 自身の外側押下に
// よる終了がそれに答える＝Esc と共有する1本の経路。メディアはポインタのイベントを取り返し、
// クリックで閉じるのは画像だけが持つ（スクラバーへのクリックが、まさに操作している当のもの
// を終わらせてはいけない）。
export function Lightbox({ state }: { state: LightboxState }) {
  const { item, open } = state;
  // ダイアログが閉じるアニメーションの間も最後の項目を持ち続け、退場の途中で絵が真っ白に
  // ならないようにする（close() は `open` を倒すのと同じ書き込みでストアの項目を消す）。
  // PromptHost と ConfirmHost が1件持っているのも同じ理由。
  const lastRef = useRef<LightboxItem | null>(null);
  if (item) lastRef.current = item;
  const shown = item ?? lastRef.current;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
    >
      {shown && <LightboxContent item={shown} />}
    </Dialog>
  );
}

function LightboxContent({ item }: { item: LightboxItem }) {
  // メディアは箱に合わせるのではなく上限を掛けている＝object-contain 付きの 95vw/95vh が
  // レイアウトの全部で、このオーバーレイのうち Dialog のものでない唯一の部分。
  const media = 'pointer-events-auto max-h-[95vh] max-w-[95vw] rounded object-contain';
  return (
    <DialogPortal>
      {/* data-slot="lightbox" がラッパーの "dialog-overlay" を置き換える＝ウィンドウ操作部の
          暗転（globals.css の .wc-dim）は、それが覆うスクリムと同じ黒を合成しなければならず、
          のぞき見のスクリムはモーダルのものより濃い。濃さごとに slot 名を1つ持てばその規則が
          曖昧にならないし、クリックモデルのハーネスが「のぞき見が開いている」を読む取っ掛かり
          のままでもいられる。平らで、背景のぼかしは掛けない（#240）＝モーダルは shadcn 化の
          際にぼかしを落としたし、design-tokens.css が浮かぶ面での backdrop-filter を禁じて
          いる。モーダルの bg-black/50 より濃いのは、その上に不透明なものが何も載らないから＝
          Bluesky のライトボックスも同じ 0.8 に落ち着いている。z-11000 は内容の上、shadcn の
          Dialog/AlertDialog の層（13000 以上）の下に来る。これが Esc の連鎖が前提にしている
          順序。 */}
      <DialogOverlay data-slot="lightbox" className="z-[11000] cursor-zoom-out bg-black/80 duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]" />
      <DialogPrimitive.Popup className="pointer-events-none fixed inset-0 z-[11000] flex items-center justify-center outline-none duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)] data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
        {/* のぞき見は見出しを描かないので、ダイアログのアクセシブル名は sr-only にする＝
            コマンドパレットと同じ作り。 */}
        <DialogTitle className="sr-only">{t('quickViewTitle')}</DialogTitle>
        {item.video ? (
          <video key={item.src} data-slot="lightbox-media" className={media} src={item.src} controls playsInline preload="metadata" />
        ) : (
          // decoding="async"（#241）＝のぞき見には前後が無いので、ここで先読みする隣も
          // 無い。この属性で話は尽きている。async にすれば、数メガピクセルのデコードが
          // スクリムとそのフェードインを待たせずに済む。クリックに即座に答えなければ
          // ならないのはその2つで（絵とは別の要素なので、絵を待つことはない）。
          <img key={item.src} data-slot="lightbox-media" className={`${media} cursor-zoom-out`} src={item.src} alt={item.alt || ''} decoding="async" onClick={() => close()} />
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  );
}
