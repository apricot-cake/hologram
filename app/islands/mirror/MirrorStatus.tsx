import { useLayoutEffect, useSyncExternalStore } from 'react';

// Backup status rail (#mirrorStatus). Pure presentation: viewer's setupMirrorStatusRail
// derives the model (backup config + last result + syncing flag → kind/text/title/time)
// and pushes it via window.corpusMirror; this renders the glyph + text and owns the host's
// className/title. The status modifier (.is-syncing / .is-error / .is-done) lives on the
// host <span> itself (the portal target, not a React-owned element), so a useLayoutEffect
// writes host.className/title there — the inline margin-left:auto style is left untouched.

// Status glyphs (verbatim from viewer's old MS_ICON_*): spinning arrows = syncing, check =
// done, triangle = error / prune-guarded.
const IconSync = () => (
  <svg className="ms-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M23 4v6h-6" />
    <path d="M1 20v-6h6" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);
const IconDone = () => (
  <svg className="ms-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
const IconWarn = () => (
  <svg className="ms-ic" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </svg>
);

const CLASS: Record<string, string> = {
  syncing: 'mirror-status is-syncing',
  error: 'mirror-status is-error',
  done: 'mirror-status is-done',
};

export function MirrorStatus() {
  const m = useSyncExternalStore(window.corpusMirror.subscribe, window.corpusMirror.get);
  // className / title live on the host <span> (portal target), not a React element.
  useLayoutEffect(() => {
    const host = document.getElementById('mirrorStatus');
    if (!host) return;
    host.className = m ? CLASS[m.kind] : 'mirror-status';
    host.title = m ? m.title || '' : '';
  }, [m]);
  if (!m) return null;
  if (m.kind === 'done') {
    return (
      <>
        <IconDone />
        <span className="ms-body">
          <span className="ms-t">{m.text}</span>
          {m.time ? <span className="ms-time">{m.time}</span> : null}
        </span>
      </>
    );
  }
  return (
    <>
      {m.kind === 'syncing' ? <IconSync /> : <IconWarn />}
      <span className="ms-t">{m.text}</span>
    </>
  );
}
