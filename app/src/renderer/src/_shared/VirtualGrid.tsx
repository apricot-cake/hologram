// 仮想化グリッドの共有の配管（masonic の useMasonry + usePositioner +
// useResizeObserver を、アプリが自前で持つスクロール容器に配線したもの＝masonic の
// <Masonry> はウィンドウのスクロールにしか対応しないので、ここのスクローラーの配線は
// 手で書いてある。実行時の PoC で確かめたとおり）。投稿者・コレクションのグリッドが
// 同じ土台に合流した時に、投稿のグリッドのコンポーネントから 1:1 で切り出した。
// グリッドのモジュールはそれぞれ自前のセルのコンポーネントを渡す。ウィンドウ表示の
// 制御はこのホストが持つ。
//
// PoC で見つかった罠。ここではそれを守っている: positioner が作り直されるたび
// （itemsKey が変わる、容器の幅が変わる）、位置のキャッシュが初期化される＝その時点で
// scrollTop の状態が古いと、見えている範囲の計算が狂ってグリッドが真っ白になる。
// そこでスクロールの状態は (a) 本物のスクローラーから初期化し、(b) スクロールの
// リスナーで更新し、(c) itemsKey が変わるたびに強制的に取り直す。
import { createPortal, flushSync } from 'react-dom';
import { useMasonry, usePositioner, useResizeObserver } from 'masonic';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { scroller as contentScroller } from '../services/content-area.ts';
import { registerGridNav } from '../services/grid-nav.ts';
import { autoScrollStep, clearsSelection, exceedsThreshold, hitIndices, rectFromPoints } from '../services/marquee.ts';
import type { MarqueeCell } from '../services/marquee.ts';
import { anchorScrollTop, anchorViewportOffset, pickAnchorIndex, registerZoomAnchorSource } from '../services/zoom-anchor.ts';
import type { ZoomAnchor, ZoomAnchorCell } from '../services/zoom-anchor.ts';

// グリッドのモジュールがそれぞれ渡すセルのコンポーネント（masonic の描画コンポーネント）。
export interface GridCellProps {
  index: number;
  data: any;
  width: number;
}

// モジュール内に閉じず export しているのは、_shared/SectionedGrid.tsx の月ごとのホスト
// （#47）が同じコンテキストを渡せるようにするため＝セルから見れば、背後にあるのが
// 共有の positioner 1つなのか月ごとの複数なのかは知りようもないし、どちらでも構わない。
export const ModelCtx = createContext<HologramGridModel | null>(null);
// セルは生きているモデルをコンテキスト越しに読む。おかげでブリッジの render()/patch()
// （paint を増やして再描画）で modelOf がカードの状態を導き直せる（選択と詳細表示中は
// Cell の中の hologramStore の購読であって、このクロージャで読むモデルには入っていない）。
// セルは必ずプロバイダの中で載るので、null の既定値が外へ漏れることはない。
export const useGridModel = () => useContext(ModelCtx) as HologramGridModel;

export function VirtualGridHost({ model, cell, nav, anchor, marquee, onBackgroundClick }: { model: HologramGridModel; cell: ComponentType<GridCellProps>; nav?: boolean; anchor?: boolean; marquee?: HologramMarqueeSink; onBackgroundClick?: () => void }) {
  // アプリのスクロール容器（ウィンドウではない）。シェルが載るときに登録し、このホストが
  // 描画されるのは必ず後から取り付けたポータルの中なので、その時点では必ず存在する。
  const scroller = contentScroller() as HTMLElement;
  const containerRef = useRef<HTMLElement | null>(null);
  // masonry の容器の上端が、スクローラーの中身の中でどれだけ下にあるか（有効な絞り込みの
  // バーなどがグリッドの上に乗る）＝scrollTop からこれを引いて、masonic には容器を基準に
  // したスクロール量を見せる。状態ではなく ref にしてあるのは、これが変わるのが、
  // どのみち再描画を伴う出来事（リサイズ／itemsKey の push）と同時のときだけだから。
  const offsetRef = useRef(0);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [scrollY, setScrollY] = useState(() => scroller.scrollTop);
  const [isScrolling, setIsScrolling] = useState(false);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el || !el.offsetWidth) return; // 非表示（別の閲覧モード）＝最後の本物の寸法を保つ。positioner を幅0で初期化しない
    offsetRef.current = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    const width = el.offsetWidth;
    const height = scroller.clientHeight;
    setDims((d) => (d.width === width && d.height === height ? d : { width, height }));
  }, [scroller]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure, scroller]);

  // ズームがビューを掴んでいる状態（#282）で、まだそれを守っている間だけ生きる。状態では
  // なく ref にしてあるのは、下の位置合わせがレイアウトの effect で走るため、どこまで
  // 進んだかを覚えるのに再描画してはいけないから。
  const heldAnchorRef = useRef<ZoomAnchor | null>(null); // 今まだ位置を合わせにいっている対象
  const seenAnchorRef = useRef<ZoomAnchor | null | undefined>(undefined); // モデルから最後に読んだ anchor（undefined はまだ載っていない）
  const anchorScrollRef = useRef(0); // そのために自分が最後に書いた scrollTop
  const anchorItemsKeyRef = useRef(model.itemsKey);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      // 他の誰かがビューを動かした＝ズームの掴みは終わり。これが無いと掴みがジェスチャー
      // より長生きして、次の無関係な再描画で利用者を引き戻してしまう。自分の書き込みは
      // 先に anchorScrollRef に載るので、他人の動きに見えることはない。
      if (heldAnchorRef.current && Math.abs(scroller.scrollTop - anchorScrollRef.current) > 1) heldAnchorRef.current = null;
      setScrollY(scroller.scrollTop);
      setIsScrolling(true); // masonic: 動いている間は pointer-events を切り、will-change を付ける
      clearTimeout(t);
      t = setTimeout(() => setIsScrolling(false), 100);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      clearTimeout(t);
    };
  }, [scroller]);

  // 項目の集合が入れ替わった＝下の positioner はたった今初期化された。スクロールの状態を
  // 実際の値と取り直す（先頭のコメントの PoC の罠を参照）。あわせて測り直しもする:
  // グリッドの上にある中身（有効な絞り込みのバー）も一緒に伸び縮みしている可能性がある。
  // biome-ignore lint/correctness/useExhaustiveDependencies: model.itemsKey が引き金そのもの（中では読まない）＝項目の集合を組み直した時にちょうど走らせたい
  useLayoutEffect(() => {
    setScrollY(scroller.scrollTop);
    measure();
  }, [model.itemsKey, measure, scroller]);

  const positioner = usePositioner(
    {
      width: dims.width || 1, // 最初のフレームは測る前なので仮の値。描画前に正される
      // columnCount を渡すとレイアウトが固定される（一覧: 幅いっぱいの1列）。そうでない
      // 場合、columnWidth は masonic にとって最小値でしかなく、実際の列は埋めるまで
      // 伸びる＝昔の CSS の auto-fill minmax(size,1fr) と同じ挙動。columnWidth が変わる
      // （大きさのスライダーを引く → ブリッジの patch）と positioner は内部で作り直される
      // ので、実時間の再配置のために追加の配線はここに要らない。
      columnCount: model.columnCount,
      columnWidth: model.columnWidth,
      rowGutter: model.rowGutter,
      columnGutter: model.rowGutter,
    },
    [model.itemsKey],
  );
  const resizeObserver = useResizeObserver(positioner); // セルの高さが変わる（本文の展開、遅れて届く画像）と列を再配置する

  // まだ測っていないセルに masonic 自身が使う高さ＝下の代替の計算でも同じ値を使い回して、
  // 推定でのスクロールが、グリッドが実際に項目を置く位置に着地するようにする。
  const heightEstimate = model.square ? positioner.columnWidth : model.itemHeightEstimate || 120;

  // キーボードでの選択の移動が必要とする幾何を公開する（services/grid-nav.ts）。
  // positioner が作り直されるたび（itemsKey や幅の変化）に登録し直すので、ハンドルが
  // 古い位置のキャッシュを閉じ込めることはない。
  useEffect(() => {
    if (!nav) return;
    return registerGridNav({
      columnCount: () => positioner.columnCount,
      scrollIntoView: (index: number) => {
        const pos = positioner.get(index);
        const pad = model.rowGutter || 0;
        const viewTop = scroller.scrollTop;
        const viewHeight = scroller.clientHeight;
        if (!pos) {
          // まだ測っていない＝masonic は描画したものしか測らないので、これは遠くへの
          // 跳躍（Home/End くらいの移動であって、隣へ1つ進む動きではない）。その上に
          // あるもの全部の推定の高さを狙って中央に寄せ、描画された時点で本物の位置に
          // 引き継がせる。
          const est = positioner.estimateHeight(index, heightEstimate);
          scroller.scrollTo({ top: Math.max(0, offsetRef.current + est - viewHeight / 2) });
          return;
        }
        const top = offsetRef.current + pos.top;
        const bottom = top + pos.height;
        if (top - pad < viewTop) scroller.scrollTo({ top: Math.max(0, top - pad) });
        else if (bottom + pad > viewTop + viewHeight) scroller.scrollTo({ top: bottom + pad - viewHeight });
      },
    });
  }, [nav, positioner, scroller, heightEstimate, model.rowGutter]);

  // --- ズームの anchor（#282） --------------------------------------------------
  // 上の itemsKey での取り直しと兄弟の関係にある: どちらも「下のレイアウトが今変わった
  // ので、スクロール位置をあるべき場所へ戻す」であり、どちらもレイアウトが在るのが
  // ここだからここでしか答えられない。
  //
  // Ctrl+ホイールのズーム（#141）は masonry 全体を並べ直す。ズームの側は動かさずに
  // 留めたい項目を指す（services/zoom-anchor.ts の登録簿。下のレイアウトのモデルから
  // 解決する＝カードを DOM から引くことはしない）。こちらはその項目が最終的にどこへ
  // 行き着いたかを知っている側。

  // ズームは登録簿を通して尋ねる。答えるとは、自分の positioner を読むこと。
  useEffect(() => {
    if (!anchor) return;
    return registerZoomAnchorSource({
      resolve: (clientX: number, clientY: number) => {
        const el = containerRef.current;
        if (!el || !el.offsetWidth) return null; // 非表示（別の閲覧モード）
        const cr = el.getBoundingClientRect();
        // 候補は、見えている範囲のセルを容器の座標で表したもの。ポインタは作りからして
        // その範囲の中にある（スクローラーの上でのホイールのイベントだから）ので、
        // その中で最も近いものは必ず画面に映っている。
        const top = Math.max(0, scroller.scrollTop - offsetRef.current);
        const cells: ZoomAnchorCell[] = [];
        positioner.range(top, top + scroller.clientHeight, (index: number) => {
          const pos = positioner.get(index);
          if (pos) cells.push({ index, left: pos.left, top: pos.top, width: positioner.columnWidth, height: pos.height });
        });
        const index = pickAnchorIndex(cells, clientX - cr.left, clientY - cr.top);
        if (index == null) return null;
        const pos = positioner.get(index);
        if (!pos) return null;
        return { index, viewportOffset: anchorViewportOffset(pos.top, offsetRef.current, scroller.scrollTop) };
      },
    });
  }, [anchor, positioner, scroller]);

  // 掴んでいる anchor を守る。依存の配列を意図して付けていない: ズームが起こす再配置は
  // 複数のコミットにまたがって着地し（先に positioner が作り直され、次に masonic の
  // リサイズの監視が本物のセルの高さを流し込んでもう一度描画を強いる）、anchor はその
  // どれでも当て直さなければならない＝この「おおまかに合わせてから正確に落ち着く」2段が、
  // この層の外で rAF とタイムアウトの当てずっぽうが代役をしていたもの。anchor を掴んで
  // いないとき（普通のコミットはすべてそう）の仕事は数値をいくつか読むだけ。
  useLayoutEffect(() => {
    const incoming = (model.zoomAnchor as ZoomAnchor | null | undefined) ?? null;
    // 値ではなく同一性を見る: ズームは掴みを（改めて）構えたいたびに新しいオブジェクトを
    // 渡し、その間の繰り返しの get ではモデルが同じものを運び続ける。載った直後は基準を
    // 取るだけにする＝前の連射から残った古い anchor が、載ったばかりのグリッドを
    // スクロールさせてはいけない。
    const fresh = seenAnchorRef.current !== undefined && incoming !== null && incoming !== seenAnchorRef.current;
    if (fresh) heldAnchorRef.current = incoming;
    seenAnchorRef.current = incoming;
    // 項目の集合が違えば問いも違う＝ズームが掴んでいたものは無くなっている（絞り込み／
    // 並び替え／検索）。ただし、このコミット自体がズームの再描画で、新しい anchor を
    // 連れてきている場合を除く。
    if (model.itemsKey !== anchorItemsKeyRef.current) {
      anchorItemsKeyRef.current = model.itemsKey;
      if (!fresh) heldAnchorRef.current = null;
    }
    const held = heldAnchorRef.current;
    if (!held) return;
    const pos = positioner.get(held.index);
    // まだ配置されていない＝作り直したばかりの positioner はキャッシュが空で、masonic は
    // 描画したものしか測らない。その項目より上にあるもの全部について positioner 自身の
    // 推定を狙い（容器の高さを組み立てるのと同じ推定なので、両者は食い違わない）、
    // それを測ったコミットで正確な位置に引き継がせる。
    const top = pos ? pos.top : positioner.estimateHeight(held.index, heightEstimate);
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = anchorScrollTop(top, offsetRef.current, held.viewportOffset, max);
    if (Math.abs(target - scroller.scrollTop) > 0.5) scroller.scrollTop = target;
    // 書いた値を信じずに読み戻す: ブラウザは実際の中身に合わせて丸めるし、スクロールの
    // リスナーはこの値と比べて、自分が動かしたのか利用者が動かしたのかを見分ける。
    anchorScrollRef.current = scroller.scrollTop;
    setScrollY(scroller.scrollTop);
  });

  // 帯の当たり判定は生きている positioner を読むが、その effect をドラッグの途中で走らせ
  // 直すとジェスチャーが壊れる＝そこで依存ではなく ref 越しに届かせる（positioner は
  // itemsKey や幅が変わるたびに作り直される）。
  const positionerRef = useRef(positioner);
  positionerRef.current = positioner;

  // --- 空白の上でのジェスチャー（#484 のドラッグ・#242 のクリック） ----------------------
  // グリッドの背景を押す動作は1つで、結果は2つ。だから認識器も1つが両方を持つ:
  //  - ドラッグすれば → ゴムひもの帯が、触れたカードをすべて選ぶ（交差判定＝
  //    Explorer / Finder と同型）。Ctrl/Shift を押していれば、既存の選択を置き換える
  //    のではなく足す。ポインタを端に留めるとグリッドがスクロールするので、帯は1画面
  //    より先まで届く（#484）。
  //  - ドラッグせずに離せば → 背景の素のクリックで、選択を解除し、インスペクタを
  //    プレースホルダーへ戻す（#242）。
  // この2つを2本のリスナーへ分けろと迫るのが `click` のハンドラで、しかも click は
  // ドラッグの後にも起きる＝移動のしきい値を持っている認識器だけが、この2つを見分け
  // られる。
  //
  // `marquee` はドラッグ側の sink。選択を持たないグリッド（投稿者）は
  // onBackgroundClick だけを渡し、クリック側だけを受け取る。
  //
  // このグリッドの性質のうち2つが実装を決めている:
  //  - セルは絶対配置で、しかも使い回される。だから当たり判定は masonic の positioner
  //    （レイアウトのモデル）に対して走り、DOM の矩形に対しては決して走らない。これが、
  //    画面外へスクロールしたカードにも帯が届く理由であり、自動スクロールで載っている
  //    ものが入れ替わっても答えが揺れない理由でもある。
  //  - 帯はアニメーションのフレームごとに動く。描画は命令的にやっている（React の状態
  //    ではなく、切り離したオーバーレイ）＝フレームごとに状態を書けば、masonry の一部
  //    でもない矩形のために masonry 全体を再描画することになるから。
  useEffect(() => {
    if (!marquee && !onBackgroundClick) return;
    // スクローラーの表示領域と同じ大きさの、位置固定の切り抜きの箱と、その中の帯:
    // 帯の原点は押した点で、長いドラッグの間にスクロールで流れていく。切り抜きが無いと
    // ツールバーやサイドバーの上まで塗ってしまう。
    // contain:strict は、フレームごとに置き直される帯が自分の箱の外のレイアウトを
    // 無効化しないようにする。帯の色味は --color-selected を、Explorer/Finder が
    // ゴムひもの帯に与えるのと同じ「半透明の塗り＋髪の毛ほどの縁」の強さで使う。
    const clip = document.createElement('div');
    clip.dataset.slot = 'grid-marquee-clip';
    clip.className = 'pointer-events-none fixed z-45 overflow-hidden [contain:strict]';
    const bandEl = document.createElement('div');
    bandEl.dataset.slot = 'grid-marquee';
    bandEl.className = 'absolute top-0 left-0 border border-[color-mix(in_oklch,var(--color-selected)_70%,transparent)] bg-[color-mix(in_oklch,var(--color-selected)_16%,transparent)] [will-change:transform,width,height]';
    clip.appendChild(bandEl);

    let drag: {
      anchorX: number; // 押した点を容器の座標で。ドラッグの間ずっと動かない
      anchorY: number;
      startX: number; // 押した点をクライアントの座標で。移動のしきい値のためだけに使う
      startY: number;
      pointerX: number; // 最新のポインタをクライアントの座標で
      pointerY: number;
      additive: boolean;
      active: boolean; // しきい値を越えた＝これはクリックではなく範囲選択の帯
      lastHits: string;
      raf: number;
    } | null = null;

    const step = (allowScroll: boolean) => {
      const el = containerRef.current;
      if (!drag || !el || !marquee) return; // 選択を持たないグリッドには帯を出さない
      const sr = scroller.getBoundingClientRect();
      if (allowScroll) {
        const dy = autoScrollStep(drag.pointerY, sr.top, sr.bottom);
        if (dy) scroller.scrollTop += dy;
      }
      const cr = el.getBoundingClientRect();
      // 動いている方の角を、見えているグリッドの中に丸め込む: ポインタは端の外に出られる
      // し（それが自動スクロールを起こすもの）、ウィンドウの外へ出ることもある。どちらの
      // 場合も、グリッドではない装飾の上まで帯を伸ばしてはいけない。
      const viewRight = sr.left + scroller.clientWidth; // sr.right は使わない＝あちらはスクロールバーの余白まで含む
      const curX = Math.min(Math.max(drag.pointerX, sr.left), viewRight) - cr.left;
      const curY = Math.min(Math.max(drag.pointerY, sr.top), sr.bottom) - cr.top;
      const rect = rectFromPoints(drag.anchorX, drag.anchorY, curX, curY);

      clip.style.left = `${sr.left}px`;
      clip.style.top = `${sr.top}px`;
      clip.style.width = `${scroller.clientWidth}px`;
      clip.style.height = `${sr.height}px`;
      bandEl.style.transform = `translate(${cr.left + rect.x - sr.left}px, ${cr.top + rect.y - sr.top}px)`;
      bandEl.style.width = `${rect.width}px`;
      bandEl.style.height = `${rect.height}px`;

      // positioner.range() は masonic 自身の区間木の引きで、帯の縦の範囲に対して働く＝
      // 何かを歩くのではなく、ライブラリ全体に対して O(log n + 当たり数)。しかも高さを
      // 測り終えたセルなら、載っていようがいまいが答えてくれる。横の半分は続く
      // hitIndices() が受け持つ。
      const p = positionerRef.current;
      const cells: MarqueeCell[] = [];
      p.range(rect.y, rect.y + rect.height, (index: number) => {
        const pos = p.get(index);
        if (pos) cells.push({ index, left: pos.left, top: pos.top, width: p.columnWidth, height: pos.height });
      });
      const hits = hitIndices(rect, cells);
      const sig = hits.join(',');
      if (sig === drag.lastHits) return; // 前のフレームと同じカード＝ストアをかき混ぜない（セルは全部それを購読している）
      drag.lastHits = sig;
      marquee.update(hits);
    };

    const frame = () => {
      if (!drag?.active) return;
      step(true);
      drag.raf = requestAnimationFrame(frame);
    };

    const finish = (mode: 'end' | 'cancel') => {
      if (!drag) return;
      if (drag.raf) cancelAnimationFrame(drag.raf);
      clip.remove();
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      const active = drag.active;
      drag = null;
      // しきい値を一度も越えなかった＝押した動作はクリックであり、次に何が起きるかは
      // onUp が持つ＝クリックが完了しうる唯一の場所だから（#242）。それ以外の理由で
      // ここを畳むとき（外れる、Esc）は、クリックとして動いてはいけない。
      if (!active || !marquee) return;
      if (mode === 'cancel') marquee.cancel();
      else marquee.end();
    };

    const onMove = (e: MouseEvent) => {
      if (!drag) return;
      drag.pointerX = e.clientX;
      drag.pointerY = e.clientY;
      if (drag.active) return;
      if (!exceedsThreshold(e.clientX - drag.startX, e.clientY - drag.startY)) return;
      drag.active = true; // 押した動作はもうドラッグ＝帯が出るかどうかに関わらずクリックではない
      if (!marquee) return;
      marquee.begin(drag.additive);
      document.body.appendChild(clip);
      drag.raf = requestAnimationFrame(frame);
    };

    // 自動スクロール無しでもう一度だけ通す: 最後のフレームのスクロールで、masonic が
    // その後に測ったセルが帯の中に入っている可能性がある。ドラッグにならずに終わった
    // 離し方は、代わりにクリックの側（#242）＝finish() がジェスチャーを消す前に読み、
    // 消した後に適用するので、ハンドラから見て進行中のドラッグは無い。
    const onUp = () => {
      const clearing = !!drag && clearsSelection(drag.active, drag.additive);
      if (drag?.active) step(false);
      finish('end');
      if (clearing) onBackgroundClick?.();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      finish('cancel');
    };
    // ドラッグの途中でウィンドウがフォーカスを失えば、mouseup はもう来ない＝帯を永久に
    // 描いたまま残すのではなく、帯が選んだものを確定させる。
    const onBlur = () => finish('end');

    const onDown = (e: MouseEvent) => {
      if (drag || e.button !== 0) return;
      const el = containerRef.current;
      if (!el || !el.offsetWidth) return; // グリッドが非表示（別の閲覧モード）
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-slot="post-card"], [data-slot="poster-card"]')) return; // クリックと OS へのドラッグ持ち出しはセルが持つ（#132）
      if (target.closest('a, button, input, textarea, select, [role="button"], [contenteditable="true"]')) return;
      const sr = scroller.getBoundingClientRect();
      if (e.clientX - sr.left >= scroller.clientWidth) return; // スクロールバーの余白であって、グリッドではない
      const cr = el.getBoundingClientRect();
      drag = {
        anchorX: e.clientX - cr.left,
        anchorY: e.clientY - cr.top,
        startX: e.clientX,
        startY: e.clientY,
        // Explorer と同じで、押した時点で読む＝ドラッグの途中で修飾キーを叩いても、
        // 帯が置き換えから追加へ黙って切り替わってはいけない。
        additive: e.ctrlKey || e.metaKey || e.shiftKey,
        pointerX: e.clientX,
        pointerY: e.clientY,
        active: false,
        lastHits: '\0', // 本物の署名でこれに等しくなるものは無いので、最初のフレームは必ず送られる
        raf: 0,
      };
      e.preventDefault(); // そうしないと、押した動作がカードをまたぐ OS のテキスト選択を始めてしまう
      window.addEventListener('mousemove', onMove, true);
      window.addEventListener('mouseup', onUp, true);
      window.addEventListener('keydown', onKey, true);
      window.addEventListener('blur', onBlur);
    };

    scroller.addEventListener('mousedown', onDown);
    return () => {
      scroller.removeEventListener('mousedown', onDown);
      finish('end');
    };
  }, [marquee, onBackgroundClick, scroller]);

  const gridEl = useMasonry({
    positioner,
    resizeObserver,
    items: model.items,
    itemKey: (data, i) => {
      const k = model.keyOf && data != null ? model.keyOf(data, i) : undefined;
      return k == null ? i : k;
    },
    // 正方形のセルは、ちょうど1列分の幅と高さを持つ＝実際に計算された列の幅を使うと
    // 高さの推定が厳密になる（容器の高さが正確＝深いところまでスクロールした位置の
    // 復元も正確）。
    itemHeightEstimate: model.square ? positioner.columnWidth : model.itemHeightEstimate || 120,
    overscanBy: 2,
    height: dims.height || scroller.clientHeight,
    scrollTop: Math.max(0, scrollY - offsetRef.current),
    isScrolling,
    containerRef,
    tabIndex: -1, // 昔のグリッドはタブの止まり位置ではなかった。そのままにしておく
    render: cell,
  });

  return <ModelCtx.Provider value={model}>{gridEl}</ModelCtx.Provider>;
}

// 仮想化グリッドすべてに共通の載せ口＝今は単一の App の根の下に置くコンポーネント
// （AppShell が <PostGrid/> / <PosterGrid/> / <TrashGrid/> を描画する）。グリッドは
// 自前のホストの <div> へ描画し、その div をシェルのグリッドの枠へまるごと取り付け、
// React はそのホストへ masonry をポータルで送り込む。ノード1つを付けたり外したりする
// 形にしてあるので、空の push でセルを全部同期に外しても、React が自分の管理する
// ノードが足元で消えるのを見ずに済む。
//
// `container` は要素の id ではなく getter: シェルは自分の枠を services/content-area.ts
// 経由で渡す（#153 の分類2＝グリッドを id で引くものは無い）。
//
// 描画は同期に流し切る（flushSync）: viewer.js（React の外）は、push が完全にコミット
// されてから次の行が走ることを当てにしている（例えば push の直後に scrollTop を復元
// する）。ブリッジの push はどれも React の外から始まるので、flushSync を使ってよい。
// ブリッジは render/patch のたびに新しいモデルの参照を返す（{...model, paint:++}）ので、
// setModel は必ず再描画になる＝paint が増えると、見えているセルが modelOf 越しに
// viewer の生きた状態を読み直す（選択と詳細表示中は Cell の中の別々の hologramStore の
// 購読）。itemsKey が変われば positioner が初期化される。
// bridge に必要なのは get()/subscribe() だけ（HologramGridSource）＝投稿の供給元も
// 投稿者の供給元もそれを満たすし、加えて自前の configure() などを持つが、GridMount は
// そこに一切触れない。
export function GridMount({ bridge, container, renderHost }: { bridge: HologramGridSource; container: () => HTMLElement | null; renderHost: (model: HologramGridModel) => ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  if (!hostRef.current) {
    const h = document.createElement('div');
    h.style.width = '100%';
    hostRef.current = h;
  }
  const host = hostRef.current;
  const [model, setModel] = useState<HologramGridModel | null>(null);

  useEffect(() => {
    // ホストへ描画する前に、ホストを容器へ取り付ける＝masonic は載る時に offsetWidth を
    // 測るので、切り離されたままのホストは0と測る（グリッドが真っ白になる罠）。
    const attach = () => {
      const c = container();
      if (c && !host.isConnected) c.appendChild(host);
    };
    const sync = () => {
      const m = bridge.get();
      if (m) {
        attach();
        flushSync(() => setModel(m));
      } else {
        flushSync(() => setModel(null));
        host.remove(); // 枠がまた空になった＝その場所は空状態が使う
      }
    };
    const unsub = bridge.subscribe(sync);
    // この effect が走る前に push されたモデルを拾う＝素の setState（effect の中でも安全で、flushSync は要らない）。
    if (bridge.get()) {
      attach();
      setModel(bridge.get());
    }
    return unsub;
  }, [bridge, container, host]);

  return model ? createPortal(renderHost(model), host) : null;
}
