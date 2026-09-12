import type { CSSProperties } from 'react';
import { TITLEBAR_COLORS, TITLEBAR_HEIGHT } from '../../../shared/window-chrome.ts';

export function Titlebar() {
  return (
    <div
      data-slot="titlebar-band"
      className="app-titlebar app-drag relative z-[13600] flex shrink-0 items-center px-3 text-xs select-none"
      style={
        {
          height: TITLEBAR_HEIGHT,
          paddingRight: 'calc(100vw - env(titlebar-area-width, calc(100vw - 138px)) + 12px)',
          '--titlebar-light': TITLEBAR_COLORS.light.color,
          '--titlebar-light-text': TITLEBAR_COLORS.light.symbolColor,
          '--titlebar-dark': TITLEBAR_COLORS.dark.color,
          '--titlebar-dark-text': TITLEBAR_COLORS.dark.symbolColor,
        } as CSSProperties
      }
    >
      <span className="truncate">Hologram</span>
    </div>
  );
}
