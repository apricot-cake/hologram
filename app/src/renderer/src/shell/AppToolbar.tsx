// ツールバーと絞り込みチップの行＝新しい IA の「述語」の軸（redesign §3-2）。グリッドの上に
// 水平な帯を1本置く＝サイドバーの切り替え、タブ履歴の戻る／進む、検索の入力欄、そして
// （右に）「絞り込みを追加」と「表示」の入口。効いている絞り込みのチップは、そのすぐ下の行に
// 座る。前例: Linear のフィルタバー・VS Code のツールバー。
//
// P1 の範囲は枠。検索は既存の SearchBox コンポーネントを載せる（P2④ で Autocomplete へ
// つなぎ替えた）。「絞り込みを追加」の追加フロー（P2③）と「表示」ポップオーバー（P2②）は
// どちらも今は動いている。下のチップの行は filterbar コンポーネントの Linear 式 FilterChips
// を描く＝チップの面はこれ1つだけ（旧いビルダーが起動時に解決していた隠れた #queryChips /
// #posterQueryChips のコンテナは、#230 でその描画経路もろとも消えた）。
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AddFilterButton } from '../filterbar/index.tsx';
import { FilterChips } from '../filterbar/FilterChips.tsx';
import { DisplayMenu } from './DisplayMenu.tsx';
import { DateJumpButton } from './DateJumpButton.tsx';
import { IndexingIndicator } from './IndexingIndicator.tsx';
import { WebSearchPanel } from '../websearch/WebSearchPanel.tsx';
import { SearchBox } from '../searchbox/SearchBox.tsx';
import { ViewerToolbar } from '../image-tab/ViewerToolbar.tsx';
import { t } from '../_shared/i18n.ts';
import { open as openPalette } from '../services/command-registry.ts';
import { hologramImageTabSource, isActive as imageViewIsActive } from '../services/image-tab.ts';
import { subscribeQueueCount } from '../services/triage-builder.ts';
import { store, subscribeKey } from '../services/store.ts';
import type { HologramStoreState } from '../services/store.ts';
import { navBack, navForward, openTriage, triageQueueCount } from '../services/orchestrator.ts';

const subKey = (key: keyof HologramStoreState) => (cb: () => void) => subscribeKey(key, cb);
const subBack = subKey('navCanBack');
const getBack = (): boolean => store.getState().navCanBack;
const subForward = subKey('navCanForward');
const getForward = (): boolean => store.getState().navCanForward;
// 画像ビューが出ているかどうか＝舞台を組み立てるモジュールである services/image-tab.ts に
// 訊く。こうすればツールバーとシェルが、今どちらが画面に出ているかで食い違うことはない
// （P2⑫）。帯そのものは残る（どのブラウザもどのタブでもツールバーの行を残す）が、載せる
// ものが入れ替わる＝述語のコントロールは画面に出ていないグリッドについてのもので、ズームの
// コントロールは今出ている絵についてのものだから（#150）。

// 検索の欄の先頭に置く虫眼鏡（SearchBox が描くのは入力欄だけで、アイコンは欄の外枠。旧い
// #searchWrap も同じ分け方だった）。
function SearchIcon() {
  return (
    // 旧い .search-ico クラスは付けない。あちらの transform:translateY(-50%) は
    // -translate-y-1/2 ユーティリティと積み重なる（Tailwind v4 は別プロパティの
    // `translate` を出すので両方が効く＝アイコンが 8px 上へずれる）。位置決めの仕組みは
    // 1つだけにする。
    <svg className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  );
}

// 検索の欄の右端に置く Ctrl+K のバッジ＝コマンドパレットの見える入口2つのうちの1つ
// （#28・もう1つはサイドバーのフッター）。ショートカットでしか辿り着けないパレットは誰にも
// 見つからないパレットで、この場所は二役をこなす＝`/` がこの欄にフォーカスし Ctrl+K が
// パレットを開く、という2つのキーがここで自分を説明する。ショートカットの手がかりを、
// それが効く先ではない欄の隣に置くのは Slack・Linear・GitHub がそろって採っている配置。
//
// Badge コンポーネントではなく素のボタンにする。Badge は状態を示すチップで、作りからして
// 操作できるものではない。ここで要るのは、キーの見た目をした押せるコントロール。
function PaletteBadge() {
  return (
    <button
      type="button"
      aria-label={t('paletteTitle')}
      title={t('paletteTitle')}
      onClick={() => openPalette()}
      className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded border border-input bg-muted/60 px-1.5 py-0.5 font-sans text-[11px] leading-tight font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      Ctrl+K
    </button>
  );
}

// 速いトリアージのモードへの入口（#46）。コマンドパレットの中だけに置くのではなく、表示と
// 絞り込みの対の隣＝それらと同じ「常に見えている右のセル」に置く。トリアージは何度も手を
// 伸ばす作業のつもりだから（写真の選別道具は、これにショートカットだけでなくツールバー上の
// 場所を与えている）。件数はツールバーの他の部分とは独立に購読する
// （services/triage-builder.ts の subscribeQueueCount）＝このコンポーネント自身の操作から
// だけでなく、アプリのどこでタグやフォルダを編集しても動かなければならないため。
function TriageButton() {
  // triageQueueCount / openTriage は orchestrator.ts の `export let` で、値が入るのは
  // 非同期 IIFE が triageCtl を組み立て終えたあと＝`await hologramI18n` より後。一方 React は
  // それよりずっと早く、同期的に載って描く。このツールバーの他の export let はすべて
  // クリックハンドラの中から読まれる（その頃には起動はとうに終わっている）が、これだけは
  // useSyncExternalStore の getSnapshot として読まれ、最初の描画でも走る＝他のものの防ぎを
  // 借りるのではなく、自分の防ぎが要る（実際に踏んだ＝この防ぎが無かった頃、起動直後に
  // 「getSnapshot is not a function」で木ごと落ちた）。
  const count = useSyncExternalStore(subscribeQueueCount, () => (triageQueueCount ? triageQueueCount() : 0));
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button data-slot="triage-toolbar-button" variant="ghost" size="icon-sm" aria-label={t('triageToolbarLabel')} onClick={() => openTriage?.()} className="relative">
            <Inbox />
            {count > 0 && (
              <Badge variant="secondary" className="-top-1 -right-1 absolute h-4 min-w-4 justify-center px-1 text-[10px] tabular-nums">
                {count > 99 ? '99+' : count}
              </Badge>
            )}
          </Button>
        }
      />
      <TooltipContent>{count > 0 ? t('triageToolbarHint', [count]) : t('triageToolbarLabel')}</TooltipContent>
    </Tooltip>
  );
}

export function AppToolbar() {
  const canBack = useSyncExternalStore(subBack, getBack);
  const canForward = useSyncExternalStore(subForward, getForward);
  const imageView = useSyncExternalStore(hologramImageTabSource.subscribe, imageViewIsActive);
  return (
    // bg-background ではなく bg-sidebar にする。ツールバーと左のサイドバーはタブ帯の下で
    // 1本の帯を成し、アクティブなタブはその帯へつながる（旧い塗りの --sidebar-bg が同じ色の
    // 別名になっている）＝Chrome のタブ帯とツールバーの作り。
    <div className="flex flex-col border-b bg-sidebar">
      {/* 3列のグリッドにして、検索を左右対称の余白付きで中央に座らせる（Slack / Safari /
          VS Code）。全幅へ引き伸ばさない（引き伸ばすと、広いウィンドウの空っぽな中央が
          そのまま広く空っぽな入力欄になるだけだった）。1fr の両脇のセルはナビ（左）と
          絞り込み／表示の対（右）を載せ、余った空きが等しくなるので検索の呼吸の幅も左右
          対称になる。中央は 40rem で頭打ちにし、狭いウィンドウでは（minmax 0 で）縮んで
          詰まった1行に戻る。 */}
      <div className="grid h-12 items-center gap-1.5 px-2" style={{ gridTemplateColumns: '1fr minmax(0, 40rem) 1fr' }}>
        {/* サイドバーの切り替えは今はサイドバー自身のヘッダーにある（Obsidian 型のシェル・
            #154）。左のセルはいきなりタブごとの戻る／進むから始まる。 */}
        <div className="flex items-center">
          <Button variant="ghost" size="icon-sm" aria-label="戻る" disabled={!canBack} onClick={() => navBack()}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="進む" disabled={!canForward} onClick={() => navForward()}>
            <ChevronRight />
          </Button>
        </div>
        {/* 画像ビューが出ている間は、外すのではなく隠す。欄は打ったがまだ適用していない
            テキストと Autocomplete の状態を保ったままになり、display:none だけで
            タブ順からも既に外れる。 */}
        <div data-slot="toolbar-search" className={`relative flex min-w-0 items-center ${imageView ? 'hidden' : ''}`}>
          <SearchIcon />
          <SearchBox placeholder={t('searchPlaceholder')} />
          <PaletteBadge />
        </div>
        <div className="flex items-center justify-end gap-1.5">
          {/* 下にある他のものと違い、画像ビューの分岐の外に置く。裏で走る索引付けは今
              画面に出ているものではなくライブラリについての話なので、ビューアがこの
              セルの残りを占めても居座る（#834＝Lightroom の作業状況の区画も同じく
              モジュールに依存しない）。仕事が無ければ何も描かない。 */}
          <IndexingIndicator />
          {/* この2つは意図して外す。どちらもポップオーバーの引き金で、グリッドについての
              ポップオーバーが開いたまま画像ビューへ生き延びる理由は無い。 */}
          {imageView ? (
            <ViewerToolbar />
          ) : (
            <>
              <TriageButton />
              <WebSearchPanel />
              <AddFilterButton />
              <DateJumpButton />
              <DisplayMenu />
            </>
          )}
        </div>
      </div>
      {/* 効いている絞り込みのチップ（redesign §3-2 / P2③）＝filterbar コンポーネントが
          activeFilters() から描く Linear 式のチップ。チップをクリックするとその編集画面が
          開き直す。px-8 は #mode-post の 32px の内容パディングと同じで、チップの行が、
          それが絞り込んでいるカードと同じ左の軸に座る（Linear のフィルタ行 ↔ 一覧の余白）。 */}
      <div className={`px-8 ${imageView ? 'hidden' : ''}`}>
        <FilterChips />
      </div>
    </div>
  );
}
