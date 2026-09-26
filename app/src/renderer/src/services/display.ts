// グリッドの表示設定とサイズ範囲。
import { store, subscribeKey } from './store.ts';

export const DISPLAY_KEYS = ['showInfo', 'showAvatar'] as const;

export interface DisplayShape {
  info: boolean;
  avatar: boolean;
}

export function currentShape(): DisplayShape {
  return {
    info: store.getState().showInfo !== false,
    avatar: store.getState().showAvatar !== false,
  };
}

export function subscribeShape(cb: () => void): () => void {
  const unsubs = DISPLAY_KEYS.map((k) => subscribeKey(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
}

export function shapeSnapshot(): string {
  const s = currentShape();
  return `${s.info ? 'info' : 'bare'}|${s.avatar ? 'av' : 'noav'}`;
}

export const GRID_MAX = 560;
export const GRID_MIN_BARE = 48;
export const GRID_MIN_INFO = 200;

export const gridMin = (info: boolean): number => (info ? GRID_MIN_INFO : GRID_MIN_BARE);

export const clampGridSize = (px: number, info: boolean): number => Math.max(gridMin(info), Math.min(GRID_MAX, px));

export const POST_GUTTER = 16;
export function setInfo(on: boolean): void {
  store.setState({ showInfo: on });
}
export function setAvatar(on: boolean): void {
  store.setState({ showAvatar: on });
}

export function avatarDisabled(s: DisplayShape): boolean {
  return !s.info;
}

export const POSTER_DISPLAY_KEYS = ['posterShowInfo'] as const;

export interface PosterShape {
  info: boolean;
}

export function currentPosterShape(): PosterShape {
  return {
    info: store.getState().posterShowInfo !== false,
  };
}

export function subscribePosterShape(cb: () => void): () => void {
  const unsubs = POSTER_DISPLAY_KEYS.map((k) => subscribeKey(k, cb));
  return () => {
    for (const u of unsubs) u();
  };
}

export function posterShapeSnapshot(): string {
  const s = currentPosterShape();
  return `${s.info ? 'info' : 'bare'}`;
}

export const POSTER_GRID_MAX = 340;
export const POSTER_GRID_MIN_BARE = 72;
export const POSTER_GRID_MIN_INFO = 150;

export const posterGridMin = (info: boolean): number => (info ? POSTER_GRID_MIN_INFO : POSTER_GRID_MIN_BARE);

export const clampPosterGridSize = (px: number, info: boolean): number => Math.max(posterGridMin(info), Math.min(POSTER_GRID_MAX, px));

export const posterGutterFor = (shape: PosterShape): number => (shape.info ? 14 : 10);

export function setPosterInfo(on: boolean): void {
  store.setState({ posterShowInfo: on });
}
