// Display popover — the "how do I see it" axis of the new IA (redesign §3-3, P2②).
// Linear's "Display" popover: one surface collecting ordering + view + view options,
// opened from the toolbar's 表示 button. Mode-aware (browseMode): posts get sort +
// gallery/list + "show info on cards"; posters get their own sort + view. Anchors:
// Linear Display, Notion view options.
//
// STAGING (P2②): the user-facing model is the new gallery/list + info toggle
// (redesign 未決事項E), but the rendering ENGINE is still grid-density-builder's
// card/tile/list. This popover is a faithful FACADE over the store 'view' key —
// gallery+info→card, gallery→tile, list→list — so no engine change is needed here.
// The store-value migration + the real gallery/list layouts land together in P2⑪
// ("※新レイアウトの実装自体は⑪"). The size slider is the follow-up commit (P2②-2);
// posters keep their existing 3-way view (card/tile/list) until that axis is
// re-conceived separately (未決事項E scoped the gallery/list split to the post grid).
import type { ReactNode } from 'react';
import { LayoutGrid, List, Shuffle, SlidersHorizontal, Square } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { t } from '../_shared/i18n.ts';
import { runPostDensityViewTransition, runPosterDensityViewTransition } from '../_shared/density-transition.ts';
import type { HologramSizeTrack } from '../services/grid-density-builder.ts';
import { applyPostSize, applyPosterSize, getPostSizeTrack, getPosterSizeTrack, rerollShuffle } from '../services/orchestrator.ts';
import { isHidden as panelsAreHidden, setHidden as setPanelsHidden, subscribe as panelsSubscribe } from '../services/panels.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../services/store.ts';

const subKey = (key: string) => (cb: () => void) => storeSubscribe(key, cb);

// Subscribe to several store keys at once (any change fires cb) — the size track depends
// on the view AND the active view's size, which live in separate store keys.
const subMany = (keys: string[]) => (cb: () => void) => {
  const unsubs = keys.map((k) => storeSubscribe(k, cb));
  return () => unsubs.forEach((u) => u());
};
const subPostSize = subMany(['view', 'tileSize', 'cardSize', 'listThumb']);
const postSizeSnap = () => `${storeGet('view')}|${storeGet('tileSize')}|${storeGet('cardSize')}|${storeGet('listThumb')}`;
const subPosterSize = subMany(['posterView', 'posterTileSize', 'posterCardSize']);
const posterSizeSnap = () => `${storeGet('posterView')}|${storeGet('posterTileSize')}|${storeGet('posterCardSize')}`;

// Sort option tables (value = the sort key the listing pipeline reads; key = i18n
// label).
const SORT_POST = [
  { value: 'date-desc', key: 'sortDateDesc' },
  { value: 'date-asc', key: 'sortDateAsc' },
  { value: 'likes-desc', key: 'sortLikes' },
  { value: 'reposts-desc', key: 'sortReposts' },
  { value: 'replies-desc', key: 'sortReplies' },
  { value: 'captured-desc', key: 'sortCaptured' },
  { value: 'likes-pct', key: 'sortLikesPct' },
  { value: 'random', key: 'sortRandom' },
];
const SORT_POSTER = [
  { value: 'count', key: 'posterSortCount' },
  { value: 'name', key: 'posterSortName' },
  { value: 'date-desc', key: 'posterSortNewest' },
  { value: 'date-asc', key: 'posterSortOldest' },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

// Size-slider track (column-count range for the auto-fill views, px for the list) read
// from grid-density-builder via the orchestrator bindings. Recomputes on a view/size
// store change and on window resize (column counts depend on grid width). getPost/
// PosterSizeTrack are stable module bindings, so they stay out of the memo deps.
function usePostSizeTrack(): HologramSizeTrack | null {
  // Re-render on a view/size store change or a window resize, then read the live
  // geometry-derived track fresh (it depends on #postGrid width, which only these change).
  useSyncExternalStore(subPostSize, postSizeSnap);
  const [, bumpResize] = useState(0);
  useEffect(() => {
    const on = () => bumpResize((n) => n + 1);
    window.addEventListener('resize', on, { passive: true });
    return () => window.removeEventListener('resize', on);
  }, []);
  return getPostSizeTrack ? getPostSizeTrack() : null;
}
function usePosterSizeTrack(): HologramSizeTrack | null {
  useSyncExternalStore(subPosterSize, posterSizeSnap);
  const [, bumpResize] = useState(0);
  useEffect(() => {
    const on = () => bumpResize((n) => n + 1);
    window.addEventListener('resize', on, { passive: true });
    return () => window.removeEventListener('resize', on);
  }, []);
  return getPosterSizeTrack ? getPosterSizeTrack() : null;
}

// The Slider drives the size axis. Local state owns the thumb while dragging (mid-drag
// updates skip the store); the caller keys this on the track RANGE so the thumb reseeds
// only when the view changes, not on every commit within a view.
function SizeSlider({ track, onDrag, onCommit }: { track: HologramSizeTrack; onDrag: (v: number) => void; onCommit: (v: number) => void }) {
  const [v, setV] = useState(track.value);
  const pick = (val: number | readonly number[]): number => (Array.isArray(val) ? val[0] : (val as number));
  return (
    <Slider
      className="w-40"
      min={track.min}
      max={track.max}
      step={track.step}
      value={[v]}
      onValueChange={(val) => {
        const n = pick(val);
        setV(n);
        onDrag(n);
      }}
      onValueCommitted={(val) => onCommit(pick(val))}
    />
  );
}

// Sort Select. Post sort's value source is the hidden #sortSelect (`sel`): on pick we
// drive it (value + 'change' event) so the orchestrator's existing change listener
// re-renders + persists per tab, then mirror into the store so the label updates.
// Poster sort has no native element (`sel` = null) — its single source IS the store
// key, which the orchestrator subscribes to for re-render.
function SortSelect_({ storeKey, sel, options }: { storeKey: string; sel: HTMLSelectElement | null; options: { value: string; key: string }[] }) {
  const subscribe = useCallback((cb: () => void) => storeSubscribe(storeKey, cb), [storeKey]);
  const getVal = useCallback((): string => {
    const v = storeGet(storeKey);
    if (v != null) return v as string;
    return sel?.value ?? options[0].value;
  }, [storeKey, sel, options]);
  const value = useSyncExternalStore(subscribe, getVal);
  const items = useMemo(() => Object.fromEntries(options.map((o) => [o.value, t(o.key)])), [options]);
  const choose = useCallback(
    (next: string | null) => {
      if (next == null) return; // Base UI passes null on clear — never our case
      if (sel && sel.value !== next) {
        sel.value = next;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      storeSet(storeKey, next);
    },
    [sel, storeKey],
  );
  return (
    <Select items={items} value={value} onValueChange={choose}>
      <SelectTrigger size="sm" className="w-40 font-sans">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {t(o.key)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// Post grid: sort + gallery/list view + "show info on cards". The view/info pair is a
// facade over the store 'view' key (card/tile/list); see the file header.
function PostControls() {
  const view = useSyncExternalStore(subKey('view'), () => (storeGet('view') as string) || 'card');
  const sizeTrack = usePostSizeTrack();
  const layout = view === 'list' ? 'list' : 'gallery';
  const infoOn = view !== 'tile'; // card/list → on, tile → off (in list the switch is disabled)
  // Remember the gallery sub-choice (info on/off) so leaving/returning via list keeps it.
  const galleryInfo = useRef(true);
  useEffect(() => {
    if (view === 'card') galleryInfo.current = true;
    else if (view === 'tile') galleryInfo.current = false;
  }, [view]);

  // Both writes go through the density View Transition (#252): the store write re-lays the
  // whole grid out, and this is the start point for the animation that carries the cards
  // from the old arrangement to the new one.
  const setLayout = useCallback((next: string) => {
    runPostDensityViewTransition(() => {
      if (next === 'list') storeSet('view', 'list');
      else storeSet('view', galleryInfo.current ? 'card' : 'tile');
    });
  }, []);
  const setInfo = useCallback((on: boolean) => {
    galleryInfo.current = on;
    runPostDensityViewTransition(() => storeSet('view', on ? 'card' : 'tile')); // only reachable while layout = gallery
  }, []);

  const sortSel = document.getElementById('sortSelect') as HTMLSelectElement | null;
  // Random is the one sort with something left to say after it is picked: the order is
  // seeded, so re-rolling is how you get a different one (#118).
  const sort = useSyncExternalStore(subKey('sortPost'), () => (storeGet('sortPost') as string) || sortSel?.value || 'date-desc');
  return (
    <>
      <Row label={t('sbSortTitle')}>
        <div className="flex items-center gap-1">
          <SortSelect_ storeKey="sortPost" sel={sortSel} options={SORT_POST} />
          {sort === 'random' && (
            <Button variant="ghost" size="icon" aria-label={t('sortReroll')} title={t('sortReroll')} onClick={() => rerollShuffle?.()}>
              <Shuffle />
            </Button>
          )}
        </div>
      </Row>
      <Separator />
      <ToggleGroup className="w-full" variant="outline" spacing={0} value={[layout]} onValueChange={(v) => v.length && setLayout(v[0] as string)} aria-label={t('sbViewTitle')}>
        <ToggleGroupItem className="flex-1" value="gallery">
          <LayoutGrid />
          {t('viewGallery')}
        </ToggleGroupItem>
        <ToggleGroupItem className="flex-1" value="list">
          <List />
          {t('viewList')}
        </ToggleGroupItem>
      </ToggleGroup>
      <Row label={t('displayShowInfo')}>
        <Switch checked={infoOn} onCheckedChange={setInfo} disabled={layout === 'list'} />
      </Row>
      {sizeTrack && !sizeTrack.single && (
        <Row label={t('displaySize')}>
          <SizeSlider key={`post:${sizeTrack.min}:${sizeTrack.max}`} track={sizeTrack} onDrag={(v) => applyPostSize?.(v, sizeTrack.min, sizeTrack.max, false)} onCommit={(v) => applyPostSize?.(v, sizeTrack.min, sizeTrack.max, true)} />
        </Row>
      )}
    </>
  );
}

// Poster grid: sort + its existing 3-way view (avatars/cards/rows). Not re-conceived
// into gallery/list — that axis is out of P2②'s scope (see the file header).
const POSTER_VIEWS = [
  { v: 'card', key: 'viewCard', Icon: Square },
  { v: 'tile', key: 'viewTile', Icon: LayoutGrid },
  { v: 'list', key: 'viewList', Icon: List },
];
function PosterControls() {
  const posterView = useSyncExternalStore(subKey('posterView'), () => (storeGet('posterView') as string) || 'card');
  const posterSizeTrack = usePosterSizeTrack();
  return (
    <>
      <Row label={t('sbPosterSortTitle')}>
        <SortSelect_ storeKey="sortPoster" sel={null} options={SORT_POSTER} />
      </Row>
      <Separator />
      {/* Same View Transition as the post side (#252): the same control in the same popover
          has to move its cards the same way. */}
      <ToggleGroup className="w-full" variant="outline" spacing={0} value={[posterView]} onValueChange={(v) => v.length && runPosterDensityViewTransition(() => storeSet('posterView', v[0] as string))} aria-label={t('sbViewTitle')}>
        {POSTER_VIEWS.map(({ v, key, Icon }) => (
          <ToggleGroupItem key={v} className="flex-1" value={v} aria-label={t(key)}>
            <Icon />
            {t(key)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {posterSizeTrack && !posterSizeTrack.single && (
        <Row label={t('displaySize')}>
          <SizeSlider key={`poster:${posterSizeTrack.min}:${posterSizeTrack.max}`} track={posterSizeTrack} onDrag={(v) => applyPosterSize?.(v, posterSizeTrack.min, posterSizeTrack.max)} onCommit={(v) => applyPosterSize?.(v, posterSizeTrack.min, posterSizeTrack.max)} />
        </Row>
      )}
    </>
  );
}

// Panel visibility (#245) — the bulk hide, plus the line that teaches the key pair.
//
// It belongs in this popover and not in the toolbar proper: 表示 is the "how do I see it"
// axis, and "is the grid boxed in by two panels" is an answer to that question, whereas the
// toolbar itself holds PREDICATES (search / filter / display) and a panel is not one — the
// split InspectorToggle's header describes, applied one level in.
//
// One switch, not three. This surface can honestly own the mask (services/panels.ts is its
// single home), but the sidebar's own open state is React-local to AppShell — it carries a
// transient narrow-window form on top of the saved choice — so a switch here claiming to be
// the sidebar would be reading a different answer than the shell paints. The pair is
// written out below instead, which is what #245 asked this menu for: the two keys side by
// side, where Ctrl+B → Ctrl+Shift+B reads as "add Shift, take more with it".
//
// Mode-independent, so it renders outside the posts/posters branch.
function PanelControls() {
  const hidden = useSyncExternalStore(panelsSubscribe, panelsAreHidden);
  return (
    <>
      <Separator />
      <Row label={t('displayPanels')}>
        <Switch checked={!hidden} onCheckedChange={(on) => setPanelsHidden(!on)} />
      </Row>
      <p className="text-xs text-muted-foreground">{t('displayPanelsHint')}</p>
    </>
  );
}

export function DisplayMenu() {
  const mode = useSyncExternalStore(subKey('browseMode'), () => (storeGet('browseMode') as string) || 'posts');
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button variant="outline" size="sm">
            <SlidersHorizontal />
            <span>{t('displayTitle')}</span>
          </Button>
        }
      />
      <PopoverContent align="end" className="w-72 gap-2">
        {mode === 'posters' ? <PosterControls /> : <PostControls />}
        <PanelControls />
      </PopoverContent>
    </Popover>
  );
}
