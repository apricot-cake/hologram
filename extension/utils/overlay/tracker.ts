// DOM の発見: どの投稿ユニットが存在し、どれが画面上にあり、それぞれが
// 今どの media/anchor の箱を持っているか。#399 で overlay.ts から分離し
// た。このモジュールは保存状態、「繋がっているか」以上の幾何情報、何が
// 描かれるかについては何も知らない＝何を追跡し、いつそれが画面に入る/
// 出るか、あるいはページから完全に取り除かれるかだけを決める。
import type { OverlaySite } from '../extractor/types.ts';
import type { Anchor, UnitState } from './types.ts';

export interface TrackerCallbacks {
  // アンカーが生きていなくなった（箱がリサイクルされて消えた、または
  // ユニットがページから完全に離脱した）。常に、呼び出し元がその操作を
  // 取り壊し（control.ts の removeControl）、それを指すホバーがあれば落
  // とすべき合図になる。
  onAnchorRemoved(anchor: Anchor): void;
  // 監視対象のユニットがビューポートに入った。
  onEnter(unit: Element, state: UnitState): void;
  // 監視対象のユニットがビューポートを出た（または離脱中に刈り取られ
  // た）。
  onLeave(unit: Element, state: UnitState): void;
  // 1回の IntersectionObserver コールバックのバッチに含まれるすべての
  // エントリを適用し終えた。
  onIntersectionSettled(): void;
  // ページ自身の DOM が変わった。`childrenChanged` は新しいユニットの再
  // スキャンをゲートし、どちらのフラグもホバー中のアンカーの再チェック
  // が必要かもしれないことを示しうる。
  onMutation(childrenChanged: boolean, modalChanged: boolean): void;
}

export interface Tracker {
  readonly tracked: Map<Element, UnitState>;
  readonly visible: Set<Element>;
  // media/text の箱 -> それが属するユニットと Anchor（ポインタ駆動のホ
  // バー検索が必要とする逆引き索引）。
  readonly anchorOf: Map<Element, { unit: Element; anchor: Anchor }>;
  // ユニットの media の箱を、その Anchor のマップへ読み直す。フィード
  // は最初の描画の後に投稿へ画像を追加することがある（遅延読み込み画
  // 像、引用プレビューの解決）し、同じユニット要素がまったく別の投稿の
  // ためにリサイクルされることもあるので、これは1回きりではなく描画の
  // たびに呼ばれる。
  syncAnchors(unit: Element, state: UnitState): void;
  scan(): void;
  forgetDetached(): void;
  dispose(): void;
}

export function createTracker(site: OverlaySite, opts: { maxTracked: number; scanDebounceMs: number; observerMargin: string }, callbacks: TrackerCallbacks): Tracker {
  const tracked = new Map<Element, UnitState>();
  const visible = new Set<Element>();
  const anchorOf = new Map<Element, { unit: Element; anchor: Anchor }>();
  let scanTimer: ReturnType<typeof setTimeout> | null = null;

  function syncAnchors(unit: Element, state: UnitState): void {
    const mediaBoxes = site.mediaIn(unit);
    // テキストのみの投稿（#575）にはキーにできる画像がないので、ユニッ
    // ト自身が唯一の合成アンカーになる。ただしそれも、サイト側がそれを
    // 配置する近くのアバターを指し示せる場合だけで、それ以外は、これが
    // 存在する前と同じく印なしのままになる。
    const textAnchor = mediaBoxes.length ? null : (site.textAnchorIn?.(unit) ?? null);
    const boxes: Element[] = mediaBoxes.length ? mediaBoxes : textAnchor ? [unit] : [];
    const live = new Set(boxes);
    for (const [box, anchor] of state.anchors) {
      if (live.has(box) && box.isConnected) continue;
      callbacks.onAnchorRemoved(anchor);
      anchorOf.delete(box);
      state.anchors.delete(box);
    }
    for (const box of boxes) {
      if (state.anchors.has(box)) continue;
      const kind: Anchor['kind'] = mediaBoxes.length ? 'media' : 'text';
      const anchor: Anchor = { box, kind, el: null, root: null, control: null, host: null, hostInlinePosition: null, hostInlinePriority: '', face: null, accessibleName: null, phase: 'idle', timer: null };
      state.anchors.set(box, anchor);
      anchorOf.set(box, { unit, anchor });
    }
  }

  function scan(): void {
    if (tracked.size >= opts.maxTracked) forgetDetached();
    for (const unit of Array.from(document.querySelectorAll(site.unitSelector))) {
      if (tracked.has(unit)) continue;
      if (tracked.size >= opts.maxTracked) break;
      tracked.set(unit, { url: null, saved: null, anchors: new Map() });
      io.observe(unit);
    }
  }

  // ページがアンマウントしたユニット（SPA の遷移、フィードのリサイク
  // ル）。監視するのではなく遅延して捨てる＝x.com のフィードに削除用の
  // observer を置くと、こちらが追跡していないノードに対しても絶えず発
  // 火してしまう。
  function forgetDetached(): void {
    for (const [unit, state] of tracked) {
      if (unit.isConnected) continue;
      io.unobserve(unit);
      visible.delete(unit);
      callbacks.onLeave(unit, state);
      for (const [box, anchor] of state.anchors) {
        callbacks.onAnchorRemoved(anchor);
        anchorOf.delete(box);
      }
      state.anchors.clear();
      tracked.delete(unit);
    }
  }

  function scheduleScan(): void {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, opts.scanDebounceMs);
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const state = tracked.get(entry.target);
        if (entry.isIntersecting) {
          visible.add(entry.target);
          if (state) callbacks.onEnter(entry.target, state);
        } else {
          visible.delete(entry.target);
          if (state) callbacks.onLeave(entry.target, state);
        }
      }
      callbacks.onIntersectionSettled();
    },
    { rootMargin: opts.observerMargin },
  );

  const mo = new MutationObserver((records) => {
    const childrenChanged = records.some((record) => record.type === 'childList');
    const modalChanged = records.some((record) => record.type === 'attributes' && record.target instanceof Element && record.target.matches('dialog, [role="dialog"], [aria-modal]'));
    callbacks.onMutation(childrenChanged, modalChanged);
    if (childrenChanged) scheduleScan();
  });
  mo.observe(document.documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ['aria-modal', 'class', 'hidden', 'open', 'style'],
    subtree: true,
  });
  scan();

  function dispose(): void {
    io.disconnect();
    mo.disconnect();
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;
    tracked.clear();
    anchorOf.clear();
    visible.clear();
  }

  return { tracked, visible, anchorOf, syncAnchors, scan, forgetDetached, dispose };
}
