// Presentational chips for the query-builder active bar. Emits the SAME DOM the
// old viewer.js innerHTML did — `.qb-pill`/`.qb-grp`/`.qb-op`/`.qb-paren` with the
// `data-nid` ids — so the delegated handlers (click/drag/contextmenu) on the
// container keep resolving nodes via viewer.js's qbNodeMap. React renders; the
// builder keeps owning state + ids + events.

import type { ReactNode } from 'react';

// The view-model viewer.js's createQueryBuilder render() pushes. Leaves (kind
// 'cond') and groups share one node shape; only the fields each renderer reads.
interface QbNode {
  id: string;
  kind?: string;
  neg?: boolean;
  isNew?: boolean;
  typeCls?: string;
  glyph?: string;
  label?: string;
  opWord?: string;
  children?: QbNode[];
}
interface QbShared {
  delTitle?: string;
  opTitle?: string;
}
export interface ChipsModel {
  root: QbNode;
  searchSeg?: { glyph: string; text: string } | null;
  searchJoin?: boolean;
  joinAndWord?: string;
  addBtn?: boolean;
  addBtnTitle?: string;
  delTitle?: string;
  opTitle?: string;
}

// In-pill delete ✕ — ported 1:1 from viewer.js's `delIc` string.
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
// transparent — the old DOM had the <svg> as a direct child, and the glyph CSS
// (`.sb-active-chip .qc-ic`) is a descendant rule, so this matches either way.
function Glyph({ html }: { html: string }) {
  // biome-ignore lint/security/noDangerouslySetInnerHtml: established SVG-glyph pattern — qcGlyph strings are app-defined constants from viewer.js, never user content
  return <span style={{ display: 'contents' }} dangerouslySetInnerHTML={{ __html: html }} />;
}

// A condition leaf → draggable pill (hover ✕ deletes; left-click opens the leaf
// editor for date/engagement; right-click → negate/delete menu — all in viewer.js).
function Pill({ n, delTitle }: { n: QbNode; delTitle?: string }) {
  const cls = 'qb-pill sb-active-chip ' + n.typeCls + (n.neg ? ' neg' : '') + (n.isNew ? ' chip-new' : '');
  return (
    <span className={cls} draggable data-nid={n.id}>
      <Glyph html={n.glyph as string} />
      {n.neg && <span className="qb-ne">≠</span>}
      <span className="qb-pill-label">{n.label}</span>
      <button type="button" className="qb-del-btn" data-act="del" data-nid={n.id} title={delTitle} aria-label={delTitle} tabIndex={-1}>
        <DelIc />
      </button>
    </span>
  );
}

// A group → its members joined by clickable operator connectors. The root renders
// bare members (no parens, connectors are `.qb-op-root`); a non-root group is
// wrapped in literal parens and may be negated. Every connector in a group carries
// the group's id, so clicking any of them toggles that group's operator.
function Group({ n, isRoot, shared }: { n: QbNode; isRoot: boolean; shared: QbShared }) {
  const items: ReactNode[] = [];
  (n.children as QbNode[]).forEach((c, i) => {
    if (i > 0) {
      items.push(
        <button key={'op' + i} type="button" className={isRoot ? 'qb-op qb-op-root' : 'qb-op'} data-act="op" data-nid={n.id} title={shared.opTitle} draggable={isRoot ? undefined : true}>
          {n.opWord}
        </button>,
      );
    }
    items.push(<Node key={'n' + i} n={c} shared={shared} />);
  });
  if (isRoot) return <>{items}</>;
  return (
    <span className={'qb-grp' + (n.neg ? ' neg' : '')} data-nid={n.id}>
      <span className="qb-paren qb-paren-l" draggable>
        {(n.neg ? '≠' : '') + '('}
      </span>
      {items}
      <span className="qb-paren qb-paren-r" draggable>
        )
      </span>
    </span>
  );
}

function Node({ n, shared }: { n: QbNode; shared: QbShared }) {
  return n.kind === 'cond' ? <Pill n={n} delTitle={shared.delTitle} /> : <Group n={n} isRoot={false} shared={shared} />;
}

// The whole bar's chips: optional search echo segment (posters only — posts fold
// the term into the tree as a real leaf), the tree root, and the add-group button.
export function Chips({ model }: { model?: ChipsModel | null }) {
  if (!model) return null;
  const shared = { delTitle: model.delTitle, opTitle: model.opTitle };
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
      <Group n={model.root} isRoot shared={shared} />
      {model.addBtn && (
        <button type="button" className="qb-group-add" data-qb-group-add="" title={model.addBtnTitle}>
          ( )
        </button>
      )}
    </>
  );
}
