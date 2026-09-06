'use strict';

// 貼り付けで取り込む（#85）＝アプリのウィンドウのどこでも Ctrl/Cmd+V を押すと、クリップ
// ボードにある画像をライブラリへ落とす。
//
// 範囲: これはアプリ内のキーだけで、それ以外は含まない。OS 全体のホットキー（globalShortcut）と
// OS の通知は意図して v2 へ送った＝理由は #85 の 2026-07-16 のコメントにある（システム全体で
// キーを掴むこと、登録に失敗した時の UI、終了時の登録解除は、この機能の高くつく側の半分で、
// しかも得られる便利さはウィンドウに焦点を当てる経路が既に覆っている）。クリップボードの
// text/html から URL を取り出すこともここではしないが、それは「まだ作っていない」ではなく
// 除外した判断だ。url を持つレコードは自分を SNS の投稿として見せるが、それはその画素が
// どこから来たかについての嘘になる。
//
// 防ぎこそがこの機能。Ctrl+V は貼り付けのキーなので、これを足せる唯一の道は、貼り付けが
// 普段どおりの意味を持つ場所すべてから身を引くこと＝タグのエディタ、検索ボックス、
// contentEditable のどこか、そして画面を持つオーバーレイ。それはアプリ全体の他のショートカットが
// 使っているのと同じ防ぎの形で（services/panels.ts の Ctrl+Shift+B、selection-builder.ts の
// Ctrl+A / Ctrl+C）、意図して同じ書き方にしてある＝隣と違う防ぎ方をするショートカットは、
// いずれ隣から離れていく。
//
// 登録は他の document レベルのキーと一緒に GlobalShortcuts コンポーネント（app/App.tsx）に
// あり、防ぎと操作は、それが呼ぶ IPC の隣であるここに残る。
import { get as confirmGet } from './confirm.ts';
import { isOpen as fulltextIsOpen } from './fulltext-dialog.ts';
import { isActive as imageViewIsActive } from './image-tab.ts';
import { isOpen as settingsIsOpen } from './settings.ts';
import { isTypingTarget, registerShortcut, tryRun } from './shortcut-registry.ts';
import { store } from './store.ts';
import { importClipboard } from './posts.ts';
import { formatDate } from './format.ts';
import { notify } from './ui.ts';
import { t } from '../_shared/i18n.ts';

/**
 * クリップボードにある画像を main に尋ね、結果を伝える。
 *
 * 3つの結果に3つの違うトーストを出すのは意図してのこと。クリップボードが空なのはよくある
 * こと（利用者が文字を載せていた）で、失敗として読まれてはいけない。それが #85 自身の受け入れ
 * 条件だ。グリッドの更新はここではしない＝書き込みの後に main が `posts-changed` を押し出す。
 * アプリ内での削除が使うのと同じ経路。
 */
export async function importFromClipboard(): Promise<void> {
  try {
    const res = await importClipboard(t('clipboardTitle', [formatDate(new Date())]));
    if (!res || res.error) notify(t('importFailed'));
    else if (res.empty) notify(t('clipboardNoImage'));
    else notify(t('clipboardImported'));
  } catch {
    notify(t('importFailed'));
  }
}

/**
 * Ctrl/Cmd+V。登録は GlobalShortcuts コンポーネント（app/App.tsx）にある。
 *
 * #246: Shift はこの和音の本当の一部（ignoreShift にしない）。Ctrl+Shift+V はたいていの
 * エディタで「書式なしで貼り付け」なので、ここでそれを取ると、このハンドラが既に身を引いて
 * いる欄の中で利用者が最も手を伸ばしそうな貼り付けの変種を壊すことになる。キー自体は今は
 * 登録簿にあり、ここに残るのは防ぎの連なり（#85 は入力の焦点の検査を最重要と呼んでいる）と
 * 操作。
 */
function canExecutePaste(e: KeyboardEvent): boolean {
  // #85 が最重要と呼ぶ唯一の防ぎ。カーソルが欄の中にある間、Ctrl+V は普通の貼り付けであり、
  // このハンドラは存在しない。
  if (isTypingTarget(e)) return false;
  if (confirmGet()) return false;
  if (settingsIsOpen()) return false;
  if (fulltextIsOpen()) return false;
  // 単体の画像ビューは自分のキーを持つ独立した画面＝Ctrl+C や Space と同じ除外
  // （selection-builder.ts）。
  if (imageViewIsActive()) return false;
  // ゴミ箱（#268）。貼り付けは新しい保存で、ゴミ箱はライブラリへの保存が切れている唯一の
  // 行き先だ。そこで貼ると、利用者が見ていないグリッドへ画像を黙って落とすことになる。上の
  // どの防ぎも自分のモジュールに尋ねているのと同じく、これはストアに尋ねる＝body のクラスを
  // 読むのは #153 が禁じた DOM の嗅ぎ回りで、しかも他に読み手のいないクラスを存在させていた。
  if (store.getState().browseMode === 'trash') return false;
  return true;
}

registerShortcut({
  id: 'clipboard.paste',
  titleKey: 'shortcutPasteImage',
  defaultCombo: 'Ctrl+v',
  canExecute: canExecutePaste,
  perform: () => void importFromClipboard(),
});

export function handleShortcutClipboardKey(e: KeyboardEvent): void {
  tryRun('clipboard.paste', e);
}
