import { mkdirSync } from 'node:fs';
import { defineWebExtConfig } from 'wxt';

const PROFILE = 'C:/Users/apricot/.hologram-ext-profile';

// chrome-launcher opens its log inside the profile directory before Chrome
// creates it, so a path that does not exist yet fails the whole dev command
// with a bare ENOENT on chrome-out.log. Creating it here keeps `npm run dev:ext`
// working on a fresh clone.
mkdirSync(PROFILE, { recursive: true });

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
// No --remote-debugging-port here on purpose. A TCP debugging port has no
// authentication, so any local process could drive this browser and lift the
// signed-in session out of it — which is why Chrome 136 refuses the switch on
// the default profile at all. Automation that needs to read this browser goes
// through Playwright instead (scripts/lib-extension-e2e.cts), whose transport
// is a pipe inherited by the launching process: nothing is listening anywhere.
// See the verify-extension skill.
export default defineWebExtConfig({
  // Outside AppData, like every other path this project persists (MSIX
  // virtualisation ate a library once — docs/build.md).
  chromiumProfile: PROFILE,
  keepProfileChanges: true,
  startUrls: ['https://x.com/i/bookmarks'],
});
