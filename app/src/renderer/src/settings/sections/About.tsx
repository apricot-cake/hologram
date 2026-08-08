import { useRef, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';
import { mount as mountAboutIcon } from '../../services/about-icon.ts';

// About this app: the live holographic icon over name / version / build meta.
interface AppInfo {
  version?: string;
  electron?: string;
  chromium?: string;
  node?: string;
}

const REPO_URL = 'https://github.com/apricot-cake/hologram';
const LINKS = [
  { key: 'aboutLinkRepo', url: REPO_URL },
  { key: 'aboutLinkReleases', url: `${REPO_URL}/releases` },
  { key: 'aboutLinkLicense', url: `${REPO_URL}/blob/main/LICENSE` },
] as const;

export function About() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);

  // Mount the existing WebGL icon module against our canvas. It self-gates on
  // visibility (IntersectionObserver) and tears down rAF/observers on destroy(),
  // so the React unmount cleanup is just handle.destroy().
  useEffect(() => {
    if (!canvasRef.current) return undefined;
    const handle = mountAboutIcon(canvasRef.current);
    return () => handle.destroy();
  }, []);

  useEffect(() => {
    Promise.resolve(ipc.getAppInfo())
      .then(setInfo)
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col items-center gap-1.5 py-6 text-center">
      <div className="mb-3">
        {/* biome-ignore lint/a11y/noAriaHiddenOnFocusable: a <canvas> is only focusable
            through fallback CONTENT (interactive children), and this one has none — it
            is a decorative animated logo. The rule's fix (drop aria-hidden) would make a
            screen reader announce an unlabeled canvas, i.e. strictly worse. */}
        <canvas ref={canvasRef} width={352} height={352} className="size-32" aria-hidden="true" />
      </div>
      <div className="text-2xl font-semibold tracking-tight">Hologram</div>
      <div className="text-muted-foreground text-sm">{info ? t('aboutVersion', [info.version || '']) : ''}</div>
      <div className="mt-1 max-w-sm text-sm text-balance">{t('aboutTagline')}</div>
      <div className="text-muted-foreground/70 mt-2 text-xs">{info ? `Electron ${info.electron} · Chromium ${info.chromium} · Node ${info.node}` : ''}</div>
      <Separator className="my-4 max-w-48" />
      <div className="flex items-center gap-5">
        {LINKS.map(({ key, url }) => (
          <Button
            key={key}
            variant="link"
            size="sm"
            className="h-auto p-0"
            render={
              <a
                href={url}
                onClick={(e) => {
                  e.preventDefault();
                  ipc.openExternal(url);
                }}
              />
            }
          >
            {t(key)}
          </Button>
        ))}
      </div>
    </div>
  );
}
