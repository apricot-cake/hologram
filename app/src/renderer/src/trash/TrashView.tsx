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

export function TrashToolbar() {
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
    <div data-slot="trash-toolbar" className="app-no-drag flex shrink-0 items-center gap-1.5">
      <span className="mr-1 text-sm text-muted-foreground">{snap.count ? t('trashCount', { count: snap.count }) : ''}</span>
      {hasSelection && (
        <>
          <span className="text-sm font-medium tabular-nums">{t('selectedCount', { count: selectedCount })}</span>
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
      <Button variant="ghost" size="icon-sm" aria-label={t('trashMoreActions')} disabled={snap.busy || snap.count === 0} onClick={overflow}>
        <MoreHorizontal />
      </Button>
    </div>
  );
}

export function TrashView() {
  const snap = useSyncExternalStore(subscribe, getSnapshot);
  return (
    <div data-slot="trash-view">
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
