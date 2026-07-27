import { PencilIcon } from 'lucide-react';
import { useMemo, useSyncExternalStore } from 'react';
import { close, get, subscribe } from '../services/kind-menu.ts';
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

// 種別 (tag-kind) menu — ONE always-mounted instance that renders whatever
// kind-menu.ts currently holds (or nothing). The orchestrator side builds the
// row model (current kind, already-localized labels) and owns the pick/rename
// actions; this component draws a shadcn DropdownMenu anchored at the click point.
// A DEDICATED component (not the generic ContextMenu) because each row carries
// TWO independent click targets — the row itself (pick a kind) and a nested
// rename button (relabel that kind) — plus a header, none of which fit
// ContextMenu's item shape.
//
// Kind selection is one-of-N, so rows are a RadioGroup (right-side indicator
// marks the current kind — the shadcn idiom for single-choice menus). The
// colored kind dot keeps its legacy tk-dot classes: kind colors are app domain,
// not ui-kit styling. closeOnClick stays false / close() is called explicitly,
// same bridge-owned lifecycle as ContextMenu.

export function KindMenuHost() {
  const menu = useSyncExternalStore(subscribe, get);

  // Virtual anchor at the click point (recreated whenever the model changes).
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
        {/* label INSIDE the RadioGroup — Base UI GroupLabel throws outside <Menu.Group>/<Menu.RadioGroup> */}
        <DropdownMenuRadioGroup value={(current && (current.kind as string)) || ''}>
          <DropdownMenuLabel>{menu.header}</DropdownMenuLabel>
          {menu.rows.map((row, i) =>
            row.sep ? (
              <DropdownMenuSeparator key={i} />
            ) : (
              <DropdownMenuRadioItem key={i} value={row.kind as string} closeOnClick={false} onClick={() => pick(row)}>
                {row.dot && <span className={'tk-dot tk-' + row.kind} />}
                {row.label}
                {row.renameable && (
                  <button type="button" className="ml-auto flex items-center rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground" aria-label={menu.renameTitle} data-tip={menu.renameTitle} onClick={(e) => rename(e, row.kind)}>
                    <PencilIcon className="size-3.5" />
                  </button>
                )}
              </DropdownMenuRadioItem>
            ),
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
