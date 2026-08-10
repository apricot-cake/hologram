// 画像表示のツールバー（#150）＝ズームの −/%/+ と、ウィンドウに合わせる⇄原寸 の切り替え。
//
// そもそもなぜツールバーか: ズームはホイールだけ、フィットの切り替えはダブルクリックだけ
// だったので、どちらもどこにも見えていなかった。このアプリが基準にする画像ビューア
// （Windows フォト / Eagle / IrfanView）はどれもズームとフィットを常設のツールバーに置く。
// ジェスチャはこれまでどおりショートカットとして残る。
//
// 絵の上ではなくアプリのツールバーの帯（shell/AppToolbar.tsx）に描く＝帯はもともとタブの列
// の下の行であり、画像ビューアの操作部は見ている当のものの上に載るべきではない。ステージ
// との会話は services/image-zoom.ts を通す＝ステージの Zoomable はスライドごとに載せ直され
// るので、ここにその ref を保持できるものは無い。
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { Contrast, Expand, FlipHorizontal, Grid3x3, Pin, Shrink, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { getState, subscribe } from '../services/image-zoom.ts';
import { getState as getOverlayState, subscribe as subscribeOverlay, toggleFlip, toggleGrid, toggleGray } from '../services/image-overlay.ts';
import { hologramImageTabSource } from '../services/image-tab.ts';
import { fileOfSrc } from '../services/asset-src.ts';
import { hologramIpc } from '../services/ipc.ts';

function ToolButton({ label, slot, disabled, pressed, onClick, children }: { label: string; slot: string; disabled: boolean; pressed?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button variant="ghost" size="icon-sm" data-slot={slot} aria-label={label} aria-pressed={pressed} disabled={disabled} onClick={onClick} className={pressed ? 'bg-muted text-foreground' : undefined}>
            {children}
          </Button>
        }
      />
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ViewerToolbar() {
  const { controller, percent, atFit, canZoomIn, canZoomOut } = useSyncExternalStore(subscribe, getState);
  // #80 のまとまりは自分のモジュール（services/image-overlay.ts）を読む＝そのトグルは
  // スライドごとの載せ直しより上にいて（上のズームの表示と違い、ページ送りを越えて残る）、
  // image-zoom.ts の ImageZoomState には端から属さない、ただの兄弟のストア。
  const overlay = useSyncExternalStore(subscribeOverlay, getOverlayState);
  // controller が無い ⟺ このスライドにズームが無い（動画はネイティブのコントロールで
  // 再生し、うごイラは自分のキャンバスで描く）。まとまりは消えずにその場に留まり、
  // disabled になる＝投稿をページ送りするたびにボタンが減るツールバーは壊れているように
  // 読めるし、#80 の左右反転とグレースケールのトグルはそういうスライドにも効くから。
  const off = !controller;
  // #79 導線②: 今まさに画面に出ているものをピン留めする＝開いているタブの、今表示中の
  // ページであって投稿全体ではない（この区別が、投稿自身の表紙をピン留めするカードの
  // メニューの「ピン」との違い＝services/pin-items.ts 参照）。モデルが渡すのは仕上がった
  // src の文字列だけなので、PinItem が要る素のファイル名は fileSrc の逆写像 fileOfSrc から
  // 取り戻す。
  const pinCurrent = () => {
    const model = hologramImageTabSource.get();
    if (!model || !model.items.length) return;
    const item = model.items[model.idx];
    const file = fileOfSrc(item.src);
    if (!file) return;
    hologramIpc.pinSend([{ captureId: model.tabId, file, video: !!item.video }]);
  };
  return (
    <div data-slot="viewer-toolbar" className="flex items-center gap-0.5">
      <ToolButton slot="viewer-zoom-out" label={t('itvZoomOut')} disabled={off || !canZoomOut} onClick={() => controller?.step(-1)}>
        <ZoomOut />
      </ToolButton>
      {/* tabular-nums と最小幅の固定＝この表示はズームのアニメーションのフレームごとに
          変わるので、プロポーショナルだと ＋ ボタンを押しのけて動かしてしまう。 */}
      <span data-slot="viewer-zoom-level" className={`min-w-11 text-center text-xs tabular-nums ${off ? 'text-muted-foreground/50' : 'text-muted-foreground'}`}>
        {percent == null ? '—' : `${percent}%`}
      </span>
      <ToolButton slot="viewer-zoom-in" label={t('itvZoomIn')} disabled={off || !canZoomIn} onClick={() => controller?.step(1)}>
        <ZoomIn />
      </ToolButton>
      {/* ボタン1つで状態は2つ＝ラベルとアイコンは押したら何が起きるかを言う。利用者に
          見えていないのはそちらの半分だから（今の状態は絵そのものが示している）。 */}
      <ToolButton slot="viewer-fit-toggle" label={atFit ? t('itvActualSize') : t('itvFitToWindow')} disabled={off} onClick={() => controller?.toggleFitActual()}>
        {atFit ? <Expand /> : <Shrink />}
      </ToolButton>
      {/* #80 の作画補助のまとまり＝左右反転 / グリッド / グレースケール。上の一瞬だけの
          ズームのボタンと違って ON/OFF が残るトグルなので、それぞれが aria-pressed と、
          ToolButton がその prop に対して足す ghost の「押されている＝bg-muted」の見た目を
          持つ。これはアプリが aria-expanded のポップオーバーのトリガーに既に使っているのと
          同じ視覚の語彙で（button.tsx の ghost バリアント）、共有のバリアントへ畳み込まず
          ここでローカルに書き下しているだけ（ツールバーの帯で aria-pressed の ghost ボタン
          はこれだけ。同じくトグルする浮かぶステージのボタン＝ImageTab.tsx の ⓘ は、この帯
          ではなく絵の上に浮くので、代わりに自前の PLATE のスタイルを使う）。 */}
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      <ToolButton slot="viewer-flip" label={t('itvFlip')} pressed={overlay.flip} disabled={false} onClick={toggleFlip}>
        <FlipHorizontal />
      </ToolButton>
      {/* グリッドは Zoomable のときだけ（v1 の設計、#80 の 2026-07-17 の修正2）＝動画や
          うごイラのスライドにはオーバーレイの div を掛ける Zoomable が無く、`off` がまさに
          「このスライドに Zoomable が無い」そのもの（上の image-zoom.ts 自身の disabled の
          条件）。 */}
      <ToolButton slot="viewer-grid" label={t('itvGrid')} pressed={overlay.grid} disabled={off} onClick={toggleGrid}>
        <Grid3x3 />
      </ToolButton>
      <ToolButton slot="viewer-grayscale" label={t('itvGrayscale')} pressed={overlay.gray} disabled={false} onClick={toggleGray}>
        <Contrast />
      </ToolButton>
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      {/* `off` では絞らない（動画やうごイラは Zoomable を持たないが、ピン留めする価値の
          あるファイルは持っている）＝ViewerToolbar はタブが実際に開いている間しか描画
          されないので、送るものは必ずある。 */}
      <ToolButton slot="viewer-pin" label={t('itvPin')} disabled={false} onClick={pinCurrent}>
        <Pin />
      </ToolButton>
    </div>
  );
}
