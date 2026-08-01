import { defineWebExtConfig } from 'wxt';

// WXT must NOT launch a browser. Anything opened through the automation
// stack (web-ext-run → chrome-launcher) carries an automation-flag fingerprint
// — a dozen --disable-* switches no ordinary Chrome has — and X and Google
// both read it as a bot and refuse sign-in (hit live 2026-07-26; evading that
// detection is out of bounds). Hot reload itself never needed the managed
// launch: it runs between the extension and the dev server, no matter who
// started the browser.
//
// The dev target is the user's own daily Chrome, launched normally, loading
// .output/chrome-mv3 (docs/build.md's "Extension development & distribution" section). `disabled`
// keeps the dev server and hot reload and skips only the launch. No
// --remote-debugging-port on that browser either: a TCP debugging port is
// unauthenticated, so any local process could lift the signed-in session out
// of it — the reason Chrome 136 refuses the switch on the default profile.
export default defineWebExtConfig({
  disabled: true,
});
