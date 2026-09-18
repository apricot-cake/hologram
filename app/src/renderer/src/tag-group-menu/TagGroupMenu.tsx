import { ContextMenuContent } from '../context-menu/ContextMenuContent';
import { Plus } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import { close, get, subscribe } from '../services/tag-group-menu.ts';
import { tagGroupDotClass } from '../_shared/tag-group-dot.ts';
import { DropdownMenu, DropdownMenuLabel, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

// タグの移動先を選ぶメニュー。グループ自身の編集は見出しの右クリックで行う。
export function TagGroupMenuHost() {
  const menu = useSyncExternalStore(subscribe, get);

  // クリック地点にある仮想の基準（モデルが変わるたびに作り直す）。
  const anchor = useMemo(() => {
    if (!menu) return null;
    const { x, y } = menu;
    return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
  }, [menu]);

  if (!menu) return null;

  const current = menu.rows.find((r) => !r.sep && r.checked);
  const pick = (row: HologramTagGroupMenuRow) => {
    close();
    menu.onPick(row.kind as string);
  };

  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <ContextMenuContent anchor={anchor} align="start" sideOffset={2} collisionPadding={8}>
        {/* ラベルは RadioGroup の中に置く＝Base UI の GroupLabel は <Menu.Group>/<Menu.RadioGroup> の外だと例外を投げる */}
        <DropdownMenuRadioGroup value={(current && (current.kind as string)) || ''}>
          <DropdownMenuLabel>{menu.header}</DropdownMenuLabel>
          {menu.rows.map((row, i) =>
            row.sep ? (
              <DropdownMenuSeparator key={i} />
            ) : (
              <DropdownMenuRadioItem key={i} value={row.kind as string} closeOnClick={false} onClick={() => pick(row)}>
                {row.dot && <span className={tagGroupDotClass(row.kind as string)} />}
                {row.label}
              </DropdownMenuRadioItem>
            ),
          )}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            close();
            menu.onCreate();
          }}
        >
          <Plus />
          {menu.createLabel}
        </DropdownMenuItem>
      </ContextMenuContent>
    </DropdownMenu>
  );
}
