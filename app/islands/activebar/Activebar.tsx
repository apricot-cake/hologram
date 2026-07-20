import type { ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../../renderer/store.ts';
import { navBack, navForward, resetAllFilters, resetPosterFilters } from '../../renderer/orchestrator.ts';

// The query-builder FRAME islands for #postActiveBar / #posterActiveBar — the chrome
// AROUND the chips: nav 戻る/進む, the フィルター title, the empty-bar hint, the result
// count, the リセット button, and the ⓘ help popover. Self-derived (P4-B slice⑱): every
// read-only field comes straight from hologramStore ('postQueryTree'/'posterQueryTree'/
// 'searchQuery'/'postGroups'/'posterGroups'/'navCanBack'/'navCanForward' — all already
// mirrored there by orchestrator.ts for other consumers) + t(); the 4 actions (nav/reset) import
// navBack/navForward/resetAllFilters/resetPosterFilters directly (Wave32/V17 continued —
// the old orchestrator bridge for these is gone). No more pushed model (the old
// renderer/activebar.ts bridge is gone too).
//
// The chips (#queryChips / #posterQueryChips) are their OWN island (query-chips) and keep
// orchestrator's delegated click/contextmenu handlers. So the frame is NOT a single portal into
// the bar (that would replace the chips container and detach those handlers). Instead each
// dynamic piece portals into a static sub-mount that sits BESIDE the chips container
// (#postNavMount / #postFrameLead / #postTrailMount / #posterFrameLead / #posterTrailMount /
// #posterCount) — the chips containers are never touched. Same ids/classes as the old
// static HTML so CSS + the verify scripts that click #postResetBtn etc. keep working.

const subSearchQuery = (cb: () => void) => storeSubscribe('searchQuery', cb);
const getSearchQuery = () => (storeGet('searchQuery') as string | undefined) ?? '';
const subPostTree = (cb: () => void) => storeSubscribe('postQueryTree', cb);
const getPostTree = () => storeGet('postQueryTree') as { children: unknown[] } | undefined;
const subPosterTree = (cb: () => void) => storeSubscribe('posterQueryTree', cb);
const getPosterTree = () => storeGet('posterQueryTree') as { children: unknown[] } | undefined;
const subPostGroups = (cb: () => void) => storeSubscribe('postGroups', cb);
const getPostGroups = () => storeGet('postGroups') as any[] | null | undefined;
const subPosterGroups = (cb: () => void) => storeSubscribe('posterGroups', cb);
const getPosterGroups = () => storeGet('posterGroups') as any[] | undefined;
const subNavCanBack = (cb: () => void) => storeSubscribe('navCanBack', cb);
const getNavCanBack = () => !!storeGet('navCanBack');
const subNavCanForward = (cb: () => void) => storeSubscribe('navCanForward', cb);
const getNavCanForward = () => !!storeGet('navCanForward');

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

// ⓘ help hover popover — pop-solid material (shared hover-hint), positioned under the
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
    <div ref={ref} className="qb-help-pop pop-solid show">
      <div className="qh-title">{help.title}</div>
      {help.rows.map((row) => (
        <div className="qh-row" key={row}>
          {row}
        </div>
      ))}
    </div>
  );
}

export function ActivebarHost() {
  const search = useSyncExternalStore(subSearchQuery, getSearchQuery).trim();
  const postTree = useSyncExternalStore(subPostTree, getPostTree);
  const posterTree = useSyncExternalStore(subPosterTree, getPosterTree);
  const postGroups = useSyncExternalStore(subPostGroups, getPostGroups);
  const posterGroups = useSyncExternalStore(subPosterGroups, getPosterGroups);
  const navCanBack = useSyncExternalStore(subNavCanBack, getNavCanBack);
  const navCanForward = useSyncExternalStore(subNavCanForward, getNavCanForward);
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

  const postActive = (postTree?.children?.length ?? 0) > 0 || !!search;
  const posterActive = (posterTree?.children?.length ?? 0) > 0 || !!search;
  const postCount = postGroups ? postGroups.length : 0;
  const posterCount = posterGroups ? posterGroups.length : 0;

  return (
    <>
      {/* --- Post bar frame --- */}
      {into(
        'postNavMount',
        <>
          <NavBtn dir="back" disabled={!navCanBack} onClick={() => navBack()} />
          <NavBtn dir="fwd" disabled={!navCanForward} onClick={() => navForward()} />
        </>,
      )}
      {into(
        'postFrameLead',
        <>
          <span className="sb-activebar-title" id="activebarLabel">
            {t('activebarLabel')}
          </span>
          <span className="qb-empty" id="qbEmptyHint" style={showHide(!postActive)}>
            {t('qbEmptyHint')}
          </span>
        </>,
      )}
      {into(
        'postTrailMount',
        <>
          <span className="post-count" id="postCount">
            {t('postCount', [postCount])}
          </span>
          <button className="sb-reset" id="postResetBtn" type="button" style={showHide(postActive)} onClick={() => resetAllFilters()}>
            {t('reset')}
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
        <span className="qb-empty" id="posterQbEmptyHint" style={showHide(!posterActive)}>
          {t('qbEmptyHint')}
        </span>,
      )}
      {into(
        'posterTrailMount',
        <button className="sb-reset" id="posterResetBtn" type="button" style={showHide(posterActive)} onClick={() => resetPosterFilters()}>
          {t('reset')}
        </button>,
      )}
      {into('posterCount', t('posterCount', [posterCount]))}
      {/* Fixed-position help popover: viewport-relative, so it renders as a direct child. */}
      {helpOpen && <HelpPop help={{ title: t('qbHelpTitle'), rows: [t('qbHelp1'), t('qbHelp2'), t('qbHelp3'), t('qbHelp4'), t('qbHelp5')] }} />}
    </>
  );
}
