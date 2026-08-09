// 共有のフォルダのストアとトースト。投稿ビュー（orchestrator.ts）が使う。ライブラリの
// データは folders.json にある（captureId をキーにする）＝フォルダをまとめて入れる入れ物。
// このモジュールが持つのはデータ、所属の切り替え、トースト（ui.ts 経由の sonner）。
// 「どのフォルダで絞り込んでいるか」の状態はビューごとに残る。書き換えのたびに購読側
// （onChange）へ通知するので、各ビューが自分のチップを更新する。
//
// 今は本物の ES モジュール（名前付きの export）＝load, all, byId, has, toggleIn, reconcile,
// toast, onChange, isLoaded, allFolders, createFolder, updateFolder, renameFolder,
// removeFolder。加えて hologramPosterFolderStore() のファクトリ（orchestrator.ts の投稿者
// フォルダのストア）。管理モーダルの状態はもう無い（#6 の残り項目1）。ライブラリのフォルダの
// 木（#41／確定 D）も、投稿者フォルダのサイドバー群も、自分のストアを直接読み書きする
// （投稿者のストアについては createPersistedFolderStore 自身の subscribe()）。
import { notify as uiNotify, type NotifyAction } from './ui.ts';
import { hologramI18n } from './i18n.ts';
import { hologramIpc } from './ipc.ts';
import { cloneTree, removeCondsMatching } from './query.ts';

// フォルダ一覧のストア。ライブラリのフォルダ（下、isLibrary あり）と投稿者フォルダ
// （viewer.js が下の hologramPosterFolderStore() ファクトリ経由で使う。isLibrary なし）で
// 共有する。{id,name,items[]} の配列と、id の生成と、所属の切り替えを持つ。persist() は
// 呼び出し側が渡し、トーストや描画のやり直しも呼び出し側が自分でやる。ビューごとに違う
// ためだ。純粋なデータの層で、DOM には触れない。
// isLibrary（ライブラリだけ）は、フォルダを一段広い「フォルダ」へ一般化する。どれも
// kind/created を持ち、動的なフォルダは保存した検索の中身（tree と q）を持つ。投稿者の
// ストアは isLibrary を渡さないので、その面も振る舞いも以前とまったく同じ。
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
  function create(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; parentId?: string | null } | null) {
    const nm = (name || '').trim();
    if (!nm) return null;
    const f: HologramFolder = { id: genId(), name: nm, items: [] };
    if (isLibrary) {
      f.kind = opts && opts.kind === 'dynamic' ? 'dynamic' : 'static';
      f.created = Date.now();
      // 下位フォルダは親の右クリックメニューから作るので、親は名前と一緒に渡ってくる。
      // 持ち主のいない id は、どのみち次の読み込みで修復されて消える。ここで断っておけば、
      // それがフォルダを失ったように見えるのを防げる。
      f.parentId = f.kind === 'dynamic' || !opts || !opts.parentId || !byId(opts.parentId) ? null : opts.parentId;
      if (f.kind === 'dynamic') setQuery(f, opts); // 保存した検索の中身（条件の木）
    }
    folders.push(f);
    invalidateTree();
    persist();
    return f;
  }
  // 保存した検索（条件の木。自由文の語はその中の 'text' の葉）を、動的なフォルダへ写す。
  // 渡されなければ消す。静的なフォルダはこれを持たない。cloneTree は _ で始まるコンパイルの
  // メモを落とすので、ディスクに着くのは素のデータになる。
  function setQuery(f: HologramFolder, src?: { tree?: unknown } | null) {
    if (src && src.tree && typeof src.tree === 'object') f.tree = cloneTree(src.tree as HologramQueryNode);
    else delete f.tree;
  }
  // 動的なフォルダの保存済みの条件をその場で更新する（＝検索を保存し直す）。
  function update(id: string | null | undefined, patch: { tree?: unknown } | null | undefined) {
    const f = byId(id);
    if (!f || f.kind !== 'dynamic') return false;
    setQuery(f, patch);
    persist();
    return true;
  }
  // フォルダを削除する時は、保存した検索すべてからも掃き出す必要がある。生きているクエリの
  // 木は削除時に folder の葉が片付くが、動的なフォルダの中にある木は片付かない＝宙に浮いた
  // 葉は永遠に偽と評価されるので、その保存した検索は黙って0件になる。#41 のカスケード削除が
  // 削除した id の集合を丸ごと渡すのも同じ理由。
  function pruneFolderLeaves(ids: Set<string>) {
    let changed = false;
    for (const f of folders) {
      if (f.kind !== 'dynamic' || !f.tree) continue;
      if (removeCondsMatching(f.tree, (c) => c.type === 'folder' && ids.has(String(c.value)))) changed = true;
    }
    return changed;
  }
  // フォルダの削除は部分木ごと持っていく（エクスプローラーも Finder も Eagle もそうする。
  // もう一方の案＝子を黙って繰り上げる＝は、利用者が頼んでいないフォルダの移動になる）。
  // 投稿そのものはライブラリに残る。押されたものだけでなく、削除した id をすべて
  // pruneFolderLeaves へ届けなければならない。そうしないと、保存した検索は既に無い
  // フォルダを指す葉を持ち続け、静かに永遠に0件を返す。
  function remove(id: string | null | undefined) {
    const gone = isLibrary ? subtreeIds(id) : new Set(id ? [id] : []);
    folders = folders.filter((f) => !gone.has(f.id));
    invalidateTree();
    if (isLibrary && gone.size) pruneFolderLeaves(gone);
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
    ...(isLibrary ? { update } : {}),
  };
}

// createFolderStore に永続化と読み込みを結線した派生。get/set の IPC の対に載った、すぐ
// 使えるストアが欲しいだけの呼び出し側のためのもの（下のフォルダのストア自身の
// load()/persist() と同じ読み込みのキャッシュの作法を、一般化したもの）。今のところ投稿者
// フォルダのストアで使う（viewer.js の pfStore はこれを手で組み立てていた＝自前の persist() の
// 閉包と、起動時の手書きの getPosterFolders/setAll のブロック。どちらも今はここにある）。
function createPersistedFolderStore({
  idPrefix,
  get,
  set,
  orgChangedKind,
}: {
  idPrefix: string;
  get: () => Promise<{ folders?: unknown[] } | null>;
  set: (data: { folders: HologramFolder[] }) => Promise<unknown>;
  // #32 St2: このストアが読み込み直す org-changed の種別（ipc-organize.ts を参照）＝
  // 書き込みをしていない側のウィンドウがディスクを読み直し、自分の購読側へ通知し直す。
  // 起動時に doLoad() が既にやっている「読み込み直して通知する」と同じこと。
  orgChangedKind?: string;
}): HologramFolderStore & { load: () => Promise<void>; reload: () => Promise<void>; subscribe: (cb: () => void) => () => void } {
  let loadPromise: Promise<void> | null = null;
  // 自前の変更の経路（#6 の残り項目1）。投稿者フォルダのサイドバー群には、共有の mgrModel を
  // 読む管理モーダルがもう無い。だから永続化するストアはそれぞれ、自分の購読側へ直接通知する＝
  // 書き換えのたび（persist() 経由）と、load() が終わった時。購読側が握っている一覧が古く
  // なりうるのは、その2つの瞬間だけ。
  const subs = new Set<() => void>();
  function notify() {
    for (const cb of [...subs]) cb();
  }
  function doPersist() {
    loadPromise = null; // 読み込みのキャッシュを無効にして、後の load() がディスクを読み直すようにする
    set({ folders: store.allRaw() }).catch(() => {
      /* できる範囲で */
    });
    notify();
  }
  const store = createFolderStore({ idPrefix, persist: doPersist });
  async function doLoad() {
    try {
      const r = await get();
      store.setAll((r && r.folders) || []);
    } catch {
      store.setAll([]);
    }
    notify();
  }
  function load() {
    if (!loadPromise) loadPromise = doLoad();
    return loadPromise;
  }
  // load() のキャッシュに関わらず、必ず読み直す＝org-changed が発火する時点で、他の
  // ウィンドウの書き込みは既にディスクに着いているので、これは必ず競合に勝つ。
  function reload() {
    loadPromise = doLoad();
    return loadPromise;
  }
  function subscribe(cb: () => void) {
    subs.add(cb);
    return () => {
      subs.delete(cb);
    };
  }
  if (orgChangedKind) {
    // できる範囲で。Node（単体テスト）では window.hologram が無いか、onOrgChanged を
    // 持たない最小限のスタブ＝このモジュールの persist()/doLoad() が既に使っている
    // 「Node には window が無い」の握り潰しと同じ。
    try {
      hologramIpc.onOrgChanged((kind) => {
        if (kind === orgChangedKind) reload();
      });
    } catch {
      /* ブリッジが無い（Node の単体テスト） */
    }
  }
  return { ...store, load, reload, subscribe };
}
export function hologramPosterFolderStore(): HologramPersistedFolderStore {
  return createPersistedFolderStore({
    idPrefix: 'pf',
    get: () => hologramIpc.getPosterFolders(),
    set: (data) => hologramIpc.setPosterFolders(data),
    orgChangedKind: 'poster-folders',
  });
}

// ライブラリのフォルダ [{ id, name, kind, created, items:[captureId] }]＝フォルダを
// まとめて入れる入れ物。isLibrary が kind/created と、動的な保存した検索を有効にする。
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

// --- 静的（名前を付けた投稿の集合）と動的（保存した検索）の違い ---
// どちらなのかを決めるのはここ1か所。両者を区別する必要がある画面はすべて、これか下の
// 2つの一覧を通る。
export const isSavedSearch = (f: HologramFolder) => f.kind === 'dynamic';
// 投稿を持てるのは静的なフォルダだけなので、フォルダを行き先として出す画面はすべて
// staticFolders() を読む＝サイドバーのフライアウトの行（facets.ts）、投稿ごとの
// 「フォルダに追加」のメニュー（post-grid-builder.ts）、フォルダの管理画面。この3つを
// 調べれば足りる＝行き先を選ぶためにストアを列挙する呼び出し側は、これで全部だから。
export function staticFolders() {
  return store.allRaw().filter((f) => !isSavedSearch(f));
}
// 保存した検索＝サイドバー専用の「保存した検索」の群（フォルダと混ぜることは一切ない）。
export function dynamicFolders() {
  return store.allRaw().filter(isSavedSearch);
}

// フォルダのビュー（3つ目のモード）。ストアの CRUD を出して、グリッドがフォルダを全部
// 並べ、カードから作成・改名・削除できるようにする。薄いラッパーが永続化と通知をするので、
// どのビューも更新される（store.create/remove/rename が永続化する）。
export function allFolders() {
  return store.allRaw();
}
export function createFolder(name: string | null | undefined, opts?: { kind?: string; tree?: unknown; q?: string; parentId?: string | null } | null) {
  const f = store.create(name, opts);
  if (f) notify('list');
  return f;
}
export function updateFolder(id: string | null | undefined, patch: { tree?: unknown; q?: string } | null | undefined) {
  const ok = store.update ? store.update(id, patch) : false; // update があるのはフォルダのストアだけ（isLibrary）
  if (ok) notify('list');
  return ok;
}
export function renameFolder(id: string | null | undefined, name: string | null | undefined) {
  const ok = store.rename(id, name);
  if (ok) notify('list');
  return ok;
}
// 消えた id をすべて返す（そのフォルダと部分木）。呼び出し側が、ストアが保存した検索に
// 使ったのと同じ集合で、生きているクエリの木と、保存したタブを掃けるようにするため。
// folder の葉は3か所にあり、そのうち2か所にしか届かない集合は、3か所目を何も指さないまま
// 残す。
export function removeFolder(id: string | null | undefined) {
  const gone = store.remove(id);
  notify('list');
  return gone;
}
export function onChange(cb: (kind?: string) => void) {
  subs.push(cb);
}
export function isLoaded() {
  return loaded;
}
