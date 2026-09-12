import type { CSSProperties } from 'react';
import { TITLEBAR_COLORS, TITLEBAR_HEIGHT } from '../../../shared/window-chrome.ts';

const appIcon = new URL('../../../../assets/icon.png', import.meta.url).href;

export function Titlebar() {
  return (
    <div
      data-slot="titlebar-band"
      className="app-titlebar app-drag relative z-[13600] flex shrink-0 items-center gap-1 px-2 text-[12px] select-none"
      style={
        {
          height: TITLEBAR_HEIGHT,
          fontFamily: '"Segoe UI", sans-serif',
          paddingRight: 'calc(100vw - env(titlebar-area-width, calc(100vw - 138px)) + 12px)',
          '--titlebar-light': TITLEBAR_COLORS.light.color,
          '--titlebar-light-text': TITLEBAR_COLORS.light.symbolColor,
          '--titlebar-dark': TITLEBAR_COLORS.dark.color,
          '--titlebar-dark-text': TITLEBAR_COLORS.dark.symbolColor,
        } as CSSProperties
      }
    >
      <img src={appIcon} alt="" draggable={false} className="size-4 shrink-0" />
      <span className="truncate">Hologram</span>
    </div>
  );
}
