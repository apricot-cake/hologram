// 投稿データと現在のタブから画像ビューアーの表示モデルを作る。
import { get as getPostsData, getQuotedPosts, subscribe as subscribePostsData } from './posts-data.ts';
import { galleryPosition } from './reply-thread.ts';
import { t } from '../_shared/i18n.ts';
import { imageTabGroup } from './records.ts';
import { store, subscribeKeys } from './store.ts';

type CropRect = import('../../../../../native-host/post-schemas.mts').CropRectShape;
type Gallery = { buildGroupGalleryItems(g: any): { src: string; alt: string; video: boolean; postId?: string; mediaSeq?: number; crop?: CropRect | null; width?: number; height?: number; ugoira?: { file: string; frames: { file: string; delay: number }[] }; poster?: string }[] };
let gallery: Gallery | null = null;
let labels: Record<string, string> | null = null;
let onIndexChange: ((i: number) => void) | null = null;
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
  for (const p of [...getQuotedPosts(), ...getPostsData()]) m.set(p.captureId, p);
  return m;
}

function dispatchIndex(i: number) {
  if (onIndexChange) onIndexChange(i);
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
  const idx = Math.max(0, Math.min(active.idx, items.length - 1));
  // フォルダからまとめて取り込んだローカル画像は、カード上ではすでに1つの
  // まとまりになっている。URL を持たない各ファイルを別投稿として数えると
  // 「投稿 1/20・画像 1/1」になってしまうため、ここでは1投稿の画像列として扱う。
  const localCollection = g.records.length > 1 && g.records.every((p) => !p.url);
  const pos = galleryPosition(items, idx, (id) => byId.get(id), { singlePost: localCollection });
  return {
    positionLabel: localCollection ? t('viewerImagePosition', { image: pos.image, images: pos.images }) : pos.posts > 1 ? t('viewerThreadPosition', { post: pos.post, posts: pos.posts, image: pos.image, images: pos.images }) : undefined,
    tabId: active.id,
    items,
    idx: Math.max(0, Math.min(active.idx, items.length - 1)),
    labels,
    onIndexChange: dispatchIndex,
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
 * 出すべきモデルがある時とちょうど一致する。settings.ts /
 * inspector-panel.ts が自分の画面について出しているのと同じ形。
 */
export function isActive(): boolean {
  return get() != null;
}

export const hologramImageTabSource = {
  configure(cfg: { gallery: Gallery; labels: Record<string, string>; onIndexChange: (i: number) => void; onCloseTab: () => void }) {
    gallery = cfg.gallery;
    labels = cfg.labels;
    onIndexChange = cfg.onIndexChange;
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
subscribeKeys(['activeImageTab'], notify);
subscribePostsData(notify);
