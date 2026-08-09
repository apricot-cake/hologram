import { PencilIcon } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import { close, get, subscribe } from '../services/kind-menu.ts';
import { kindDotClass } from '../_shared/kind-dot.ts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

// 種別（タグの種別）のメニュー＝常に載っているただ1つのインスタンスで、kind-menu.ts が今
// 持っているものを描く（何も無ければ何も描かない）。行のモデル（今の種別、訳し終えた
// ラベル）を組み立て、選択と改名の動作を持つのは orchestrator 側。このコンポーネントは
// クリック地点を基準にした shadcn の DropdownMenu を描く。汎用の ContextMenu ではなく専用の
// コンポーネントにしているのは、各行が独立した2つのクリック先を持つため＝行そのもの
//（種別を選ぶ）と、その中の改名ボタン（その種別のラベルを付け替える）。加えて見出しもあり、
// どれも ContextMenu の項目の形に収まらない。
//
// 種別の選択は N のうち1つなので、行は RadioGroup にする（右側の印が今の種別を示す＝
// 単一選択のメニューについての shadcn の言い回し）。色の付いた種別の点は
// _shared/kind-dot.ts から来る。種別の色は ui キットの装飾ではなくアプリの領域の話だから。
// closeOnClick は false のままにして close() を明示的に呼ぶ。ContextMenu と同じく、
// 寿命はブリッジが持つ。

export function KindMenuHost() {
  const menu = useSyncExternalStore(subscribe, get);

  // クリック地点にある仮想の基準（モデルが変わるたびに作り直す）。
  const anchor = useMemo(() => {
    if (!menu) return null;
    const { x, y } = menu;
    return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
  }, [menu]);

  if (!menu) return null;

  const current = menu.rows.find((r) => !r.sep && r.checked);
  const pick = (row: HologramKindMenuRow) => {
    close();
    menu.onPick(row.kind as string);
  };
  const rename = (e: { stopPropagation(): void }, kind?: string) => {
    e.stopPropagation();
    close();
    menu.onRename(kind as string);
  };

  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DropdownMenuContent anchor={anchor} align="start" sideOffset={2} collisionPadding={8} className="w-auto min-w-44">
        {/* ラベルは RadioGroup の中に置く＝Base UI の GroupLabel は <Menu.Group>/<Menu.RadioGroup> の外だと例外を投げる */}
        <DropdownMenuRadioGroup value={(current && (current.kind as string)) || ''}>
          <DropdownMenuLabel>{menu.header}</DropdownMenuLabel>
          {menu.rows.map((row, i) =>
            row.sep ? (
              <DropdownMenuSeparator key={i} />
            ) : (
              <DropdownMenuRadioItem key={i} value={row.kind as string} closeOnClick={false} onClick={() => pick(row)}>
                {row.dot && <span className={kindDotClass(row.kind as string)} />}
                {row.label}
                {row.renameable && (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <button type="button" className="ml-auto flex items-center rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label={menu.renameTitle} onClick={(e) => rename(e, row.kind)}>
                          <PencilIcon className="size-3.5" />
                        </button>
                      }
                    />
                    <TooltipContent side="right">{menu.renameTitle}</TooltipContent>
                  </Tooltip>
                )}
              </DropdownMenuRadioItem>
            ),
          )}
        </DropdownMenuRadioGroup>
        {menu.websearch && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                close();
                menu.websearch?.onPick();
              }}
            >
              {menu.websearch.label}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
