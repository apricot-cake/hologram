// The window tab strip — Chrome's tab-strip anatomy, drawn in Tailwind and wired
// straight to the tab actions (#621, leftover from redesign P1-2).
//
// Two things went away here together, because they were the same knot. The strip used
// to emit a fixed shape of legacy DOM (`.tab-item[data-tab]`, `.tab-close[data-close]`,
// `.tab-new`) purely so that delegated listeners on #tabBarInner could route clicks
// back by `closest()`. Now every gesture is a prop on the element it belongs to —
// onClick / onAuxClick / onContextMenu calling orchestrator's exported tab actions — so
// the markup owes nothing to anyone, and the styling moved out of index.html's legacy
// layer into utilities here.
//
// What this is NOT: shadcn's <Tabs>. That component switches panels inside a page and
// owns a value/onValueChange model; these are window tabs (Chrome) with close, pin,
// duplicate, a context menu and per-tab history behind them.
//
// Kept from the old strip, all of it deliberate: ✕ appears on hover (and always on the
// active tab), pinned tabs wear the pin glyph and no ✕, ＋ trails the row, middle-click
// closes, and everything interactive opts out of the titlebar drag region (app-no-drag),
// leaving the strip's own padding as a patch you can still grab to move the window.
//
// No rename UI: manual tab titles were dropped in the redesign (2026-07-13) — a tab is
// named after what it shows (tabTitleOf), like Chrome's and VS Code's.
import type { MouseEvent } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { addTab, closeTab, closeTabByGesture, showTabMenu, switchTab } from '../services/orchestrator.ts';

// The strip model TabsHost pulls from services/tabs.ts's hologramTabsSource.
export interface TabModel {
  id: string;
  title: string;
  icon: string;
  active?: boolean;
  pinned?: boolean;
  showClose?: boolean;
}
export interface TabsModel {
  tabs: TabModel[];
  closeTitle?: string;
  newTitle?: string;
}

// Trailing ＋ (new tab). aria-hidden because the glyph repeats what the button
// around it already says — the same shape every icon set ships with.
function NewIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ✕ (close tab). aria-hidden for the same reason as NewIcon above.
function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

// All tabs share one bottom-flush 34px box and one text axis, Chrome-style — only the
// fill changes between states. The ::before is the floating pill an inactive tab shows
// on hover (inset inside the box); the active tab paints the box itself instead and
// connects into the band below. `group` is what fades the ✕ in on hover without a
// per-tab hover state in React.
const TAB_BASE = 'app-no-drag group relative flex h-[34px] max-w-[200px] min-w-0 flex-1 cursor-pointer items-center overflow-hidden rounded-[8px] py-0 pr-2 pl-2.5 text-xs transition-colors select-none before:pointer-events-none before:absolute before:inset-[3px_2px] before:rounded-[7px] before:transition-colors';
// Connected to the band below: square bottom corners, and the ears may overflow the box.
const TAB_ACTIVE = 'z-1 overflow-visible rounded-b-none bg-[var(--sidebar-bg)] text-[var(--text)]';
// Pinned but not active — the accent tint is the whole reason a pin reads at a glance.
const TAB_PINNED = 'text-[var(--accent-text)] before:bg-[var(--accent-subtle)] hover:text-[var(--text)]';
// The hover pill sits halfway between the strip (--bg) and the band (--sidebar-bg),
// which is Chrome's hierarchy. Plain --hover is unusable here: in dark mode it IS
// --sidebar-bg, so a hovered inactive tab would look exactly like the active one.
const TAB_IDLE = 'text-[var(--text-muted-strong)] hover:text-[var(--text)] hover:before:bg-[color-mix(in_srgb,var(--sidebar-bg)_60%,var(--bg))]';
// A concave "ear" at each bottom corner of the active tab: fill everything OUTSIDE a
// quarter circle centred on the corner that touches the strip background, so the painted
// sliver hugs the tab wall and the band while the rest shows the strip through.
const EAR_LEFT = 'pointer-events-none absolute bottom-0 -left-2 size-2 bg-[radial-gradient(circle_8px_at_top_left,transparent_7.5px,var(--sidebar-bg)_8px)]';
const EAR_RIGHT = 'pointer-events-none absolute bottom-0 -right-2 size-2 bg-[radial-gradient(circle_8px_at_top_right,transparent_7.5px,var(--sidebar-bg)_8px)]';

function Tab({ t, closeTitle }: { t: TabModel; closeTitle?: string }) {
  return (
    <div
      data-slot="tab"
      data-tab-id={t.id}
      data-active={t.active || undefined}
      data-pinned={t.pinned || undefined}
      className={`${TAB_BASE} ${t.active ? TAB_ACTIVE : t.pinned ? TAB_PINNED : TAB_IDLE}`}
      role="tab"
      aria-selected={t.active ? 'true' : 'false'}
      tabIndex={0}
      onClick={() => switchTab(t.id)}
      // Middle-click closes. The mousedown preventDefault is what stops Chromium from
      // dropping into its autoscroll cursor over the strip.
      onMouseDown={(e: MouseEvent) => {
        if (e.button === 1) e.preventDefault();
      }}
      onAuxClick={(e: MouseEvent) => {
        if (e.button !== 1) return;
        e.preventDefault();
        closeTabByGesture(t.id);
      }}
      onContextMenu={(e: MouseEvent) => {
        e.preventDefault();
        showTabMenu(t.id, e);
      }}
    >
      {t.active && (
        <>
          <span className={EAR_LEFT} />
          <span className={EAR_RIGHT} />
        </>
      )}
      {/* relative z-1: everything readable has to sit above the ::before pill. */}
      <span className="relative z-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap">
        {/* The glyph is an app-defined SVG constant (tabs-builder's TAB_ICONS, or the
            pin), never user content. */}
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: established SVG-glyph pattern — app-defined constants, never user content */}
        <span className={`flex size-3 shrink-0 items-center ${t.active ? 'opacity-100' : 'opacity-70'}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: t.icon }} />
        <span data-slot="tab-title" className="min-w-0 flex-1 truncate font-medium">
          {t.title}
        </span>
      </span>
      {t.showClose && (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                data-slot="tab-close"
                className={`absolute top-1/2 right-1.5 z-1 grid size-4 -translate-y-1/2 place-items-center rounded-[3px] text-[var(--text-muted)] transition-opacity hover:bg-[var(--hover)] hover:text-[var(--text)] hover:opacity-100! ${t.active ? 'opacity-100' : 'opacity-0 group-hover:opacity-70'}`}
                aria-label={closeTitle}
                onClick={(e: MouseEvent) => {
                  e.stopPropagation(); // the row underneath would otherwise switch to the tab being closed
                  closeTab(t.id);
                }}
              >
                <CloseIcon />
              </button>
            }
          />
          <TooltipContent side="bottom">{closeTitle}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export function Tabs({ model }: { model: TabsModel | null }) {
  if (!model) return null;
  return (
    // The strip's own row inside the titlebar band. Tabs sit bottom-flush (items-end) so
    // the active one can connect into the band below. The right padding is the grab
    // gutter: a draggable patch between the last tab and the inspector toggle, kept even
    // when the tabs fill the row — the strip itself stays part of the drag region and
    // each interactive child opts out (app-no-drag). Windows' title-bar guidance asks for
    // exactly this: a region that can always be grabbed, left of the caption buttons.
    //
    // 88px is written here rather than behind a token (#628). It was `var(--tabbar-drag-gutter,
    // 88px)` from the day it was added, but the variable was never defined anywhere — so the
    // fallback was always the value, and the name only suggested an owner that did not exist.
    // A length becomes a token when two independent owners have to agree on it: --tabbar-h is
    // read by the band and by everything that lines up inside it, --window-controls-w by the
    // band's padding and by the portaled strip's width. Nothing has to agree with the gutter —
    // it is one element's own padding, and the space right of the tabs is whatever the band
    // has left. So it stays a literal, which is also what acceptance condition 6 of #628 asks
    // for (no new size tokens).
    <div data-slot="tab-strip" role="tablist" className="flex min-w-0 flex-1 items-end self-stretch pr-[88px] pl-2">
      {model.tabs.map((t) => (
        <Tab key={t.id} t={t} closeTitle={model.closeTitle} />
      ))}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-slot="tab-new"
              // Tabs are bottom-flush, so the ＋ centres itself on the strip's mid-line rather
              // than riding the tab baseline.
              className="app-no-drag ml-1.5 grid size-6 shrink-0 place-items-center self-center rounded-[6px] text-[var(--text-muted)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--text)]"
              aria-label={model.newTitle}
              onClick={() => addTab()}
            >
              <NewIcon />
            </button>
          }
        />
        <TooltipContent side="bottom">{model.newTitle}</TooltipContent>
      </Tooltip>
    </div>
  );
}
