// Collection grid — a plain uniform CSS grid (aligned rows), NOT masonic masonry.
// Collections are few (user-created folders) and mostly uniform, so the Pinterest-
// style stagger read as broken (user 2026-07-04: 組み方が変); a uniform grid is the
// right shape and needs no virtualization at this count. Emits the SAME DOM the old
// flow layout did — `.collection-card[data-cid][data-index]` (+dynamic),
// `.collection-thumbs`, `.collection-meta`, the `.collection-card.new[data-cnew]`
// create tile, and the empty state — so the delegated click/contextmenu handlers on
// #collectionGrid keep firing. viewer.js owns the data, thumbs, count, and events.

// The collection cell model viewer.js resolves per card — only the fields laid out here.
interface CollectionCardModel {
  index: number;
  id?: string;
  name?: string;
  dynamic?: boolean;
  thumbs: string[];
  condChips: string[];
  countLabel?: string;
}

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

function Card({ c, dynamicTitle }: { c: CollectionCardModel; dynamicTitle?: string }) {
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

// The leading "＋ 新規" create tile — always present, even on the empty state.
// The big glyph IS the plus, so the label is just "新規" (the collNew string no
// longer carries its own ＋ — user 2026-07-04: ＋＋新規).
function NewCard({ label }: { label?: string }) {
  return (
    <div className="collection-card new" data-cnew="1" tabIndex={0}>
      <div className="ct-newinner">＋</div>
      <div className="collection-meta">
        <div className="collection-name">{label}</div>
      </div>
    </div>
  );
}

export function CollectionsHost({ model }: { model: CorpusGridModel }) {
  if (model.empty) {
    // 0 collections: a full-width message + the create tile.
    const b = model.emptyBody;
    return (
      <div className="collection-grid-inner">
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
  const items = model.items || [];
  return (
    <div className="collection-grid-inner">
      {items.map((it, i) => (it.newTile ? <NewCard key="__new" label={model.newLabel} /> : <Card key={it.id ?? i} c={model.modelOf(it, i)} dynamicTitle={model.dynamicTitle} />))}
    </div>
  );
}
