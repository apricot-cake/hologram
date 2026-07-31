import { useEffect, useState, useSyncExternalStore } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';

// Loading placeholder for the two library grids (posts/posters), shown for the
// stretch between "the window opened" and "the library's first load landed"
// (#682) — the gap that used to render nothing at all, which read as "the
// library is empty" on anything but a trivial library. empty/EmptyState.tsx
// covers the OTHER two states (confirmed empty / filtered-empty); this one
// covers "we don't know yet".
//
// Skeleton, not a spinner: NN/G's guidance for content with a known layout
// (feeds, listings, search results — https://www.nngroup.com/articles/skeleton-screens/)
// is a skeleton that mirrors the incoming shape, reserving spinners for short
// blocking actions (submit/auth/save). A post grid is the former. Built from
// the existing shadcn Skeleton (components/ui/skeleton.tsx) — shadcn's own
// docs describe it as "a placeholder while content is loading" — not a new
// loading primitive.
const subLibraryLoaded = (cb: () => void) => storeSubscribe('libraryLoaded', cb);
const getLibraryLoaded = () => !!storeGet('libraryLoaded');
const subMode = (cb: () => void) => storeSubscribe('browseMode', cb);
const getMode = () => (storeGet('browseMode') as string | undefined) ?? 'posts';

// Below ~300ms a human doesn't register the wait, so a skeleton that appears
// and immediately vanishes reads as a flash of noise rather than progress —
// several independent design systems (eBay's Playbook, Semrush's Intergalactic,
// the UK Intelligence Community's ICDS) draw the same line: show nothing under
// 300ms, only show the placeholder past it. See #682 for the citations.
const SHOW_DELAY_MS = 300;
const SKELETON_COUNT = 18;

function useDelayed(active: boolean, delayMs: number): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [active, delayMs]);
  return show;
}

export function LibraryLoading() {
  const mode = useSyncExternalStore(subMode, getMode);
  const loaded = useSyncExternalStore(subLibraryLoaded, getLibraryLoaded);
  const pending = mode !== 'trash' && !loaded;
  const show = useDelayed(pending, SHOW_DELAY_MS);
  if (!show) return null;
  return (
    <div aria-hidden className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
      {Array.from({ length: SKELETON_COUNT }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="aspect-square w-full rounded-lg" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
