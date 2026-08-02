// Thin wrappers over hologramIpc (services/ipc.ts, the P4 IPC→service seam over the
// preload bridge) and the theme runtime (services/theme-api.ts). app/src/main/index.ts / app/src/preload/index.ts
// stay untouched — the component talks to the exact same IPC the vanilla settings did,
// just routed through the same seam every other renderer service uses now.

import { get as themeGet, set as themeSet } from '../services/theme-api.ts';
import { get as uiFontGet, apply as uiFontApply, set as uiFontSet } from '../services/ui-font-api.ts';
import { hologramIpc } from '../services/ipc.ts';
import type { AppPrefs } from '../../../main/ipc-payloads.ts';

// Partial, not AppPrefs: the bare-dev-server fallback resolves to {}, and every
// caller here already treats a missing member as "not set".
export const getPrefs = (): Promise<Partial<AppPrefs>> => (hologramIpc.getPrefs ? hologramIpc.getPrefs() : Promise.resolve({}));
export const setPref = (key: string, value: unknown) => (hologramIpc.setPref ? hologramIpc.setPref(key, value) : Promise.resolve());
export const getAppInfo = () => (hologramIpc.getAppInfo ? hologramIpc.getAppInfo() : Promise.resolve(null));
export const openExternal = (url: string) => hologramIpc.openExternal(url);

// Theme runtime lives in services/theme-api.ts (applies [data-theme], persists via
// setPref, caches to localStorage, follows the OS). We read/drive it through that module
// so the whole app stays in sync.
export const theme = {
  get: themeGet,
  set: (v: string) => {
    themeSet(v);
  },
};

// #137: uiFont splits preview from commit — the font combobox applies every keystroke
// live (preview, uncommitted, services/ui-font-api.ts's apply()) but only writes to
// config.json once the user settles on a value (commit, that module's set()).
export const uiFont = {
  get: uiFontGet,
  preview: (v: string) => {
    uiFontApply(v);
  },
  commit: (v: string) => {
    uiFontSet(v);
  },
};
