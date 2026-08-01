import { defineManifest } from '@crxjs/vite-plugin';
import { API_HOST_PERMISSIONS, RESIDENT_MATCHES } from './utils/extractor/index.ts';

export const EXTENSION_ID = 'keggmjkemfcekcffohnpaojacdakpejh';

export default defineManifest(({ mode }) => ({
  manifest_version: 3,
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzBGm/kCBitgpMoAkBDv5YrWwfAf74U8Uiy/rEuZgwFP703HT2EIhASBHEfVX7MSBF1a5V3D5IwZzu9mRFQmTzXtjyli8wdvxIjXVy3fqXXCRSmPMfCklL5nZ56ncx2LATi40kP8IiP36b40ZhPCVsq/NExT9gO0TNFpyJchDuAGgefqSBSS/xwp6c25vozxjbSfD3vcD2ohfSqpa75mui4XGwwouvbHl+69I7zXpeM5yYxmU+tTqWSUEblFGM67BsYSaPXGxcP9izInSB8JQ6WbmOyjCd/6az1RbKz9Yud2Yc4cX4z9+qWAx/ldn6vmQ6cjpvEAWTQdngSyHpawP5QIDAQAB',
  name: '__MSG_extName__',
  version: '1.1.0',
  description: '__MSG_extDesc__',
  default_locale: 'en',
  permissions: ['activeTab', 'scripting', 'nativeMessaging', 'storage'],
  host_permissions: API_HOST_PERMISSIONS,
  background:
    mode === 'firefox'
      ? {
          scripts: ['entrypoints/background.ts'],
        }
      : {
          service_worker: 'entrypoints/background.ts',
          type: 'module',
        },
  content_scripts: [
    {
      matches: RESIDENT_MATCHES,
      js: ['entrypoints/resident.content.ts'],
      run_at: 'document_idle',
    },
  ],
  icons: {
    16: 'public/icons/icon16.png',
    32: 'public/icons/icon32.png',
    48: 'public/icons/icon48.png',
    128: 'public/icons/icon128.png',
  },
  action: {
    default_title: '__MSG_actionTitle__',
    default_icon: {
      16: 'public/icons/icon16.png',
      32: 'public/icons/icon32.png',
    },
  },
  commands: {
    activate: {
      suggested_key: { default: 'Alt+S' },
      description: '__MSG_cmdActivate__',
    },
    'activate-auto': {
      suggested_key: { default: 'Alt+Shift+S' },
      description: '__MSG_cmdActivateAuto__',
    },
  },
  options_ui: {
    page: 'options.html',
    open_in_tab: true,
  },
}));
