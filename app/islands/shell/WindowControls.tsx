// The window's min/max/close buttons, drawn by the app.
//
// Why app-drawn and not the OS overlay (titleBarOverlay / WCO): the OS strip is painted by
// the browser process on its own compositor, while the page is painted by the renderer on
// another — the display compositor just aggregates whichever frame each side has ready. So a
// page-wide change (a modal scrim) and a strip recolor can never be guaranteed to land in the
// same frame; they could only be nudged closer, which is what the earlier dim/recolor/defer
// machinery did, and the residual 1-2 frame split was visible as a flicker on rapid open/close.
// Drawing the buttons here puts them in the same frame as everything else, so there is nothing
// left to synchronize: the scrim simply covers them like any other pixels.
//
// The trade is the Windows 11 Snap Layouts flyout on maximize-hover, which requires a real
// caption button (Windows hit-tests the window and only the native overlay can answer
// "HTMAXBUTTON"); Electron does not expose that for app-drawn buttons. Snap itself is
// unaffected — Win+arrow, drag-to-screen-edge and Win+Z all still work.
//
// Geometry follows the Windows caption convention: 46x32 buttons, Segoe-style glyphs, and the
// close button's red hover (#c42b1c, the system's own value — Windows Terminal uses it too).
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { corpusIpc } from '../../renderer/ipc.ts';

function useMaximized(): boolean {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    corpusIpc.windowIsMaximized().then(setMaximized);
    // Main pushes every change, including the ones no button caused (snap, double-click on
    // the drag strip, Win+arrow, the taskbar), so the glyph can't drift out of sync.
    corpusIpc.onWindowMaximizedChanged(setMaximized);
  }, []);
  return maximized;
}

// 10x10 glyphs on the Windows caption grid. Stroke (not fill) at 1px keeps them crisp at
// 100% and lets the browser scale them on fractional-DPI displays.
function MinimizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function MaximizeGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
// The restore glyph is the standard two offset squares: the front pane plus the back one
// peeking out at the top-right.
function RestoreGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2.5 2.5V0.5h7v7h-2" fill="none" stroke="currentColor" strokeWidth="1" />
      <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

export function WindowControls() {
  const maximized = useMaximized();
  // app-no-drag: the strip overlaps the tab bar's drag region, which would otherwise swallow
  // the clicks. The tab bar reserves --window-controls-w of right padding so tabs never run
  // under it (index.html).
  const base = 'app-no-drag inline-grid h-8 w-[46px] place-items-center text-muted-foreground transition-colors duration-75';
  // Portaled to body and z-[13600]: above every modal surface (dialog 13000 / alert 13100 /
  // sheet 13500) so window management still works while a modal is up, the way the OS buttons
  // it replaces did. Inside the tab bar this was impossible — #tabBar is its own stacking
  // context at z-50, so no z-index on a child could clear the scrim. The dim that the scrim
  // would have applied is painted by .wc-dim instead (globals.css).
  // The strip carries the tab bar's own background, opaque: it sits ABOVE the scrim, so
  // without it the scrim would show through and .wc-dim would darken an already-darkened
  // area — the strip came out visibly deeper than the page around it. Opaque + one dim of
  // its own reproduces exactly what the page gets.
  return createPortal(
    <div className="app-no-drag fixed top-0 right-0 z-[13600] flex bg-[var(--tabbar-bg)]">
      <button type="button" aria-label="最小化" className={`${base} hover:bg-[var(--hover)] active:bg-[var(--active)]`} onClick={() => corpusIpc.windowControl('minimize')}>
        <MinimizeGlyph />
      </button>
      <button type="button" aria-label={maximized ? '元のサイズに戻す' : '最大化'} className={`${base} hover:bg-[var(--hover)] active:bg-[var(--active)]`} onClick={() => corpusIpc.windowControl('toggle-maximize')}>
        {maximized ? <RestoreGlyph /> : <MaximizeGlyph />}
      </button>
      <button type="button" aria-label="閉じる" className={`${base} hover:bg-[#c42b1c] hover:text-white active:bg-[#c42b1c]/90 active:text-white`} onClick={() => corpusIpc.windowControl('close')}>
        <CloseGlyph />
      </button>
      {/* The scrim's dim, re-created over the buttons (they're above the scrim). pointer-events
          off so it darkens without taking the clicks it exists to preserve. */}
      <div className="wc-dim pointer-events-none absolute inset-0 bg-black/50" aria-hidden="true" />
    </div>,
    document.body,
  );
}
