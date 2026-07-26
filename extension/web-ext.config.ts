import { defineWebExtConfig } from 'wxt';

// `wxt` (dev) opens its own Chrome on a throwaway profile by default, which is
// dead weight here: the browser used for development already has
// .output/chrome-mv3-dev loaded as an unpacked extension, and that copy is what
// hot-reloads off the dev server. The managed instance only added a second
// window that steals focus every time the dev server starts.
//
// `disabled` keeps the dev server (and therefore hot reload) and skips only the
// browser launch. Delete this file to get the managed instance back.
export default defineWebExtConfig({
  disabled: true,
});
