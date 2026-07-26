import { defineWebExtConfig } from 'wxt';

// Development happens in a browser WXT owns, not in the everyday one.
//
// The default throwaway profile was disabled once (#370) because the pages we
// develop against need a logged-in session, and a fresh profile has none — so
// development moved into the everyday Chrome instead, with .output/chrome-mv3-dev
// loaded there by hand. That inverted the fragility: a dev-mode extension holds
// no content_scripts in its manifest and registers them at runtime over the dev
// server connection, so the moment that server stops the extension goes silent
// in the browser being used for actual work, and the only trace is a
// chrome://extensions error nobody has open (2026-07-26, #362).
//
// A persistent profile solves what #370 actually hit. Sign in once and
// keepProfileChanges carries the session forward, so the managed instance is
// worth having: hot reload works as designed, the everyday browser never
// depends on a dev server, and the window only appears when someone
// deliberately starts extension development.
//
// The remote-debugging port lets Claude attach to THIS browser (9222 belongs to
// the Hologram app itself), which is the other half — it can then read the
// extension's own console instead of asking for screenshots of a page it cannot
// open. See the verify-extension skill.
export default defineWebExtConfig({
  // Outside AppData, like every other path this project persists (MSIX
  // virtualisation ate a library once — docs/build.md).
  chromiumProfile: 'C:/Users/apricot/.hologram-ext-profile',
  keepProfileChanges: true,
  chromiumArgs: ['--remote-debugging-port=9223'],
  startUrls: ['https://x.com/i/bookmarks'],
});
