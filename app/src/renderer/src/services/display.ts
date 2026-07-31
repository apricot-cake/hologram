// The display axes (#618) — "how do I see it", decomposed into orthogonal keys.
//
// P2② shipped the display popover as a FACADE over a single 3-value store key
// (`view` = card/tile/list): "情報を表示" flipped the thumbnail's SHAPE, the GIF
// playback and the image quality along with the metadata, because all four rode one
// value. This module is the replacement — three independent keys, five legal states:
//
//   grid + 元比率 + 情報あり   (Pinterest / Notion ギャラリー)
//   grid + 元比率 + 情報なし   (Pinterest / Eagle 既定)
//   grid + 正方形 + 情報あり   (EC グリッド / Eagle のファイル名表示)
//   grid + 正方形 + 情報なし   (pixiv / Instagram / X メディアタブ)
//   list                       (行そのものが情報なので2スイッチは無効)
//
// Naming: only the SQUARE side is named — "元の比率のまま敷き詰める" needs no term of
// its own, which is why there is no `masonry`/`waterfall` in the codebase (2026-07-19
// 確定, #154). `square` is Mac 写真.app の「正方形のサムネール」と同語.
//
// #658 adds a 4th orthogonal key, `avatar` — every state above ×2 (avatar on/off),
// ten legal states, no new concept (same extend-don't-bundle rule this module already
// follows). See `avatarDisabled` below for why its disabled condition runs the
// OPPOSITE way from `square`/`info`'s.
import { get as storeGet, set as storeSet, subscribe as storeSubscribe } from './store.ts';

/** The four store keys that make up a display state. */
export const DISPLAY_KEYS = ['layout', 'squareThumbs', 'showInfo', 'showAvatar'] as const;

export interface DisplayShape {
  /** Rows instead of a grid. Both switches below are inert (and disabled) while true. */
  list: boolean;
  /** Grid: crop every thumbnail to a square, so the grid is an even lattice. */
  square: boolean;
  /** Grid: draw the poster / excerpt / meta block under the thumbnail. */
  info: boolean;
  /** Draw the author's avatar in AuthorLine (#658). Independent of `info` — see avatarDisabled. */
  avatar: boolean;
}

/** Defaults = grid, original aspect, info on (what the old `view: 'card'` drew), avatar on. */
export function currentShape(): DisplayShape {
  return {
    list: storeGet('layout') === 'list',
    square: storeGet('squareThumbs') === true,
    info: storeGet('showInfo') !== false,
    avatar: storeGet('showAvatar') !== false,
  };
}

/** Fires on any of the three keys — callers that re-derive the whole shape. */
export function subscribeShape(cb: () => void): () => void {
  const unsubs = DISPLAY_KEYS.map((k) => storeSubscribe(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
}

/** A value that changes whenever the shape does (useSyncExternalStore snapshots). */
export function shapeSnapshot(): string {
  const s = currentShape();
  return `${s.list ? 'list' : 'grid'}|${s.square ? 'sq' : 'ar'}|${s.info ? 'info' : 'bare'}|${s.avatar ? 'av' : 'noav'}`;
}

// --- The size axis ----------------------------------------------------------
// One size per layout: the grid's is a COLUMN WIDTH (the square edge, when squares
// are on — same number either way), the list's is its thumbnail width.
//
// The grid's floor depends on `info`, and only on it: at the small end of the axis a
// cell is pure thumbnail — that IS the overview zoom (#141) — and a metadata block
// has nowhere to go there. So turning 情報を表示 on raises the floor (and pulls an
// overview-sized grid up to it); turning it off opens the small end again.
export const GRID_MAX = 560;
export const GRID_MIN_BARE = 48;
export const GRID_MIN_INFO = 200;
export const LIST_MIN = 56;
export const LIST_MAX = 200;

export const gridMin = (info: boolean): number => (info ? GRID_MIN_INFO : GRID_MIN_BARE);

/** Clamp a grid column width into the range the current `info` switch allows. */
export const clampGridSize = (px: number, info: boolean): number => Math.max(gridMin(info), Math.min(GRID_MAX, px));

/**
 * The gap between cells, in px. One formula, two readers: the grid model hands it to
 * masonic as the row/column gutter, and the size track needs the same number to work
 * out how many columns fit. A bare square lattice packs tightest (pixiv / X メディア
 * タブ); anything carrying text needs room to read as separate cards.
 */
export const gutterFor = (shape: DisplayShape): number => (shape.list ? 14 : shape.square && !shape.info ? 8 : 16);

/** Set one axis. Writing the store is the whole action — every reader subscribes. */
export function setLayout(list: boolean): void {
  storeSet('layout', list ? 'list' : 'grid');
}
export function setSquare(on: boolean): void {
  storeSet('squareThumbs', on);
}
export function setInfo(on: boolean): void {
  storeSet('showInfo', on);
}
export function setAvatar(on: boolean): void {
  storeSet('showAvatar', on);
}

// The avatar switch disables on the OPPOSITE condition from square/info: those go
// inert in LIST mode (a row has no separate info toggle — see `list`'s doc above).
// The avatar has somewhere to draw in list mode too: ListRow.tsx always renders
// AuthorLine, list or no "info" concept of its own. What kills the avatar's only
// drawing surface is the GRID's own info block going away — PostCard.tsx doesn't
// render its `info` block (AuthorLine's home) at all when `shape.info` is false, so
// there is nothing left for the switch to act on. Hence: disabled only in grid, and
// only once info is off; list always leaves it live (#658).
export function avatarDisabled(s: DisplayShape): boolean {
  return !s.list && !s.info;
}

// --- The poster grid's axes (#630) ------------------------------------------
// The same decomposition, one axis short. A saved picture can be worth cropping to a
// square — the library holds every proportion — but an AVATAR is already square on all
// five platforms Hologram reads (X / Bluesky / Misskey / Mastodon / pixiv serve them
// that way), so a 正方形 switch here would be the identity function wearing a control.
// GitHub's Members / Stargazers, Linear's Members and Discord's member list carry no
// aspect switch over a list of people either.
//
//   grid + 情報あり   (GitHub Members のカード)
//   grid + 情報なし   (アバターだけの俯瞰 — #141 と同じ性格)
//   list              (行そのものが情報なのでスイッチは無効)
//
// The retired 3-value density (card / tile / list) maps onto these one-for-one, so this
// is the same three states drawn from two keys — nothing gained, nothing dropped.
//
// The keys are the poster grid's OWN (not shared with the post grid): with a different
// number of axes, a shared key would leave `squareThumbs` meaningless in poster mode —
// the same failure the facade had. Finder / Explorer and Photos.app's People likewise
// remember a view per place rather than one for the whole app.
export const POSTER_DISPLAY_KEYS = ['posterLayout', 'posterShowInfo'] as const;

export interface PosterShape {
  /** Rows instead of a grid. The switch below is inert (and disabled) while true. */
  list: boolean;
  /** Grid: draw the name / handle / platform / count block under the avatar. */
  info: boolean;
}

/** Defaults = grid, info on (what the old `posterView: 'card'` drew). */
export function currentPosterShape(): PosterShape {
  return {
    list: storeGet('posterLayout') === 'list',
    info: storeGet('posterShowInfo') !== false,
  };
}

export function subscribePosterShape(cb: () => void): () => void {
  const unsubs = POSTER_DISPLAY_KEYS.map((k) => storeSubscribe(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
}

export function posterShapeSnapshot(): string {
  const s = currentPosterShape();
  return `${s.list ? 'list' : 'grid'}|${s.info ? 'info' : 'bare'}`;
}

// One size per LAYOUT, as on the post side: the grid's is a column width, and the list
// has none at all (a row is a fixed-height line of text — GitHub's contributor rows and
// Linear's member rows have no size control either). The floor rides 情報を表示 for the
// same reason it does over there: a bare cell is pure avatar and can shrink to the
// overview zoom, a cell carrying a metadata block cannot.
export const POSTER_GRID_MAX = 340;
export const POSTER_GRID_MIN_BARE = 72;
export const POSTER_GRID_MIN_INFO = 150;

export const posterGridMin = (info: boolean): number => (info ? POSTER_GRID_MIN_INFO : POSTER_GRID_MIN_BARE);

export const clampPosterGridSize = (px: number, info: boolean): number => Math.max(posterGridMin(info), Math.min(POSTER_GRID_MAX, px));

/** Gutter between poster cells — a bare avatar lattice packs tightest. */
export const posterGutterFor = (shape: PosterShape): number => (shape.list ? 4 : shape.info ? 14 : 10);

export function setPosterLayout(list: boolean): void {
  storeSet('posterLayout', list ? 'list' : 'grid');
}
export function setPosterInfo(on: boolean): void {
  storeSet('posterShowInfo', on);
}
