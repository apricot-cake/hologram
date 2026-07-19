// Inspector open/close toggle (#243) — the right-hand counterpart to the sidebar's
// collapse trigger, which sits at the left end of the same titlebar band.
//
// Placement follows the products that have a tree plus panels (VS Code / Obsidian): the
// panel toggles live at the top corners of the window chrome, not in the toolbar. Keeping
// it out of the toolbar also preserves the IA split this redesign is built on — the
// toolbar holds PREDICATES (search / filter / display), and opening a panel is not one.
//
// Portaled and pinned to the window's top-right like WindowControls, NOT laid out inside
// #tabBar: the inspector is a flex sibling of the whole content column, so the tab band
// ends at the panel's left edge rather than at the window edge — a toggle placed in that
// band would drift left by 320px whenever the panel it controls is open.
//
// It differs from WindowControls in one way, deliberately: z-index below the modal scrim,
// so a dialog covers it. There is nothing to toggle while a dialog is up, whereas the
// window's min/max/close must stay reachable and sit above the scrim for that reason.
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { PanelRight } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isOpen, subscribe, toggle } from '../../renderer/inspector-panel.ts';
import { t } from '../_shared/i18n.ts';

export function InspectorToggle() {
  const open = useSyncExternalStore(subscribe, isOpen);
  const label = t('toggleInspector');
  return createPortal(
    // z-[60] clears the tab band's own stacking context (#tabBar is sticky at z-50) while
    // staying far below the scrim (13000+). Offset by the window buttons' width so it sits
    // just left of them, matching the sidebar trigger's inset from the opposite corner.
    <div className="app-no-drag fixed top-0 right-[var(--window-controls-w,138px)] z-[60] grid h-8 place-items-center px-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="inline-grid h-8 w-8 place-items-center rounded-md text-muted-foreground transition-colors duration-75 hover:bg-foreground/8 hover:text-foreground active:bg-foreground/16"
              aria-label={label}
              aria-pressed={open}
              onClick={() => toggle()}
            >
              <PanelRight className="size-4" />
            </button>
          }
        />
        <TooltipContent side="bottom" align="end">
          {label}
        </TooltipContent>
      </Tooltip>
    </div>,
    document.body,
  );
}
