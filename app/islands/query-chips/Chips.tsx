// Presentational chips for the query-builder active bar (改訂④ ファセット・
// チップ). Values cluster by attribute inside one
// glass pill; the only operator surface is the すべて/どれか toggle (.qb-opt) on
// multi-value clusters; exclusions render in the 除く cluster; a non-facet
// persisted tree renders as a read-only summary. Each interactive element calls
// `dispatch()` directly (P4-B スライス⑦ event半分 — no more DOM delegation);
// query-chips.ts resolves the `nid` against its qbNodeMap and mutates the tree.
// `data-nid`/`data-op` stay on the DOM (test scripts + manual introspection
// query them), they just aren't read back by any handler anymore.

import { Fragment } from 'react';

// The view-model viewer.js's createQueryBuilder render() pushes.
// `leaving` is set only by the island's AnimatedChips wrapper (never by
// viewer.js): a removed value/cluster is kept as a ghost for the length of the
// corpusPillOut exit animation, then pruned.
export interface QbItem {
  id: string;
  label: string;
  isNew?: boolean;
  leaving?: boolean;
  editable?: boolean;
  glyph: string;
  typeCls: string;
}
export interface QbCluster {
  id: string | null; // the group node's id (2+ values) — the opt segment writes here
  typeCls: string;
  glyph: string;
  items: QbItem[];
  op?: 'and' | 'or' | null; // current operator; null = no switch (single value / schema-forced)
  leaving?: boolean;
}
interface QbShared {
  delTitle?: string;
  optAll?: string;
  optAny?: string;
  optAllTip?: string;
  optAnyTip?: string;
}
export interface ChipsModel {
  searchSeg?: { glyph: string; text: string } | null;
  searchJoin?: boolean;
  joinAndWord?: string;
  clusters: QbCluster[];
  excl?: { label: string; items: QbItem[]; leaving?: boolean } | null;
  summary?: { text: string; tip: string } | null;
  delTitle?: string;
  optAll?: string;
  optAny?: string;
  optAllTip?: string;
  optAnyTip?: string;
}

// Actions routed to query-chips.ts's per-instance dispatch(). `nid` is a
// qbNodeMap id from the model just rendered (rebuilt fresh each render(), so
// it's always in sync with what dispatch() resolves against).
export type ChipsAction = { act: 'opt'; nid: string; op: 'and' | 'or' } | { act: 'del'; nid: string } | { act: 'clearSearch' } | { act: 'edit'; nid: string } | { act: 'menu'; nid: string; x: number; y: number };
type Dispatch = (action: ChipsAction) => void;

// In-value delete ✕ — ported 1:1 from the 改訂③ pill.
function DelIc() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

// Raw glyph SVG from viewer.js's qcGlyph (a `<svg class="qc-ic">…`). Inserted via
// dangerouslySetInnerHTML; the wrapper is display:contents so it stays layout-
// transparent (the glyph CSS is a descendant rule either way).
function Glyph({ html }: { html: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: established SVG-glyph pattern — qcGlyph strings are app-defined constants from viewer.js, never user content
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

// One value inside a cluster: label + hover ✕; date/engagement values open
// their editor on click (data-edit); right-click → 除外/削除 menu (query-chips.ts).
function Val({ it, delTitle, withGlyph, dispatch }: { it: QbItem; delTitle?: string; withGlyph?: boolean; dispatch: Dispatch }) {
  const cls = 'qb-val ' + it.typeCls + (it.isNew ? ' chip-new' : '') + (it.leaving ? ' leaving' : '') + (it.editable ? ' qb-val-edit' : '');
  return (
    <span
      className={cls}
      data-nid={it.id}
      data-edit={it.editable ? '1' : undefined}
      onClick={it.editable ? () => dispatch({ act: 'edit', nid: it.id }) : undefined}
      onContextMenu={(e) => {
        e.preventDefault();
        dispatch({ act: 'menu', nid: it.id, x: e.clientX, y: e.clientY });
      }}
    >
      {withGlyph && <Glyph html={it.glyph} />}
      <span className="qb-val-label">{it.label}</span>
      <button
        type="button"
        className="qb-del-btn"
        data-act="del"
        data-nid={it.id}
        data-tip={delTitle}
        aria-label={delTitle}
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation(); // don't also fire the outer Val's edit onClick
          dispatch({ act: 'del', nid: it.id });
        }}
      >
        <DelIc />
      </button>
    </span>
  );
}

// An attribute cluster: one glass pill = type glyph + values joined by 「・」 +
// the optional すべて/どれか segment. A single-value cluster reads like the old
// single pill — same shape, zero new vocabulary.
// The segment shows BOTH options (mini scope-bar) so it reads as a pressable
// two-way switch, not a status badge — the ぴったり/おおまか precedent, which
// replaced a lone word chip for exactly this discoverability failure.
function OptSeg({ c, shared, dispatch }: { c: QbCluster; shared: QbShared; dispatch: Dispatch }) {
  const seg = (op: 'and' | 'or', word?: string, tip?: string) => (
    <button type="button" className={'qb-opt-btn' + (c.op === op ? ' is-on' : '')} data-act="opt" data-op={op} data-nid={c.id} data-tip={tip} onClick={() => c.id && dispatch({ act: 'opt', nid: c.id, op })}>
      {word}
    </button>
  );
  return (
    <span className="qb-opt" role="group">
      {seg('and', shared.optAll, shared.optAllTip)}
      {seg('or', shared.optAny, shared.optAnyTip)}
    </span>
  );
}
function Cluster({ c, shared, dispatch }: { c: QbCluster; shared: QbShared; dispatch: Dispatch }) {
  return (
    <span className={'qb-cluster sb-active-chip ' + c.typeCls + (c.leaving ? ' leaving' : '')}>
      <Glyph html={c.glyph} />
      {c.items.map((it, i) => (
        <Fragment key={it.id}>
          {i > 0 && <span className="qb-sep">・</span>}
          <Val it={it} delTitle={shared.delTitle} dispatch={dispatch} />
        </Fragment>
      ))}
      {c.op && c.id && <OptSeg c={c} shared={shared} dispatch={dispatch} />}
    </span>
  );
}

// The 除く cluster: a leading word instead of a type glyph (its values can mix
// types, so each value carries its own glyph). Root-AND semantics make it read
// "none of these" — no operator ambiguity, nothing to toggle.
function Excl({ e, shared, dispatch }: { e: { label: string; items: QbItem[]; leaving?: boolean }; shared: QbShared; dispatch: Dispatch }) {
  return (
    <span className={'qb-cluster qb-cluster-excl sb-active-chip' + (e.leaving ? ' leaving' : '')}>
      <span className="qb-excl-label">{e.label}</span>
      {e.items.map((it, i) => (
        <Fragment key={it.id}>
          {i > 0 && <span className="qb-sep">・</span>}
          <Val it={it} delTitle={shared.delTitle} withGlyph dispatch={dispatch} />
        </Fragment>
      ))}
    </span>
  );
}

// The whole bar's chips: optional search echo segment (posters only — posts fold
// the term into the tree as a real leaf), the attribute clusters, the 除く
// cluster, or the read-only summary of a non-facet persisted tree.
export function Chips({ model, dispatch }: { model?: ChipsModel | null; dispatch: Dispatch }) {
  if (!model) return null;
  const shared = { delTitle: model.delTitle, optAll: model.optAll, optAny: model.optAny, optAllTip: model.optAllTip, optAnyTip: model.optAnyTip };
  return (
    <>
      {model.searchSeg && (
        <>
          <span className="sb-active-chip qc-search" data-special="search" onClick={() => dispatch({ act: 'clearSearch' })}>
            <Glyph html={model.searchSeg.glyph} />
            {model.searchSeg.text}
          </span>
          {model.searchJoin && <span className="qc-conn">{model.joinAndWord}</span>}
        </>
      )}
      {model.summary ? (
        <span className="qb-summary" data-tip={model.summary.tip} data-tip-rich="">
          {model.summary.text}
        </span>
      ) : (
        <>
          {model.clusters.map((c, i) => (
            <Cluster key={c.typeCls + i} c={c} shared={shared} dispatch={dispatch} />
          ))}
          {model.excl && <Excl e={model.excl} shared={shared} dispatch={dispatch} />}
        </>
      )}
    </>
  );
}
