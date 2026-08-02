import { homedir } from 'node:os';
import { dirname, basename, resolve } from 'node:path';
import { defineConfig } from 'wxt';
import { API_HOST_PERMISSIONS } from './utils/extractor/index.ts';

// Where a DEVELOPMENT build lands. Deliberately outside the working tree and
// identical for every tree: the dedicated development Chrome profile (#732)
// loads one unpacked folder once, and re-pointing it every time work moves to
// another worktree would be a click nobody remembers to make. The env var is
// what `npm run dev:ext` sets; the default below is what a bare `wxt` in this
// directory writes, so both agree on the folder the profile has loaded.
const developmentOutput = process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT || resolve(homedir(), '.hologram-dev', 'chrome-mv3-dev');

export default defineConfig({
  // Firefox too. WXT would default Firefox to MV2; this extension has been MV3 on
  // both since the CRXJS era, and the native messaging model — the one thing the
  // Firefox port actually depends on (#211) — is the same either way. Keeping one
  // manifest version keeps one set of release checks.
  manifestVersion: 3,
  // Two outputs that must never be confused for each other:
  //   dev     → the fixed path above, read only by the development profile
  //   release → .output/<browser>-mv3-release, verified by scripts/build-extension.cts
  //             before anything copies it to .output/chrome-mv3 (the folder the
  //             daily Chrome has loaded). `wxt build` therefore CANNOT write to
  //             the daily folder, which is the point: only a verified build gets
  //             there, and it gets there by promotion (scripts/deploy-extension.cts).
  outDir: process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT ? dirname(developmentOutput) : resolve(import.meta.dirname, '.output'),
  outDirTemplate: process.env.HOLOGRAM_EXTENSION_DEV_OUTPUT ? basename(developmentOutput) : '{{browser}}-mv{{manifestVersion}}-release{{modeSuffix}}',
  dev: {
    server: {
      // Fixed so the development profile's extension always finds the server it
      // was built against. Only one dev server can be up at a time, and taking
      // the port is how a second one finds out.
      port: 51731,
    },
  },
  // WXT must NOT launch a browser. Two independent reasons, both still live:
  //   - anything opened through an automation stack carries the automation-flag
  //     fingerprint, and X and Google read it as a bot and refuse sign-in (hit
  //     live 2026-07-26). The development profile is signed in to five sites;
  //     losing that is losing the profile's whole reason to exist.
  //   - `--load-extension` is ignored by Chrome 137+ (#657, measured on Chrome
  //     151), so a managed launch would not even load the extension.
  // The extension is loaded once, by hand, into the dedicated profile; hot
  // reload runs between the extension and the dev server and does not care who
  // started the browser. Keeping the runner off also means `web-ext` — an
  // OPTIONAL peer dependency since WXT 0.21.2 — is never installed, so its
  // transitive dependencies are not in this tree at all (#454).
  webExt: {
    disabled: true,
  },
  vite: (env) => ({
    build: {
      // Vite's default modulepreload <link> for entry chunks (options.html,
      // diag.html) can't be used by Chrome extension pages — the browser loads
      // extension resources in a different "world" than the preload targets, so
      // it discards the tag as a "cross-world extension resource mismatch" and
      // then warns a second time that the preload went unused. Two warnings per
      // chunk stack up in chrome://extensions every time a settings or diag page
      // opens, burying real errors. These pages only ever fetch local extension
      // files, so there is no load-time win to give up (#595).
      modulePreload: false,
    },
    // Which build this bundle IS (#650). Minted per build by
    // scripts/build-extension.cts, which puts the same token in a stamp file the
    // native host reads — the extension then notices that the folder it was
    // loaded from now holds a different build and reloads itself, so a promoted
    // release needs no click in chrome://extensions.
    //
    // Read from the environment rather than generated here so the value is
    // decided ONCE per build, outside, by the script that also verifies the
    // output and publishes the stamp. A bare `wxt build` sets nothing and the
    // identifier stays undefined — utils/dev-reload.ts reads that as "there is
    // no local build", which is the correct answer for anything that leaves
    // this machine.
    define: {
      __EXT_BUILD_ID__: JSON.stringify(process.env.HOLOGRAM_EXT_BUILD_ID || ''),
      // Which native messaging host this build asks for (#732 —
      // utils/native-host.ts). Keyed on the COMMAND, deliberately: `import.meta.env.DEV`
      // follows NODE_ENV, so a release built from a test runner would come out
      // pointing at the development host and its sandbox library.
      __HOLOGRAM_NATIVE_HOST__: JSON.stringify(env.command === 'serve' ? 'com.hologram.host.dev' : 'com.hologram.host'),
    },
  }),
  manifest: {
    // The fixed signing key, and therefore the fixed extension id. Kept
    // IDENTICAL for development and release builds: native messaging routes on
    // the host NAME (utils/native-host.ts), not on the extension id, so the two
    // profiles can be isolated without a second id — and a second id would fork
    // chrome.storage, the keyboard shortcuts and the release verification.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzBGm/kCBitgpMoAkBDv5YrWwfAf74U8Uiy/rEuZgwFP703HT2EIhASBHEfVX7MSBF1a5V3D5IwZzu9mRFQmTzXtjyli8wdvxIjXVy3fqXXCRSmPMfCklL5nZ56ncx2LATi40kP8IiP36b40ZhPCVsq/NExT9gO0TNFpyJchDuAGgefqSBSS/xwp6c25vozxjbSfD3vcD2ohfSqpa75mui4XGwwouvbHl+69I7zXpeM5yYxmU+tTqWSUEblFGM67BsYSaPXGxcP9izInSB8JQ6WbmOyjCd/6az1RbKz9Yud2Yc4cX4z9+qWAx/ldn6vmQ6cjpvEAWTQdngSyHpawP5QIDAQAB',
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    // contextMenus (#195): the page right-click "bookmark" item. Warning-free
    // (no install-time permission prompt, no host_permissions) — see #195's
    // 2026-08-02 design comment #5 for why this is the only permission the
    // feature adds.
    permissions: ['activeTab', 'scripting', 'nativeMessaging', 'storage', 'contextMenus'],
    // The API hosts whose CORS the background fetch needs, declared by the
    // extractors that call them (#212) — adding a site does not touch this file.
    host_permissions: API_HOST_PERMISSIONS,
    icons: {
      16: 'icons/icon16.png',
      32: 'icons/icon32.png',
      48: 'icons/icon48.png',
      128: 'icons/icon128.png',
    },
    action: {
      default_title: '__MSG_actionTitle__',
      default_icon: {
        16: 'icons/icon16.png',
        32: 'icons/icon32.png',
      },
    },
    commands: {
      activate: {
        suggested_key: { default: 'Alt+S' },
        description: '__MSG_cmdActivate__',
      },
      // #362: its own gesture rather than a mode Alt+S switches into on certain
      // pages — Alt+S must keep meaning "save the post I am about to click"
      // everywhere, including the bookmarks list. A command (not just a
      // page-side button) because the auto capture needs activeTab, which only
      // a toolbar/command/context-menu gesture grants.
      'activate-auto': {
        suggested_key: { default: 'Alt+Shift+S' },
        description: '__MSG_cmdActivateAuto__',
      },
    },
  },
});
