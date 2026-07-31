import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { t } from '../_shared/i18n.ts';
import { get as storeGet, subscribe as storeSubscribe } from '../services/store.ts';
import { navBack, navForward, resetAllFilters, resetPosterFilters } from '../services/orchestrator.ts';

// The query-builder FRAME components for #postActiveBar / #posterActiveBar — the chrome
// AROUND the chips: nav 戻る/進む, the フィルター title, the empty-bar hint, the result
// count, the リセット button, and the ⓘ help popover. Self-derived: every
// read-only field comes straight from hologramStore ('postQueryTree'/'posterQueryTree'/
// 'searchQuery'/'postGroups'/'posterGroups'/'navCanBack'/'navCanForward' — all already
// mirrored there by orchestrator.ts for other consumers) + t(); the 4 actions (nav/reset) import
// navBack/navForward/resetAllFilters/resetPosterFilters directly from orchestrator.ts —
// the old orchestrator bridge for these is gone. No more pushed model (the old
// renderer/activebar.ts bridge is gone too).
//
// The chips used to be their OWN component rendering into #queryChips /
// #posterQueryChips, so the frame could NOT be a single portal into the bar (that would
// replace the chips container). Instead each dynamic piece portals into a static
// sub-mount that sits BESIDE where the chips were (#postNavMount / #postFrameLead /
// #postTrailMount / #posterFrameLead / #posterTrailMount / #posterCount). Same
// ids/classes as the old static HTML so CSS + the verify scripts that click
// #postResetBtn etc. keep working. (The chips themselves are the toolbar's FilterChips
// now; their containers went with the render path in #230.)

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
  const label = back ? '戻る (Alt+←)' : '進む (Alt+→)';
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button className="icon-btn icon-btn--ghost" id={back ? 'navBackBtn' : 'navFwdBtn'} type="button" aria-label={back ? '戻る' : '進む'} disabled={disabled} onClick={onClick}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points={back ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
            </svg>
          </button>
        }
      />
      <TooltipContent side="bottom" align="start">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

// ⓘ how-to-read-the-filters hint — a multi-line ("rich") Tooltip. It used to be a
// hand-rolled .qb-help-pop: a fixed-position div placed under the button by hand and
// clamped to the right edge, with its own Escape handler and open state. Base UI owns
// placement, collision flipping and dismissal now (#62); all that is left here is the
// content and how wide it may get.
function HelpTip() {
  const rows = [t('qbHelp1'), t('qbHelp2'), t('qbHelp3'), t('qbHelp4'), t('qbHelp5')];
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button className="qb-help" id="qbHelpBtn" type="button" aria-label={t('qbHelpTitle')}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="9" />
              <line x1="12" y1="11" x2="12" y2="16" />
              <line x1="12" y1="7.6" x2="12" y2="7.7" />
            </svg>
          </button>
        }
      />
      {/* Explanatory prose, not a label: it wraps, stacks and reads left-aligned, so the
          single-line defaults (inline-flex / items-center / max-w-xs) are overridden here.
          Same 360px ceiling the hand-rolled popover had. */}
      <TooltipContent side="bottom" align="end" className="max-w-[min(360px,calc(100vw-1rem))] flex-col items-start gap-1 p-3 text-left leading-relaxed">
        <span className="font-bold">{t('qbHelpTitle')}</span>
        {rows.map((row) => (
          <span className="flex gap-1.5" key={row}>
            <span aria-hidden="true" className="shrink-0 opacity-60">
              ・
            </span>
            {row}
          </span>
        ))}
      </TooltipContent>
    </Tooltip>
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
          <HelpTip />
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
    </>
  );
}
