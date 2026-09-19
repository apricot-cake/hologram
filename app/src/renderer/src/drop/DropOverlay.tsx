import { Download } from 'lucide-react';
import type { DragEvent as ReactDragEvent } from 'react';
import { useEffect, useState } from 'react';
import { t } from '../_shared/i18n.ts';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '../components/ui/empty.tsx';
import { handleDroppedPaths, pathsFromFileList } from '../services/drop-intake.ts';
import { dragLeavesWindow } from './drop-visibility.ts';

// ウィンドウ全体に効く、ドロップで取り込むためのオーバーレイ（#234）。検知の側
//（dragenter/dragleave で出し入れの時機を知るだけ）は純粋な観測者に留まる＝
// preventDefault を呼ばないので、そもそもファイルのドラッグではないドロップについて、
// アプリ内部のドラッグ＆ドロップ（フォルダの並べ替え、LeftSidebar.tsx）と競うことがない。
// 内部のドラッグは dataTransfer.types に 'Files' を持たない。これが OS のファイルドラッグと
// ページ内部のドラッグを確実に見分けられる唯一の合図（内部のドラッグの中身は text/plain と
// して運ばれる。LeftSidebar.tsx の onDragStart を参照）。実際に受け取る側＝preventDefault
// とファイルの読み取り＝は、このコンポーネント自身のオーバーレイの要素が出ている時に、
// その上で起きる。要素に閉じた受け口を、services/theme.ts のウィンドウ単位の遷移防ぎの上に
// 重ねる形で、あちらは今もここで誰も扱わなかったものを拾い続ける（あのファイルのモジュール
// コメントを参照。意図して残してあり、これで置き換えたわけではない）。
function isFileDrag(e: DragEvent): boolean {
  return !!e.dataTransfer && Array.prototype.includes.call(e.dataTransfer.types, 'Files');
}

export function DropOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      setVisible(true);
    };
    const onDragLeave = (e: DragEvent) => {
      if (dragLeavesWindow(e.relatedTarget)) setVisible(false);
    };
    const onWindowDrop = () => {
      // 念のためのリセット。Files のドロップは通常オーバーレイ自身の onDrop に落ちる。
      setVisible(false);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onWindowDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onWindowDrop);
    };
  }, []);

  if (!visible) return null;
  return (
    <div
      className="bg-background/75 fixed inset-0 z-[13600] flex backdrop-blur-sm"
      onDragOver={(e: ReactDragEvent<HTMLDivElement>) => {
        if (!isFileDrag(e.nativeEvent)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDrop={(e: ReactDragEvent<HTMLDivElement>) => {
        if (!isFileDrag(e.nativeEvent)) return;
        e.preventDefault();
        e.stopPropagation();
        setVisible(false);
        const paths = pathsFromFileList(e.dataTransfer.files);
        void handleDroppedPaths(paths);
      }}
    >
      <Empty className="border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="size-12 rounded-xl bg-muted text-foreground shadow-sm ring-1 ring-border [&_svg:not([class*='size-'])]:size-6">
            <Download />
          </EmptyMedia>
          <EmptyTitle className="text-base">{t('dropOverlayHint')}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    </div>
  );
}
