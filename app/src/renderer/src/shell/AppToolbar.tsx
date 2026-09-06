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
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { AddFilterButton } from '../filterbar/index.tsx';
import { FilterChips } from '../filterbar/FilterChips.tsx';
import { DisplayMenu } from './DisplayMenu.tsx';
import { SearchBox } from '../searchbox/SearchBox.tsx';
import { ViewerToolbar } from '../image-tab/ViewerToolbar.tsx';
import { t } from '../_shared/i18n.ts';
import { hologramImageTabSource, isActive as imageViewIsActive } from '../services/image-tab.ts';
import { store, subscribeKey } from '../services/store.ts';
import type { HologramStoreState } from '../services/store.ts';
import { navBack, navForward } from '../services/orchestrator.ts';

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

export function AppToolbar() {
  const canBack = useSyncExternalStore(subBack, getBack);
  const canForward = useSyncExternalStore(subForward, getForward);
  const imageView = useSyncExternalStore(hologramImageTabSource.subscribe, imageViewIsActive);
  return (
    // bg-background ではなく bg-sidebar にする。ツールバーと左のサイドバーはタブ帯の下で
    // 1本の帯を成し、アクティブなタブはその帯へつながる（旧い塗りの --sidebar-bg が同じ色の
    // 別名になっている）＝Chrome のタブ帯とツールバーの作り。
    <div className="flex flex-col border-b bg-sidebar">
      <div className="grid h-12 items-center gap-1.5 px-2" style={{ gridTemplateColumns: '1fr minmax(0, 40rem) 1fr' }}>
        {/* サイドバーの切り替えは今はサイドバー自身のヘッダーにある（Obsidian 型のシェル・
            #154）。左のセルはいきなりタブごとの戻る／進むから始まる。 */}
        <div className="flex shrink-0 items-center">
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
          <SearchBox placeholder={t('searchPlaceholder')} />
        </div>
        <div className="flex items-center justify-end gap-1.5">
          {/* この2つは意図して外す。どちらもポップオーバーの引き金で、グリッドについての
              ポップオーバーが開いたまま画像ビューへ生き延びる理由は無い。 */}
          {imageView ? (
            <ViewerToolbar />
          ) : (
            <>
              <AddFilterButton />
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
