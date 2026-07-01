import { useSyncExternalStore, useRef, useLayoutEffect, useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';

// Glass value-flyout (qf-pop) — ONE always-mounted host that renders whatever
// window.corpusQfPop currently holds (or nothing). viewer.js owns the bespoke facet
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
// Emits the SAME DOM the old imperative builder did (.fold-menu.qf-pop >
// .qf-find-wrap/.seg-control--qf + .qf-vals > .fm-row/.qf-ghead/.qf-div + .qf-footer)
// so the existing CSS is unchanged. Labels are provided already-localized by viewer.

const Check = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="5 12.5 10 17 19 7" />
  </svg>
);

// Right-anchored flyout, maxHeight-capped so a long value list scrolls internally
// instead of overrunning the viewport (mirrors viewer.js's old placeFlyout(el, rect,
// {maxHeight:true})).
function usePlaceFlyout(popRef, anchorRect) {
  useLayoutEffect(() => {
    if (!anchorRect) return;
    const pop = popRef.current;
    if (!pop) return;
    pop.style.maxHeight = '';
    pop.style.left = (anchorRect.right + 8) + 'px';
    pop.style.top = anchorRect.top + 'px';
    const pr = pop.getBoundingClientRect();
    if (pr.right > innerWidth - 8) pop.style.left = Math.max(8, innerWidth - pr.width - 8) + 'px';
    let top = anchorRect.top;
    if (pr.bottom > innerHeight - 8) { top = Math.max(8, innerHeight - pr.height - 8); pop.style.top = top + 'px'; }
    pop.style.maxHeight = (innerHeight - top - 8) + 'px';
  }, [anchorRect]);
}

// Flatten items into a render list with group headers / a single "present vs absent"
// divider inserted — mirrors viewer.js's old renderQfPop() loop exactly. On a FLAT
// facetDim list, one divider marks where present (count>0) gives way to absent
// (count=0); grouped tag lists rely on their group headings, fixed lists keep order —
// neither gets a divider.
function buildRows(items) {
  const hasGhead = items.some((it) => it.ghead != null);
  const out = [];
  let sawPresent = false, dividerDone = false;
  for (const it of items) {
    if (!hasGhead && !dividerDone && it.facetDim && it.count === 0 && sawPresent) { out.push({ type: 'div' }); dividerDone = true; }
    if (it.facetDim && it.count > 0) sawPresent = true;
    out.push(it.ghead != null ? { type: 'ghead', text: it.ghead } : { type: 'row', item: it });
  }
  return out;
}

function QfBody({ model }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  useEffect(() => {
    if (!model.showFind) return;
    const t = setTimeout(() => { if (inputRef.current) inputRef.current.focus(); }, 0);
    return () => clearTimeout(t);
  }, [model.showFind]);
  const fuzzy = useSyncExternalStore(window.corpusSearch.onChange, window.corpusSearch.isFuzzy);

  const rows = useMemo(() => buildRows(model.items), [model.items]);
  const hasAnyRows = useMemo(() => rows.some((r) => r.type === 'row'), [rows]);

  // 検索方式（通常=部分一致 / あいまい=corpusSearch）はメイン検索と共有。@ プレフィックス
  // は screen name（sn）を対象にする（旧 applyQfFind と同じ規約）。
  const raw = query.trim().toLowerCase();
  const atMode = raw.startsWith('@');
  const q = atMode ? raw.slice(1) : raw;
  const matcher = q && fuzzy ? window.corpusSearch.compile(q) : null;
  const hit = (hay) => { const s = String(hay || '').toLowerCase(); return matcher ? matcher(s) : s.includes(q); };
  const filtering = !!q;
  const visible = rows.filter((r) => {
    if (r.type !== 'row') return !filtering;
    return !filtering || (atMode ? hit(r.item.sn || '') : hit(r.item.l));
  });

  return (
    <>
      {model.showFind && (
        <>
          <div className="qf-find-wrap">
            <input ref={inputRef} type="text" className="qf-find" placeholder={model.findPlaceholder}
              autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className={'seg-control seg-control--qf' + (fuzzy ? ' is-fuzzy' : '')} role="group" aria-label={model.searchModeTitle}>
            <span className="seg-thumb" aria-hidden="true" />
            <button type="button" className={'seg-opt' + (!fuzzy ? ' is-on' : '')} data-mode="normal"
              title={model.exactHint} onClick={() => window.corpusSearch.setMode('normal')}>{model.exactLabel}</button>
            <button type="button" className={'seg-opt' + (fuzzy ? ' is-on' : '')} data-mode="fuzzy"
              title={model.fuzzyHint} onClick={() => window.corpusSearch.setMode('fuzzy')}>{model.fuzzyLabel}</button>
          </div>
        </>
      )}
      <div className="qf-vals">
        {!hasAnyRows ? <div className="qf-zone-empty" style={{ padding: '6px 8px' }}>—</div> : visible.map((r, i) => {
          if (r.type === 'div') return <div key={i} className="qf-div" />;
          if (r.type === 'ghead') return <div key={i} className="qf-ghead">{r.text}</div>;
          const it = r.item;
          return (
            <div key={i} className={'fm-row' + (it.sub ? ' fm-sub' : '') + (it.facetDim && it.count === 0 ? ' off' : '')}
              onClick={() => model.onPick(it)}>
              {it.kind && <span className={'tk-dot tk-' + it.kind} title={it.dotTitle} />}
              <span className="fm-name">{it.l}</span>
              {it.count != null && <span className="fm-count">{it.count}</span>}
              {it.on && <span className="fm-check"><Check /></span>}
            </div>
          );
        })}
      </div>
      {model.footerLabel && (
        <div className="qf-footer">
          <button className="qf-footer-link" type="button" onClick={() => model.onManage()}>{model.footerLabel}</button>
        </div>
      )}
    </>
  );
}

export function QfPopHost() {
  const model = useSyncExternalStore(window.corpusQfPop.subscribe, window.corpusQfPop.get);
  const popRef = useRef(null);
  usePlaceFlyout(popRef, model && model.anchorRect);

  // Dismiss on outside-click (capture) / Escape. Exempt .sb-row / [data-tag-group]
  // clicks: the row handler already closes-and-reopens itself (avoids a double-close
  // race) — same exemption as the filter-popover island.
  useEffect(() => {
    if (!model) return;
    const onDoc = (e) => {
      if (!document.contains(e.target)) return;
      if (popRef.current && popRef.current.contains(e.target)) return;
      if (e.target.closest('.sb-row') || e.target.closest('[data-tag-group]')) return;
      window.corpusQfPop.close();
    };
    const onKey = (e) => { if (e.key === 'Escape') window.corpusQfPop.close(); };
    document.addEventListener('click', onDoc, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('click', onDoc, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [model]);

  if (!model) return null;
  return createPortal(
    <div className="fold-menu qf-pop show" ref={popRef} key={model.openId}>
      <QfBody model={model} />
    </div>,
    document.body
  );
}
