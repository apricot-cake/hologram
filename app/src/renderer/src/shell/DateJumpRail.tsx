// 年月ジャンプレール（#47）＝日付順に並んだグリッドへの右端の索引。
// 配置は ScrollToTop と同じ「inset の内側に置くオーバーレイ」（理由はあちらの
// コメントにある＝inset を狭めるのが右の詳細パネルなので、ここを起点にすれば
// レール自身の幅確保の分岐を持たずに詳細パネルを避けられる）。hologramStore の
// 'postSections' を直に読む（services/grid.ts がグリッドモデルへ `sections` と
// して付けるのと同じ値）。グリッド経由で受け渡さないのは、これがグリッドのセル
// ではなく兄弟のオーバーレイだから＝どちらにせよ2つの読み手（グリッドのホスト、
// このレール）は post-grid-builder.ts の1回の計算を共有する。
//
// #875: オーバーレイである以上、出ている間はカードの右端の列を覆う。だから必要に
// なるまで邪魔をしない＝スクロール中・ポインタが右端に寄っている間・フォーカスが
// レールの中にある間だけ出る。Google フォトの web のスクラバーも同じ振る舞いを
// する（開いた直後は無く、スクロールし始めると出る）。載せたままにして1つの CSS
// トランジションで両状態を行き来する形は ScrollToTop と同じで、載せ外しはしない。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { scroller } from '../services/content-area.ts';
import { scrollSectionToTop } from '../services/section-nav.ts';
import { store, subscribeKey } from '../services/store.ts';

const subSections = (cb: () => void) => subscribeKey('postSections', cb);
const getSections = () => store.getState().postSections;
const subBrowseMode = (cb: () => void) => subscribeKey('browseMode', cb);
const getBrowseMode = () => store.getState().browseMode;

/** 最後のスクロールイベントからレールを出したままにする時間。 */
const IDLE_MS = 1200;
/** レールの左どこまでを「レールへ手を伸ばしている」と見なすか。 */
const EDGE_PAD_PX = 24;

export function DateJumpRail() {
  const sections = useSyncExternalStore(subSections, getSections);
  const mode = useSyncExternalStore(subBrowseMode, getBrowseMode);
  // 索引が意味を持つのは飛び先が2つ以上あるときだけ＝1か月分・結果1ページでは
  // レールにやることが無い。'posts'/'timeline' でも絞っている＝'postSections' は
  // 投稿グリッドの描画（post-grid-builder.ts の renderPosts。両モードが共有する）
  // でしか更新されないので、そうしないと投稿者やゴミ箱へ切り替えたときにレールが
  // 投稿グリッドの最後の内容を出したままになる。#183: タイムラインは日付ソートに
  // 固定されているので索引すべきセクションが常にある＝タイムラインでレールを殺さ
  // ないのは意図してそうしている（2026-08-02 の設計コメント: 時間軸そのもので
  // あるモードから時間軸の索引を落とす理由が無い）。
  const shown = (mode === 'posts' || mode === 'timeline') && !!sections && sections.length > 1;

  const railRef = useRef<HTMLDivElement>(null);
  const [scrolling, setScrolling] = useState(false);
  const [nearEdge, setNearEdge] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);

  useEffect(() => {
    // タイミングの注記は ScrollToTop と同じ＝ref はエフェクトが走る前に付き、
    // スクロールする列はこのコンポーネントと同じコミットで載る。
    const el = scroller();
    if (!el) return;
    let timer: number | undefined;
    const onScroll = () => {
      setScrolling(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setScrolling(false), IDLE_MS);
    };
    // 近さを測る相手はスクロール要素の右端ではなくレール自身の矩形。移動のたびに
    // その矩形を読めば、専用のオブザーバを持たずに判定領域がリサイズへ追随する。
    // 判定領域がレールを含むので、レールの上でポインタが止まっているだけで
    // 別のホバー状態を持たずに出したままになる＝これがあるから待機中のレールは
    // `pointer-events: none` のままでいられ、背後のカードを狙ったクリックや
    // マーキードラッグ（#484）を一切飲み込まない。
    const onMove = (e: MouseEvent) => {
      const rail = railRef.current;
      if (!rail) return;
      // 横方向だけを見る＝ライブラリが数か月分しかなければレールは短く、
      // 「右端へ手を伸ばす」のに高さまで当てさせるべきではない。
      setNearEdge(e.clientX >= rail.getBoundingClientRect().left - EDGE_PAD_PX);
    };
    // ポインタがウィンドウの外へ出ると mousemove は届かないので、そのままだと
    // 切り替えた先の裏でレールが出しっぱなしになる。`document` ではなく <html>
    // にするのは、mouseleave がバブルせず、「ウィンドウから出た」を確実に発火
    // するのがこの要素だから。
    const root = document.documentElement;
    const onLeave = () => setNearEdge(false);
    el.addEventListener('scroll', onScroll, { passive: true });
    // スクロール要素ではなく document で受ける＝レールはスクロールする列の兄弟
    // なので、列だけで聞いているとポインタがレールへ乗った瞬間に「ポインタが
    // 出た」と報告してしまう。
    document.addEventListener('mousemove', onMove, { passive: true });
    root.addEventListener('mouseleave', onLeave);
    return () => {
      window.clearTimeout(timer);
      el.removeEventListener('scroll', onScroll);
      document.removeEventListener('mousemove', onMove);
      root.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const visible = shown && (scrolling || nearEdge || focusWithin);
  const label = t('dateJumpRailTitle');

  return (
    <div
      ref={railRef}
      // `inert` が追うのは `visible` ではなく `shown` のまま＝待機中のレールも
      // 正当な Tab の止まり先で、そこへ入ることがレールを出す経路の1つ。
      inert={!shown}
      onFocus={() => setFocusWithin(true)}
      onBlur={() => setFocusWithin(false)}
      className={cn(
        'absolute top-1/2 right-2 z-40 flex max-h-[70vh] -translate-y-1/2 flex-col gap-0.5 overflow-y-auto rounded-lg border bg-popover/90 p-1 shadow-lg backdrop-blur-sm transition-opacity duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]',
        visible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      aria-label={label}
      role="navigation"
    >
      {(sections || []).map((sec) => (
        <Tooltip key={sec.key}>
          <TooltipTrigger
            render={
              <button type="button" data-slot="date-jump-rail-item" className="flex items-baseline justify-between gap-1.5 rounded px-1.5 py-0.5 text-[11px] leading-tight text-muted-foreground tabular-nums transition-colors hover:bg-muted hover:text-foreground" onClick={() => scrollSectionToTop(sec.key)}>
                {/* ロケールの完全なラベルではなく詰めた "'26/7"（年/月）にする＝これはセクション
                    の見出しではなく索引のレールで、1年分が折り返さずに収まる幅を保つ必要が
                    ある。日付不明も同じ2列の形を保ち、その件数が他のどの行とも揃うようにする。 */}
                <span>{sec.key === 'unknown' ? '—' : `'${String(new Date(sec.ms).getFullYear()).slice(-2)}/${new Date(sec.ms).getMonth() + 1}`}</span>
                <span className="text-muted-foreground/70">{sec.count}</span>
              </button>
            }
          />
          <TooltipContent side="left">{sec.label}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
