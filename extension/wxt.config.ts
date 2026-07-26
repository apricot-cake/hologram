import { defineConfig } from 'wxt';

export default defineConfig({
  // Dev and production builds write to the same .output/chrome-mv3 (WXT's
  // default appends "-dev" in dev mode). The user's daily Chrome loads this
  // single path, so switching modes is one rebuild + one extension reload —
  // never a remove/re-add, which wipes chrome.storage.local and shortcut
  // assignments (docs/build.md「拡張機能の開発・配布」).
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}',
  manifest: {
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzBGm/kCBitgpMoAkBDv5YrWwfAf74U8Uiy/rEuZgwFP703HT2EIhASBHEfVX7MSBF1a5V3D5IwZzu9mRFQmTzXtjyli8wdvxIjXVy3fqXXCRSmPMfCklL5nZ56ncx2LATi40kP8IiP36b40ZhPCVsq/NExT9gO0TNFpyJchDuAGgefqSBSS/xwp6c25vozxjbSfD3vcD2ohfSqpa75mui4XGwwouvbHl+69I7zXpeM5yYxmU+tTqWSUEblFGM67BsYSaPXGxcP9izInSB8JQ6WbmOyjCd/6az1RbKz9Yud2Yc4cX4z9+qWAx/ldn6vmQ6cjpvEAWTQdngSyHpawP5QIDAQAB',
    name: '__MSG_extName__',
    description: '__MSG_extDesc__',
    default_locale: 'en',
    permissions: ['activeTab', 'scripting', 'nativeMessaging', 'storage'],
    host_permissions: ['https://cdn.syndication.twimg.com/*', 'https://www.pixiv.net/*'],
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
