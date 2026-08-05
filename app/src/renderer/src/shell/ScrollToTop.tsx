// "Back to top" for the content column (#606) — the one visible way back after a deep
// scroll. The React shell dropped the old sidebar/content buttons along with their
// markup, and nothing replaced them: the page itself never scrolls (body is
// height:100svh; overflow:hidden), the column that DOES scroll carries no tabindex, and
// no card is focusable — so keyboard scrolling has nothing to act on either and the
// wheel or a scrollbar drag was the only route left.
//
// Form follows #116's 2026-07-14 decision: bottom right, icon only, appearing after a
// scroll, readability carried by the hover tooltip. The centered button with a visible
// label that #116 proposed was rejected there — that shape belongs to a feed's
// "jump to new posts", not to a library grid.
//
// It lives inside the inset (like FloatingBar) rather than being pinned to the window,
// so the right inspector — a flex sibling at every width (#243/#975) — narrows its
// container and the button follows without a reservation branch of its own.
import { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { t } from '../_shared/i18n.ts';
import { scroller } from '../services/content-area.ts';

// Appear only past ONE full screen of scrolling, measured against the scroller's own
// height rather than a fixed pixel count. Nielsen Norman Group's back-to-top guidance is
// "long pages only" — a threshold in pixels answers that differently on a short window
// than on a tall one, whereas "you are more than a screen deep" means the same thing at
// every size. It also keeps the button off screen entirely for a library that fits.
function isDeep(el: HTMLElement): boolean {
  return el.scrollTop > el.clientHeight;
}

export function ScrollToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    // The shell's ref callback has run by now: refs attach before effects, and the
    // scroll column is mounted in the same commit as this component.
    const el = scroller();
    if (!el) return;
    const sync = () => setShown(isDeep(el));
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    // The threshold depends on the scroller's height, so a resize can flip the answer
    // without a single scroll event (open the inspector, or drag the window shorter).
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', sync);
      ro.disconnect();
    };
  }, []);

  const label = t('scrollToTop');
  return (
    // Stays mounted and crosses between the two states with one CSS transition, in both
    // directions (ADR 0014 / redesign §3-10a — no exit-presence library). `inert` while
    // hidden so a button nobody can see is also not in the tab order or the a11y tree;
    // it leaves layout alone, which is what keeps the transition playable.
    <div inert={!shown} className={cn('absolute right-6 bottom-6 z-50 transition-[opacity,transform] duration-[var(--motion-duration-base)] ease-[var(--motion-ease-out)]', shown ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0')}>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-slot="scroll-to-top"
              aria-label={label}
              className="inline-grid size-9 place-items-center rounded-full border bg-popover text-popover-foreground shadow-lg transition-colors duration-75 hover:bg-muted active:bg-foreground/16"
              onClick={() => scroller()?.scrollTo({ top: 0, behavior: 'smooth' })}
            >
              <ArrowUp className="size-4" />
            </button>
          }
        />
        <TooltipContent side="left">{label}</TooltipContent>
      </Tooltip>
    </div>
  );
}
