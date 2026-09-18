import type { MessageKey } from '../services/translation.ts';
type SortOption = { value: string; key: MessageKey; icon: LucideIcon; hint?: MessageKey };
import type { ReactNode } from 'react';
import { Calendar, SquarePen, Download, Eye, Heart, Shuffle, SlidersHorizontal, Files, Users, Text, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isSortAscending, sortOption, sortWithDirection } from '../services/sort-direction.ts';
import { t } from '../_shared/i18n.ts';
import { DISPLAY_KEYS, POSTER_DISPLAY_KEYS, posterShapeSnapshot, shapeSnapshot } from '../services/display.ts';
import type { HologramSizeTrack } from '../services/grid-density-builder.ts';
import { applyPostSize, applyPosterSize, getPostSizeTrack, getPosterSizeTrack, rerollShuffle, setPostSort } from '../services/orchestrator.ts';
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
  { value: 'local-views-desc', key: 'sortLocalViews', icon: Eye },
  { value: 'likes-pct', key: 'sortLikesPct', icon: Heart },
  { value: 'random', key: 'sortRandom', icon: Shuffle },
];
const SORT_POSTER: SortOption[] = [
  { value: 'count', key: 'posterSortCount', icon: Files },
  { value: 'followers-pct', key: 'posterSortFollowers', icon: Users, hint: 'posterSortFollowersHint' },
  { value: 'name', key: 'posterSortName', icon: Text },
  { value: 'date-desc', key: 'posterSortDate', icon: Calendar },
];

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3">
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function usePostSizeTrack(): HologramSizeTrack | null {
  // ビュー／サイズのストアの変更かウィンドウのリサイズで描き直し、そのうえで幾何から導かれる
  // 生きたトラックを読み直す（#postGrid の幅に依存し、それを動かすのはこの2つだけ）。
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

// サイズの軸は Slider が動かす。ドラッグ中のつまみはローカルの状態が持つ（ドラッグ途中の
// 更新はストアを通さない）。呼び出し側はトラックの範囲を key にしているので、つまみが種を
// 撒き直すのはビューが変わったときだけで、同じビューの中の確定ごとには起きない。
function SizeSlider({ track, onDrag, onCommit }: { track: HologramSizeTrack; onDrag: (v: number) => void; onCommit: (v: number) => void }) {
  const [v, setV] = useState(track.value);
  const applied = useRef(track.value);
  const snap = (value: number) => track.min + Math.round((value - track.min) / track.step) * track.step;
  const pick = (val: number | readonly number[]): number => (Array.isArray(val) ? val[0] : (val as number));
  const slider = (
    <Slider
      className={track.single ? 'w-49 pointer-events-none [&_[data-base-ui-slider-control]]:opacity-100 [&_[data-slot=slider-track]]:bg-muted-foreground/30 [&_[data-slot=slider-thumb]]:border-muted-foreground [&_[data-slot=slider-thumb]]:bg-muted [&_[data-slot=slider-range]]:bg-muted-foreground' : 'w-49'}
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
      <TooltipTrigger render={<span role="group" tabIndex={0} aria-disabled="true" aria-label={t('displaySize')} className="flex w-49 cursor-not-allowed py-2" />}>{slider}</TooltipTrigger>
      <TooltipContent side="bottom" align="center" className="pointer-events-none w-49">
        {t('displaySizeUnavailable')}
      </TooltipContent>
    </Tooltip>
  ) : (
    slider
  );
}

// 並び順の Select。今はどちらの並び順も素のストアのキー。投稿側の並び順はかつてシェルに
// 隠した <select> で、ここから合成した 'change' イベントで動かしていた（#153 の分類3）が、
// 今は setPostSort()＝本物の関数呼び出しになっている。
function SortSelect_({ storeKey, apply, options }: { storeKey: 'sortPost' | 'sortPoster'; apply?: (value: string) => void; options: SortOption[] }) {
  const subscribe = useCallback((cb: () => void) => subscribeKey(storeKey, cb), [storeKey]);
  const getVal = useCallback((): string => store.getState()[storeKey], [storeKey]);
  const value = useSyncExternalStore(subscribe, getVal);
  const items = useMemo(() => Object.fromEntries(options.map((o) => [o.value, t(o.key)])), [options]);
  const SelectedIcon = options.find((o) => o.value === sortOption(value))?.icon;
  const hint = options.find((o) => o.value === sortOption(value))?.hint;
  const ascending = isSortAscending(value);
  const directionLabel = t(value.startsWith('date-') || value.startsWith('captured-') ? (ascending ? 'sortOldestFirst' : 'sortNewestFirst') : sortOption(value) === 'name' ? (ascending ? 'sortAscending' : 'sortDescending') : ascending ? 'sortFewestFirst' : 'sortMostFirst');
  const choose = useCallback(
    (next: string | null) => {
      if (next == null) return; // Base UI は解除のとき null を渡す＝ここでは起こらない
      if (apply) apply(next);
      else store.setState({ [storeKey]: next });
    },
    [apply, storeKey],
  );
  return (
    <div className="flex w-49 items-center gap-1">
      <Select items={items} value={sortOption(value)} onValueChange={(next) => next && choose(value === 'random' ? next : sortWithDirection(next, isSortAscending(value)))}>
        <SelectTrigger size="sm" className="min-w-0 flex-1 font-sans" title={hint ? t(hint) : undefined}>
          {SelectedIcon && <SelectedIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
          <SelectValue className="min-w-0 flex-1 text-left" />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} side="bottom" align="start">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} title={o.hint ? t(o.hint) : undefined}>
              <o.icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              {t(o.key)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value === 'random' ? (
        <Button variant="ghost" size="icon" aria-label={t('sortReroll')} title={t('sortReroll')} onClick={() => rerollShuffle?.()}>
          <Shuffle />
        </Button>
      ) : (
        <Button data-slot="sort-direction" variant="outline" size="sm" className="shrink-0 px-2" onClick={() => choose(sortWithDirection(value, !ascending))}>
          {directionLabel}
        </Button>
      )}
    </div>
  );
}

function PostControls() {
  const sizeTrack = usePostSizeTrack();
  return (
    <>
      <Row label={t('sbSortTitle')}>
        <SortSelect_ storeKey="sortPost" apply={(v) => setPostSort?.(v)} options={SORT_POST} />
      </Row>
      <Separator />
      {sizeTrack && (
        <Row label={t('displaySize')}>
          <SizeSlider key={`post:${sizeTrack.min}:${sizeTrack.max}`} track={sizeTrack} onDrag={(v) => applyPostSize?.(v, sizeTrack.min, sizeTrack.max, false)} onCommit={(v) => applyPostSize?.(v, sizeTrack.min, sizeTrack.max, true)} />
        </Row>
      )}
    </>
  );
}

// 投稿者グリッド: 並び順、そのあとに表示の2軸（#630）。形の行は無い＝Hologram がアバターを
// 読むところではどこでも既に正方形なので、スイッチを置いても何もしないものにコントロールを
// 着せるだけになる（services/display.ts を参照）。それ以外は投稿側と揃えてある。
function PosterControls() {
  const posterSizeTrack = usePosterSizeTrack();
  return (
    <>
      <Row label={t('sbPosterSortTitle')}>
        <SortSelect_ storeKey="sortPoster" options={SORT_POSTER} />
      </Row>
      <Separator />
      {posterSizeTrack && (
        <Row label={t('displaySize')}>
          <SizeSlider key={`poster:${posterSizeTrack.min}:${posterSizeTrack.max}`} track={posterSizeTrack} onDrag={(v) => applyPosterSize?.(v, posterSizeTrack.min, posterSizeTrack.max)} onCommit={(v) => applyPosterSize?.(v, posterSizeTrack.min, posterSizeTrack.max)} />
        </Row>
      )}
    </>
  );
}

export function DisplayMenu() {
  const mode = useSyncExternalStore(subKey('browseMode'), () => store.getState().browseMode);
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
      </PopoverContent>
    </Popover>
  );
}
