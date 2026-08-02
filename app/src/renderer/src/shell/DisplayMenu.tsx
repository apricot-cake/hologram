// Display popover — the "how do I see it" axis of the new IA (redesign §3-3, P2②).
// Linear's "Display" popover: one surface collecting ordering + view + view options,
// opened from the toolbar's Display button. Mode-aware (browseMode): each grid gets its
// own sort and its own display axes. Anchors: Linear Display, Notion view options.
//
// Both sides are ORTHOGONAL store keys now, not a 3-value enum: three for posts
// (#618 — layout plus two grid switches), two for posters (#630 — layout plus one,
// since every platform serves a square avatar and a square switch there would do
// nothing). P2② shipped this popover as a facade over a single value, which is what
// made "Show Info" quietly change the thumbnail's shape as well; services/display.ts
// holds the real axes and this surface is exactly a view of them.
//
// The rows differ by mode, and only by SUBTRACTION: the layout toggle, Show Info and
// Size sit at the same height in both modes, and posts add the square-thumbnail toggle between the
// first two. Nothing is renamed or reordered across the switch.
import type { ReactNode } from 'react';
import { LayoutGrid, List, Shuffle, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { t } from '../_shared/i18n.ts';
import { avatarDisabled, currentPosterShape, currentShape, DISPLAY_KEYS, POSTER_DISPLAY_KEYS, posterShapeSnapshot, setAvatar, setInfo as setShowInfo, setLayout, setPosterInfo, setPosterLayout, setSquare, shapeSnapshot, subscribePosterShape, subscribeShape } from '../services/display.ts';
import type { HologramSizeTrack } from '../services/grid-density-builder.ts';
import { applyPostSize, applyPosterSize, getPostSizeTrack, getPosterSizeTrack, rerollShuffle, setPostSort } from '../services/orchestrator.ts';
import { isHidden as panelsAreHidden, setHidden as setPanelsHidden, subscribe as panelsSubscribe } from '../services/panels.ts';
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from '../services/store.ts';

const subKey = (key: string) => (cb: () => void) => storeSubscribe(key, cb);

// Subscribe to several store keys at once (any change fires cb) — the size track depends
// on the display shape AND the active layout's size, which live in separate store keys.
const subMany = (keys: string[]) => (cb: () => void) => {
  const unsubs = keys.map((k) => storeSubscribe(k, cb));
  return () => unsubs.forEach((u) => u());
};
const subPostSize = subMany([...DISPLAY_KEYS, 'gridSize', 'listThumb']);
const postSizeSnap = () => `${shapeSnapshot()}|${storeGet('gridSize')}|${storeGet('listThumb')}`;
const subPosterSize = subMany([...POSTER_DISPLAY_KEYS, 'posterGridSize']);
const posterSizeSnap = () => `${posterShapeSnapshot()}|${storeGet('posterGridSize')}`;

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

// Sort Select. Both sorts are plain store keys now: the post sort used to be a hidden
// <select> in the shell that this drove with a synthetic 'change' event (#153 category
// 3), and it is setPostSort() — a real function call — instead.
function SortSelect_({ storeKey, apply, options }: { storeKey: string; apply?: (value: string) => void; options: { value: string; key: string }[] }) {
  const subscribe = useCallback((cb: () => void) => storeSubscribe(storeKey, cb), [storeKey]);
  const getVal = useCallback((): string => (storeGet(storeKey) as string) ?? options[0].value, [storeKey, options]);
  const value = useSyncExternalStore(subscribe, getVal);
  const items = useMemo(() => Object.fromEntries(options.map((o) => [o.value, t(o.key)])), [options]);
  const choose = useCallback(
    (next: string | null) => {
      if (next == null) return; // Base UI passes null on clear — never our case
      if (apply) apply(next);
      else storeSet(storeKey, next);
    },
    [apply, storeKey],
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

// Post grid: sort, then the display axes — layout (grid/list) plus, for the grid,
// two independent switches. All five combinations are legal on purpose (#618); the two
// switches go inert in the list, where a row IS its own information.
function PostControls() {
  useSyncExternalStore(subscribeShape, shapeSnapshot);
  const shape = currentShape();
  const sizeTrack = usePostSizeTrack();
  // Random is the one sort with something left to say after it is picked: the order is
  // seeded, so re-rolling is how you get a different one (#118).
  const sort = useSyncExternalStore(subKey('sortPost'), () => (storeGet('sortPost') as string) || 'date-desc');
  return (
    <>
      <Row label={t('sbSortTitle')}>
        <div className="flex items-center gap-1">
          <SortSelect_ storeKey="sortPost" apply={(v) => setPostSort?.(v)} options={SORT_POST} />
          {sort === 'random' && (
            <Button variant="ghost" size="icon" aria-label={t('sortReroll')} title={t('sortReroll')} onClick={() => rerollShuffle?.()}>
              <Shuffle />
            </Button>
          )}
        </div>
      </Row>
      <Separator />
      <ToggleGroup className="w-full" variant="outline" spacing={0} value={[shape.list ? 'list' : 'grid']} onValueChange={(v) => v.length && setLayout(v[0] === 'list')} aria-label={t('sbViewTitle')}>
        <ToggleGroupItem className="flex-1" value="grid">
          <LayoutGrid />
          {t('layoutGrid')}
        </ToggleGroupItem>
        <ToggleGroupItem className="flex-1" value="list">
          <List />
          {t('layoutList')}
        </ToggleGroupItem>
      </ToggleGroup>
      {/* Only the square side is named: leaving it off means "keep each picture's own
          proportions", which needs no term (2026-07-19, finalized). Mac Photos.app calls the
          same switch "square thumbnail". */}
      <Row label={t('displaySquare')}>
        <Switch checked={shape.square} onCheckedChange={setSquare} disabled={shape.list} />
      </Row>
      <Row label={t('displayShowInfo')}>
        <Switch checked={shape.info} onCheckedChange={setShowInfo} disabled={shape.list} />
      </Row>
      <Row label={t('displayShowAvatar')}>
        <Switch checked={shape.avatar} onCheckedChange={setAvatar} disabled={avatarDisabled(shape)} />
      </Row>
      {sizeTrack && !sizeTrack.single && (
        <Row label={t('displaySize')}>
          <SizeSlider key={`post:${sizeTrack.min}:${sizeTrack.max}`} track={sizeTrack} onDrag={(v) => applyPostSize?.(v, sizeTrack.min, sizeTrack.max, false)} onCommit={(v) => applyPostSize?.(v, sizeTrack.min, sizeTrack.max, true)} />
        </Row>
      )}
    </>
  );
}

// Poster grid: sort, then its two display axes (#630). No shape row — an avatar is
// already square everywhere Hologram reads one, so the switch would be a no-op wearing
// a control (see services/display.ts). Everything else lines up with the post side.
function PosterControls() {
  useSyncExternalStore(subscribePosterShape, posterShapeSnapshot);
  const shape = currentPosterShape();
  const posterSizeTrack = usePosterSizeTrack();
  return (
    <>
      <Row label={t('sbPosterSortTitle')}>
        <SortSelect_ storeKey="sortPoster" options={SORT_POSTER} />
      </Row>
      <Separator />
      <ToggleGroup className="w-full" variant="outline" spacing={0} value={[shape.list ? 'list' : 'grid']} onValueChange={(v) => v.length && setPosterLayout(v[0] === 'list')} aria-label={t('sbViewTitle')}>
        <ToggleGroupItem className="flex-1" value="grid">
          <LayoutGrid />
          {t('layoutGrid')}
        </ToggleGroupItem>
        <ToggleGroupItem className="flex-1" value="list">
          <List />
          {t('layoutList')}
        </ToggleGroupItem>
      </ToggleGroup>
      <Row label={t('displayShowInfo')}>
        <Switch checked={shape.info} onCheckedChange={setPosterInfo} disabled={shape.list} />
      </Row>
      {posterSizeTrack && !posterSizeTrack.single && (
        <Row label={t('displaySize')}>
          <SizeSlider key={`poster:${posterSizeTrack.min}:${posterSizeTrack.max}`} track={posterSizeTrack} onDrag={(v) => applyPosterSize?.(v, posterSizeTrack.min, posterSizeTrack.max)} onCommit={(v) => applyPosterSize?.(v, posterSizeTrack.min, posterSizeTrack.max)} />
        </Row>
      )}
    </>
  );
}

// Timeline (#183): no sort row (pinned to post-date descending, never a user
// choice — that fixed order is the mode's whole identity), no layout toggle /
// square switch / size slider (FeedCard.tsx is the one card this mode draws,
// at its own fixed read width — "which layout" is not a question this surface
// answers here). What survives is the same pair of density switches the post
// grid has, reading the SAME store keys (services/display.ts) rather than a
// second settings axis for what is still the same post population.
function TimelineControls() {
  useSyncExternalStore(subscribeShape, shapeSnapshot);
  const shape = currentShape();
  return (
    <>
      <Row label={t('displayShowInfo')}>
        <Switch checked={shape.info} onCheckedChange={setShowInfo} />
      </Row>
      <Row label={t('displayShowAvatar')}>
        {/* Disabled on the same condition FeedCard itself gates the author line
            on: with "Show info" off there is no author line for this switch to
            act on (see FeedCard.tsx's shape.info branch). */}
        <Switch checked={shape.avatar} onCheckedChange={setAvatar} disabled={!shape.info} />
      </Row>
    </>
  );
}

// Panel visibility (#245) — the bulk hide, plus the line that teaches the key pair.
//
// It belongs in this popover and not in the toolbar proper: Display is the "how do I see it"
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
        {mode === 'posters' ? <PosterControls /> : mode === 'timeline' ? <TimelineControls /> : <PostControls />}
        <PanelControls />
      </PopoverContent>
    </Popover>
  );
}
