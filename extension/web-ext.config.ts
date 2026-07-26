import { defineWebExtConfig } from 'wxt';

// WXT must NOT launch the dev browser. Anything opened through the automation
// stack (web-ext-run → chrome-launcher) carries an automation-flag fingerprint
// — a dozen --disable-* switches no ordinary Chrome has — and X and Google
// both read it as a bot and refuse the sign-in the dev profile exists for
// (hit live 2026-07-26; evading that detection is out of bounds). Hot reload
// itself never needed the managed launch: it runs between the extension and
// the dev server, no matter who started the browser.
//
// The dev browser is therefore a HUMAN-launched Chrome on a dedicated profile
// (docs/build.md「拡張機能の開発・配布」 has the command and the one-time
// setup). `disabled` keeps the dev server and hot reload and skips only the
// launch. No --remote-debugging-port on that browser either: a TCP debugging
// port is unauthenticated, so any local process could lift the signed-in
// session out of it — the reason Chrome 136 refuses the switch on the default
// profile.
export default defineWebExtConfig({
  disabled: true,
});
