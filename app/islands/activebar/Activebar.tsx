import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

// The query-builder FRAME islands for #postActiveBar / #posterActiveBar — the chrome
// AROUND the chips: nav 戻る/進む, the フィルター title, the empty-bar hint, the result
// count, the リセット button, and the ⓘ help popover. viewer.js keeps ALL logic and pushes
// a model via window.corpusActivebar (buildActivebarModel / pushActivebar); this host
// renders the frame. The count/reset/empty/nav are pure data; nav/reset/help call back into
// viewer through the model's callbacks.
//
// The chips (#queryChips / #posterQueryChips) are their OWN island (query-chips) and keep
// viewer's delegated click/contextmenu handlers. So the frame is NOT a single portal into
// the bar (that would replace the chips container and detach those handlers). Instead each
// dynamic piece portals into a static sub-mount that sits BESIDE the chips container
// (#postNavMount / #postFrameLead / #postTrailMount / #posterFrameLead / #posterTrailMount /
// #posterCount) — the chips containers are never touched. Same ids/classes as the old
// static HTML so CSS + the verify scripts that click #postResetBtn etc. keep working.

const subscribe = (cb: () => void) => window.corpusActivebar.subscribe(cb);
const getSnapshot = () => window.corpusActivebar.get();

// Portal a subtree into a static viewer-owned sub-mount by id (present before app.js runs,
// so getElementById resolves synchronously). Mirrors App.tsx's Portal helper.
function into(id: string, node: ReactNode) {
  const el = document.getElementById(id);
  return el ? createPortal(node, el) : null;
}

// display: '' clears the inline property (reads back as ''), 'none' hides it — matches the
// old viewer `el.style.display = … ? '' : 'none'` exactly, which test-app-postfilter.js
// asserts on #postResetBtn (reset.style.display === 'none' / !== 'none').
const showHide = (visible: boolean) => ({ display: visible ? '' : 'none' });

function NavBtn({ dir, disabled, onClick }: { dir: 'back' | 'fwd'; disabled: boolean; onClick: () => void }) {
  const back = dir === 'back';
  return (
    <button className="icon-btn icon-btn--ghost" id={back ? 'navBackBtn' : 'navFwdBtn'} type="button" aria-label={back ? '戻る' : '進む'} data-tip={back ? '戻る (Alt+←)' : '進む (Alt+→)'} disabled={disabled} onClick={onClick}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={back ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
      </svg>
    </button>
  );
}

// ⓘ help hover popover — glass-lens material (shared hover-hint), positioned under the
// button and clamped to the viewport's right edge (1:1 port of viewer's showQbHelp). Only
// rendered while open, so `show` is always present (its CSS gives display:block + pop-in).
function HelpPop({ help }: { help: { title: string; rows: string[] } }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const pop = ref.current;
    const btn = document.getElementById('qbHelpBtn');
    if (!pop || !btn) return;
    const r = btn.getBoundingClientRect();
    pop.style.left = `${r.left}px`;
    pop.style.top = `${r.bottom + 6}px`;
    const pr = pop.getBoundingClientRect();
    if (pr.right > window.innerWidth - 8) pop.style.left = `${Math.max(8, window.innerWidth - pr.width - 8)}px`;
    // Position once on mount — HelpPop remounts on each open (helpOpen toggles it), so this
    // reruns per open. No reactive deps (ref/document/window aren't dependencies).
  }, []);
  return (
    <div ref={ref} className="qb-help-pop glass-lens show">
      <div className="qh-title">{help.title}</div>
      {help.rows.map((t) => (
        <div className="qh-row" key={t}>
          {t}
        </div>
      ))}
    </div>
  );
}

export function ActivebarHost() {
  const m = useSyncExternalStore(subscribe, getSnapshot);
  const [helpOpen, setHelpOpen] = useState(false);
  // Escape closes the hint (parity with viewer's old global keydown handler).
  useEffect(() => {
    if (!helpOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHelpOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [helpOpen]);
  if (!m) return null;
  const P = m.post;
  const Po = m.poster;
  return (
    <>
      {/* --- Post bar frame --- */}
      {into(
        'postNavMount',
        <>
          <NavBtn dir="back" disabled={P.navBackDisabled} onClick={m.onNavBack} />
          <NavBtn dir="fwd" disabled={P.navFwdDisabled} onClick={m.onNavFwd} />
        </>,
      )}
      {into(
        'postFrameLead',
        <>
          <span className="sb-activebar-title" id="activebarLabel">
            {P.label}
          </span>
          <span className="qb-empty" id="qbEmptyHint" style={showHide(P.emptyVisible)}>
            {P.emptyHint}
          </span>
        </>,
      )}
      {into(
        'postTrailMount',
        <>
          <span className="post-count" id="postCount">
            {P.countLabel}
          </span>
          <button className="sb-reset" id="postResetBtn" type="button" style={showHide(P.resetVisible)} onClick={m.onReset}>
            {P.resetLabel}
          </button>
          <button className="qb-help" id="qbHelpBtn" type="button" onMouseEnter={() => setHelpOpen(true)} onMouseLeave={() => setHelpOpen(false)} onFocus={() => setHelpOpen(true)} onBlur={() => setHelpOpen(false)}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="11" x2="12" y2="16" />
              <line x1="12" y1="7.6" x2="12" y2="7.7" />
            </svg>
          </button>
        </>,
      )}
      {/* --- Poster bar frame (no nav / title; count lives in the sidebar) --- */}
      {into(
        'posterFrameLead',
        <span className="qb-empty" id="posterQbEmptyHint" style={showHide(Po.emptyVisible)}>
          {Po.emptyHint}
        </span>,
      )}
      {into(
        'posterTrailMount',
        <button className="sb-reset" id="posterResetBtn" type="button" style={showHide(Po.resetVisible)} onClick={m.onPosterReset}>
          {Po.resetLabel}
        </button>,
      )}
      {into('posterCount', Po.countLabel)}
      {/* Fixed-position help popover: viewport-relative, so it renders as a direct child. */}
      {helpOpen && <HelpPop help={m.help} />}
    </>
  );
}
