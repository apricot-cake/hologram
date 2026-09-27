import { installWebSaveNotices } from '../utils/web-save-notices.ts';

export default defineUnlistedScript(() => {
  const state = globalThis as typeof globalThis & { hologramWebSaveNotices?: boolean };
  if (state.hologramWebSaveNotices) return;
  state.hologramWebSaveNotices = true;
  installWebSaveNotices();
});
