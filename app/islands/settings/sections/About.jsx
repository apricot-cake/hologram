import { useRef, useEffect, useState } from 'react';
import { t } from '../../_shared/i18n.js';
import * as ipc from '../ipc.js';

// このアプリについて: the live holographic icon over name / version / build meta.
export function About() {
  const canvasRef = useRef(null);
  const [info, setInfo] = useState(null);

  // Mount the existing WebGL icon module against our canvas. It self-gates on
  // visibility (IntersectionObserver) and tears down rAF/observers on destroy(),
  // so the React unmount cleanup is just handle.destroy().
  useEffect(() => {
    if (!canvasRef.current || !window.corpusAboutIcon) return undefined;
    const handle = window.corpusAboutIcon.mount(canvasRef.current);
    return () => handle.destroy();
  }, []);

  useEffect(() => { Promise.resolve(ipc.getAppInfo()).then(setInfo).catch(() => {}); }, []);

  return (
    <div className="about-card">
      <div className="about-icon">
        <canvas ref={canvasRef} width={352} height={352} aria-hidden="true" />
      </div>
      <div className="about-name">Corpus</div>
      <div className="about-version">{info ? t('aboutVersion', [info.version || '']) : ''}</div>
      <div className="about-tagline">{t('aboutTagline')}</div>
      <div className="about-meta">
        {info ? `Electron ${info.electron} · Chromium ${info.chromium} · Node ${info.node}` : ''}
      </div>
    </div>
  );
}
