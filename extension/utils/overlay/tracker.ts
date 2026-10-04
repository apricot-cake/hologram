// DOM の発見: どの投稿ユニットが存在し、どれが画面上にあり、それぞれが
// 今どの media/anchor の箱を持っているか。#399 で overlay.ts から分離し
// た。このモジュールは保存状態、「繋がっているか」以上の幾何情報、何が
// 描かれるかについては何も知らない＝何を追跡し、いつそれが画面に入る/
// 出るか、あるいはページから完全に取り除かれるかだけを決める。
import type { OverlaySite } from '../extractor/types.ts';
import { logSaveEvent } from '../capture-log.ts';
import { guardCaughtException } from '../uncaught-report.ts';
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
  // ページ自身の DOM が変わった。`contentChanged` は既存ユニットの media
  // と identity の再読込を、`modalChanged` はホバーの遮蔽判定を要求する。
  // records は、呼び出し元が画面上のどのユニットだけを読み直すべきかを
  // 絞るために渡す。
  onMutation(contentChanged: boolean, modalChanged: boolean, records: MutationRecord[]): void;
}

export interface Tracker {
  readonly tracked: Map<Element, UnitState>;
  readonly visible: Set<Element>;
  // ホバー領域 -> それが属するユニットと、ポスト単位の Anchor。
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
  const observerMarginPx = Number.parseFloat(opts.observerMargin) || 0;

  function syncAnchors(unit: Element, state: UnitState): void {
    const mediaBoxes = site.mediaIn(unit);
    const avatar = site.textAnchorIn?.(unit) ?? null;
    const targets: Array<{ box: Element; kind: Anchor['kind']; hitBoxes: Element[] }> = mediaBoxes.map((box) => ({ box, kind: 'media', hitBoxes: [box] }));
    if (avatar && mediaBoxes.length !== 1) targets.push({ box: unit, kind: 'text', hitBoxes: [unit] });
    for (const [box, anchor] of state.anchors) {
      if (targets.some((target) => target.box === box && target.kind === anchor.kind)) continue;
      callbacks.onAnchorRemoved(anchor);
      removeAnchorIndex(anchor);
      state.anchors.delete(box);
    }
    for (const target of targets) {
      if (state.anchors.has(target.box)) continue;
      const anchor: Anchor = { ...target, el: null, root: null, control: null, host: null, hostInlinePosition: null, hostInlinePriority: '', face: null, accessibleName: null, phase: 'idle', timer: null };
      state.anchors.set(target.box, anchor);
      for (const hit of anchor.hitBoxes) anchorOf.set(hit, { unit, anchor });
    }
  }

  function removeAnchorIndex(anchor: Anchor): void {
    for (const hit of anchor.hitBoxes) anchorOf.delete(hit);
    anchorOf.delete(anchor.box);
  }

  function forgetUnit(unit: Element, state: UnitState): void {
    io.unobserve(unit);
    visible.delete(unit);
    callbacks.onLeave(unit, state);
    for (const [, anchor] of state.anchors) {
      callbacks.onAnchorRemoved(anchor);
      removeAnchorIndex(anchor);
    }
    state.anchors.clear();
    tracked.delete(unit);
  }

  function nearViewport(unit: Element): boolean {
    const rect = unit.getBoundingClientRect();
    return rect.bottom >= -observerMarginPx && rect.right >= -observerMarginPx && rect.top <= innerHeight + observerMarginPx && rect.left <= innerWidth + observerMarginPx;
  }

  function makeRoomFor(unit: Element): boolean {
    if (tracked.size < opts.maxTracked) return true;
    // 上限は「以後の投稿をすべて無視する」境界ではない。今から画面へ入る
    // ユニットを、画面外に残った古いユニットより優先する。
    if (!nearViewport(unit)) return false;
    for (const [candidate, state] of tracked) {
      if (visible.has(candidate) || nearViewport(candidate)) continue;
      forgetUnit(candidate, state);
      return true;
    }
    return false;
  }

  function scan(): void {
    if (tracked.size >= opts.maxTracked) forgetDetached();
    for (const unit of Array.from(document.querySelectorAll(site.unitSelector))) {
      if (tracked.has(unit)) continue;
      if (!makeRoomFor(unit)) continue;
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
      forgetUnit(unit, state);
    }
  }

  function scheduleScan(): void {
    if (scanTimer) return;
    scanTimer = setTimeout(
      guardCaughtException(logSaveEvent, 'content', 'overlay-tracker-scan', () => {
        scanTimer = null;
        scan();
      }),
      opts.scanDebounceMs,
    );
  }

  const io = new IntersectionObserver(
    guardCaughtException(logSaveEvent, 'content', 'overlay-tracker-intersection', (entries: IntersectionObserverEntry[]) => {
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
    }),
    { rootMargin: opts.observerMargin },
  );

  const mo = new MutationObserver(
    guardCaughtException(logSaveEvent, 'content', 'overlay-tracker-mutation', (records: MutationRecord[]) => {
      const childrenChanged = records.some((record) => record.type === 'childList');
      const contentChanged = records.some((record) => record.type === 'childList' || (record.type === 'attributes' && ['data-testid', 'href', 'poster', 'role', 'src', 'tabindex'].includes(record.attributeName || '')));
      const selectorChanged = records.some((record) => record.type === 'childList' || (record.type === 'attributes' && ['data-testid', 'href', 'role', 'tabindex'].includes(record.attributeName || '')));
      const modalChanged = records.some((record) => record.type === 'attributes' && record.target instanceof Element && record.target.matches('dialog, [role="dialog"], [aria-modal]'));
      callbacks.onMutation(contentChanged, modalChanged, records);
      if (childrenChanged || selectorChanged) scheduleScan();
    }),
  );
  mo.observe(document.documentElement, {
    childList: true,
    attributes: true,
    attributeFilter: ['aria-modal', 'class', 'data-testid', 'hidden', 'href', 'open', 'poster', 'role', 'src', 'style', 'tabindex'],
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
