// Privacy mode toggle + on-screen indicator (#88) — the mouse-reachable twin of the P
// hotkey (services/privacy-mode.ts), and the "モード中インジケータを常時表示" #88's decision
// comment asked for: the accept-request path is a hotkey with no visible affordance at all,
// which is exactly how a mode gets left on (or forgotten off) without anyone noticing.
//
// Placement: the titlebar band, next to InspectorToggle — the one strip AppShell.tsx renders
// unconditionally across every destination (grid/list/poster/trash/image-tab), so the
// indicator reads correctly no matter what is on screen, unlike a toolbar control (which
// AppToolbar.tsx swaps out for ViewerToolbar while an image tab is open).
//
// Visual language: EyeOff (this app has no other "hide/reveal" icon precedent to match) plus
// the product accent (`text-selected`/`bg-selected`) ONLY while active — the one token
// globals.css already earmarks for "mode indicators" (#114) and that nothing has used for one
// yet. Off state matches InspectorToggle's neutral muted-foreground exactly, so the two
// corner toggles read as the same family of control.
import { useSyncExternalStore } from 'react';
import { EyeOff } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isEnabled, subscribe, toggle } from '../services/privacy-mode.ts';
import { t } from '../_shared/i18n.ts';

export function PrivacyModeToggle() {
  const on = useSyncExternalStore(subscribe, isEnabled);
  const label = t('privacyModeToggle');
  return (
    // Same h-8/px-2 cell as InspectorToggle, its neighbour in the band.
    <div className="app-no-drag grid h-8 shrink-0 place-items-center px-2">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-slot="privacy-mode-toggle"
              className={`inline-grid h-8 w-8 place-items-center rounded-md transition-colors duration-75 ${on ? 'bg-selected/15 text-selected hover:bg-selected/25' : 'text-muted-foreground hover:bg-foreground/8 hover:text-foreground active:bg-foreground/16'}`}
              aria-label={label}
              aria-pressed={on}
              onClick={() => toggle()}
            >
              <EyeOff className="size-4" />
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
