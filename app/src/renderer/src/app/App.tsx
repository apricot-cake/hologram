import { useEffect } from 'react';
import { AppShell } from '../shell/AppShell.tsx';
import { DropOverlay } from '../drop/DropOverlay.tsx';
import { ConfirmHost } from '../confirm/Confirm.tsx';
import { PaletteHost } from '../palette/CommandPalette.tsx';
import { PromptHost } from '../prompt/Prompt.tsx';
import { ContextMenuHost } from '../context-menu/ContextMenu.tsx';
import { KindMenuHost } from '../kind-menu/KindMenu.tsx';
import { WebSearchContextPanelHost } from '../websearch/WebSearchPanel.tsx';
import { LightboxHost } from '../lightbox/index.tsx';
import { CompareHost } from '../compare/index.tsx';
import { SettingsHost } from '../settings/index.tsx';
import { BulkTagDialogHost } from '../selection/BulkTagDialog.tsx';
import { AliasPickerHost } from '../posters/AliasPicker.tsx';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { handleShortcutFullTextKey, handleShortcutPaletteKey } from '../services/command-registry.ts';
import { handleShortcutHistoryKey } from '../services/history-panel.ts';
import { handleShortcutPanelsKey } from '../services/panels.ts';
import { handleShortcutZoomKey } from '../services/image-zoom.ts';
import { handleShortcutClipboardKey } from '../services/clipboard-intake.ts';
import { handleShortcutNewWindowKey } from '../services/window-actions.ts';
import { onPostsChanged } from '../services/posts.ts';
import { getLibraryStatus, getExtensionContact } from '../services/library-path.ts';
import { subscribePosterShape as subscribePosterDisplay, subscribeShape as subscribeDisplay } from '../services/display.ts';
import { onChange as foldersOnChange } from '../services/folders.ts';
import { store, subscribeKey } from '../services/store.ts';
import {
  viewerReady,
  bootApp,
  handleFolderChange,
  handlePostsChanged,
  handleShortcutNavKey,
  handleShortcutMouseNav,
  handleShortcutUndoKey,
  handleShortcutSelectAllKey,
  handleShortcutCopyKey,
  handleShortcutQuickView,
  handleShortcutArrowNav,
  handleShortcutSearchFocusKey,
  handleShortcutSizeKey,
  handleZoomWheel,
  handleEscDismissDetail,
  handleGlobalTabShortcut,
  handleSelectionContextmenu,
  handleDisplayStoreChange,
  handlePosterDisplayStoreChange,
  handleSearchQueryStoreChange,
} from '../services/orchestrator.ts';

// レンダラー全体でただ1つの React ルート＝最終形 B の DoD「島のルート群を1つにまとめる」
// （かつて独立していた島のルートを1つへ）。各コンポーネントはかつてそれぞれ自前の
// createRoot() を呼んでいたが、検証できる単位に分けてここへ移した。移したあとも各
// コンポーネントが持つのは描画だけで、状態はサービスのモジュールから読む（ロジックと状態は
// orchestrator.ts が持つ）。統一されたルートの下にどのコンポーネントが居るかは、この
// コンポーネントが正本。root.tsx が initI18n() の完了までマウントを止めるので、ここでは
// t() が同期で使える。
//
// #621 以降、ポータルの差し先はもう無い。index.html にあるのはルートのマウント点だけで
// （redesign §0-0⑥）、下のオーバーレイはどれも、このルートの fixed 配置の子としてその場に
// 描画されるか、自分のコンポーネントから document.body へポータルする（Base UI のもの）。

// アプリの起動。ただ1つの React ルート（このコンポーネント）がアプリの唯一の入り口なので、
// 最初のデータ読み込みを起こすのもここが持つ＝orchestrator.ts が React のマウントと並行して
// 自分で起動するのではない。まず viewerReady を待ってから bootApp() を一度だけ呼ぶ
// （viewerReady は orchestrator.ts の最初の同期文で代入されるので、この effect が走る時点で
// は既にある）。bootApp が代入されるのは orchestrator.ts が閉じ込める対象をすべて定義し
// 終えてからで、viewerReady が解決するのはその代入より後＝Promise が決着した時点で bootApp
// が本物の関数であることは保証されている。片付けは無い。起動はアプリの生涯で厳密に一度きり
// で、この単一ページのアプリで実際にはアンマウントされない他の App.tsx 直下の effect と
// 同じ。
function AppBoot() {
  useEffect(() => {
    viewerReady.then(() => bootApp());
  }, []);
  return null;
}

// #37: マウント時に一度だけ hologramStore の 'libraryMissing'/'libraryMissingPath' に種を
// 入れる。AppShell と LibraryMissingState が、ライブラリを見せるのか、なぜ届かないのかを
// 説明するのかを判断できるようにするため。購読ではなく一度きりの取得＝get-library-status は
// 呼ぶたびに statSync をやり直すし、プッシュの経路も無い（main/index.ts の
// refreshLibraryStatus のコメントを参照）。empty/LibraryMissingState.tsx は再試行や
// 付け替えのあと自分で取り直す。AppBoot/bootApp とは独立。DB に載った投稿一覧はどちらに
// しても読み込まれる（保存フォルダがあるかどうかを DB は知らないし気にしない）。この effect
// が決めるのは、AppShell がそれを見せるかどうかだけ。
//
// 併せて 'extensionContacted'（#71）にも種を入れる。形は同じく一度きりで、Native Messaging
// ブリッジが接触の印にこれまで一度でも触れたかどうか。2つ目のコンポーネントに分けずこの
// ゲートにまとめてある＝どちらも背後にプッシュの経路を持たない起動時の読み取りであり、しかも
// empty/EmptyState.tsx の firstRun の判定（services/library-status.ts の
// libraryEmptyVariant）は、導入案内の状態とただの空のライブラリとを見分けるのに、これと
// libraryLoaded の両方が着いていることを必要とするため。
function LibraryStatusGate() {
  useEffect(() => {
    getLibraryStatus()
      .then((status) => {
        store.setState({ libraryMissing: !!(status && status.missing) });
        store.setState({ libraryMissingPath: (status && status.path) || null });
      })
      .catch(() => {
        /* 既定（missing ではない）のままにする＝通常のグリッドは変わらず読み込みを試みる */
      });
    getExtensionContact()
      .then((status) => store.setState({ extensionContacted: !!(status && status.contacted) }))
      .catch(() => {
        /* 既定（undefined＝偽）のままにする＝「まだ接触なし」と読まれる。外れたときの
         * 2通りのうち安全な側（最悪でも案内が一度ちらつくだけ）。 */
      });
  }, []);
  return null;
}

// （ここには ShellClasses が居た。閲覧モードを .browse-posters として <body> に写し、旧来の
// シートがセレクタで拾えるようにしていた。対になる .browse-trash は、その読み手が代わりに
// ストアへ聞くようになった時点で先に消えている（P2⑬）。.browse-posters の最後の読み手は
// 旧来のシート自身だったので、クラスもシートと一緒に消えた＝P3 #6。）

// （ここには ModalChrome が居た。フォルダのモーダルか確認ダイアログが出ている間、<html> と
// <body> に .modal-open クラスを付けて背面のスクロールを止めていた。だが、これが実際に止めた
// ものは何も無かった。シェルが固定高の列になって以降ページはスクロールしないし、body 自身の
// overflow:hidden（globals.css）はビューポートまで伝わる。書き込むために存在していたその
// クラスと一緒に消えた＝P3 #6。もっと前の役目＝スクリムと歩調を合わせて OS が描く窓の帯を
// 暗くすることは、ボタンがアプリ描画になった時点で先に無くなっていた。）

// グローバルのキーボード／マウスショートカット（タブ履歴の移動、取り消しとやり直し、全選択、
// 検索欄へのフォーカス、表示サイズの一段の変更）。DOM のリスナー登録は React が持つように
// なった（アプリの生涯で一度だけマウントされる）。各ハンドラの防ぎと動作のロジックは変えて
// いない。orchestrator.ts に置いたまま live binding として直接 import する＝「切り出して
// 繋ぎ直す」であって、作り直しではない。起動の完了を待つ防ぎは要らない。理由は下の
// handleFolderChange/handlePostsChanged と同じで、これらが動くのは本物の keydown/mouseup が
// 起きたときだけであり、orchestrator.ts の IIFE は、人間（や CDP のテスト）がそれを起こせる
// ようになるよりずっと前に本物の関数を代入し終えている。
function GlobalShortcuts() {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      handleShortcutNavKey(e);
      handleShortcutUndoKey(e);
      handleShortcutSelectAllKey(e);
      handleShortcutCopyKey(e);
      handleShortcutQuickView(e);
      handleShortcutArrowNav(e);
      handleShortcutSearchFocusKey(e);
      handleShortcutSizeKey(e);
      // Ctrl/Cmd+K = コマンドパレット（#28）。`/` は検索欄へのフォーカスのままで、こちらは
      // レジストリから直接来る＝orchestrator の束縛は無い。パレットを開くのは純粋に UI の
      // 状態だから（防ぎと動作は services/command-registry.ts の、それらが読む状態の隣に
      // ある）。
      handleShortcutPaletteKey(e);
      // Ctrl/Cmd+Shift+F = パレットの全文検索モード（#29）＝パレット自身の下端の行と並ぶ、
      // 設計上2つ目の入り口。仕組みは上のパレットのキーと同じ（防ぎと動作は、それらが読む
      // 状態の隣にある）。
      handleShortcutFullTextKey(e);
      // Ctrl/Cmd+H = グローバルの履歴ページ（#145）＝サイドバー下端の行とパレットの
      // cmd:history と並ぶ3つ目の入り口。仕組みは上のパレットのキーと同じ。
      handleShortcutHistoryKey(e);
      // Ctrl/Cmd+Shift+B = サイドバーと詳細パネルをまとめて隠す（#245）。仕組みは上の
      // パレットのキーと同じで、防ぎと動作は services/panels.ts の状態の隣にあり、ここに
      // あるのは登録だけ。
      handleShortcutPanelsKey(e);
      // 画像の表示中に Ctrl/Cmd+0 = 画面に合わせる／Ctrl/Cmd+1 = 実寸（#150）。ここも仕組みは
      // 同じ。防ぎは「拡大できるスライドがコントローラを登録済みかどうか」で、それを知り得る
      // のは services/image-zoom.ts だけ。
      handleShortcutZoomKey(e);
      // Ctrl/Cmd+V = クリップボードの画像を取り込む（#85）。ここも仕組みは同じで、ここに
      // あるのは登録だけ。防ぎはこの一群で最も厳しい。他のあらゆる場所でそのキーが既に別の
      // 意味を持っている唯一のショートカットだから＝services/clipboard-intake.ts を参照。
      handleShortcutClipboardKey(e);
      // Ctrl+T / Ctrl+W / Ctrl+Tab＝タブのショートカットが効く先は、指しているタブではなく
      // ウィンドウなので、ストリップではなくここに置く（#621）。
      handleGlobalTabShortcut(e);
      // Ctrl/Cmd+Shift+N = 新しいウィンドウを開く（#32 St1）。仕組みは上の他の Ctrl+Shift+
      // のキーと同じで、防ぎと動作は services/window-actions.ts にある。
      handleShortcutNewWindowKey(e);
    };
    const onMouseup = (e: MouseEvent) => handleShortcutMouseNav(e);
    // Ctrl+ホイール = 表示サイズ（#141）。意図して非 passive にしてある。ハンドラが
    // preventDefault して、Chromium のページズームをグリッドに入れないため。
    const onWheel = (e: WheelEvent) => handleZoomWheel(e);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('mouseup', onMouseup);
    window.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      document.removeEventListener('keydown', onKeydown);
      window.removeEventListener('mouseup', onMouseup);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);
  return null;
}

// 画像タブの詳細表示を Esc で優先的に引っ込める処理。捕捉相で走らせる必要がある（確認する
// 対象のオーバーレイやポップオーバーより先に来なければならないため）＝GlobalShortcuts の
// バブリング相の keydown とは相が違うので、そちらに合流させず別の effect／コンポーネントの
// ままにしてある。ハンドラと防ぎのロジックは inspector-builder.ts にある（そのモジュールが
// orchestrator.ts から切り出された時に一緒に移した）。GlobalShortcuts と同じ「切り出して
// 繋ぎ直す」で、live binding として直接 import する。
//
// この effect を共有していた外側クリックのリスナーは、それが仕えていた狭い幅のスライド
// オーバーごと無くなった（#975）。据え付けの列は、グリッドをクリックして追い払うようなもの
// ではないし、パネルを空にする余白のクリック（#242）はグリッド自身の押下の判定が持つ＝押下と
// ドラッグを見分けられるのはそれだけだから。
function DetailDismiss() {
  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => handleEscDismissDetail(e);
    document.addEventListener('keydown', onKeydown, true);
    return () => {
      document.removeEventListener('keydown', onKeydown, true);
    };
  }, []);
  return null;
}

// 選択テキストの右クリック（#167）。自前のコンテキストメニューを持たない画面のための
// 「コピー」「Googleで検索」「ライブラリ内検索」で、主にインスペクタの本文とメタデータが対象。
// Electron は既定のメニューを積んでいないうえ、ウィンドウは removeMenu() を走らせているので、
// これが無いとそこでの右クリックは何にも当たらない。
//
// document のバブリング相なのは意図してそうしている。自前のメニューを持つ画面（カード／
// 投稿者／タブ／フォルダ／タグのチップ）は、どれも先に自分の contextmenu を
// preventDefault() するので、このハンドラは defaultPrevented なら何もせず抜ける。おかげで
// これは、対象の画面の一覧を保守しなくて済む受け皿のままでいられるし、「選択が無ければ
// メニューも出ない」も元のまま。起動を待つ防ぎが要らない理由は GlobalShortcuts と同じで、
// 本物の右クリックでしか動かない。
function SelectionContextMenu() {
  useEffect(() => {
    const onContextmenu = (e: MouseEvent) => handleSelectionContextmenu(e);
    document.addEventListener('contextmenu', onContextmenu);
    return () => document.removeEventListener('contextmenu', onContextmenu);
  }, []);
  return null;
}

// 外部ストアと IPC の購読。hologramStore のキー（両方のグリッドの表示の軸と searchQuery）、
// 検索モードの切り替え、共有フォルダの変更、そして fs 監視から来る posts-changed の合図。
// subscribe() の登録は React が持つ（アプリの生涯で一度だけマウントされる）。ストアと検索
// モードのハンドラは防ぎと動作のロジックで、今も orchestrator.ts にあり、live binding として
// 直接 import する＝App.tsx 直下の他の effect や下の handleFolderChange/handlePostsChanged と
// 同じ「切り出して繋ぎ直す」で、orchestrator.ts が本物の束縛として export していればブリッジ
// は要らない。hologramStore の購読は unsubscribe を返すので（useSyncExternalStore と互換）
// 片付けで呼ぶ。hologramFolders.onChange と hologramPosts.onPostsChanged は返さない
// （subs.push と生の ipcRenderer.on）が、この単一ページのアプリでこの effect が実際に
// アンマウントされることは無いので害は無い。
function StoreSubscriptions() {
  useEffect(() => {
    const unsubDisplay = subscribeDisplay(() => handleDisplayStoreChange());
    const unsubPosterDisplay = subscribePosterDisplay(() => handlePosterDisplayStoreChange());
    const unsubSearchQuery = subscribeKey('searchQuery', () => handleSearchQueryStoreChange());
    foldersOnChange((kind) => handleFolderChange(kind));
    onPostsChanged(() => handlePostsChanged());
    return () => {
      unsubDisplay();
      unsubPosterDisplay();
      unsubSearchQuery();
    };
  }, []);
  return null;
}

export function App() {
  return (
    // アプリ全体で TooltipProvider は1つ。ホバーの補足はどれも自前の Base UI の Tooltip に
    // なっていて（単一の .ui-tip ホストと document レベルの [data-tip] の委譲は無くなった、
    // #62）、それらに同じ遅延と「同時に開くのは1つ」のまとまりを共有させているのがこの
    // プロバイダ。body レベルのオーバーレイより上にも居る必要がある＝種別メニューの名前変更
    // ボタンがツールチップを持つため。
    <TooltipProvider delay={0}>
      {/* マウント時に一度だけ、アプリの最初のデータ読み込みを起こす。 */}
      <AppBoot />
      {/* #37: マウント時に一度だけ、ストアの libraryMissing 系のキーに種を入れる。 */}
      <LibraryStatusGate />
      {/* グローバルのキーボード／マウスショートカット＝リスナーの登録は React が持つ。 */}
      <GlobalShortcuts />
      {/* Esc を優先したインスペクタの閉じる処理と、外側クリックでの引っ込め＝捕捉相。 */}
      <DetailDismiss />
      {/* 他のどのメニューもそのクリックを取らない場所での、選択テキストの右クリック（#167）。 */}
      <SelectionContextMenu />
      {/* 外部ストアと IPC の購読（hologramStore のキー、qf-pop、検索モード、フォルダの変更、
          fs 監視から来る posts-changed の合図）。 */}
      <StoreSubscriptions />
      {/* React が持つアプリのシェル。タブバー＋左のナビ＋コンテンツの inset＋右のインスペクタ
          で、シェルに埋め込まれたコンポーネント（タブ／グリッド／詳細パネル／画像タブ／検索／
          チップ／空状態／バックアップ状態）をその場に描画する（redesign §3、P1-2..P1-5）。 */}
      <AppShell />
      {/* ウィンドウへのドロップで取り込む（#234）。drag/drop のリスナーはウィンドウ全体に
          張るが、受け取る要素はファイルのドラッグがウィンドウの上にある間しか存在しない（し、
          見えもしない）。だから、上の常にマウントされている effect のコンポーネントではなく
          ここで描画する。 */}
      <DropOverlay />
      {/* body レベルのオーバーレイ。メニュー／確認／ダイアログ／トースター／ツールチップ／
          クイックビューの覗き見は自分で document.body へポータルする。フォルダのモーダルは
          このルートの fixed 配置の子。どちらも index.html に静的なコンテナを置く必要はもう
          無い（#621）。 */}
      <ContextMenuHost />
      <KindMenuHost />
      {/* #207: 投稿者／タグのコンテキストメニューから「ウェブで探す」への入り口。常にマウント
          されている実体が1つで、形は上の2つと同じ。 */}
      <WebSearchContextPanelHost />
      <ConfirmHost />
      {/* コマンドパレット（#28）＝Ctrl+K。 */}
      <PaletteHost />
      {/* 名前を付けるための共有ダイアログ（prompt.ts のブリッジ）。Electron のレンダラーでは
          window.prompt が使えないので、名前を付ける流れはこちらを通る。 */}
      <PromptHost />
      {/* 選択に対する一括タグ付け（bulk-tag.ts のブリッジ、P2⑦）。書き込む前に一段溜める唯一
          のタグ付けの流れなので、詳細パネルの行内の欄ではなく Dialog になる。 */}
      {/* 「同一人物にする」の投稿者ピッカー（#23 St1）＝インスペクタとカードのメニューから始まる統合の流れが使う検索ダイアログ。 */}
      <AliasPickerHost />
      <BulkTagDialogHost />
      <LightboxHost />
      <CompareHost />
      {/* 設定＝shadcn の Dialog なので、自分で document.body へポータルする。 */}
      <SettingsHost />
      {/* トーストの出口（sonner）＝services/ui.ts の notify() が流し込む。 */}
      <Toaster />
    </TooltipProvider>
  );
}
