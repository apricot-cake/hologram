// セッション内の Undo/Redo コントローラ（#235）――旧 viewer.ts のモノリスから
// 抽出。inspector-builder.ts / poster-grid-builder.ts を鏡写しにしている:
// スタックのセマンティクス（上限／redo の破棄／方向のマッピング／スタック
// 最上段のガード）は undo.ts に残る――このモジュールはその利用側で、変更を
// 実際に再適用する副作用（IPC への書き込み、グリッドの再描画、インスペクタの
// 更新）と Ctrl+Z/Ctrl+Shift+Z のショートカットハンドラを持つ。
// orchestrator.ts の早い段階で構築される（postGrid/inspector/posterGrid が
// 存在する前、という元の _undo の呼び出し場所に合わせている）ので、pushUndo
// はそれらのビルダー自身の deps から使える――まだ構築されていない一群へ
// 手を伸ばす deps はどれも遅延した前方参照になる。inspector-builder.ts の
// jumpToPoster/showToast と同じ形。
//
// 適用側はどれも1つの規則を共有する: 対象の「今の」一覧を取り、`remove` を
// 落とし、それがまだ持っていない `add` のメンバーを足す。捕まえた一覧を
// 決して書き戻さない――それが、これと #235 が却下したスナップショット
// モデルとの違い。
import { makeUndo, type DirectedChange, type UndoChange } from './undo.ts';
import { isVisible as panelIsVisible } from './inspector-panel.ts';
import { postIdKey } from './records.ts';
import { applyTagWrite, updateTags as postsUpdateTags } from './posts.ts';
import { registerShortcut, tryRun } from './shortcut-registry.ts';
import { applyPosterTagRecords, getPosterTags } from './tags.ts';
import { applyFolderItems as applyLibraryFolderItems } from './folders.ts';
import { restore as restorePosterAliases, type PosterAliasGroup } from './aliases.ts';
import { store } from './store.ts';

export interface UndoBuilderDeps {
  showToast(msg: unknown): void;
  t(key: string, subs?: ReadonlyArray<string | number | null | undefined>): string;
  getPostById(id: string): HologramPost | undefined;
  markPostsMutated(): void;
  renderPosts(keepLimit?: boolean): void;
  getViewGroups(): HologramPostGroup[];
  showDetail(g: HologramPostGroup): void;
  refreshPosterTagFields(key: string): void;
  // ポスターフォルダのストアは posterGrid のもの（pfStore）で、この
  // コントローラより後に構築される――上のアクセサと同じ遅延した前方参照。
  getPosterFolderStore(): HologramFolderStore | null;
  // 所属の undo は、有効なフォルダフィルタの下でカードを追加・削除しうる
  // ので、そこから描く view には、トグル自身が行うのとまったく同じように
  // 知らせなければならない。
  onFolderMembershipChanged(): void;
  onPosterFolderMembershipChanged(): void;
  // #23 St1: 名前マージの undo/redo は、今検査中の投稿者がどの投稿者へ
  // 畳み込まれるかを変えうる（そのグループを解体・拡張しうる）ので、
  // ポスターグリッドと開いているポスターインスペクタの両方に知らせる
  // 必要がある。上の2つの所属コールバックと同じ形。
  onPosterAliasChanged(): void;
}

/** 現在の一覧 − remove ＋（まだ持っていない add）。順序は保つ。 */
function nextList(current: readonly string[] | null | undefined, change: DirectedChange): string[] {
  const remove = new Set(change.remove);
  const kept = (current || []).filter((v) => !remove.has(v));
  const have = new Set(kept);
  return [...kept, ...change.add.filter((v) => !have.has(v))];
}

export function makeUndoController(deps: UndoBuilderDeps) {
  async function applyPostTags(changes: DirectedChange[]) {
    for (const c of changes) {
      const rec = deps.getPostById(c.target); // 差分キャッシュのマップ経由で O(1)（allPosts は同じレコード参照を保持している）
      // 「今の」タグ一覧が住む場所はこのレコードだけ。これが無いと差分を
      // 取る対象が無いので、推測を書き込むのではなくスキップする。
      if (!rec) continue;
      const next = nextList(rec.tags, c);
      let res: Awaited<ReturnType<typeof postsUpdateTags>> | null = null;
      try {
        res = await postsUpdateTags(c.image || rec.image || rec.video || '', next);
      } catch {
        /* このまま続ける――1件の書き込み失敗がエントリの残りを巻き添えにしてはいけない */
      }
      applyTagWrite(rec, next, res);
    }
    deps.markPostsMutated();
    deps.renderPosts(true);
    // 影響を受けたグループを表示中ならインスペクタを同期させておく（undo は
    // 追加用の入力欄に入力している間は発火しないので、ここでのフル
    // 再描画は安全）。
    const inspectedKey = store.getState().inspectedKey;
    if (panelIsVisible() && inspectedKey) {
      const fresh = deps.getViewGroups().find((g2) => postIdKey(g2.rep) === inspectedKey);
      if (fresh) deps.showDetail(fresh);
    }
  }

  // ポスタータグ版: posterTags[key]（tags.ts）が正本（投稿レコードでは
  // ない）なので、差分はそのマップに対して適用され、開いているポスター
  // インスペクタを更新する（applyPostTags のインスペクタ更新を鏡写しに
  // している）。一括変更＋1回の永続化は tags.ts にある。
  function applyPosterTags(changes: DirectedChange[]) {
    // #810: ストアは投稿者を1行（名前＋id＋実効集合）にキー付けする。undo が
    // 復元するのは常に生の名前だけ――それが利用者が編集した半分。
    const current = getPosterTags();
    applyPosterTagRecords(changes.map((c) => ({ key: c.target, tags: nextList(current[c.target]?.tags, c) })));
    const inspectedKey = store.getState().inspectedKey;
    if (panelIsVisible() && typeof inspectedKey === 'string' && inspectedKey.indexOf('poster:') === 0) {
      deps.refreshPosterTagFields(inspectedKey.slice('poster:'.length));
    }
  }

  function applyFolderItems(changes: DirectedChange[]) {
    for (const c of changes) applyLibraryFolderItems(c.target, c.add, c.remove);
    deps.onFolderMembershipChanged();
  }

  function applyPosterFolderItems(changes: DirectedChange[]) {
    const pfStore = deps.getPosterFolderStore();
    if (!pfStore) return;
    for (const c of changes) pfStore.applyItems(c.target, c.add, c.remove);
    deps.onPosterFolderMembershipChanged();
  }

  // #23 St1: ポスター alias の変更は、値の差分ではなく完全な前後のグループ
  // スナップショット（理由は undo.ts の UndoChange のコメント参照）――
  // `c.add` は常に、undo.ts が今適用している方向（undo/redo）が復元「先」
  // とするスナップショットを持つので、この適用側はその1つのフィールド
  // しか読まない。壊れたペイロード（起きないはず――このモジュールが唯一の
  // 書き手）は throw せずスキップする。他のすべての適用側の「対象が無い→
  // スキップ」という許容と一致させている。
  function applyPosterAlias(changes: DirectedChange[]) {
    for (const c of changes) {
      const raw = c.add[0];
      if (!raw) continue;
      try {
        const payload = JSON.parse(raw) as { keys: string[]; groups: PosterAliasGroup[] };
        restorePosterAliases(payload.keys, payload.groups);
      } catch {
        /* 壊れたペイロード――復元するものが無い */
      }
    }
    deps.markPostsMutated(); // buildUsers の世代キャッシュされた畳み込みを無効化する
    deps.onPosterAliasChanged();
  }

  const _undo = makeUndo({
    appliers: {
      'post-tags': applyPostTags,
      'poster-tags': applyPosterTags,
      'folder-items': applyFolderItems,
      'poster-folder-items': applyPosterFolderItems,
      'poster-alias': applyPosterAlias,
    },
  });

  /**
   * 編集を記録し、それを取り消す方法を返す。編集がすべての対象について
   * 結局 no-op だったときは null。呼び出し側は返された関数をトースト
   * 通知の「Undo」の裏に置く。それが発火するのはこのエントリが今も
   * いちばん新しいものである間だけ（undo.ts の undoIfTop）なので、古びた
   * トースト通知が他の誰かの編集を元に戻すことはできない。
   */
  function pushUndo(changes: readonly UndoChange[] | null | undefined): (() => void) | null {
    const entry = _undo.push(changes);
    if (!entry) return null;
    return () => {
      void _undo.undoIfTop(entry.id);
    };
  }

  /** `undoFn` に対してトースト通知が持つべき「Undo」ボタン。無ければ何も無し。 */
  function undoAction(undoFn: (() => void) | null) {
    return undoFn ? { label: deps.t('undoAction'), onClick: undoFn } : null;
  }

  async function doUndo() {
    if (await _undo.undo()) deps.showToast(deps.t('undoDone'));
  }

  async function doRedo() {
    if (await _undo.redo()) deps.showToast(deps.t('redoDone'));
  }

  // #246: Ctrl+Z / Ctrl+Shift+Z は今では登録簿に、別々の独立して再割り当て
  // 可能なコマンド（undo / redo）として住んでいる。ここに残るのは共有の
  // ガードと2つのアクションだけ。
  function canExecuteUndo() {
    return !(document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA'));
  }
  registerShortcut({ id: 'undo', titleKey: 'shortcutUndo', defaultCombo: 'Ctrl+z', canExecute: canExecuteUndo, perform: doUndo });
  registerShortcut({ id: 'redo', titleKey: 'shortcutRedo', defaultCombo: 'Ctrl+Shift+z', canExecute: canExecuteUndo, perform: doRedo });

  // 登録は GlobalShortcuts コンポーネント（app/App.tsx）にある。
  function handleShortcutUndoKey(e: KeyboardEvent) {
    if (tryRun('undo', e)) return;
    tryRun('redo', e);
  }

  return { pushUndo, undoAction, doUndo, doRedo, handleShortcutUndoKey };
}
