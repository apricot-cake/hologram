// ゴミ箱の表示（#268）＝左のナビのゴミ箱の項目が開く行き先。普段のライブラリの内容領域を
// そのまま使う（同じスクロール根・同じカード・同じクイックビューの覗き見）。ここが足すのは
// グリッドの上の操作行と、空の時の表示。
//
// 操作をここに置き、上のツールバー帯に置かない理由: あの帯はアプリ全体のアクティブバーで、
// どの行き先でも共有していて、しかも #150 が作り直している最中。この表示だけに閉じた行に
// しておけば、ゴミ箱固有の動詞（復元／完全に削除／空にする）が対象のそばに残り、
// あの作り直しの邪魔にもならない。
//
// カードの操作は今はセル自身の props になっている（services/grid.ts の cardActions を
// orchestrator.ts が埋める）。以前はこの表示がグリッドのコンテナで click/dblclick/dragstart
// を委譲で受け、`data-key` 属性から投稿を索いていた＝#153 の分類1と2が1か所に出ていた。
import { MoreHorizontal, RotateCcw, Trash2, X } from 'lucide-react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { t } from '../_shared/i18n.ts';
import { registerGridSlot } from '../services/content-area.ts';
import { open as menuOpen } from '../services/menu.ts';
import { clearSelection, getSnapshot, requestDeleteSelected, requestEmptyAll, restoreSelected, selectAll, subscribe } from '../services/trash-view.ts';

const setGridSlot = registerGridSlot('trash');

export function TrashView() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);

  const selectedCount = snap.selected.size;
  const hasSelection = selectedCount > 0;
  // 基準はこのコンポーネントが測った矩形ではなく ⋯ ボタンそのもの。メニューはその下に
  // 右寄せでぶら下がり、間隔と衝突時の反転は ui キットが受け持つ。
  const overflow = (e: ReactMouseEvent<HTMLButtonElement>) => {
    menuOpen({ anchorEl: e.currentTarget, align: 'end', items: [{ label: t('trashSelectAll'), act: 'selectAll' }, { sep: true }, { label: t('trashEmptyBtn'), act: 'empty', danger: true }] }, (item) => {
      if (item.act === 'selectAll') selectAll();
      else if (item.act === 'empty') requestEmptyAll();
    });
  };

  return (
    // 他の2つの行き先と同じく、閲覧モードに応じて AppShell が出し入れする＝どれを画面に
    // 出すかの判断は1つに保たれ、body のクラスとインラインスタイルが競う形ではなく React
    // の中で下される。
    <div data-slot="trash-view">
      {/* sticky にして、ゴミ箱が長くても動詞に届き続けるようにする。-mx-8/-mt-6 は
          #mode-post 自身の padding を打ち消し、行を内容領域の端から端まで広げる。 */}
      <div className="sticky top-0 z-10 -mx-8 -mt-6 mb-4 flex flex-wrap items-center gap-2 border-b bg-background px-8 py-3">
        {/* 空の時は何も出さない。下の空表示がすでにそう言っていて、この行でも言うと
            同じ文が1画面に二度出ていた。 */}
        <span className="text-muted-foreground text-sm">{snap.count ? t('trashCount', [snap.count]) : ''}</span>
        <span className="flex-1" />
        {hasSelection && (
          <>
            <span className="text-sm font-medium tabular-nums">{t('selectedCount', [selectedCount])}</span>
            <Button variant="ghost" size="sm" aria-label={t('trashClearSelection')} onClick={() => clearSelection()}>
              <X />
            </Button>
          </>
        )}
        <Button variant="outline" size="sm" disabled={!hasSelection || snap.busy} onClick={() => restoreSelected()}>
          <RotateCcw />
          {t('trashRestoreBtn')}
        </Button>
        <Button variant="destructive" size="sm" disabled={!hasSelection || snap.busy} onClick={() => requestDeleteSelected()}>
          <Trash2 />
          {t('trashDeleteBtn')}
        </Button>
        {/* あふれメニューの2行はどちらもゴミ箱全体に効くので、ゴミ箱が空ならボタンごと死ぬ。 */}
        <Button variant="ghost" size="icon-sm" aria-label={t('trashMoreActions')} disabled={snap.busy || snap.count === 0} onClick={overflow}>
          <MoreHorizontal />
        </Button>
      </div>
      {/* グリッドの枠。TrashGrid（AppShell が他のグリッドの載せ場と並べて描く）が、この中に
          自分の masonry のホストを取り付ける。セルはライブラリのグリッドと同じ表示の形から
          自分で並ぶので、どちらかを言うクラスは無い。 */}
      <div ref={setGridSlot} data-slot="trash-grid" />
      {/* ゴミ箱が空でもナビの項目は出したままにする（設計上の判断: 0件でも隠さない）。だから
          「どこへ行ったのか」という問いには、行が消えることではなくここで答える＝誰も何も
          押さないまま項目が出ていく唯一の理由である30日の規則も含めて。 */}
      {snap.loaded && snap.count === 0 && (
        // ライブラリ自身の空表示（P2⑫）と同じ作り＝アイコンの台・見出し・説明。動作は
        // 置かない。空のゴミ箱は終わった状態で、ここにボタンをこしらえても、左のナビが
        // すでに行ける先へ連れて行くだけになる。
        <Empty className="py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Trash2 />
            </EmptyMedia>
            <EmptyTitle>{t('trashEmpty')}</EmptyTitle>
            <EmptyDescription>{t('trashEmptyDesc')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
