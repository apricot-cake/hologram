// Virtualized collection grid — collection cells on the shared VirtualGridHost.
// Emits the SAME DOM the old flow layout did — `.collection-card[data-cid]
// [data-index]` (+dynamic), `.collection-thumbs`, `.collection-meta`, the
// `.collection-card.new[data-cnew]` tile, and the empty state — so the delegated
// click/contextmenu handlers on #collectionGrid keep firing. React renders +
// windows; viewer.js owns the collection data, records/thumbs computation, the
// count badge, and every event. The "＋ 新規" tile rides as the last item.
import { useGridModel, VirtualGridHost } from '../_shared/VirtualGrid.jsx';

// Empty-collection cover — layers glyph, ported 1:1 from viewer.js COLL_EMPTY_ICON.
function EmptyIcon() {
  return (
    <svg className="ct-empty-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

// ⚡ dynamic-collection marker, ported 1:1 from viewer.js COLL_BOLT_ICON.
function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function Card({ c, dynamicTitle }) {
  const n = c.thumbs.length;
  return (
    <div className={'collection-card' + (c.dynamic ? ' dynamic' : '')} data-index={c.index} data-cid={c.id} tabIndex={0}>
      <div className={'collection-thumbs ' + (n ? 'n' + n : 'empty')}>{n ? c.thumbs.map((src, i) => <img key={i} src={src} alt="" loading="lazy" />) : <EmptyIcon />}</div>
      <div className="collection-meta">
        <div className="collection-name">
          {c.dynamic && (
            <span className="col-bolt" title={dynamicTitle}>
              <BoltIcon />
            </span>
          )}
          {c.name}
        </div>
        {c.dynamic && c.condChips.length > 0 && (
          <div className="collection-cond">
            {c.condChips.map((s, i) => (
              <span key={i} className="cc">
                {s}
              </span>
            ))}
          </div>
        )}
        <div className="collection-count">{c.countLabel}</div>
      </div>
    </div>
  );
}

// The trailing "＋ 新規" tile — always present, even on the empty state.
function NewCard({ label }) {
  return (
    <div className="collection-card new" data-cnew="1" tabIndex={0}>
      <div className="ct-newinner">＋</div>
      <div className="collection-meta">
        <div className="collection-name">{label}</div>
      </div>
    </div>
  );
}

// One windowed cell; the new-tile sentinel rides as the last item.
function CollectionCell({ index, data }) {
  const model = useGridModel();
  if (data.newTile) return <NewCard label={model.newLabel} />;
  return <Card c={model.modelOf(data, index)} dynamicTitle={model.dynamicTitle} />;
}

export function CollectionsHost({ model }) {
  if (model.empty) {
    // 0 collections: a full-width message + the new tile. Two elements need no
    // windowing — render them in flow, with the container's OLD grid geometry
    // inline (the CSS-file layout moved into masonic for the windowed path).
    const b = model.emptyBody;
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px' }}>
        <div className="empty-state" style={{ display: 'block', gridColumn: '1 / -1' }}>
          <p>
            <strong>{b.title}</strong>
          </p>
          <p>{b.desc}</p>
        </div>
        <NewCard label={model.newLabel} />
      </div>
    );
  }
  return <VirtualGridHost model={model} cell={CollectionCell} />;
}
