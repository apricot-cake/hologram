import { useMemo, useSyncExternalStore } from 'react';
import { close, get, pick, subscribe } from '../services/menu.ts';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';

// Context-menu host — ONE always-mounted instance that renders whatever menu.ts
// currently holds (or nothing). The orchestrator side owns the menu's data +
// actions; this component only draws a shadcn DropdownMenu anchored at the click
// point and dispatches clicks back through menu.ts's pick().
//
// The menu opens programmatically at (x, y) — there is no trigger element — so
// the content is anchored to a virtual element at those coordinates (Base UI
// positions + viewport-clamps it; the old hand-rolled clampIntoView is gone).
//
// closeOnClick is false on EVERY row: the bridge alone decides whether a pick
// closes the menu (default), keeps it open re-rendered (folder-assignment
// toggle rows return a fresh items array), or replaces it with another menu
// (card menu → folder picker). Letting Base UI self-close on click would race
// those stay-open paths. Outside-click / Escape close via onOpenChange.
//
// Row mapping: `checked` present → CheckboxItem (right-side indicator),
// `danger` → destructive variant, `manage` → muted "manage…" styling.

export function ContextMenuHost() {
  const menu = useSyncExternalStore(subscribe, get);

  // Virtual anchor at the click point (recreated whenever the model changes).
  const anchor = useMemo(() => {
    if (!menu) return null;
    const { x, y } = menu;
    return { getBoundingClientRect: () => new DOMRect(x, y, 0, 0) };
  }, [menu]);

  if (!menu) return null;
  return (
    <DropdownMenu
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DropdownMenuContent anchor={anchor} align="start" sideOffset={2} collisionPadding={8} className="w-auto min-w-44">
        {menu.items.map((it, i) =>
          it.sep ? (
            <DropdownMenuSeparator key={i} />
          ) : it.checked !== undefined ? (
            <DropdownMenuCheckboxItem key={i} checked={!!it.checked} closeOnClick={false} onClick={() => pick(it)}>
              {it.label}
            </DropdownMenuCheckboxItem>
          ) : (
            <DropdownMenuItem key={i} variant={it.danger ? 'destructive' : 'default'} className={it.manage ? 'text-muted-foreground' : undefined} closeOnClick={false} onClick={() => pick(it)}>
              {/* biome-ignore lint/security/noDangerouslySetInnerHtml: established SVG-glyph pattern — icon strings are app-defined constants from the orchestrator, never user content */}
              {it.icon && <span className="flex items-center" dangerouslySetInnerHTML={{ __html: it.icon }} />}
              {it.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
