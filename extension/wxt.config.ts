import { defineConfig } from 'wxt';
import { API_HOST_PERMISSIONS } from './utils/extractor/index.ts';

export default defineConfig({
  // WXT appends "-dev" to this path in its own dev mode (`wxt` / `wxt dev`),
  // which this project no longer runs — the standard loop is
  // `npm run build:ext` only (dev:ext retired, #675). The override stays as
  // a guard: if `wxt` is ever invoked directly (by hand, outside the npm
  // scripts), its output still lands in the one path the daily Chrome loads
  // instead of silently forking into an unread `chrome-mv3-dev` folder
  // (docs/build.md's "Extension development & distribution" section).
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  // Never let WXT auto-launch a browser via web-ext-run: that dependency
  // carries known-vulnerable transitives (shell-quote, tmp, adm-zip). The
  // only runner is the user's daily Chrome loading .output/chrome-mv3 (#378),
  // which never goes through this launcher; disabling it is a guard against
  // `wxt` being invoked directly, not something the standard `build:ext`
  // loop depends on (#398, #675).
  webExt: {
    disabled: true,
  },
  // Vite's default modulepreload <link> for entry chunks (options.html,
  // diag.html) can't be used by Chrome extension pages — the browser loads
  // extension resources in a different "world" than the preload targets, so
  // it discards the tag as a "cross-world extension resource mismatch" and
  // then warns a second time that the preload went unused. That's two
  // warnings per chunk stacking in chrome://extensions every time a settings
  // or diag page opens, burying real errors. These pages only ever fetch
  // local extension files, so there's no meaningful load-time win to give up
  // by disabling it (#595).
  vite: () => ({
    build: {
      modulePreload: false,
    },
    // Which build this bundle IS (#650). Minted per build by
    // scripts/build-extension.cts, which puts the same token in a stamp file the
    // native host reads — the extension then notices that the folder it was
    // loaded from now holds a different build and reloads itself, so a code
    // change needs no click in chrome://extensions.
    //
    // Read from the environment rather than generated here so that the value is
    // decided ONCE per build, outside, by the script that also has to verify the
    // output and publish the stamp. A bare `wxt build` (which `npm run zip:ext`
    // runs to make the store artifact) sets nothing, and the identifier stays
    // undefined — utils/dev-reload.ts reads that as "there is no local build",
    // which is the correct answer for anything that leaves this machine.
    define: {
      __EXT_BUILD_ID__: JSON.stringify(process.env.HOLOGRAM_EXT_BUILD_ID || ''),
    },
  }),
  manifest: {
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzBGm/kCBitgpMoAkBDv5YrWwfAf74U8Uiy/rEuZgwFP703HT2EIhASBHEfVX7MSBF1a5V3D5IwZzu9mRFQmTzXtjyli8wdvxIjXVy3fqXXCRSmPMfCklL5nZ56ncx2LATi40kP8IiP36b40ZhPCVsq/NExT9gO0TNFpyJchDuAGgefqSBSS/xwp6c25vozxjbSfD3vcD2ohfSqpa75mui4XGwwouvbHl+69I7zXpeM5yYxmU+tTqWSUEblFGM67BsYSaPXGxcP9izInSB8JQ6WbmOyjCd/6az1RbKz9Yud2Yc4cX4z9+qWAx/ldn6vmQ6cjpvEAWTQdngSyHpawP5QIDAQAB',
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    permissions: ['activeTab', 'scripting', 'nativeMessaging', 'storage'],
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
