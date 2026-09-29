import { hologramIpc } from './ipc.ts';

const ATTRIBUTE = 'data-legacy-privacy-mode';

/**
 * Honour an enabled privacy-mode preference written by an older release.
 * This runs before the React root is mounted so protected media is never
 * rendered unblurred during startup.
 */
export async function restoreLegacyPrivacyMode(): Promise<void> {
  try {
    const prefs = await hologramIpc.getPrefs();
    if (prefs.privacyMode) document.documentElement.setAttribute(ATTRIBUTE, '');
  } catch {
    // Other startup preference readers are best-effort too. Without a readable
    // config there is no persisted choice that can safely be inferred here.
  }
}
