// タブストリップのモデルソース――タブ帯を、旧来の push（viewer.js が
// renderTabs() 経由で完全な TabsModel を組み立て、約15の呼び出し場所から
// 共有の描画ブリッジへ push していた）から、グリッドのソース
// （services/grid.ts）や image-tab のソース（services/image-tab.ts）と同じ
// 形の pull されるソースへ変換したもの。viewer.js はもう tabs/activeTabId
// をクロージャの状態として持たない――hologramStore の 'tabs'/'activeTabId'
// のキーが今ではその状態そのもの（selection.ts が selectedSet に対して
// 行ったのと同じ「唯一の正本」への移行）。renderTabs() の呼び出し場所は
// すべて無くなり、その通知は下のストア購読を通して今では自動になっている。
//
// アクティブなタブの title/icon には、なお生きたフィルタ状態が要る
// （タブの永続化された .state ではない。それは切り替えて離れたときにしか
// 更新されない）。postQB.shadow() は意図してストアには映していない
// （すべての読み手がそれを直接呼ぶ。2つ目のコピーを避けるため）――これは、
// 映されているものから同じものを再計算する: query.ts の
// buildShadow(postQueryTree) は postQB.shadow() が内部で呼ぶのとまさに
// 同じ関数。searchQuery/sortPost/multiOnly はすべてストアに住むので、この
// ソースはそれらの書き手が書き込んだ場所からそれらを読む。allPostsCount が
// タブタイトルの件数をカバーする。
//
// tabTitleOf 自体は引き続き viewer が構築する（tab-state.ts の
// makeTabLabels、viewer の t/folderName などの deps 付き。このファイルは
// それらへのアクセスを持たない）――configure() は、すでに構築済みの
// その関数と、静的なアイコンマップ＋ピン留めのグリフを、不変のコールバック
// として受け取る（グリッドのソースの modelOf/keyOf/labels/onAspect と
// 同じ「一度だけ設定する」形）。
//
// タブのイベントは今ではストリップ自身の props（tabs/Tabs.tsx が
// orchestrator の switchTab/closeTab/… を直接呼ぶ、#621）――このファイルは
// モデルを計算するだけで、タブの状態を変更することは一切ない。
import { buildShadow } from './query.ts';
import { store, subscribeKeys } from './store.ts';

type TabTitleOf = (state: any, ctx: { allCount?: number | null }) => { text: string; iconType: string };
type TabsConfig = { tabTitleOf: TabTitleOf; tabIcons: Record<string, string>; pinSvg: string; closeTitle?: string; newTitle?: string; postersTitle?: string; trashTitle?: string; imageFallbackTitle?: string };

let tabTitleOf: TabTitleOf | null = null;
let tabIcons: Record<string, string> | null = null;
let pinSvg = '';
let closeTitle = '';
let newTitle = '';
let postersTitle = '';
let trashTitle = '';
let imageFallbackTitle = '';

const subs = new Set<() => void>();
const notify = () => {
  for (const cb of [...subs]) {
    try {
      cb();
    } catch (_e) {
      /* 握りつぶす */
    }
  }
};

function navKindOf(t: HologramTab): 'posts' | 'posters' | 'image' {
  if (Array.isArray(t._navHist) && t._navHist.length) {
    const i = Math.max(0, Math.min(typeof t._navIdx === 'number' ? t._navIdx : t._navHist.length - 1, t._navHist.length - 1));
    try {
      const kind = JSON.parse(t._navHist[i]).kind;
      if (kind === 'posters' || kind === 'image') return kind;
    } catch {
      /* posts へフォールスルー */
    }
  }
  return 'posts';
}

// postQB.shadow() が内部で計算するものを、同じ映された木
// （query-chips.ts の状態側の半分）から鏡写しにする――シャドウの2つ目の
// コピーはストアには住まない。
function liveActiveState() {
  const tree = store.getState().postQueryTree;
  return {
    f: tree ? buildShadow(tree) : [],
    folderId: store.getState().activeFolderId,
    search: store.getState().searchQuery,
    sort: store.getState().sortPost,
    multi: store.getState().multiOnly,
  };
}

function get(): HologramTabsModel | null {
  const tt = tabTitleOf;
  const icons = tabIcons;
  if (!tt || !icons) return null;
  const rawTabs: HologramTab[] | undefined = store.getState().tabs;
  if (!rawTabs) return null; // viewer の initTabs() でまだ読み込まれていない
  const activeTabId = store.getState().activeTabId;
  const allCount = store.getState().allPostsCount;
  const tabs = rawTabs.map((t) => {
    const isActive = t.id === activeTabId;
    const kind = isActive ? (store.getState().activeImageTab ? 'image' : store.getState().browseMode === 'posters' ? 'posters' : store.getState().browseMode === 'trash' ? 'trash' : 'posts') : navKindOf(t);
    // ゴミ箱（#268）――常にアクティブなタブだけ。ゴミ箱は履歴エントリを
    // 記録しないため（navKindOf は決して 'trash' を答えられない）。
    // ストリップはタブがどこを見ているかを言うもので、ゴミ箱を見ている
    // 間、古いグリッドのタイトルは嘘をつくことになる。
    if (kind === 'trash') {
      return { id: t.id, title: trashTitle, icon: t.pinned ? pinSvg : icons.trash || icons.all, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
    }
    if (kind === 'image') {
      // image のタイトルは image-view のコントローラによって t.title に刻まれる（自動タイトル）。
      return { id: t.id, title: t.title || imageFallbackTitle, icon: t.pinned ? pinSvg : icons.media, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
    }
    if (kind === 'posters') {
      return { id: t.id, title: postersTitle, icon: t.pinned ? pinSvg : icons.users, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
    }
    const s = isActive ? liveActiveState() : t.state || {};
    const derived = tt(s, { allCount });
    const icon = t.pinned ? pinSvg : icons[derived.iconType] || icons.all;
    // t.title はグリッドタブには決して表示されない: 手動でのリネームが
    // 無くなった今（#621）、タブが持ちうる唯一のタイトルは image エントリが
    // 刻んだ自動のものだけで、グリッド上では導出されたタイトルこそが真実
    // （自動のものは、clearAutoTitle が届く前にタブが戻るナビをしていた
    // 場合、1フレーム分古いことがある）。
    return { id: t.id, title: derived.text, icon, active: isActive, pinned: !!t.pinned, showClose: !t.pinned && rawTabs.length > 1 };
  });
  return { tabs, closeTitle, newTitle };
}

export const hologramTabsSource = {
  configure(cfg: TabsConfig) {
    tabTitleOf = cfg.tabTitleOf;
    tabIcons = cfg.tabIcons;
    pinSvg = cfg.pinSvg;
    closeTitle = cfg.closeTitle || '';
    newTitle = cfg.newTitle || '';
    postersTitle = cfg.postersTitle || '';
    trashTitle = cfg.trashTitle || '';
    imageFallbackTitle = cfg.imageFallbackTitle || '';
  },
  get,
  subscribe(cb: () => void): () => void {
    subs.add(cb);
    return () => subs.delete(cb);
  },
};
subscribeKeys(['tabs', 'activeTabId', 'postQueryTree', 'activeFolderId', 'searchQuery', 'sortPost', 'multiOnly', 'allPostsCount', 'browseMode', 'activeImageTab'], notify);
