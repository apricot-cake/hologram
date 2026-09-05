import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { Images, Puzzle, SearchX, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { t } from '../_shared/i18n.ts';
import { importFromClipboard } from '../services/clipboard-intake.ts';
import { hologramIpc } from '../services/ipc.ts';
import { libraryEmptyVariant } from '../services/library-status.ts';
import { resetAllFilters, resetPosterFilters } from '../services/orchestrator.ts';
import { store, subscribeKey } from '../services/store.ts';
import { runZipImport } from '../services/zip-import.ts';

// #71: ストアへの申請はまだ存在しない（リリース前＝Issue #71 のリリース順の注記を
// 参照。この Issue は最後、拡張機能が公開されたあとに出る）。存在したら実際の Chrome
// ウェブストアの掲載 URL に置き換える。それまでは、でっち上げの掲載ページではなく
// ストアのトップを指しておく。
const EXTENSION_STORE_URL = 'https://chrome.google.com/webstore/category/extensions'; // TODO(#71): 実際の掲載 URL

// 2つのライブラリのグリッドが空のときの差し込み＝初回起動の「投稿がありません」、絞り込みで
// 空になったときの「見つかりませんでした」、投稿者側の初回起動のメッセージ。自分のコンテナと
// 自分の表示可否を自分で持つ＝かつてシェルは静的な `#emptyState` の div の中へこれを載せ、
// その `hidden` を2本の描画経路が手で書いていた（今は無い）。一方でこのコンポーネントは、
// 言うことがあるかどうかを既にストアから知っていた。ボタンはオーケストレータを直に呼ぶ＝
// 要素の id で照合していた委譲クリックリスナの代わり（#153）。
//
// 形は shadcn の Empty（P2⑫）＝アイコンの板、見出し、説明、そして操作。今やアプリの空の
// 状態はどれもこの骨格をまとう（ゴミ箱の、インスペクタの、画像表示の「投稿が消えている」）。
// かつてはここでしか当たらないスタイルのボタンを添えた <p><strong> の行だけの素の <div>
// で、それが「ここには何も無い」と言う3つの画面が3つの別の製品に見えていた原因だった。
//
// 両方のバリアント（投稿と投稿者）は viewer からの push ではなく、自分で導くセレクタに
// たたみ込んである＝hologramStore が必要なものをすべてリアクティブに持っている。共有して
// いた旧 push ブリッジはどこにも呼び手が残らず、削除した。
//
// どのバリアントにするかの判断はここではなく services/library-status.ts にある（#682）＝
// 'libraryLoaded' で絞っているので、読み込み途中のグリッドが「空だと確定した」と読まれる
// ことはない。postGroups/posterGroups だけではその2つを区別できなかった理由はあちらの
// モジュールの冒頭に、読み込み中に何が穴を埋めるかは empty/LibraryLoading.tsx にある。
const subPostGroups = (cb: () => void) => subscribeKey('postGroups', cb);
const getPostGroups = () => store.getState().postGroups;
const subAllPostsCount = (cb: () => void) => subscribeKey('allPostsCount', cb);
const getAllPostsCount = () => store.getState().allPostsCount;
const subPosterGroups = (cb: () => void) => subscribeKey('posterGroups', cb);
const getPosterGroups = () => store.getState().posterGroups; // 明示的に null にはならない＝library-status.ts 参照
const subAllUsersCount = (cb: () => void) => subscribeKey('allUsersCount', cb);
const getAllUsersCount = () => store.getState().allUsersCount;
const subSearchQuery = (cb: () => void) => subscribeKey('searchQuery', cb);
const getSearchQuery = () => store.getState().searchQuery;
const subMode = (cb: () => void) => subscribeKey('browseMode', cb);
const getMode = () => store.getState().browseMode;
const subLibraryLoaded = (cb: () => void) => subscribeKey('libraryLoaded', cb);
const getLibraryLoaded = () => store.getState().libraryLoaded;
// #71: App.tsx の LibraryStatusGate（get-extension-contact）が起動時に1回だけ入れる＝
// これが firstRun を2つに割る仕組みは library-status.ts の libraryEmptyVariant を参照。
const subExtensionContacted = (cb: () => void) => subscribeKey('extensionContacted', cb);
const getExtensionContacted = () => store.getState().extensionContacted;

export function EmptyState() {
  const mode = useSyncExternalStore(subMode, getMode);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const allPostsCount = useSyncExternalStore(subAllPostsCount, getAllPostsCount);
  const posterGroups = useSyncExternalStore(subPosterGroups, getPosterGroups);
  const allUsersCount = useSyncExternalStore(subAllUsersCount, getAllUsersCount);
  const query = useSyncExternalStore(subSearchQuery, getSearchQuery);
  const libraryLoaded = useSyncExternalStore(subLibraryLoaded, getLibraryLoaded);
  const extensionContacted = useSyncExternalStore(subExtensionContacted, getExtensionContacted);
  const variant = libraryEmptyVariant({ mode, libraryLoaded, postGroups, posterGroups, allPostsCount, allUsersCount, query, extensionContacted });
  if (!variant) return null;
  // #71: 拡張機能がホストと一度も話したことがない＝この画面が言えるどの話よりも先に
  // 来るのはインストールなので、下の通常の firstRun/posterFirstRun の文言を両方の
  // モードで押しのける（この案内は拡張機能を入れる話であって、投稿か投稿者かの話では
  // ない）。
  if (variant === 'extensionGuide') {
    return (
      <Frame>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Puzzle />
          </EmptyMedia>
          <EmptyTitle>{t('extGuideTitle')}</EmptyTitle>
          <EmptyDescription>{t('extGuideDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => hologramIpc.openExternal(EXTENSION_STORE_URL)}>
            {t('extGuideInstallBtn')}
          </Button>
        </EmptyContent>
      </Frame>
    );
  }
  // 絞り込みか検索が全部を食べた → 正直に言える次の一手はそれを取り消すことだけ。ここに
  // でっち上げの2つ目のボタンは置かない＝グリッドが空なのは利用者が置いた述語のせいで、
  // この場所からそれについてできることは「リセット」で尽きている。
  if (variant === 'filtered') {
    return (
      <Frame>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <SearchX />
          </EmptyMedia>
          <EmptyTitle>{t('emptySearchTitle')}</EmptyTitle>
          <EmptyDescription>{t('emptySearchDesc')}</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button variant="outline" onClick={() => (mode === 'posters' ? resetPosterFilters?.() : resetAllFilters?.())}>
            {t('emptyResetBtn')}
          </Button>
        </EmptyContent>
      </Frame>
    );
  }
  // 初回起動、投稿でも投稿者でも: ライブラリは本当に空なので、ここに載るべきは「どうやって
  // 入れるか」。ブラウザの投稿保存は説明文に、アプリが実行できる残りの2つはボタンに。
  // この2つは、そうしなければコマンド
  // パレットからしか辿り着けなかった。
  const poster = variant === 'posterFirstRun';
  return (
    <Frame>
      <EmptyHeader>
        <EmptyMedia variant="icon">{poster ? <Users /> : <Images />}</EmptyMedia>
        <EmptyTitle>{t(poster ? 'posterEmptyTitle' : 'emptyTitle')}</EmptyTitle>
        <EmptyDescription>
          {t(poster ? 'posterEmptyDesc' : 'emptyDesc')} {t('emptyCaptureHint')}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="outline" onClick={() => void runZipImport()}>
            {t('importZip')}
          </Button>
          <Button variant="outline" onClick={() => void importFromClipboard()}>
            {t('emptyImportClipboard')}
          </Button>
        </div>
      </EmptyContent>
    </Frame>
  );
}

// グリッドの空の状態は、スクロールする内容の列を埋めるパネルではなく、その列の中に置く
// ブロック。だから Empty 自身の `flex-1` には伸びる相手が無い＝高さは代わりに padding で
// 出す。（インスペクタと画像表示のものはコンテナを埋めるので、コンポーネントをそのまま使う。）
function Frame({ children }: { children: ReactNode }) {
  return (
    <Empty data-slot="empty-state" className="py-16">
      {children}
    </Empty>
  );
}
