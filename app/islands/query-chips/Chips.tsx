// Presentational chips for the query-builder active bar (改訂④ ファセット・
// チップ, docs/design-query-builder.md). Values cluster by attribute inside one
// glass pill; the only operator surface is the すべて/どれか toggle (.qb-opt) on
// multi-value clusters; exclusions render in the 除く cluster; a non-facet
// persisted tree renders as a read-only summary. Emits `data-nid` ids so the
// delegated handlers (click/contextmenu) on the container keep resolving nodes
// via viewer.js's qbNodeMap. React renders; the builder owns state + events.

import { Fragment } from 'react';

// The view-model viewer.js's createQueryBuilder render() pushes.
interface QbItem {
  id: string;
  label: string;
  isNew?: boolean;
  editable?: boolean;
  glyph: string;
  typeCls: string;
}
interface QbCluster {
  id: string | null; // the group node's id (2+ values) — the opt segment writes here
  typeCls: string;
  glyph: string;
  items: QbItem[];
  op?: 'and' | 'or' | null; // current operator; null = no switch (single value / schema-forced)
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
  excl?: { label: string; items: QbItem[] } | null;
  summary?: { text: string; tip: string } | null;
  delTitle?: string;
  optAll?: string;
  optAny?: string;
  optAllTip?: string;
  optAnyTip?: string;
}

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
// their editor on click (data-edit); right-click → 除外/削除 menu (viewer.js).
function Val({ it, delTitle, withGlyph }: { it: QbItem; delTitle?: string; withGlyph?: boolean }) {
  const cls = 'qb-val ' + it.typeCls + (it.isNew ? ' chip-new' : '') + (it.editable ? ' qb-val-edit' : '');
  return (
    <span className={cls} data-nid={it.id} data-edit={it.editable ? '1' : undefined}>
      {withGlyph && <Glyph html={it.glyph} />}
      <span className="qb-val-label">{it.label}</span>
      <button type="button" className="qb-del-btn" data-act="del" data-nid={it.id} title={delTitle} aria-label={delTitle} tabIndex={-1}>
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
function OptSeg({ c, shared }: { c: QbCluster; shared: QbShared }) {
  const seg = (op: 'and' | 'or', word?: string, tip?: string) => (
    <button type="button" className={'qb-opt-btn' + (c.op === op ? ' is-on' : '')} data-act="opt" data-op={op} data-nid={c.id} title={tip}>
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
function Cluster({ c, shared }: { c: QbCluster; shared: QbShared }) {
  return (
    <span className={'qb-cluster sb-active-chip ' + c.typeCls}>
      <Glyph html={c.glyph} />
      {c.items.map((it, i) => (
        <Fragment key={it.id}>
          {i > 0 && <span className="qb-sep">・</span>}
          <Val it={it} delTitle={shared.delTitle} />
        </Fragment>
      ))}
      {c.op && c.id && <OptSeg c={c} shared={shared} />}
    </span>
  );
}

// The 除く cluster: a leading word instead of a type glyph (its values can mix
// types, so each value carries its own glyph). Root-AND semantics make it read
// "none of these" — no operator ambiguity, nothing to toggle.
function Excl({ e, shared }: { e: { label: string; items: QbItem[] }; shared: QbShared }) {
  return (
    <span className="qb-cluster qb-cluster-excl sb-active-chip">
      <span className="qb-excl-label">{e.label}</span>
      {e.items.map((it, i) => (
        <Fragment key={it.id}>
          {i > 0 && <span className="qb-sep">・</span>}
          <Val it={it} delTitle={shared.delTitle} withGlyph />
        </Fragment>
      ))}
    </span>
  );
}

// The whole bar's chips: optional search echo segment (posters only — posts fold
// the term into the tree as a real leaf), the attribute clusters, the 除く
// cluster, or the read-only summary of a non-facet persisted tree.
export function Chips({ model }: { model?: ChipsModel | null }) {
  if (!model) return null;
  const shared = { delTitle: model.delTitle, optAll: model.optAll, optAny: model.optAny, optAllTip: model.optAllTip, optAnyTip: model.optAnyTip };
  return (
    <>
      {model.searchSeg && (
        <>
          <span className="sb-active-chip qc-search" data-special="search">
            <Glyph html={model.searchSeg.glyph} />
            {model.searchSeg.text}
          </span>
          {model.searchJoin && <span className="qc-conn">{model.joinAndWord}</span>}
        </>
      )}
      {model.summary ? (
        <span className="qb-summary" title={model.summary.tip}>
          {model.summary.text}
        </span>
      ) : (
        <>
          {model.clusters.map((c, i) => (
            <Cluster key={c.typeCls + i} c={c} shared={shared} />
          ))}
          {model.excl && <Excl e={model.excl} shared={shared} />}
        </>
      )}
    </>
  );
}
