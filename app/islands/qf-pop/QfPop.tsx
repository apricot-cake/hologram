import { useSyncExternalStore, useRef, useLayoutEffect, useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { RefObject } from 'react';
import { tipProps } from '../_shared/tip.ts';
import { subscribe, get, close } from '../../renderer/qf-pop.ts';
import { subscribe as subscribeSearch, isFuzzy, compile, setMode } from '../../renderer/search.ts';

// Render list entries buildRows() flattens the facet items into.
type QfRow = { type: 'div' } | { type: 'ghead'; text: string } | { type: 'row'; item: CorpusQfPopItem };

// A tag group parsed out of the flat facet items (a ghead marker + the value rows
// that follow it, until the next ghead).
type QfGroup = { name: string; items: CorpusQfPopItem[] };

// Glass value-flyout (qf-pop) — ONE always-mounted host that renders whatever
// qf-pop.ts's bridge currently holds (or nothing). viewer.ts owns the bespoke facet
// logic (qfValues — per-category counting/sorting rules) and pick routing; this island
// owns the find-input's local filter state and draws the glass popup. Every value pick
// makes viewer.js recompute items and call open() again (matching the old
// renderQfPop()-on-every-change behavior) — open() bumps openId, which keys this
// component's root and so remounts (and re-focuses the find box) exactly like the old
// innerHTML rebuild did. Because the find box's local state lives INSIDE this
// component and typing never touches the bridge, filtering-while-focused never
// triggers this remount — the old "don't re-render on every keystroke" trick (kept to
// preserve input focus) falls out for free instead of needing a special case.
//
// Two layouts: a flat single column of .fm-row (platforms/authors/folders/…), and —
// when the items carry tag-group headings (ghead) — an Eagle-style TWO-PANE (group
// list on the left, the selected group's tags as rows on the right; 2026-07-04,
// replacing the wrapped-chip layout). Same row/CSS anatomy either way; labels arrive
// already-localized from viewer.

const Check = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="5 12.5 10 17 19 7" />
  </svg>
);

// Right-anchored flyout, maxHeight-capped so a long value list scrolls internally
// instead of overrunning the viewport (mirrors viewer.js's old placeFlyout(el, rect,
// {maxHeight:true})).
function usePlaceFlyout(popRef: RefObject<HTMLDivElement | null>, anchorRect: CorpusAnchorRect | null | undefined) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: popRef is a stable ref — anchorRect is the only reposition trigger
  useLayoutEffect(() => {
    if (!anchorRect) return;
    const pop = popRef.current;
    if (!pop) return;
    pop.style.maxHeight = '';
    pop.style.left = anchorRect.right + 8 + 'px';
    pop.style.top = anchorRect.top + 'px';
    // offsetWidth/Height, NOT getBoundingClientRect: this effect runs while corpusPopIn
    // is mid-scale(.96), so the rect under-measures ~4% and the maxHeight came out one
    // chip-row short — a sliver of scroll on a list that would have fit.
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    if (anchorRect.right + 8 + w > innerWidth - 8) pop.style.left = Math.max(8, innerWidth - w - 8) + 'px';
    let top = anchorRect.top;
    if (top + h > innerHeight - 8) {
      top = Math.max(8, innerHeight - h - 8);
      pop.style.top = top + 'px';
    }
    pop.style.maxHeight = innerHeight - top - 8 + 'px';
  }, [anchorRect]);
}

// Flatten items into a render list with group headers / a single "present vs absent"
// divider inserted — mirrors viewer.js's old renderQfPop() loop exactly. On a FLAT
// facetDim list, one divider marks where present (count>0) gives way to absent
// (count=0); grouped tag lists rely on their group headings, fixed lists keep order —
// neither gets a divider.
function buildRows(items: CorpusQfPopItem[]) {
  const hasGhead = items.some((it) => it.ghead != null);
  const out: QfRow[] = [];
  let sawPresent = false,
    dividerDone = false;
  for (const it of items) {
    if (!hasGhead && !dividerDone && it.facetDim && it.count === 0 && sawPresent) {
      out.push({ type: 'div' });
      dividerDone = true;
    }
    if (it.facetDim && it.count > 0) sawPresent = true;
    out.push(it.ghead != null ? { type: 'ghead', text: it.ghead } : { type: 'row', item: it });
  }
  return out;
}

// Split the flat facet items into tag groups (a ghead marker opens a group; the value
// rows until the next ghead are its members). Returns [] when there are no gheads.
function buildGroups(items: CorpusQfPopItem[]): QfGroup[] {
  const groups: QfGroup[] = [];
  let cur: QfGroup | null = null;
  for (const it of items) {
    if (it.ghead != null) {
      cur = { name: it.ghead, items: [] };
      groups.push(cur);
    } else if (cur) {
      cur.items.push(it);
    }
  }
  return groups;
}

// One value row, shared by both layouts.
function ValueRow({ it, onPick }: { it: CorpusQfPopItem; onPick: (it: CorpusQfPopItem) => void }) {
  return (
    <div className={'fm-row' + (it.sub ? ' fm-sub' : '') + (it.facetDim && it.count === 0 ? ' off' : '')} onClick={() => onPick(it)}>
      {it.kind && <span className={'tk-dot tk-' + it.kind} data-tip={it.dotTitle} />}
      <span className="fm-name">{it.l}</span>
      {it.count != null && <span className="fm-count">{it.count}</span>}
      {it.on && (
        <span className="fm-check">
          <Check />
        </span>
      )}
    </div>
  );
}

function QfBody({ model }: { model: CorpusQfPopModel }) {
  const [query, setQuery] = useState('');
  // Selected tag group in two-pane mode: -1 = すべて (all tags), else index into groups.
  const [groupSel, setGroupSel] = useState(-1);
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!model.showFind) return;
    const t = setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 0);
    return () => clearTimeout(t);
  }, [model.showFind]);
  const fuzzy = useSyncExternalStore(subscribeSearch, isFuzzy);

  const groups = useMemo(() => buildGroups(model.items), [model.items]);
  const twoPane = groups.length > 0;
  // Flat rows for the single-column layout (non-grouped categories).
  const rows = useMemo(() => buildRows(model.items), [model.items]);
  // All tag rows across every group, count-desc then name — the すべて view.
  const allTags = useMemo(() => groups.flatMap((g) => g.items).sort((a, b) => (b.count || 0) - (a.count || 0) || String(a.l).localeCompare(String(b.l), 'ja')), [groups]);

  // 検索方式（通常=部分一致 / あいまい=corpusSearch）はメイン検索と共有。@ プレフィックス
  // は screen name（sn）を対象にする（旧 applyQfFind と同じ規約）。
  const raw = query.trim().toLowerCase();
  const atMode = raw.startsWith('@');
  const q = atMode ? raw.slice(1) : raw;
  const matcher = q && fuzzy ? compile(q) : null;
  const hit = (hay: unknown) => {
    const s = String(hay || '').toLowerCase();
    return matcher ? matcher(s) : s.includes(q);
  };
  const filtering = !!q;
  const matchItem = (it: CorpusQfPopItem) => !filtering || (atMode ? hit(it.sn || '') : hit(it.l));
  // Flat-layout visible list (keeps dividers / any stray gheads when not filtering).
  const visible = rows.filter((r) => {
    if (r.type !== 'row') return !filtering;
    return matchItem(r.item);
  });
  // Two-pane right column: the selected group's tags (すべて = allTags), filtered.
  const paneItems = (groupSel < 0 ? allTags : groups[groupSel] ? groups[groupSel].items : []).filter(matchItem);

  return (
    <>
      {model.showFind && (
        <>
          <div className="qf-find-wrap">
            <input ref={inputRef} type="text" className="qf-find" placeholder={model.findPlaceholder} autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="seg-control seg-control--qf" role="group" aria-label={model.searchModeTitle}>
            <span className="seg-thumb" aria-hidden="true" style={{ transform: fuzzy ? '' : 'translateX(100%)' }} />
            <button type="button" className={'seg-opt' + (fuzzy ? ' is-on' : '')} data-mode="fuzzy" {...tipProps(model.fuzzyHint || '')} onClick={() => setMode('fuzzy')}>
              {model.fuzzyLabel}
            </button>
            <button type="button" className={'seg-opt' + (!fuzzy ? ' is-on' : '')} data-mode="normal" {...tipProps(model.exactHint || '')} onClick={() => setMode('normal')}>
              {model.exactLabel}
            </button>
          </div>
        </>
      )}
      {twoPane ? (
        <div className="qf-panes">
          <div className="qf-groups">
            <button type="button" className={'qf-group-row' + (groupSel < 0 ? ' active' : '')} onClick={() => setGroupSel(-1)}>
              <span className="fm-name">{model.allGroupLabel}</span>
              <span className="fm-count">{allTags.length}</span>
            </button>
            {groups.map((g, gi) => (
              <button key={gi} type="button" className={'qf-group-row' + (groupSel === gi ? ' active' : '')} onClick={() => setGroupSel(gi)}>
                <span className="fm-name">{g.name}</span>
                <span className="fm-count">{g.items.length}</span>
              </button>
            ))}
          </div>
          <div className="qf-vals">
            {paneItems.length === 0 ? (
              <div className="qf-zone-empty" style={{ padding: '6px 8px' }}>
                —
              </div>
            ) : (
              paneItems.map((it, i) => <ValueRow key={i} it={it} onPick={model.onPick} />)
            )}
          </div>
        </div>
      ) : (
        <div className="qf-vals">
          {visible.filter((r) => r.type === 'row').length === 0 ? (
            <div className="qf-zone-empty" style={{ padding: '6px 8px' }}>
              —
            </div>
          ) : (
            visible.map((r, i) => {
              if (r.type === 'div') return <div key={i} className="qf-div" />;
              if (r.type === 'ghead')
                return (
                  <div key={i} className="qf-ghead">
                    {r.text}
                  </div>
                );
              return <ValueRow key={i} it={r.item} onPick={model.onPick} />;
            })
          )}
        </div>
      )}
      {model.footerLabel && (
        <div className="qf-footer">
          <button className="qf-footer-link" type="button" onClick={() => (model.onManage as () => void)()}>
            {model.footerLabel}
          </button>
        </div>
      )}
    </>
  );
}

export function QfPopHost() {
  const model = useSyncExternalStore(subscribe, get);
  const popRef = useRef<HTMLDivElement | null>(null);
  usePlaceFlyout(popRef, model && model.anchorRect);

  // Dismiss on outside-click (capture) / Escape. Exempt .sb-row clicks: the row
  // handler already closes-and-reopens itself (avoids a double-close race) — same
  // exemption as the filter-popover island.
  useEffect(() => {
    if (!model) return;
    const onDoc = (e: MouseEvent) => {
      if (!document.contains(e.target as Node)) return;
      if (popRef.current && popRef.current.contains(e.target as Node)) return;
      if ((e.target as Element).closest('.sb-row')) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [model]);

  if (!model) return null;
  const twoPane = model.items.some((it) => it.ghead != null);
  // Key on sessionId (bumped only on a fresh open), NOT openId (bumped on every pick):
  // a value pick re-renders in place so the selected group + find text survive; opening
  // a different row remounts (fresh group/find/focus). Fall back to openId if unset.
  return createPortal(
    <div className={'fold-menu qf-pop show' + (twoPane ? ' qf-pop--twopane' : '')} ref={popRef} key={model.sessionId ?? model.openId}>
      <QfBody model={model} />
    </div>,
    document.body,
  );
}
