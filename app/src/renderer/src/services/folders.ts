import { notify as uiNotify, type NotifyAction } from './ui.ts';
import { hologramI18n } from './i18n.ts';
import { hologramIpc } from './ipc.ts';

function createFolderStore({ idPrefix, persist, isLibrary }: { idPrefix: string; persist: () => void; isLibrary?: boolean }): HologramFolderStore {
  let folders: HologramFolder[] = [];
  const genId = () => idPrefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  const allRaw = () => folders;
  const all = () => folders;
  // 入れ子（#41）。ストアは平たい配列のままで、辺は `parentId` だけ＝木は下で必要に応じて
  // 導く。parentId は main 側の正規化だけでなくここにも並べる必要がある。そうしないと、
  // ファイルには残っている欄がストアへ入る途中で落ち、次の保存でそのフォルダが根へ
  // 書き戻されてしまう。
  function setAll(list: unknown) {
    folders = Array.isArray(list) ? (list as HologramFolder[]) : [];
    if (isLibrary)
      folders = folders.map((f) => ({
        ...f,
        kind: f.kind || 'static',
        created: typeof f.created === 'number' ? f.created : null,
        parentId: f.kind !== 'dynamic' && typeof f.parentId === 'string' ? f.parentId : null,
        items: Array.isArray(f.items) ? f.items : [],
      }));
    invalidateTree();
  }
  // 親 → 子の索引。必要になった時に組み直し、構造が変わったら捨てる。兄弟の順序は配列の
  // 順序そのもの（`order` の欄は無い）なので、索引は歩いた順序をそのまま保つだけでよく、
  // 既存の並べ替えの仕組みは手を触れずに動き続ける。
  let kids: Map<string | null, HologramFolder[]> | null = null;
  function invalidateTree() {
    kids = null;
  }
  function childIndex() {
    if (!kids) {
      kids = new Map();
      for (const f of folders) {
        const p = f.parentId || null;
        const arr = kids.get(p);
        if (arr) arr.push(f);
        else kids.set(p, [f]);
      }
    }
    return kids;
  }
  const childrenOf = (id: string | null) => childIndex().get(id || null) || [];
  // そのフォルダ自身と、その下にあるものすべて。呼び出し側は、親が部分木を代表する2つの
  // 場面で使う＝投稿の照合（既定は集約＝親は子が持つものを見せる）と、カスケード削除。
  function subtreeIds(id: string | null | undefined) {
    const out = new Set<string>();
    if (!id) return out;
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop() as string;
      if (out.has(cur)) continue; // 修復済みのファイルに循環は含まれないが、万一あっても回り続けない
      out.add(cur);
      for (const c of childrenOf(cur)) stack.push(c.id);
    }
    return out;
  }
  // 子孫まで含めた所属（`only` はそのフォルダ自身の項目だけを尋ねる）。集約の無い入れ子は、
  // 平たい一覧とタグが同じ仕事をしているのと変わらなくなる。だから既定のクエリの意味は
  // 集約で、「このフォルダのみ」がそこから抜ける。
  function hasDeep(id: string | null | undefined, key: string, only?: boolean) {
    if (only) return has(id, key);
    for (const fid of subtreeIds(id)) {
      const f = byId(fid);
      if (f && f.items.includes(key)) return true;
    }
    return false;
  }
  // 「親 / 子 / 孫」の形。木の外でフォルダを見せる画面のためのもの。フォルダが入れ子に
  // なれるようになった瞬間、名前だけでは識別子として使えなくなった（別々の親の下に
  // 「Documents」フォルダが2つある、というのは普通に起きる）。
  function pathOf(id: string | null | undefined) {
    const parts: string[] = [];
    const seen = new Set<string>();
    let cur = byId(id);
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      parts.unshift(cur.name);
      cur = byId(cur.parentId);
    }
    return parts.join(' / ');
  }
  // 親の付け替えは、フォルダを自分自身や自分の部分木の中へ動かすことを断る＝配列を木で
  // ないものに変えうる唯一の書き込みだから。サイドバーはドラッグ中にそういう落とし先を
  // 無効にする。これはその背後にある防ぎで、何が正当かについて両者が食い違うことはない。
  function reparent(id: string | null | undefined, parentId: string | null) {
    const f = byId(id);
    if (!f || !id) return false;
    if (parentId && subtreeIds(id).has(parentId)) return false;
    if ((f.parentId || null) === (parentId || null)) return false;
    f.parentId = parentId || null;
    invalidateTree();
    persist();
    return true;
  }
  // 1回のドロップにつき1回の書き込み。木のドラッグは、親と兄弟の中での位置の両方を同時に
  // 変えうる（「Documents の下の、上から3番目に置く」）。これを親の付け替えと並べ替えに
  // 分けると、永続化が2回走り、利用者が落としていない場所にフォルダがある状態を購読側が
  // 見てしまう。
  //   into＝targetId の子にする（null なら根）
  //   before / after＝targetId の隣に置き、その行の親を引き継ぐ
  function place(draggedId: string | null | undefined, targetId: string | null, mode: 'into' | 'before' | 'after') {
    const f = byId(draggedId);
    if (!f || !draggedId || draggedId === targetId) return false;
    const target = byId(targetId);
    if (mode !== 'into' && !target) return false; // 「隣に置く」には、隣にする行が要る
    const newParent = mode === 'into' ? (target ? target.id : null) : (target as HologramFolder).parentId || null;
    // 親の付け替えと同じ拒否。フォルダは自分の部分木の中には着地できない。
    if (newParent && subtreeIds(draggedId).has(newParent)) return false;
    const parentChanged = (f.parentId || null) !== newParent;
    if (mode === 'into' && !parentChanged) return false; // もうそこにいる
    f.parentId = newParent;
    if (target && mode !== 'into') {
      folders.splice(folders.indexOf(f), 1);
      const to = folders.indexOf(target);
      folders.splice(mode === 'before' ? to : to + 1, 0, f);
    }
    invalidateTree();
    persist();
    return true;
  }
  const byId = (id: string | null | undefined) => folders.find((f) => f.id === id) || null;
  const has = (id: string | null | undefined, key: string) => {
    const f = byId(id);
    return !!(f && f.items.includes(key));
  };
  function create(name: string | null | undefined, opts?: { parentId?: string | null } | null) {
    const nm = (name || '').trim();
    if (!nm) return null;
    const f: HologramFolder = { id: genId(), name: nm, items: [] };
    if (isLibrary) {
      f.kind = 'static';
      f.created = Date.now();
      // 下位フォルダは親の右クリックメニューから作るので、親は名前と一緒に渡ってくる。
      // 持ち主のいない id は、どのみち次の読み込みで修復されて消える。ここで断っておけば、
      // それがフォルダを失ったように見えるのを防げる。
      f.parentId = !opts || !opts.parentId || !byId(opts.parentId) ? null : opts.parentId;
    }
    folders.push(f);
    invalidateTree();
    persist();
    return f;
  }
  function remove(id: string | null | undefined) {
    const gone = isLibrary ? subtreeIds(id) : new Set(id ? [id] : []);
    folders = folders.filter((f) => !gone.has(f.id));
    invalidateTree();
    persist();
    return gone;
  }
  function rename(id: string | null | undefined, name: string | null | undefined) {
    const f = byId(id);
    const nm = (name || '').trim();
    if (!f || !nm) return false;
    f.name = nm;
    persist();
    return true;
  }
  // フォルダ id に対して、指定したキーの集合をそのまま追加・削除する（切り替えはしない）。
  // そして実際に動いたものを返す＝取り消しが記録する差分（#235）。何か動いた時だけ永続化する。
  function applyItems(id: string | null | undefined, add: readonly string[] | null | undefined, remove: readonly string[] | null | undefined) {
    const f = byId(id);
    const none = { added: [] as string[], removed: [] as string[] };
    if (!f || f.kind === 'dynamic') return none; // 保存した検索に所属は無い＝その中身はクエリの答えそのもの
    const dropping = new Set((remove || []).filter((k): k is string => k != null));
    const removed = f.items.filter((c) => dropping.has(c));
    if (removed.length) f.items = f.items.filter((c) => !dropping.has(c));
    const added: string[] = [];
    for (const c of add || []) {
      if (c == null || f.items.includes(c)) continue;
      f.items.push(c);
      added.push(c);
    }
    if (!added.length && !removed.length) return none;
    persist();
    return { added, removed };
  }
  // フォルダ id の中で、キー1つ、またはキーの群をまとめて切り替える。向きを決めるのは
  // anchorKey（タイルの代表の id）。向きと、実際に動いたキーを返す＝既にそのフォルダに
  // ある選択に対して一括で追加すると、渡された数より少ないキーしか動かない。取り消しが
  // 残りを消してしまってはいけない。
  function toggleIn(id: string | null | undefined, keys: string | string[] | null | undefined, anchorKey?: string | null): { op: 'added' | 'removed'; keys: string[] } | null {
    const f = byId(id);
    if (!f) return null;
    if (f.kind === 'dynamic') return null;
    const ids = (Array.isArray(keys) ? keys : [keys]).filter((k): k is string => k != null);
    if (!ids.length) return null;
    const anchor = anchorKey != null ? anchorKey : ids[0];
    const wasIn = f.items.includes(anchor);
    const moved = wasIn ? applyItems(id, null, ids) : applyItems(id, ids, null);
    const changed = wasIn ? moved.removed : moved.added;
    if (!changed.length) return null;
    return { op: wasIn ? 'removed' : 'added', keys: changed };
  }
  // もう存在しないキー（削除された項目）を落とす。何か変わったら true を返す。
  function reconcile(existing: Set<string>) {
    let changed = false;
    folders.forEach((f) => {
      const n = f.items.length;
      f.items = f.items.filter((c) => existing.has(c));
      if (f.items.length !== n) changed = true;
    });
    return changed;
  }
  // 並べ替え。draggedId を targetId の前／後ろへ置く（ドラッグ＆ドロップ）。順序が変わったら
  // true を返す。
  function move(draggedId: string | null | undefined, targetId: string | null | undefined, before: boolean) {
    if (draggedId === targetId) return false;
    const from = folders.findIndex((f) => f.id === draggedId);
    if (from < 0) return false;
    const [item] = folders.splice(from, 1);
    const to = folders.findIndex((f) => f.id === targetId);
    if (to < 0) folders.push(item);
    else folders.splice(before ? to : to + 1, 0, item);
    invalidateTree(); // 兄弟の順序は配列の順序そのものなので、子の索引はこれで古くなった
    persist();
    return true;
  }
  return {
    all,
    allRaw,
    setAll,
    byId,
    has,
    hasDeep,
    childrenOf,
    pathOf,
    subtreeIds,
    reparent,
    place,
    create,
    remove,
    rename,
    toggleIn,
    applyItems,
    reconcile,
    move,
  };
}

const store = createFolderStore({ idPrefix: 'f', persist: () => persist(), isLibrary: true });
let loaded = false;
let loadPromise: Promise<void> | null = null;
const subs: Array<(kind?: string) => void> = [];

// i18n。このモジュール自身のトースト（foldAdded/foldRemoved。下の業務ロジックから、
// どのコンポーネントの描画の外でも発火する）は、レンダラーの i18n を使い回す＝
// hologramI18n は i18n.ts が返す promise。一度だけ解決して getMessage を t() として
// キャッシュし、それまでは t() がキーをそのまま返す。自前のラベル（タイトル、
// プレースホルダ、改名や削除の問い合わせ）が要るコンポーネントは、代わりに共有の
// _shared/i18n.ts の t() を JSX で直接使う。
let t: (key: string, subs2?: ReadonlyArray<string | number | null | undefined>) => string = (key) => key;
hologramI18n.then((api) => {
  if (api && api.getMessage) t = api.getMessage;
});

function persist() {
  loadPromise = null; // 読み込みのキャッシュを無効にして、後の load() がディスクを読み直すようにする（念のため。このセッション中はメモリ上の状態が正本のまま）
  if (hologramIpc && hologramIpc.setFolders)
    hologramIpc.setFolders({ folders: store.allRaw() }).catch(() => {
      /* できる範囲で */
    });
}
function notify(kind?: string) {
  subs.forEach((cb) => {
    try {
      cb(kind);
    } catch {
      /* 無視する */
    }
  });
}

async function doLoad() {
  try {
    const r = hologramIpc && hologramIpc.getFolders ? await hologramIpc.getFolders() : null;
    store.setAll((r && r.folders) || []);
    // activeId は旧来のもの（かつての 🔖 の対象）＝無視する。以前の選択中のフォルダは、
    // 普通のフォルダとしてそのまま残るだけ。
  } catch {
    store.setAll([]);
  }
  loaded = true;
}
export function load() {
  if (!loadPromise) loadPromise = doLoad();
  return loadPromise;
}

// #32 St2: 他のウィンドウの set-folders が着いた＝DB を読み直し（org-changed が発火する
// 時点でディスクは既に最新）、購読側すべて（サイドバーのフォルダの木）へ描き直すよう伝える。
// これが具体的な受け入れの場面（設計:「コレクション作成が org-changed 経由で他窓の
// サイドバーに反映」）。できる範囲で。Node（単体テスト）ではブリッジが無い＝このモジュールの
// どの hologramIpc の呼び出しも既に使っている握り潰しと同じ。
try {
  hologramIpc.onOrgChanged((kind) => {
    if (kind !== 'folders') return;
    loadPromise = doLoad().then(() => notify('list'));
  });
} catch {
  /* ブリッジが無い（Node の単体テスト） */
}

export const byId = store.byId;
export const has = store.has;
// 入れ子（#41）。クエリのエンジンが尋ねるのは hasDeep（親は自分の部分木を代表する）。
// 素の `has` は、そのフォルダを文字どおりに指す画面のために残す＝投稿ごとの
// 「フォルダに追加」のチェック印で、あれは「これに入っているか」に答えるもの。
export const hasDeep = store.hasDeep;
export const childrenOf = store.childrenOf;
export const pathOf = store.pathOf;
export const subtreeIds = store.subtreeIds;
export function placeFolder(id: string | null | undefined, targetId: string | null, mode: 'into' | 'before' | 'after') {
  const ok = store.place(id, targetId, mode);
  if (ok) notify('list');
  return ok;
}
export function reparentFolder(id: string | null | undefined, parentId: string | null) {
  const ok = store.reparent(id, parentId);
  if (ok) notify('list');
  return ok;
}

// もう存在しない captureId（削除された項目）を落とし、永続化と通知を1回ずつ行う。
export function reconcile(existing: Set<string>) {
  const changed = store.reconcile(existing);
  if (changed) {
    persist();
    notify('list');
  }
}

// 所属の変更は、セッション中の取り消しのスタックに載る（#235）。スタック自体は
// orchestrator.ts（undo-builder.ts）が、この末端のモジュールが読み込まれるずっと後に
// 組む。だから記録役は import ではなく注入する。記録役は、今記録した変更を取り消す手段を
// 返す＝トーストの「元に戻す」が走らせるのがそれ。出せるものが無ければ null を返す。
export type FolderUndoRecorder = (folderId: string, added: string[], removed: string[]) => (() => void) | null;
let undoRecorder: FolderUndoRecorder | null = null;
let undoLabel = '';
export function setUndoRecorder(fn: FolderUndoRecorder | null, label?: string) {
  undoRecorder = fn;
  undoLabel = label || '';
}

// 切り替えをせずに、追加・削除の集合をそのままフォルダ fid へ適用する＝取り消し／やり直しが
// 所属の差分を当て直すやり方。通知は呼び出し側に任せてある。そうすれば、複数のフォルダに
// 触れる取り消し1件でも、ビューの更新は1回で済む（下の notifyChanged）。
export function applyFolderItems(fid: string | null | undefined, add: readonly string[] | null | undefined, remove: readonly string[] | null | undefined) {
  return store.applyItems(fid, add, remove);
}

/** applyFolderItems を通した変更を知らせる＝どのビューのチップも読む、購読側の経路。 */
export function notifyChanged(kind?: string) {
  notify(kind);
}

// フォルダ fid の中で captureIds[] の所属を切り替える。向きを決めるのは anchorCid
// （タイルの代表の id）。実際に動いたキーを { op, keys } で返し、何も動かなければ null を
// 返す。
export function toggleIn(fid: string | null | undefined, captureIds: string[] | null | undefined, anchorCid?: string | null) {
  const f = byId(fid);
  if (!f) return null; // トースト用に、切り替える前の名前を押さえておく
  const res = store.toggleIn(fid, captureIds, anchorCid);
  if (!res) return null;
  const undoFn = undoRecorder ? undoRecorder(f.id, res.op === 'added' ? res.keys : [], res.op === 'removed' ? res.keys : []) : null;
  toast(res.op === 'removed' ? t('foldRemoved', [f.name]) : t('foldAdded', [f.name]), undoFn && undoLabel ? { label: undoLabel, onClick: undoFn } : null);
  notify('membership');
  return res;
}

// --- トースト（共有＝ui.ts の notify() 経由の sonner） ---
export function toast(msg: unknown, action?: NotifyAction | null) {
  return uiNotify(msg, action);
}

export function all() {
  return store.all();
}

// 旧保存済み検索はデータを保全し、通常のフォルダ一覧から除外する。
export const isSavedSearch = (f: HologramFolder) => f.kind === 'dynamic';
// 投稿を持てるのは静的なフォルダだけなので、フォルダを行き先として出す画面はすべて
// staticFolders() を読む＝サイドバーのフライアウトの行（facets.ts）、投稿ごとの
// 「フォルダに追加」のメニュー（post-grid-builder.ts）、フォルダの管理画面。この3つを
// 調べれば足りる＝行き先を選ぶためにストアを列挙する呼び出し側は、これで全部だから。
export function staticFolders() {
  return store.allRaw().filter((f) => !isSavedSearch(f));
}
// フォルダのビュー（3つ目のモード）。ストアの CRUD を出して、グリッドがフォルダを全部
// 並べ、カードから作成・改名・削除できるようにする。薄いラッパーが永続化と通知をするので、
// どのビューも更新される（store.create/remove/rename が永続化する）。
export function allFolders() {
  return store.allRaw();
}
export function createFolder(name: string | null | undefined, opts?: { parentId?: string | null } | null) {
  const f = store.create(name, opts);
  if (f) notify('list');
  return f;
}
export function renameFolder(id: string | null | undefined, name: string | null | undefined) {
  const ok = store.rename(id, name);
  if (ok) notify('list');
  return ok;
}
export function removeFolder(id: string | null | undefined) {
  const gone = store.remove(id);
  notify('list');
  return gone;
}
export function onChange(cb: (kind?: string) => void) {
  subs.push(cb);
  return () => {
    const i = subs.indexOf(cb);
    if (i >= 0) subs.splice(i, 1);
  };
}
export function isLoaded() {
  return loaded;
}
