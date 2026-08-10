// 内容の列のための「最上部へ戻る」（#606）＝深くスクロールしたあとに戻る、目に見える唯一の
// 道。React のシェルは旧来のサイドバー側・内容側のボタンをマークアップごと落とし、代わりは
// 何も置かれなかった＝ページ自体はスクロールしない（body が height:100svh; overflow:hidden）
// し、実際にスクロールする列は tabindex を持たず、カードもフォーカスできない＝キーボードで
// のスクロールにも掛ける相手が無く、残った経路はホイールかスクロールバーのドラッグだけ
// だった。
//
// 形は #116 の 2026-07-14 の決定に従う＝右下、アイコンのみ、スクロールしてから出る、読み
// やすさはホバーのツールチップが担う。#116 が提案した、ラベルの見える中央のボタンはそこで
// 却下された＝あの形はフィードの「新しい投稿へ飛ぶ」のもので、ライブラリのグリッドのもの
// ではない。
//
// ウィンドウに留め付けるのではなく（FloatingBar と同じく）inset の内側に置く。そうすれば、
// どの幅でも flex の兄弟である右のインスペクタ（#243/#975）がコンテナを狭め、ボタンは自前の
// 幅確保の分岐なしにそれへ追随する。
import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { scroller } from '../services/content-area.ts';

// 出るのは画面1つぶんスクロールしてから。判定は固定のピクセル数ではなくスクロール要素自身
// の高さに対して測る。Nielsen Norman Group の最上部へ戻るボタンの指針は「長いページだけ」＝
// ピクセルでのしきい値は、低いウィンドウと高いウィンドウとでその問いに違う答えを出すが、
// 「画面1つぶんより深い」はどの大きさでも同じことを意味する。収まりきるライブラリでは
// ボタンを画面から完全に締め出しておける、という効果もある。
function isDeep(el: HTMLElement): boolean {
  return el.scrollTop > el.clientHeight;
}

export function ScrollToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // この時点でシェルの ref のコールバックは走り終えている＝ref はエフェクトより先に付き、
    // スクロールする列はこのコンポーネントと同じコミットで載る。
    const el = scroller();
    if (!el) return;
    const sync = () => setShown(isDeep(el));
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    // しきい値はスクロール要素の高さに依るので、スクロールのイベントが1つも無くても
    // リサイズだけで答えが裏返る（インスペクタを開く、ウィンドウを低くドラッグする）。
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, []);

  const label = t('scrollToTop');
  return (
    // 載せたままにして、2つの状態の間を1つの CSS トランジションで、どちらの向きにも行き来
    // する（ADR 0014 / 再設計 §3-10a＝退場を扱うライブラリは使わない）。隠れている間は
    // `inert` にして、誰にも見えないボタンがタブ順にもアクセシビリティの木にも入らない
    // ようにする。`inert` はレイアウトに触らないので、トランジションが再生できるままになる。
    <div inert={!shown} className={cn('absolute right-6 bottom-6 z-50 transition-[opacity,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]', shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0')}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-slot="scroll-to-top"
              aria-label={label}
              className="inline-grid size-9 place-items-center rounded-full border bg-popover text-popover-foreground shadow-lg transition-colors duration-75 hover:bg-muted active:bg-foreground/16"
              onClick={() => scroller()?.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <ArrowUp className="size-4" />
            </button>
          }
        />
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}
