import { isAppRendererUrl } from './renderer-files.ts';
import { resolveDevServerUrl } from './dev-server-guard.ts';

export function isTrustedIpcUrl(raw: string, devUrl: string | undefined, packaged: boolean): boolean {
  try {
    const url = new URL(raw);
    if (url.username || url.password) return false;
    if (isAppRendererUrl(url) && !url.port) return true;
    const dev = resolveDevServerUrl(devUrl, packaged);
    return !!dev.url && url.origin === new URL(dev.url).origin && ['/', '/index.html'].includes(url.pathname);
  } catch {
    return false;
  }
}
