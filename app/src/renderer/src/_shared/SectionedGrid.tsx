// セクション分けしたグリッドのホスト（#47）＝日付ソートのための月のセクションの見出し。
// _shared/VirtualGrid.tsx の VirtualGridHost の兄弟であって、その改造ではない。他のどの
// ソート・閲覧モードも、あの単一インスタンスの経路をまったく変えずに使い続ける（Grid.tsx が
// model.sections を見て振り分ける＝GridHost を参照）。このホストが載るのは、日付ソートが
// グリッドの項目を HologramDateSection のバケットへまとめた時だけ
// （services/post-grid-builder.ts / date-sections.ts）。
//
// 以下すべての形を決めている設計上の制約（#47 の issue、2026-07-11 の調査コメントで確定）:
// masonic には幅一杯の行の区切りという概念が無いので、月の見出しを、共有する1つの masonry の
// インスタンスに混ぜ込む疑似項目にはできない。1つの列だけがその場所を確保し、他の列は確保
// しないからで、これは稀な境界事例ではなく壊れたレイアウトである。そこで月ごとに自前の
// masonic のインスタンスを持たせ（自前の usePositioner/useResizeObserver/useMasonry）、
// セクションはふつうの文書の流れの中でただ積み上がるようにした。ブラウザは他のブロックの
// 内容とまったく同じように上から下へ並べるので、レイアウトのために累積の位置を手で帳簿付け
// する必要は無い。
//
// issue の調査メモと違い、セクションを IntersectionObserver で遅れて載せたり外したりは
// しない。あの仕掛けは、投稿が数千ある library で DOM の大きさを頭打ちにするためのもの
// だったが、masonic はそれを既に自分でやっている。useMasonry が描くのは、渡された
// positioner の [scrollTop, scrollTop+height]（＋overscan）の中にあるセルだけ＝あるセクション
// 自身の範囲から遠く外れたローカルの scrollTop を渡せば（つまりそのセクションが画面から
// よく外れていれば）、そのセクションについて描かれるセルは0になる。今日 9千件のライブラリに
// 対して単一グリッドの経路が既にやっているのと同じこと。N 個のインスタンスに割る代償は、
// 小さな位置のキャッシュ N 個と、（ほとんど空で画面外の）容器の div が N 個。既に扱っている
// カードの枚数に比べれば無視できる。これは issue の調査が挙げていた「プレースホルダの高さと
// 実測の高さが食い違う」というスクロール補正の罠も回避する。プレースホルダから本物の内容へ
// 差し替わることが一度も無いので、補正すべき飛びがそもそも起きない。
//
// nav（キーボードの矢印での移動）、マーキー（ドラッグによる範囲選択）、Ctrl+ホイールのズームの
// アンカーは、どれもアプリ全体で1つずつのレジストリ（services/grid-nav.ts / zoom-anchor.ts）
// で、positioner 1つに支えられたグリッド1つのために作られている。それらのレジストリや、その
// 多くの呼び出し側（selection-builder.ts、grid-density-builder.ts）に手を入れる代わりに、この
// ホストもそれぞれちょうど1つのハンドルを登録する。ただ答え方が違うだけで、グローバルな添字や
// 点がどのセクションに落ちるかを見つけ、そのセクションの positioner へ委ね、添字を
// ± section.startIndex で読み替える。既存の呼び出し側はどれも手を入れずに動き続ける。
import { useMasonry, usePositioner, useResizeObserver } from 'masonic';
import type { Positioner } from 'masonic';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { scroller as contentScroller } from '../services/content-area.ts';
import { registerGridNav } from '../services/grid-nav.ts';
import { autoScrollStep, clearsSelection, exceedsThreshold, hitIndices, rectFromPoints } from '../services/marquee.ts';
import type { MarqueeCell } from '../services/marquee.ts';
import { anchorScrollTop, anchorViewportOffset, pickAnchorIndex, registerZoomAnchorSource } from '../services/zoom-anchor.ts';
import type { ZoomAnchor, ZoomAnchorCell } from '../services/zoom-anchor.ts';
import { ModelCtx } from './VirtualGrid.tsx';
import type { GridCellProps } from './VirtualGrid.tsx';

// 載っているセクション1つについて、親が控えておくもの。nav／マーキー／ズームが必要になった
// 時に読む（フレームをまたいでキャッシュはしない。getBoundingClientRect は安いし、こうすれば
// 常に正しく、古くなったかどうかの帳簿付けも要らない）。
interface SectionHandle {
  bodyEl: HTMLElement | null;
  positioner: Positioner;
  startIndex: number;
  count: number;
}

// `scroller` のスクロールできる中身の中で、`el` の上端がどれだけ下にあるか（中身を基準に
// した値）。scrollTop の項がスクロールの分を打ち消すので、素の getBoundingClientRect の差と
// 違い、スクローラーがどれだけ動いていても正しいままになる（VirtualGridHost 自身の offsetRef
// が使うのと同じ式）。
function contentOffsetOf(el: HTMLElement, scroller: HTMLElement): number {
  return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
}

export function SectionedGridHost({ model, cell, nav, anchor, marquee, onBackgroundClick }: { model: HologramGridModel; cell: ComponentType<GridCellProps>; nav?: boolean; anchor?: boolean; marquee?: HologramMarqueeSink; onBackgroundClick?: () => void }) {
  const sections = model.sections || [];
  const scroller = contentScroller() as HTMLElement;
  const containerRef = useRef<HTMLElement | null>(null); // 外側の包み。すべてのセクションにまたがる
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [scrollY, setScrollY] = useState(() => scroller.scrollTop);
  const [isScrolling, setIsScrolling] = useState(false);
  // 外側の包み自身の大きさが変わるたびに1つ進める。子のどれかのリサイズでもこれは起きるので
  // （高さが内容で決まるブロック）、「どこかのセクションの本当の高さが今定まった、その下に
  // あるものは全部動いたかもしれない」の合図も兼ねる。セクションの本体は、これを見て自分の
  // スクロールを基準にした位置を測り直す。
  const [layoutTick, setLayoutTick] = useState(0);

  const measure = useCallback(() => {
    const el = containerRef.current;
    if (!el || !el.offsetWidth) return; // 非表示（別の閲覧モード）
    const width = el.offsetWidth;
    const height = scroller.clientHeight;
    setDims((d) => (d.width === width && d.height === height ? d : { width, height }));
    setLayoutTick((t) => t + 1);
  }, [scroller]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [measure, scroller]);

  // ズームが表示位置を保つための握り（#282）＝VirtualGridHost 自身のものと同じ形で、この
  // ホストのインスタンスに閉じている。
  const heldAnchorRef = useRef<ZoomAnchor | null>(null);
  const seenAnchorRef = useRef<ZoomAnchor | null | undefined>(undefined);
  const anchorScrollRef = useRef(0);
  const anchorItemsKeyRef = useRef(model.itemsKey);

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (heldAnchorRef.current && Math.abs(scroller.scrollTop - anchorScrollRef.current) > 1) heldAnchorRef.current = null;
      setScrollY(scroller.scrollTop);
      setIsScrolling(true);
      clearTimeout(t);
      t = setTimeout(() => setIsScrolling(false), 100);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      clearTimeout(t);
    };
  }, [scroller]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: model.itemsKey が引き金そのもの（中では読まない）＝項目の集合を組み直した時にちょうど走らせたい
  useLayoutEffect(() => {
    setScrollY(scroller.scrollTop);
    measure();
  }, [model.itemsKey, measure, scroller]);

  // 今載っているセクションのレジストリ（常に全セクション。ここで遅れて載せたり外したりしない
  // 理由は冒頭のコメントを参照）。
  const sectionHandles = useRef(new Map<string, SectionHandle>()).current;
  const registerSection = useCallback(
    (key: string, handle: SectionHandle | null) => {
      if (handle) sectionHandles.set(key, handle);
      else sectionHandles.delete(key);
    },
    [sectionHandles],
  );
  // 共有の列数。どのセクションも同じ model.columnWidth と容器の幅から並べるので、最後に列数を
  // 報告したセクションが全部を代表する。
  const columnCountRef = useRef(1);

  const sectionFor = useCallback(
    (globalIndex: number) => {
      for (const s of sections) if (globalIndex >= s.startIndex && globalIndex < s.startIndex + s.count) return s;
      return null;
    },
    [sections],
  );

  // --- キーボードでの移動（矢印キー）＝ホスト全体で登録は1つ ---
  useEffect(() => {
    if (!nav) return;
    return registerGridNav({
      columnCount: () => columnCountRef.current,
      scrollIntoView: (index: number) => {
        const sec = sectionFor(index);
        const h = sec && sectionHandles.get(sec.key);
        if (!sec || !h || !h.bodyEl) return;
        const localIndex = index - sec.startIndex;
        const pad = model.rowGutter || 0;
        const viewTop = scroller.scrollTop;
        const viewHeight = scroller.clientHeight;
        const off = contentOffsetOf(h.bodyEl, scroller);
        const pos = h.positioner.get(localIndex);
        if (!pos) {
          const estimate = model.square ? h.positioner.columnWidth : model.itemHeightEstimate || 120;
          const est = h.positioner.estimateHeight(localIndex, estimate);
          scroller.scrollTo({ top: Math.max(0, off + est - viewHeight / 2) });
          return;
        }
        const top = off + pos.top;
        const bottom = top + pos.height;
        if (top - pad < viewTop) scroller.scrollTo({ top: Math.max(0, top - pad) });
        else if (bottom + pad > viewTop + viewHeight) scroller.scrollTo({ top: bottom + pad - viewHeight });
      },
    });
    // sections と model の同一性が変わると（ソートや絞り込み）、それらを閉じ込めた古い
    // クロージャは無効になる。
  }, [nav, sectionFor, sectionHandles, scroller, model.rowGutter, model.square, model.itemHeightEstimate]);

  // --- Ctrl+ホイールのズームのアンカー（#282）＝点を、その上にあるセクションへ解決する ---
  useEffect(() => {
    if (!anchor) return;
    return registerZoomAnchorSource({
      resolve: (clientX: number, clientY: number) => {
        for (const sec of sections) {
          const h = sectionHandles.get(sec.key);
          if (!h?.bodyEl || !h.bodyEl.offsetWidth) continue;
          const cr = h.bodyEl.getBoundingClientRect();
          if (clientY < cr.top || clientY > cr.bottom) continue; // セクションは縦に積み上がる＝ポインタが実際に乗っているものを選ぶ
          const off = contentOffsetOf(h.bodyEl, scroller);
          const top = Math.max(0, scroller.scrollTop - off);
          const cells: ZoomAnchorCell[] = [];
          h.positioner.range(top, top + scroller.clientHeight, (index: number) => {
            const pos = h.positioner.get(index);
            if (pos) cells.push({ index: index + sec.startIndex, left: pos.left, top: pos.top, width: h.positioner.columnWidth, height: pos.height });
          });
          const idx = pickAnchorIndex(cells, clientX - cr.left, clientY - cr.top);
          if (idx == null) return null;
          const pos = h.positioner.get(idx - sec.startIndex);
          if (!pos) return null;
          return { index: idx, viewportOffset: anchorViewportOffset(pos.top, off, scroller.scrollTop) };
        }
        return null;
      },
    });
  }, [anchor, sections, sectionHandles, scroller]);

  // 握ったアンカーを、レイアウトのやり直しが落ち着くまでの複数回のコミットにわたって守る。
  // VirtualGridHost 自身と同じく依存配列を持たない形（対象のセクションが実測の位置を報告する
  // まで、コミットのたびに当て直す）。
  useLayoutEffect(() => {
    const incoming = (model.zoomAnchor as ZoomAnchor | null | undefined) ?? null;
    const fresh = seenAnchorRef.current !== undefined && incoming !== null && incoming !== seenAnchorRef.current;
    if (fresh) heldAnchorRef.current = incoming;
    seenAnchorRef.current = incoming;
    if (model.itemsKey !== anchorItemsKeyRef.current) {
      anchorItemsKeyRef.current = model.itemsKey;
      if (!fresh) heldAnchorRef.current = null;
    }
    const held = heldAnchorRef.current;
    if (!held) return;
    const sec = sectionFor(held.index);
    const h = sec && sectionHandles.get(sec.key);
    if (!sec || !h || !h.bodyEl) return;
    const localIndex = held.index - sec.startIndex;
    const off = contentOffsetOf(h.bodyEl, scroller);
    const pos = h.positioner.get(localIndex);
    const estimate = model.square ? h.positioner.columnWidth : model.itemHeightEstimate || 120;
    const top = pos ? pos.top : h.positioner.estimateHeight(localIndex, estimate);
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = anchorScrollTop(top, off, held.viewportOffset, max);
    if (Math.abs(target - scroller.scrollTop) > 0.5) scroller.scrollTop = target;
    anchorScrollRef.current = scroller.scrollTop;
    setScrollY(scroller.scrollTop);
  });

  // --- ドラッグによるマーキー選択（#484）＋余白のクリック（#242）------------
  // ジェスチャの判定は VirtualGridHost と同じ（1つの押下に2つの結末）。違うのは当たり判定
  // だけで、載っているセクションを1つずつ回り、共有のドラッグの矩形をそれぞれの容器の座標へ
  // 移してから、そのセクションの positioner.range() を呼ぶ。当たった添字は
  // + section.startIndex で戻してから marquee.update() へ渡す（あちらが添字を引くのは、
  // 平らでグループ分けされていない viewGroups の配列＝selection.ts を参照）。
  useEffect(() => {
    if (!marquee && !onBackgroundClick) return;
    const clip = document.createElement('div');
    clip.dataset.slot = 'grid-marquee-clip';
    clip.className = 'pointer-events-none fixed z-45 overflow-hidden [contain:strict]';
    const bandEl = document.createElement('div');
    bandEl.dataset.slot = 'grid-marquee';
    bandEl.className = 'absolute top-0 left-0 border border-[color-mix(in_oklch,var(--color-selected)_70%,transparent)] bg-[color-mix(in_oklch,var(--color-selected)_16%,transparent)] [will-change:transform,width,height]';
    clip.appendChild(bandEl);

    let drag: {
      anchorX: number;
      anchorY: number;
      startX: number;
      startY: number;
      pointerX: number;
      pointerY: number;
      additive: boolean;
      active: boolean;
      lastHits: string;
      raf: number;
    } | null = null;

    const step = (allowScroll: boolean) => {
      const el = containerRef.current;
      if (!drag || !el || !marquee) return;
      const sr = scroller.getBoundingClientRect();
      if (allowScroll) {
        const dy = autoScrollStep(drag.pointerY, sr.top, sr.bottom);
        if (dy) scroller.scrollTop += dy;
      }
      const cr = el.getBoundingClientRect();
      const viewRight = sr.left + scroller.clientWidth;
      const curX = Math.min(Math.max(drag.pointerX, sr.left), viewRight) - cr.left;
      const curY = Math.min(Math.max(drag.pointerY, sr.top), sr.bottom) - cr.top;
      const rect = rectFromPoints(drag.anchorX, drag.anchorY, curX, curY); // 外側の容器の座標

      clip.style.left = `${sr.left}px`;
      clip.style.top = `${sr.top}px`;
      clip.style.width = `${scroller.clientWidth}px`;
      clip.style.height = `${sr.height}px`;
      bandEl.style.transform = `translate(${cr.left + rect.x - sr.left}px, ${cr.top + rect.y - sr.top}px)`;
      bandEl.style.width = `${rect.width}px`;
      bandEl.style.height = `${rect.height}px`;

      const hits: number[] = [];
      for (const [, h] of sectionHandles) {
        if (!h.bodyEl) continue;
        const sectionTop = h.bodyEl.getBoundingClientRect().top - cr.top; // 外側の容器の中での、このセクションの上端
        const localRect = { x: rect.x, y: rect.y - sectionTop, width: rect.width, height: rect.height };
        const cells: MarqueeCell[] = [];
        h.positioner.range(localRect.y, localRect.y + localRect.height, (index: number) => {
          const pos = h.positioner.get(index);
          if (pos) cells.push({ index: index + h.startIndex, left: pos.left, top: pos.top, width: h.positioner.columnWidth, height: pos.height });
        });
        hits.push(...hitIndices(localRect, cells));
      }
      hits.sort((a, b) => a - b);
      const sig = hits.join(',');
      if (sig === drag.lastHits) return;
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
      drag.active = true;
      if (!marquee) return;
      marquee.begin(drag.additive);
      document.body.appendChild(clip);
      drag.raf = requestAnimationFrame(frame);
    };

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
    const onBlur = () => finish('end');

    const onDown = (e: MouseEvent) => {
      if (drag || e.button !== 0) return;
      const el = containerRef.current;
      if (!el || !el.offsetWidth) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('[data-slot="post-card"], [data-slot="poster-card"]')) return;
      if (target.closest('a, button, input, textarea, select, [role="button"], [contenteditable="true"]')) return;
      const sr = scroller.getBoundingClientRect();
      if (e.clientX - sr.left >= scroller.clientWidth) return;
      const cr = el.getBoundingClientRect();
      drag = {
        anchorX: e.clientX - cr.left,
        anchorY: e.clientY - cr.top,
        startX: e.clientX,
        startY: e.clientY,
        additive: e.ctrlKey || e.metaKey || e.shiftKey,
        pointerX: e.clientX,
        pointerY: e.clientY,
        active: false,
        lastHits: ' ',
        raf: 0,
      };
      e.preventDefault();
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
  }, [marquee, onBackgroundClick, scroller, sectionHandles]);

  return (
    <ModelCtx.Provider value={model}>
      <div ref={containerRef as React.Ref<HTMLDivElement>} data-slot="sectioned-grid" style={{ width: '100%' }}>
        {sections.map((sec) => (
          <SectionBlock
            // 同一性の一部は、月だけでなく範囲でもある（#871）。ブロックの masonic の
            // インスタンスは添字ごとに実測の高さをキャッシュしており、masonic の取り決め
            // では、リセット無しに `items` が短くなることは無い。キャッシュを抱えたまま
            // 短くなったスライスを渡すと、末尾を越えた添字まで歩き、そこでは items[index]
            // が undefined になって、描画のメモが WeakMap.set(undefined) で死ぬ（グリッドの
            // 「画面を表示できませんでした」のクラッシュ）。きれいなキャッシュを保証するのは
            // マウントし直すことで、usePositioner の deps だけでは保証されない。deps と同じ
            // 描画の中で容器の幅が変わると、masonic は古いキャッシュを新しい positioner へ
            // 写すからだ（その `optsChanged` の枝は deps の変化と排他ではない）。新しく
            // マウントすれば、写す元になる前のインスタンスが無い。代償はセクション1つ分の
            // DOM で、そもそも範囲が動いたなら中身も変わっている。
            key={`${sec.key}:${sec.startIndex}:${sec.count}`}
            sec={sec}
            model={model}
            cell={cell}
            scroller={scroller}
            dims={dims}
            scrollY={scrollY}
            isScrolling={isScrolling}
            layoutTick={layoutTick}
            onRegister={registerSection}
            onColumnCount={(n) => {
              columnCountRef.current = n;
            }}
          />
        ))}
      </div>
    </ModelCtx.Provider>
  );
}

// 1つの月が持つ、自前の masonic のインスタンス。items は model.items（平らな viewGroups の
// 配列）のスライスで、masonic が `cell` へ渡すローカルの添字がグローバルなものへ読み替え
// られることは決してない。cardModel も keyOf も、グループのオブジェクト自身だけから導くし
// （添字の引数からは決して導かない＝records.ts の cardModel/postIdKey を参照）、選択と nav は、
// セルがどの添字で描かれたかを信じるのではなく、同一性から自分の添字を解決する（正規の
// viewGroups に対する Array#indexOf）。+startIndex の読み替えが要るのは、上のまとめ役
// （マーキーの当たり、nav の scrollIntoView、ズームのアンカー）だけ。
function SectionBlock({
  sec,
  model,
  cell: Cell,
  scroller,
  dims,
  scrollY,
  isScrolling,
  layoutTick,
  onRegister,
  onColumnCount,
}: {
  sec: HologramDateSection;
  model: HologramGridModel;
  cell: ComponentType<GridCellProps>;
  scroller: HTMLElement;
  dims: { width: number; height: number };
  scrollY: number;
  isScrolling: boolean;
  layoutTick: number;
  onRegister(key: string, handle: SectionHandle | null): void;
  onColumnCount(n: number): void;
}) {
  const bodyRef = useRef<HTMLElement | null>(null);
  const offsetRef = useRef(0); // 中身を基準にしたこのセクションの上端（contentOffsetOf を参照）＝リサイズには1コミット遅れ、次のコミットで直る（VirtualGridHost 自身の offsetRef が飲んでいるのと同じ取引）
  const items = model.items.slice(sec.startIndex, sec.startIndex + sec.count);

  const positioner = usePositioner(
    {
      width: dims.width || 1,
      columnCount: model.columnCount,
      columnWidth: model.columnWidth,
      rowGutter: model.rowGutter,
      columnGutter: model.rowGutter,
    },
    // 「範囲は同じで項目が違う」場合を拾う（作り直しの結果、たまたまこの月のバケットの
    // 大きさが変わらなかったとき）。範囲そのものが動いた場合は、1つ上でブロックをマウント
    // し直して扱う＝親が与えるキーを参照（#871）。
    [model.itemsKey, sec.key],
  );
  const resizeObserver = useResizeObserver(positioner);

  useEffect(() => {
    onColumnCount(positioner.columnCount);
  }, [positioner.columnCount, onColumnCount]);

  useEffect(() => {
    onRegister(sec.key, { bodyEl: bodyRef.current, positioner, startIndex: sec.startIndex, count: sec.count });
    return () => onRegister(sec.key, null);
  }, [sec.key, sec.startIndex, sec.count, positioner, onRegister]);

  // 全体のレイアウトがこのセクションをずらし得たとき（リサイズ、あるいはどれかのセクションが
  // 本当の高さに落ち着いたとき＝layoutTick 自身のコメントを参照）、または項目の集合が変わった
  // ときに、このセクション自身のスクロールを基準にした位置を測り直す。
  // biome-ignore lint/correctness/useExhaustiveDependencies: layoutTick と model.itemsKey が引き金（中では読まない）＝全体のレイアウトがずれうる時にちょうど測り直したい
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el) offsetRef.current = contentOffsetOf(el, scroller);
  }, [layoutTick, model.itemsKey, scroller]);

  const heightEstimate = model.square ? positioner.columnWidth : model.itemHeightEstimate || 120;

  const gridEl = useMasonry({
    positioner,
    resizeObserver,
    items,
    itemKey: (data, i) => {
      const k = model.keyOf && data != null ? model.keyOf(data, i) : undefined;
      return k == null ? sec.startIndex + i : k;
    },
    itemHeightEstimate: heightEstimate,
    overscanBy: 2,
    height: dims.height || scroller.clientHeight,
    // 0 で頭打ちにはしない（#880）。まだビューポートより下にあるセクションが欲しいのは負の
    // ローカル scrollTop で、それがあってこそ masonic 自身の
    // range(max(0, scrollTop - overscan/2), scrollTop + overscan) がそのセクションについて空を
    // 返す。頭打ちにすると、まだ到達していないセクションのすべてに「お前の上端は画面に出て
    // いる」と告げることになり、どれもビューポート1杯分のセルを描いた＝16枚しか見えていない
    // ところに 143 枚のカードが載り、そのうえ :has() がセルの挿入ごとに強いるスタイルの再計算
    // が、文書全体に対して走った。
    scrollTop: scrollY - offsetRef.current,
    isScrolling,
    containerRef: bodyRef as React.MutableRefObject<HTMLElement | null>,
    tabIndex: -1,
    render: Cell,
  });

  return (
    <div data-slot="grid-section">
      {/* スクローラーの上端に貼り付くのではなく、自分の月と一緒に流れていく（#878）。
          masonry の列は決して揃わないので、貼り付いた見出しは必ずどれかのカードの真ん中を
          横切る。 */}
      <div data-slot="grid-section-header" className="flex items-baseline gap-2 py-2 text-sm font-medium text-foreground first:pt-0">
        {sec.label}
      </div>
      {gridEl}
    </div>
  );
}
