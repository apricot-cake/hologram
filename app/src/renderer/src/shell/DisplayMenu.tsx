import type { MessageKey } from '../services/translation.ts';
type SortOption = { value: string; key: MessageKey; hint?: MessageKey };
import type { ReactNode } from 'react';
import { ArrowUp, ArrowDown, Shuffle, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { isSortAscending, sortOption, sortWithDirection } from '../services/sort-direction.ts';
import { t } from '../_shared/i18n.ts';
import { avatarDisabled, currentPosterShape, currentShape, DISPLAY_KEYS, POSTER_DISPLAY_KEYS, posterShapeSnapshot, setAvatar, setInfo as setShowInfo, setPosterInfo, setSquare, shapeSnapshot, subscribePosterShape, subscribeShape } from '../services/display.ts';
import type { HologramSizeTrack } from '../services/grid-density-builder.ts';
import { applyPostSize, applyPosterSize, getPostSizeTrack, getPosterSizeTrack, rerollShuffle, setPostSort } from '../services/orchestrator.ts';
import { isHidden as panelsAreHidden, setHidden as setPanelsHidden, subscribe as panelsSubscribe } from '../services/panels.ts';
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
  { value: 'date-desc', key: 'sortPostDate' },
  { value: 'captured-desc', key: 'sortCaptured' },
  { value: 'likes-desc', key: 'sortLikes' },
  { value: 'local-views-desc', key: 'sortLocalViews' },
  { value: 'likes-pct', key: 'sortLikesPct', hint: 'sortLikesPctHint' },
  { value: 'random', key: 'sortRandom' },
];
const SORT_POSTER: SortOption[] = [
  { value: 'count', key: 'posterSortCount' },
  { value: 'followers-pct', key: 'posterSortFollowers', hint: 'posterSortFollowersHint' },
  { value: 'name', key: 'posterSortName' },
  { value: 'date-desc', key: 'posterSortDate' },
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
  return (
    <Slider
      className="w-40"
      min={track.min}
      max={track.max}
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
}

// 並び順の Select。今はどちらの並び順も素のストアのキー。投稿側の並び順はかつてシェルに
// 隠した <select> で、ここから合成した 'change' イベントで動かしていた（#153 の分類3）が、
// 今は setPostSort()＝本物の関数呼び出しになっている。
function SortSelect_({ storeKey, apply, options }: { storeKey: 'sortPost' | 'sortPoster'; apply?: (value: string) => void; options: SortOption[] }) {
  const subscribe = useCallback((cb: () => void) => subscribeKey(storeKey, cb), [storeKey]);
  const getVal = useCallback((): string => store.getState()[storeKey], [storeKey]);
  const value = useSyncExternalStore(subscribe, getVal);
  const items = useMemo(() => Object.fromEntries(options.map((o) => [o.value, t(o.key)])), [options]);
  const hint = options.find((o) => o.value === sortOption(value))?.hint;
  const choose = useCallback(
    (next: string | null) => {
      if (next == null) return; // Base UI は解除のとき null を渡す＝ここでは起こらない
      if (apply) apply(next);
      else store.setState({ [storeKey]: next });
    },
    [apply, storeKey],
  );
  return (
    <div className="flex items-center gap-1">
      <Select items={items} value={sortOption(value)} onValueChange={(next) => next && choose(value === 'random' ? next : sortWithDirection(next, isSortAscending(value)))}>
        <SelectTrigger size="sm" className="w-40 font-sans" title={hint ? t(hint) : undefined}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false} side="bottom" align="start">
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} title={o.hint ? t(o.hint) : undefined}>
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
        <Button data-slot="sort-direction" variant="ghost" size="icon" aria-label={t(isSortAscending(value) ? 'sortAscending' : 'sortDescending')} title={t(isSortAscending(value) ? 'sortAscending' : 'sortDescending')} onClick={() => choose(sortWithDirection(value, !isSortAscending(value)))}>
          {isSortAscending(value) ? <ArrowUp /> : <ArrowDown />}
        </Button>
      )}
    </div>
  );
}

function PostControls() {
  useSyncExternalStore(subscribeShape, shapeSnapshot);
  const shape = currentShape();
  const sizeTrack = usePostSizeTrack();
  return (
    <>
      <Row label={t('sbSortTitle')}>
        <SortSelect_ storeKey="sortPost" apply={(v) => setPostSort?.(v)} options={SORT_POST} />
      </Row>
      <Separator />
      {/* 名前が付いているのは正方形の側だけ。切ったままにするのは「それぞれの絵の比率を
          保つ」という意味で、こちらには語が要らない（2026-07-19 に確定）。Mac の Photos.app
          は同じスイッチを "square thumbnail" と呼んでいる。 */}
      <Row label={t('displaySquare')}>
        <Switch checked={shape.square} onCheckedChange={setSquare} />
      </Row>
      <Row label={t('displayShowInfo')}>
        <Switch checked={shape.info} onCheckedChange={setShowInfo} />
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

// 投稿者グリッド: 並び順、そのあとに表示の2軸（#630）。形の行は無い＝Hologram がアバターを
// 読むところではどこでも既に正方形なので、スイッチを置いても何もしないものにコントロールを
// 着せるだけになる（services/display.ts を参照）。それ以外は投稿側と揃えてある。
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
      <Row label={t('displayShowInfo')}>
        <Switch checked={shape.info} onCheckedChange={setPosterInfo} />
      </Row>
      {posterSizeTrack && !posterSizeTrack.single && (
        <Row label={t('displaySize')}>
          <SizeSlider key={`poster:${posterSizeTrack.min}:${posterSizeTrack.max}`} track={posterSizeTrack} onDrag={(v) => applyPosterSize?.(v, posterSizeTrack.min, posterSizeTrack.max)} onCommit={(v) => applyPosterSize?.(v, posterSizeTrack.min, posterSizeTrack.max)} />
        </Row>
      )}
    </>
  );
}

// パネルの表示（#245）＝まとめて隠す操作と、キーの組を教える1行。
//
// これはツールバー本体ではなく、このポップオーバーに属する。「表示」は「どう見るか」の軸で、
// 「グリッドが2枚のパネルに挟まれているか」はその問いへの答えだが、ツールバー自身が持つのは
// 述語（検索／フィルタ／表示）で、パネルは述語ではない＝InspectorToggle のヘッダーが述べて
// いる切り分けを、1段内側で当てはめたもの。
//
// スイッチは1つ、教えるキーも1つ。#245 はこのメニューに組を与えていた（サイドバーだけなら
// Ctrl+B・両方なら Ctrl+Shift+B）が、サイドバーはもう自分の開閉状態を持たない（#981＝
// レールであるか、他のものと一緒に隠れているかのどちらか）。だから素の方（Ctrl+B 単独）は
// 無くなり、名前を付ける対象はまとめて隠す方だけが残った。
//
// モードに依存しないので、投稿／投稿者の分岐の外で描く。
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
        <PanelControls />
      </PopoverContent>
    </Popover>
  );
}
