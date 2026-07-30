import log from 'electron-log/renderer';
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { t } from '../_shared/i18n.ts';

// The single React root's last resort (#324). React unmounts the WHOLE tree when a
// render throws with no boundary above it, and this app has exactly one root
// (root.tsx) — so one bad value anywhere took the grid, sidebar, inspector,
// settings and trash with it and left a blank window with no way back. Data whose
// shape came from outside the app is normalized at its own boundary now
// (normalizePostRecord on the way into the DB, listTrashRecords for the trash
// listing), but a boundary is insurance for the failures normalization cannot
// anticipate — a field nobody has thought about yet, or a plain bug in a component.
//
// Deliberately built from plain elements: a fallback that renders through the
// component library it is catching for could throw a second time, and React treats
// a throw inside a boundary's own render as an unhandled error again. Reload is the
// only offered action because nothing in the renderer holds unsaved state — the DB
// is written through main — so a fresh mount is a complete recovery whenever the
// cause was transient.
//
// Class component because getDerivedStateFromError / componentDidCatch have no hook
// equivalent (React docs); this is the one class component in the renderer.
interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // log.errorHandler.startCatching() (app/log.ts) never sees this one: React
    // catches the throw itself, so it reaches neither window.onerror nor an
    // unhandled rejection. Without this line the diagnostic log would hold no
    // trace of the failure that emptied the window.
    log.error('[error-boundary] renderer render failed', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    // z-[14000]: above every layer of the legacy z-scale and above the shadcn portals
    // handled for it (dialog z-[13000], popover z-[13500]) — whatever was on screen when
    // the tree died must not show through the only surface left.
    return (
      <div className="bg-background/95 fixed inset-0 z-[14000] flex flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-base font-medium">{t('renderErrorTitle')}</div>
        <div className="text-muted-foreground max-w-md text-sm">{t('renderErrorBody')}</div>
        <button type="button" className="bg-primary text-primary-foreground hover:opacity-90 rounded-md px-3 py-1.5 text-sm" onClick={() => location.reload()}>
          {t('renderErrorReload')}
        </button>
      </div>
    );
  }
}
