import type { Translate } from './translation.ts';
// カード選択＋選択バーの一括操作＝旧 viewer.ts のモノリスから抽出。
// inspector-builder.ts / post-grid-builder.ts を鏡写しにしている: 純粋ロジック
// はここへ移り、それに届くジェスチャーは今ではセル自身の props になっている
// （services/grid.ts の cardActions、orchestrator.ts で配線）。selection.ts
// （hologramStore に支えられた selectedSet/anchor のブリッジ）は変更しない＝
// このモジュールはその利用側の1つ（もう1つは FloatingBar コンポーネント自身の
// モデル導出で、ここでは影響を受けない）。
// 「タグを追加」（openBulkTagDialog）は bulk-tag-builder.ts の領分（P2⑦で
// Dialog へ差し替え）。viewer.ts でこのモジュールの直後に構築される（この
// モジュール自身の selectedRecords を必要とするため）ので、このモジュールは
// 遅延 dep 経由でそれを呼ぶだけ＝inspector-builder.ts の
// jumpToPoster/showToast の前方参照と同じ形。
import { hologramImageTabSource } from './image-tab.ts';
import { fileOfSrc } from './asset-src.ts';
import { copyImage, copyableImages, get as getImageCopy } from './image-copy.ts';
import * as selection from './selection.ts';
import { isActive as imageViewIsActive } from './image-tab.ts';
import { gridColumnCount, scrollGridIndexIntoView } from './grid-nav.ts';
import { postIdKey } from './records.ts';
import { deletePost } from './posts.ts';
import { refresh as trashRefresh } from './trash-view.ts';
import { get as confirmGet, open as confirmOpen } from './confirm.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';
import { store } from './store.ts';
import { gridSlot } from './content-area.ts';

export interface SelectionBarDeps {
  t: Translate;
  showToast(msg: unknown): void;
  getViewGroups(): HologramPostGroup[];
  renderPosts(inPlace?: boolean): void;
  removePosts(ids: Iterable<string>): void;
  loadPosts(keepLimit?: boolean): Promise<void>;
  showFoldMenu(g: HologramPostGroup, at: HologramMenuAnchor): void;
  // openBulkTagDialog は bulk-tag-builder.ts にある＝遅延 dep、
  // inspector-builder.ts の jumpToPoster/showToast と同じ形。
  openBulkTagDialog(): void;
  // コピー対象の解決と IPC は post-grid-builder.ts が担当する。
  copyGroupsImage(groups: HologramPostGroup[]): void;
}

export function makeSelectionBar(deps: SelectionBarDeps) {
  // クリックは選択だけを変更する。インスペクタはその状態から導出される。
  function clickSelect(g: HologramPostGroup, e: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean }) {
    gridSlot('post')?.querySelector<HTMLElement>('[role="grid"]')?.focus({ preventScroll: true });
    const idx = deps.getViewGroups().indexOf(g);
    const key = postIdKey(g.rep);
    if (e.shiftKey) {
      selection.toggle(idx, key, true, deps.getViewGroups(), postIdKey);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      selection.toggle(idx, key, false, deps.getViewGroups(), postIdKey);
      return;
    }
    selection.selectOnly(idx, key);
  }

  // 同じ押下のクリック側の半分（#242）: 背景クリック＝もう何も選択されて
  // いない、そしてインスペクタ――選択「の」ビューである（#143）――は
  // プレースホルダへ戻る。グリッドのホストはすでにカード・カードのボタン・
  // スクロールバーの余白・Ctrl/Shift の押下・ドラッグへ変わったものを除外
  // 済みなので、ここで繰り返すガードは残っていない。
  //
  // 選択は「ある」ときだけ作り直す: 表示中のセルはどれも 'selectedSet' を
  // 購読しているので、変化が無いのに新しい空の Set（＝新しい identity）を
  // 渡すと全部を無駄に再描画してしまう。
  function clickBackground() {
    if (selection.size()) {
      selection.clear();
    }
  }

  // 手で同期すべきものはもう何も残っていない: 表示中のセルはどれも
  // hologramStore の 'selectedSet'（selection.ts がすでに書き込んでいる）を
  // 購読しているので、選択が変わった瞬間に自分自身を再描画する。以前グリッド
  // コンテナに付け外ししていた `.selecting` クラスは、カードのホバー操作を
  // 隠すために存在していたが、それらはもう無い（#618 決定Aで確認済み）。

  // 選択中の各グループのすべてのレコード（一括操作はレコードに対して行う）。
  function selectedRecords() {
    return selection.selectedRecords(deps.getViewGroups(), postIdKey);
  }

  function clearSelection() {
    selection.clear();
  }

  // updateSelectionBar() はかつてここにあった: #selectionBar のコンテナの
  // 表示・非表示を切り替え、コンポーネント自身は children だけを持っていた。
  // どちらも今は無い――再設計がシェルからコンテナを取り除き、かつコンポーネント
  // もアンマウントした（代わりは下部のフローティングバー）ので、呼ぶたびに
  // `null.style` になる＝選択が変わるたびに TypeError を投げていた。無害に
  // 見えていた（ストアへの書き込みが先に走るのでリングは更新され続けていた）。選択バーが戻ってくるなら、
  // SelectionBar.tsx がすでにそうしているように hologramStore から自分の
  // 表示状態を導出するべき（count === 0 → null）＝ここを経由しては戻ってこない。

  function toggleSelectAll() {
    selection.toggleAll(deps.getViewGroups(), postIdKey);
  }

  // Ctrl/Cmd+A は表示中の（フィルタ済みの）カードをすべて選択する。フィールド
  // への入力中やモーダル／オーバーレイが開いているときはブラウザに任せる
  // （そちらではネイティブの全選択が働く）。登録は GlobalShortcuts コンポーネント
  // （app/App.tsx）にある。
  //
  // #246: このコード（Ctrl+A、Shift は無視＝shortcut-registry.ts の
  // ignoreShift の doc 参照）は今では登録簿にある。ここに残るのはガードの連鎖と
  // アクションだけ。
  function canExecuteSelectAll() {
    if (confirmGet()) return false;
    if (settingsIsOpen()) return false;
    if (imageViewIsActive()) return false; // グリッドの選択は画面に無い（#656）＝下の Ctrl+C/Space/矢印ナビと同じガード
    if (store.getState().browseMode !== 'posts') return false; // 全選択は post グリッドのみ（poster／コレクションは対象外）
    if (deps.getViewGroups().length === 0) return false;
    return true;
  }
  function doSelectAll() {
    selection.selectAll(deps.getViewGroups(), postIdKey);
    deps.renderPosts(true);
  }
  registerShortcut({
    id: 'selection.selectAll',
    titleKey: 'shortcutSelectAll',
    defaultCombo: 'Ctrl+a',
    ignoreShift: true,
    canExecute: (e) => !isTypingTarget(e) && canExecuteSelectAll(),
    perform: doSelectAll,
  });

  function handleShortcutSelectAllKey(e: KeyboardEvent) {
    tryRun('selection.selectAll', e);
  }

  // Ctrl/Cmd+C は画像が複数ある場合だけ選択画面を開く。
  function activeCopyFile() {
    const model = hologramImageTabSource.get();
    const item = model?.items[model.idx];
    return item && !item.video ? copyableImages([fileOfSrc(item.src)])[0] : undefined;
  }
  function canExecuteCopy(e: KeyboardEvent) {
    if (isTypingTarget(e) || getImageCopy()) return false;
    if (confirmGet() || settingsIsOpen()) return false;
    if (String(window.getSelection() || '')) return false;
    if (imageViewIsActive()) return !!activeCopyFile();
    if (store.getState().browseMode !== 'posts') return false;
    return selection.selectedGroups(deps.getViewGroups(), postIdKey).some((g) => copyableImages(g.files).length > 0);
  }
  function doCopy() {
    if (imageViewIsActive()) {
      const file = activeCopyFile();
      if (file) void copyImage(file);
      return;
    }
    const groups = selection.selectedGroups(deps.getViewGroups(), postIdKey);
    if (groups.length) deps.copyGroupsImage(groups);
  }
  // 保存済みのキー割り当てを引き継ぐため、ショートカット ID は維持する。
  registerShortcut({ id: 'selection.copyImage', titleKey: 'shortcutCopyImage', defaultCombo: 'Ctrl+c', ignoreShift: true, canExecute: canExecuteCopy, perform: doCopy });

  function handleShortcutCopyKey(e: KeyboardEvent) {
    tryRun('selection.copyImage', e);
  }

  function handleShortcutArrowNav(e: KeyboardEvent) {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const isHome = e.key === 'Home';
    const isEnd = e.key === 'End';
    const step = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' ? -gridColumnCount() : e.key === 'ArrowDown' ? gridColumnCount() : 0;
    if (!step && !isHome && !isEnd) return;
    const t = e.target as HTMLElement | null;
    if (!t || !gridSlot('post')?.contains(t)) return;
    if (t.closest('button, a, [role="button"], [role="separator"], [role="slider"]')) return;
    // テキストフィールドや contentEditable の中の Home/End は、そのフィールド
    // 自身のキャレットを行頭／行末へ動かす挙動＝このガードがすでに検索ボックス
    // とタグ入力から矢印ナビを締め出しているのと同じ理由（#672 の受け入れ
    // 基準: 入力へのフォーカスは Home/End を失ってはいけない）。
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (confirmGet()) return;
    if (settingsIsOpen()) return;
    if (imageViewIsActive()) return;
    if (store.getState().browseMode !== 'posts') return;
    const groups = deps.getViewGroups();
    if (groups.length === 0) return;
    e.preventDefault(); // これが無いとグリッドが矢印／Home/End でスクロールしてしまい、選択が画面外へ滑り出てしまう

    // 今どこにいるか: アンカーが正本（selectOnly/toggle がそれを最新に保つ）。
    // 全選択／クリア／選択を外すトグルの後は null になるので、単独の選択済み
    // カードへフォールバックし、それも無ければ「まだ何も無い」＝最初の一押しは
    // カード0に着地する。
    const selected = selection.selectedGroups(groups, postIdKey);
    const from = selection.anchorIndex() ?? (selected.length === 1 ? groups.indexOf(selected[0]) : -1);
    const next = isHome ? 0 : isEnd ? groups.length - 1 : from < 0 ? 0 : Math.min(groups.length - 1, Math.max(0, from + step));
    // 選択が変わらない（すでにその端にいる）ときは selectOnly を
    // 飛ばして、インスペクタが無駄に churn しないようにする＝以前と同じ。
    // ただし下の SCROLL は、選択が動いたかどうかに関わらず無条件に再実行
    // する: #606 自身の「トップへ戻る」ボタン（や、ただのホイール／ドラッグ
    // スクロール）は選択やアンカーには触れずにビューポートだけを動かすので、
    // これが無いと End → #606 のボタン → もう一度 End が、2回目は黙って何も
    // しないことになってしまう（選択はずっと最後のカードに乗ったままなので
    // next === from になり、利用者はトップを見つめたままキーボードで下へ
    // 戻る手段が無くなる――#672 を #606 のボタンと突き合わせて検証していて
    // 見つかった）。scrollGridIndexIntoView を無条件に再実行しても安全:
    // 対象のカードがすでに画面内にあれば、それ自体が no-op になる
    // （services/grid-nav.ts / VirtualGrid.tsx）ので、ビューポートがずれて
    // いなかった通常の経路ではコストが無い。
    if (next !== from) {
      const g = groups[next];
      if (!g) return;
      selection.selectOnly(next, postIdKey(g.rep));
    }
    scrollGridIndexIntoView(next);
  }

  function requestDeleteSelected() {
    if (selection.size() === 0) return;
    confirmOpen({
      message: deps.t('confirmDeleteSelected', { count: selection.size() }),
      okLabel: deps.t('confirmOk'),
      cancelLabel: deps.t('confirmCancel'),
      onOk: async () => {
        // 選択中のグループを一括削除する＝各選択グループの全レコード。
        const toDelete = selection.selectedRecords(deps.getViewGroups(), postIdKey);
        const count = toDelete.length;
        selection.clear();
        deps.removePosts(toDelete.map((p) => p.captureId));
        trashRefresh(); // ナビのゴミ箱バッジは、たった今そこへ着地したものを数える（#268）
        deps.showToast(deps.t('deletedN', { count: count }));
        await Promise.all(toDelete.map((p) => deletePost(p.image || p.video || p.captureId).catch(() => undefined)));
        await deps.loadPosts(true); // 失敗した項目があれば、実際の保存状態へ戻す
      },
    });
  }

  // 一括操作のボタンは今では下部のフローティングバーのもの（selection/
  // FloatingBar.tsx）＝orchestrator の export をそのまま通してこれらの名前付き
  // アクションを呼ぶ（onClick → 関数）ので、#selectionBar のコンテナも
  // data-act の DOM 契約も、委譲されたディスパッチャもすでに無い（再設計
  // §8-1 のゼロ許容）。メニューをアンカーする操作として残っているただ1つ
  // （フォルダ）は、クリックされたボタンを受け取り、それに対してメニューを
  // 開く（Base UI がそれを測って、下部バーの上に来るよう衝突反転させる）。

  // 「タグを追加」: 選択全体分のタグを Dialog（P2⑦）に載せる。中央寄せの
  // モーダルなので、下のフォルダメニューと違いアンカー矩形は取らない。
  function tagSelection() {
    deps.openBulkTagDialog();
  }

  // 「フォルダへ追加」: 選択全体分のフォルダピッカーを開く（行き先は選ぶ、
  // カードの 📁 と同じ＝既定フォルダは無い）。
  function folderSelection(anchorEl: HTMLElement) {
    const recs = selectedRecords();
    const ids = recs.map((r) => r.captureId).filter(Boolean);
    if (!ids.length) return;
    // 合成した代役グループ（本物のキー／files は無い＝showFoldMenu の呼び先は
    // この一括「選択をフォルダへ追加」の経路では .rep.captureId と .records
    // しか読まない）。ピッカーは「フォルダへ追加」ボタン自身の上にぶら下がる:
    // バーは下部に固定されているので `side: 'top'` がはまる位置（万一そうで
    // なければ Base UI が下向きに反転させる）。
    deps.showFoldMenu({ rep: { captureId: ids[0] }, records: recs } as unknown as HologramPostGroup, { anchorEl, side: 'top', align: 'center' });
  }

  return {
    clickSelect,
    clickBackground,
    selectedRecords,
    clearSelection,
    handleShortcutSelectAllKey,
    handleShortcutCopyKey,
    handleShortcutArrowNav,
    toggleSelectAll,
    requestDeleteSelected,
    tagSelection,
    folderSelection,
  };
}
