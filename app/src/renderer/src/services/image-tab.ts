// 画像タブのモデルの source＝画像の詳細ビューを、旧来の押し込み（viewer.js が React の
// モデルを組み、8つほどの呼び出し場所＝showImageTab / hideImageTabView / 添字の移動 /
// インスペクタの切り替え / ライブラリの更新＝から render(model) を呼んでいた）から、引く
// 側の source へ移したもの。グリッドの source（services/grid.ts）と同じ形。viewer.js が
// hologramStore の 'activeImageTab' へ書くのはタブの身元だけ（id/recs/idx＝タブの状態のうち、
// tabs をストアへ移す全体の作業に先んじて移した1つ）。残りはすべて get() が導く＝ギャラリーの
// 項目（hologramRecords.imageTabGroup 経由。posts-data.ts と突き合わせるので、削除された投稿は
// viewer からの押し込み無しに、その場で「見つからない」の状態へ落ちる＝posts-data.ts の doc
// コメントが見込んでいたとおり）と、inspectorOpen（hologramStore の 'inspectedKey'。
// state→store の段以来、「インスペクタが開いているか」の唯一の情報源）。命令（添字の移動 /
// インスペクタの切り替え / タブを閉じる）は、configure() で渡されたコールバック
// （onIndexChange/onToggleInspector/onCloseTab）経由で viewer.ts へ返す。query-chips や
// TabBarEvents のイベント側の形と同じで＝このファイルは計算するだけで、タブの状態を書き換える
// ことはない。
// 本物の ES モジュール（名前付きの export `hologramImageTabSource`）で、image-tab/index.tsx
// （コンポーネント）と viewer.ts（configure）が直接 import する。以前 viewer.ts の旧共有
// ブリッジ経由で行っていた発火は、image-tab-builder.ts がコールバックの供給を引き取った時に
// 依存の注入へ置き換えた。
import { get as getPostsData, subscribe as subscribePostsData } from './posts-data.ts';
import { imageTabGroup } from './records.ts';
import { store, subscribeKeys } from './store.ts';

type Gallery = { buildGroupGalleryItems(g: any): { src: string; alt: string; video: boolean; postId?: string; ugoira?: { file: string; frames: { file: string; delay: number }[] }; poster?: string }[] };
let gallery: Gallery | null = null;
let labels: Record<string, string> | null = null;
let onIndexChange: ((i: number) => void) | null = null;
let onToggleInspector: (() => void) | null = null;
let onCloseTab: (() => void) | null = null;

const subs = new Set<() => void>();
const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 無視する */
    }
  }
};

function byIdMap() {
  const m = new Map<string, any>();
  for (const p of getPostsData()) m.set(p.captureId, p);
  return m;
}

function dispatchIndex(i: number) {
  if (onIndexChange) onIndexChange(i);
}
function dispatchToggleInspector() {
  if (onToggleInspector) onToggleInspector();
}
function dispatchClose() {
  if (onCloseTab) onCloseTab();
}

function get(): HologramImageTabModel | null {
  const active = store.getState().activeImageTab;
  if (!active || !gallery || !labels) return null;
  const byId = byIdMap();
  const g = imageTabGroup({ id: active.id, recs: active.recs }, (id) => byId.get(id));
  if (!g) return { tabId: active.id, items: [], idx: 0, missing: true, labels, onCloseTab: dispatchClose };
  const items = gallery.buildGroupGalleryItems(g);
  if (!items.length) return { tabId: active.id, items: [], idx: 0, missing: true, labels, onCloseTab: dispatchClose };
  return {
    tabId: active.id,
    items,
    idx: Math.max(0, Math.min(active.idx, items.length - 1)),
    inspectorOpen: store.getState().inspectedKey != null,
    labels,
    onIndexChange: dispatchIndex,
    onToggleInspector: dispatchToggleInspector,
    onCloseTab: dispatchClose,
  };
}

/**
 * 今画面に出ているのは画像ビューか。
 *
 * その問いへの答えを、必要とする全員に1つだけ返す（P2⑫ / #153 ⑤）＝シェルのコンテンツと
 * 舞台の切り替え、ツールバーの操作の入れ替え、表示側に譲るグローバルショートカット。以前は
 * `document.body.classList.contains('image-tab-active')` が5か所と CSS の規則1つにあった。
 * つまり、このモジュールが計算する事実を DOM から嗅ぎ回っていた＝ビューが出ているのは、
 * 出すべきモデルがある時とちょうど一致する。lightbox.ts / settings.ts /
 * inspector-panel.ts が自分の画面について出しているのと同じ形。
 */
export function isActive(): boolean {
  return get() != null;
}

export const hologramImageTabSource = {
  configure(cfg: { gallery: Gallery; labels: Record<string, string>; onIndexChange: (i: number) => void; onToggleInspector: () => void; onCloseTab: () => void }) {
    gallery = cfg.gallery;
    labels = cfg.labels;
    onIndexChange = cfg.onIndexChange;
    onToggleInspector = cfg.onToggleInspector;
    onCloseTab = cfg.onCloseTab;
  },
  get,
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  },
};
subscribeKeys(['activeImageTab', 'inspectedKey'], notify);
subscribePostsData(notify);
