import { useRef, useEffect, useState } from 'react';
import { t } from '../../_shared/i18n.ts';
import * as ipc from '../ipc.ts';
import { mount as mountAboutIcon } from '../../../renderer/about-icon.ts';

// このアプリについて: the live holographic icon over name / version / build meta.
interface AppInfo {
  version?: string;
  electron?: string;
  chromium?: string;
  node?: string;
}

const REPO_URL = 'https://github.com/apricot-cake/corpus';
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
    <div className="about-card">
      <div className="about-icon">
        <canvas ref={canvasRef} width={352} height={352} aria-hidden="true" />
      </div>
      <div className="about-name">Corpus</div>
      <div className="about-version">{info ? t('aboutVersion', [info.version || '']) : ''}</div>
      <div className="about-tagline">{t('aboutTagline')}</div>
      <div className="about-meta">{info ? `Electron ${info.electron} · Chromium ${info.chromium} · Node ${info.node}` : ''}</div>
      <div className="about-links">
        {LINKS.map(({ key, url }) => (
          <a
            key={key}
            href={url}
            onClick={(e) => {
              e.preventDefault();
              ipc.openExternal(url);
            }}
          >
            {t(key)}
          </a>
        ))}
      </div>
    </div>
  );
}
