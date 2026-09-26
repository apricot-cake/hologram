import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { gridSlot, subscribeGridSlots } from '../services/content-area.ts';
import type { MessageKey } from '../services/translation.ts';
type SortOption = { value: string; key: MessageKey; icon: LucideIcon; hint?: MessageKey };
import { Calendar, SquarePen, Download, Eye, History, Heart, Shuffle, ChevronDown, ArrowDownWideNarrow, Minus, Plus, Users, Text, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isSortAscending, sortOption, sortWithDirection } from '../services/sort-direction.ts';
import { t } from '../_shared/i18n.ts';
import { DISPLAY_KEYS, POSTER_DISPLAY_KEYS, posterShapeSnapshot, shapeSnapshot } from '../services/display.ts';
import type { HologramSizeTrack } from '../services/grid-density-builder.ts';
import { applyPostSize, applyPosterSize, getPostSizeTrack, getPosterSizeTrack, rerollShuffle, setPostSort, setTrashSort } from '../services/orchestrator.ts';
import { store, subscribeKey, subscribeKeys } from '../services/store.ts';
import type { HologramStoreState } from '../services/store.ts';

const subKey = (key: keyof HologramStoreState) => (cb: () => void) => subscribeKey(key, cb);

// ストアのキーをまとめて購読する（どれが変わっても cb が呼ばれる）＝サイズのトラックは
// 表示の形と、今のレイアウトのサイズの両方に依存し、この2つは別々のストアのキーにある。
const subMany = (keys: readonly (keyof HologramStoreState)[]) => (cb: () => void) => subscribeKeys(keys, cb);
const subPostSize = subMany([...DISPLAY_KEYS, 'gridSize']);
const postSizeSnap = () => `${shapeSnapshot()}|${store.getState().gridSize}`;
const subPosterSize = subMany([...POSTER_DISPLAY_KEYS, 'posterGridSize']);
const posterSizeSnap = () => `${posterShapeSnapshot()}|${store.getState().posterGridSize}`;

const SORT_POST: SortOption[] = [
  { value: 'date-desc', key: 'sortPostDate', icon: SquarePen },
  { value: 'captured-desc', key: 'sortCaptured', icon: Download },
  { value: 'local-views-desc', key: 'sortLocalViews', icon: Eye, hint: 'sortLocalViewsHint' },
  { value: 'last-viewed-desc', key: 'sortLastViewed', icon: History },
  { value: 'likes-pct', key: 'sortLikesPct', icon: Heart, hint: 'sortSiteRelativeHint' },
  { value: 'random', key: 'sortRandom', icon: Shuffle },
];
const SORT_TRASH: SortOption[] = [
  { value: 'trashed-desc', key: 'sortTrashed', icon: Download },
  { value: 'date-desc', key: 'sortPostDate', icon: SquarePen },
  { value: 'captured-desc', key: 'sortCaptured', icon: Download },
  { value: 'local-views-desc', key: 'sortLocalViews', icon: Eye, hint: 'sortLocalViewsHint' },
  { value: 'likes-pct', key: 'sortLikesPct', icon: Heart, hint: 'sortSiteRelativeHint' },
];
const SORT_POSTER: SortOption[] = [
  { value: 'local-views-desc', key: 'sortLocalViews', icon: Eye, hint: 'sortLocalViewsHint' },
  { value: 'last-viewed-desc', key: 'sortLastViewed', icon: History },
  { value: 'count', key: 'posterSortCount', icon: SquarePen },
  { value: 'followers-pct', key: 'posterSortFollowers', icon: Users, hint: 'sortSiteRelativeHint' },
  { value: 'name', key: 'posterSortName', icon: Text },
  { value: 'date-desc', key: 'posterSortDate', icon: Calendar },
  { value: 'random', key: 'sortRandom', icon: Shuffle },
];

function usePostSizeTrack(): HologramSizeTrack | null {
  // ビュー／サイズのストアの変更かウィンドウのリサイズで描き直し、そのうえで幾何から導かれる
  // 生きたトラックを読み直す（#postGrid の幅に依存し、それを動かすのはこの2つだけ）。
  useSyncExternalStore(subPostSize, postSizeSnap);
  const [, bumpResize] = useState(0);
  useEffect(() => {
    const on = () => bumpResize((n) => n + 1);
    window.addEventListener('resize', on, { passive: true });
    const observer = new ResizeObserver(on);
    const observe = () => {
      observer.disconnect();
      for (const kind of ['post', 'poster', 'trash'] as const) {
        const el = gridSlot(kind);
        if (el) observer.observe(el);
      }
      on();
    };
    const unsubscribe = subscribeGridSlots(observe);
    observe();
    return () => {
      window.removeEventListener('resize', on);
      observer.disconnect();
      unsubscribe();
    };
  }, []);
  return getPostSizeTrack ? getPostSizeTrack() : null;
}
function usePosterSizeTrack(): HologramSizeTrack | null {
  useSyncExternalStore(subPosterSize, posterSizeSnap);
  const [, bumpResize] = useState(0);
  useEffect(() => {
    const on = () => bumpResize((n) => n + 1);
    window.addEventListener('resize', on, { passive: true });
    const observer = new ResizeObserver(on);
    const observe = () => {
      observer.disconnect();
      for (const kind of ['post', 'poster', 'trash'] as const) {
        const el = gridSlot(kind);
        if (el) observer.observe(el);
      }
      on();
    };
    const unsubscribe = subscribeGridSlots(observe);
    observe();
    return () => {
      window.removeEventListener('resize', on);
      observer.disconnect();
      unsubscribe();
    };
  }, []);
  return getPosterSizeTrack ? getPosterSizeTrack() : null;
}

// サイズの軸は Slider が動かす。ドラッグ中のつまみはローカルの状態が持つ（ドラッグ途中の
// 更新はストアを通さない）。呼び出し側はトラックの範囲を key にしているので、つまみが種を
// 撒き直すのはビューが変わったときだけで、同じビューの中の確定ごとには起きない。
function SizeSlider({ track, onDrag, onCommit }: { track: HologramSizeTrack; onDrag: (v: number) => void; onCommit: (v: number) => void }) {
  const [v, setV] = useState(track.value);
  const applied = useRef(track.value);
  useEffect(() => {
    setV(track.value);
    applied.current = track.value;
  }, [track.value]);
  const snap = (value: number) => track.min + Math.round((value - track.min) / track.step) * track.step;
  const pick = (val: number | readonly number[]): number => (Array.isArray(val) ? val[0] : (val as number));
  const slider = (
    <Slider
      className={track.single ? 'w-20 pointer-events-none [&_[data-base-ui-slider-control]]:opacity-100 [&_[data-slot=slider-track]]:bg-muted-foreground/30 [&_[data-slot=slider-thumb]]:border-muted-foreground [&_[data-slot=slider-thumb]]:bg-muted [&_[data-slot=slider-range]]:bg-muted-foreground' : 'w-20'}
      aria-label={t('displaySize')}
      min={track.min}
      max={track.single ? track.min + track.step : track.max}
      disabled={track.single}
      step={track.step / 100}
      largeStep={track.step}
      value={[v]}
      onKeyDownCapture={(event) => {
        const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
        if (!direction) return;
        event.preventDefault();
        const next = Math.max(track.min, Math.min(track.max, snap(v) + direction * track.step));
        setV(next);
        applied.current = next;
        onCommit(next);
      }}
      onValueChange={(val) => {
        const n = pick(val);
        setV(n);
        const next = snap(n);
        if (next !== applied.current) {
          applied.current = next;
          onDrag(next);
        }
      }}
      onValueCommitted={(val) => onCommit(snap(pick(val)))}
    />
  );
  return track.single ? (
    <Tooltip disableHoverablePopup>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: 無効なスライダーの理由をキーボードでも確認できるよう、外側をフォーカス可能にする。 */}
      <TooltipTrigger render={<span role="group" tabIndex={0} aria-disabled="true" aria-label={t('displaySize')} className="flex w-20 cursor-not-allowed py-2" />}>{slider}</TooltipTrigger>
      <TooltipContent side="bottom" align="center" className="pointer-events-none w-20">
        {t('displaySizeUnavailable')}
      </TooltipContent>
    </Tooltip>
  ) : (
    slider
  );
}

function SortMenu({ storeKey, apply, options }: { storeKey: 'sortPost' | 'sortPoster' | 'sortTrash'; apply?: (value: string) => void; options: SortOption[] }) {
  const subscribe = useCallback((cb: () => void) => subscribeKey(storeKey, cb), [storeKey]);
  const getVal = useCallback(() => store.getState()[storeKey], [storeKey]);
  const value = useSyncExternalStore(subscribe, getVal);
  const selected = options.find((o) => o.value === sortOption(value)) ?? options[0];
  const ascending = isSortAscending(value);
  const date = /^(date-|captured-|trashed-|last-viewed-)/.test(value);
  const labels = date ? (['sortNewestFirst', 'sortOldestFirst'] as const) : sortOption(value) === 'name' ? (['sortDescending', 'sortAscending'] as const) : (['sortMostFirst', 'sortFewestFirst'] as const);
  const choose = (next: string) => {
    if (apply) apply(next);
    else store.setState({ [storeKey]: next });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-slot="toolbar-sort" render={<Button variant="outline" size="sm" />}>
        <ArrowDownWideNarrow aria-hidden="true" className="text-muted-foreground" />
        <span>{t(selected.key)}</span>
        <ChevronDown className="size-4 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44" aria-label={t('sbSortTitle')}>
        <DropdownMenuRadioGroup value={sortOption(value)} onValueChange={(next) => choose(value === 'random' ? next : sortWithDirection(next, ascending))}>
          {options.map((o) => {
            const item = (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                <o.icon className="text-muted-foreground" />
                {t(o.key)}
              </DropdownMenuRadioItem>
            );
            return o.hint ? (
              <Tooltip key={o.value}>
                <TooltipTrigger render={item} />
                <TooltipContent side="left">{t(o.hint)}</TooltipContent>
              </Tooltip>
            ) : (
              <DropdownMenuRadioItem key={o.value} value={o.value}>
                <o.icon className="text-muted-foreground" />
                {t(o.key)}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {value === 'random' ? (
          <DropdownMenuItem onClick={() => rerollShuffle?.()}>
            <Shuffle />
            {t('sortReroll')}
          </DropdownMenuItem>
        ) : (
          <DropdownMenuRadioGroup value={ascending ? 'asc' : 'desc'} onValueChange={(next) => choose(sortWithDirection(value, next === 'asc'))}>
            <DropdownMenuRadioItem value="desc">{t(labels[0])}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="asc">{t(labels[1])}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function DisplayMenu() {
  const mode = useSyncExternalStore(subKey('browseMode'), () => store.getState().browseMode);
  return mode === 'posters' ? <SortMenu storeKey="sortPoster" options={SORT_POSTER} /> : mode === 'trash' ? <SortMenu storeKey="sortTrash" apply={(value) => setTrashSort(value)} options={SORT_TRASH} /> : <SortMenu storeKey="sortPost" apply={(value) => setPostSort(value)} options={SORT_POST} />;
}
export function CardSizeControl() {
  const mode = useSyncExternalStore(subKey('browseMode'), () => store.getState().browseMode);
  const post = usePostSizeTrack(),
    poster = usePosterSizeTrack();
  const track = mode === 'posters' ? poster : post;
  if (!track) return null;
  const apply = (v: number, commit: boolean) => (mode === 'posters' ? applyPosterSize(v, track.min, track.max) : applyPostSize(v, track.min, track.max, commit));
  return (
    <div data-slot="toolbar-card-size" className="ml-2 flex shrink-0 items-center gap-1 text-muted-foreground">
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('cardSizeSmaller')} disabled={track.single || track.value <= track.min} onClick={() => apply(Math.max(track.min, track.value - track.step), true)} />}>
          <Minus />
        </TooltipTrigger>
        <TooltipContent>{t('cardSizeSmaller')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<div className="flex w-20 shrink-0" />}>
          <SizeSlider key={`${mode}:${track.min}:${track.max}`} track={track} onDrag={(v) => apply(v, false)} onCommit={(v) => apply(v, true)} />
        </TooltipTrigger>
        <TooltipContent>{t('cardSizeLabel')}</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t('cardSizeLarger')} disabled={track.single || track.value >= track.max} onClick={() => apply(Math.min(track.max, track.value + track.step), true)} />}>
          <Plus />
        </TooltipTrigger>
        <TooltipContent>{t('cardSizeLarger')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
