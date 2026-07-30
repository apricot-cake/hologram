// Inspector open/close toggle (#243) — the right-hand counterpart to the sidebar's
// collapse trigger, which sits at the left end of the same titlebar band.
//
// Placement follows the products that have a tree plus panels (VS Code / Obsidian): the
// panel toggles live at the top corners of the window chrome, not in the toolbar. Keeping
// it out of the toolbar also preserves the IA split this redesign is built on — the
// toolbar holds PREDICATES (search / filter / display), and opening a panel is not one.
//
// A plain child of the titlebar band, laid out just left of the corner the window buttons
// reserve.
// It used to be portaled and pinned to the window instead, because the band then ended at
// the inspector's left edge and an in-band toggle would have drifted 320px whenever the
// panel it controls was open; since #518 the band reaches the window edge, so the flow
// position IS the corner and the portal has nothing left to solve.
//
// It differs from WindowControls in one way, deliberately: it stays below the modal scrim,
// so a dialog covers it. There is nothing to toggle while a dialog is up, whereas the
// window's min/max/close must stay reachable and sit above the scrim for that reason.
import { useSyncExternalStore } from 'react';
import { PanelRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isOpen, setOpen, subscribe, toggle } from '../services/inspector-panel.ts';
import { isHidden as panelsAreHidden, reveal as panelsReveal, subscribe as panelsSubscribe } from '../services/panels.ts';
import { t } from '../_shared/i18n.ts';

// While #245's bulk hide is on, this button is the one panel control still on screen (it
// lives in the tab band, not in the panel it opens) — so it has to be the way back. It
// reads and writes what the user SEES: masked means "closed" no matter what the panel's own
// state says, and pressing it drops the mask and opens, rather than flipping a state behind
// the mask and looking broken.
export function InspectorToggle() {
  const panelOpen = useSyncExternalStore(subscribe, isOpen);
  const panelsHidden = useSyncExternalStore(panelsSubscribe, panelsAreHidden);
  const open = panelOpen && !panelsHidden;
  const press = () => {
    if (panelsHidden) {
      panelsReveal();
      setOpen(true);
      return;
    }
    toggle();
  };
  const label = t('toggleInspector');
  return (
    // px-2 matches the sidebar trigger's inset from the opposite corner. The band's own
    // right padding (--window-controls-w) is what keeps this clear of the window buttons.
    <div className="app-no-drag grid h-8 shrink-0 place-items-center px-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <button type="button" className="inline-grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-foreground/8 hover:text-foreground active:bg-foreground/16" aria-label={label} aria-pressed={open} onClick={press}>
              <PanelRight className="size-4" />
            </button>
          }
        />
        <TooltipContent side="bottom" align="end">
          {label}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
