import { store, subscribeKeys } from './store.ts';
import { getSnapshot as trashSnapshot, subscribe as subscribeTrash } from './trash-view.ts';
import { hologramImageTabSource } from './image-tab.ts';
import { subscribe as subscribePosts } from './posts-data.ts';
import { isOpen, isVisible, subscribe as subscribePanel } from './inspector-panel.ts';
import { close, refresh, open } from './inspector.ts';
import { imageTabGroup, postIdKey, postKeyOf } from './records.ts';

export type DetailOptions = { focusTags?: boolean; showReplies?: boolean };
type Target = { key: string; group: HologramPostGroup } | { key: string; poster: HologramUserAgg };
type Dependencies = {
  getPostById(id: string): HologramPost | undefined;
  buildUsers(): HologramUserAgg[];
  postModel(group: HologramPostGroup, options: DetailOptions): Omit<HologramInspectorModel, 'openId'>;
  posterModel(poster: HologramUserAgg, options: DetailOptions): Omit<HologramInspectorModel, 'openId'>;
  recordView(id: string): void;
};

// モデルは表示用のキャッシュ。対象の正本は各画面の選択とビューアーの現在位置だけ。
let update = () => {};
let options: DetailOptions = {};
let requestedOptions = false;
export function refreshInspector() {
  update();
}
export function requestDetailOptions(next: DetailOptions = {}) {
  options = next;
  requestedOptions = true;
  update();
}

export function singleSelectedGroup(groups: HologramPostGroup[], selected: ReadonlySet<string>): HologramPostGroup | null {
  const matches = groups.filter((group) => selected.has(postIdKey(group.rep)));
  return matches.length === 1 ? matches[0] : null;
}

export function connectInspector(deps: Dependencies) {
  let previousKey: string | null = null;
  let queued = false;
  let disposed = false;
  function target(): Target | null {
    const state = store.getState();
    if (state.activeImageTab) {
      const model = hologramImageTabSource.get();
      const id = model?.items[model.idx]?.postId;
      const post = id ? deps.getPostById(id) : undefined;
      if (!post) return null;
      const urlKey = postKeyOf(post.url);
      const recs = state.activeImageTab.recs.filter((id) => {
        const record = deps.getPostById(id);
        return record && (urlKey ? postKeyOf(record.url) === urlKey : id === post.captureId);
      });
      const group = imageTabGroup({ id: state.activeImageTab.id, recs }, deps.getPostById);
      return group ? { key: postIdKey(group.rep), group } : null;
    }
    if (state.browseMode === 'posters') {
      const poster = deps.buildUsers().find((item) => item.key === state.selectedPosterKey);
      return poster ? { key: 'poster:' + poster.key, poster } : null;
    }
    const trash = trashSnapshot();
    const group = state.browseMode === 'trash' ? singleSelectedGroup(trash.groups, trash.selected) : singleSelectedGroup(state.postGroups || [], state.selectedSet);
    if (!group) return null;
    if (state.browseMode === 'trash') return { key: postIdKey(group.rep), group };
    const rep = deps.getPostById(group.rep.captureId);
    if (!rep) return null;
    const records = group.records.map((record) => deps.getPostById(record.captureId)).filter((record): record is HologramPost => !!record);
    return { key: postIdKey(rep), group: { ...group, rep, records } };
  }
  function sync() {
    queued = false;
    if (disposed) return;
    const subject = isOpen() ? target() : null;
    const key = subject?.key ?? null;
    const changed = previousKey !== key;
    const focusRequested = requestedOptions && options.focusTags;
    if (changed && !requestedOptions) options = {};
    requestedOptions = false;
    previousKey = key;
    store.setState({ inspectedKey: key });
    if (!subject) {
      close();
      return;
    }
    const model = 'group' in subject ? deps.postModel(subject.group, options) : deps.posterModel(subject.poster, options);
    if (changed || focusRequested) open(model);
    else refresh(model);
    if (changed && isVisible() && 'group' in subject && !store.getState().activeImageTab && store.getState().browseMode === 'posts') deps.recordView(subject.group.rep.captureId);
  }
  // 一回の操作が複数の状態を書き換えても、途中の画面ではなく確定した状態を読む。
  function schedule() {
    if (queued) return;
    queued = true;
    queueMicrotask(sync);
  }
  update = schedule;
  const disposers = [subscribeKeys(['activeImageTab', 'browseMode', 'selectedSet', 'selectedPosterKey', 'postGroups', 'posterGroups'], schedule), subscribePosts(schedule), subscribeTrash(schedule), subscribePanel(schedule)];
  schedule();
  return () => {
    disposed = true;
    disposers.forEach((dispose) => dispose());
    update = () => {};
  };
}
